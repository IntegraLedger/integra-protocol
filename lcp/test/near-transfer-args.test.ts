// `ft_transfer`'s arguments as the token contract reads them. near-sdk reads a JSON method's arguments with
// `serde_json::from_slice` into a struct serde derives from the method's parameters (near-sdk-macros,
// src/core_impl/code_generator/impl_item_method_info.rs and attr_sig_info.rs), and NEP-141's method is
// `ft_transfer(receiver_id: AccountId, amount: U128, memo: Option<String>)` (near-contract-standards,
// src/fungible_token/core.rs). The derived reader refuses a field it names that appears twice, and skips any other key
// each time it appears (serde_derive, src/de/struct_.rs); a missing `Option` field is `None` and any other missing
// field is refused (serde, src/private/de.rs). serde_json reads each key of the object as a string and refuses an
// escape that decodes to a lone surrogate, while a skipped value's strings and keys are not held to that (serde_json,
// src/read.rs and src/de.rs). A `U128` is a JSON string that Rust's `u128::from_str` reads (near-sdk-core,
// src/json_types/integers.rs): an optional `+`, then one or more ASCII digits, at most 2^128 - 1 (core,
// src/num/mod.rs). The pairing binds and recovers H only from arguments the contract reads, and refuses the others as
// `near/args-malformed`; a `memo` keeps the pairing's own codes, `near/memo-missing` and `near/memo-not-lcp`.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AtrHash } from "../src/core.js";
import { exactNear, ftTransferArgs, nearCarrier, type NearReader } from "../src/near.js";
import type { PaymentRequirements } from "../src/x402.js";
import { rowsOf } from "./rows.js";

const V = JSON.parse(readFileSync(new URL("../vectors/x402-exact-near.json", import.meta.url), "utf8"));
const H: AtrHash = V.fixed.H;
const O: PaymentRequirements = V.fixed.O;

// V2's signed delegate action with its arguments, u32-length bytes after the method name, replaced.
const v2 = Buffer.from(V.V2.expectSignedDelegateAction, "base64");
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};
const senderEnd = 4 + v2.readUInt32LE(0);
const receiverEnd = senderEnd + 4 + v2.readUInt32LE(senderEnd);
const methodAt = receiverEnd + 4 + 1;
const argsAt = methodAt + 4 + v2.readUInt32LE(methodAt);
const argsEnd = argsAt + 4 + v2.readUInt32LE(argsAt);
const sdaWithArgs = (text: string) => {
  const b = Buffer.from(text, "utf8");
  return Buffer.concat([v2.subarray(0, argsAt), u32(b.length), b, v2.subarray(argsEnd)]).toString("base64");
};
const payment = (signedDelegateAction: string) => ({
  x402Version: 2,
  resource: V.fixed.resource,
  accepted: O,
  payload: { signedDelegateAction },
});

// V3's settled recover fixture, its delegate's arguments replaced.
const landed = V.V3.recover[0];
const readerWithArgs = (text: string): NearReader => ({
  network: V.V3.ref.network,
  relayers: V.V3.relayers,
  txStatus: async () => ({
    ...landed.outcome,
    delegate: { ...landed.outcome.delegate, nonce: BigInt(landed.outcome.delegate.nonce), argsBase64: Buffer.from(text, "utf8").toString("base64") },
  }),
  finalHeight: async () => 0n,
  accessKeyNonce: async () => null,
});

// V1's arguments, member by member: R, A and M.
const R = '"receiver_id":"merchant.testnet"';
const A = '"amount":"1000000"';
const M = `"memo":${JSON.stringify(JSON.parse(V.V1.expectArgsUtf8).memo)}`;
const args = (...members: string[]) => `{${members.join(",")}}`;
const withAmount = (amount: string) => args(R, `"amount":${amount}`, M);

/**
 * `bound`'s answer, H or the refusal's code, once `nearCarrier`, `reference` and `recover`, reading the arguments from
 * a settled transaction's delegate, give the same; else what differs.
 */
async function answer(text: string): Promise<string> {
  const sda = sdaWithArgs(text);
  const b = await exactNear.bound(payment(sda));
  const c = nearCarrier(sda);
  const r = await exactNear.reference(payment(sda));
  const v = await exactNear.recover({ network: V.V3.ref.network, transaction: V.V3.ref.transaction }, readerWithArgs(text));
  const of = (x: unknown, ok: (v: unknown) => boolean) =>
    typeof x === "object" && x !== null && "refused" in x ? String((x as { code?: unknown }).code) : ok(x) ? "H" : JSON.stringify(x);
  const each = [
    of(b, (x) => x === H),
    of(c, (x) => (x as { h?: unknown }).h === H),
    of(r, (x) => typeof (x as { argsDigest?: unknown }).argsDigest === "string"),
    of(v, (x) => x === H),
  ];
  return each.every((x) => x === each[0]) ? each[0]! : `differ: ${each.join(" | ")}`;
}

async function answers(rows: readonly (readonly [string, string, string])[]): Promise<string[][]> {
  const out: string[][] = [];
  for (const [label, text, want] of rows) out.push([label, await answer(text), want]);
  return out;
}
const wanted = (rows: readonly (readonly [string, string, string])[]) => rows.map(([label, , want]) => [label, want, want]);

describe("ft_transfer's arguments as the token contract reads them", () => {
  it("V1's arguments bind H at bound, nearCarrier and reference, and recover recovers it", async () => {
    expect(V.V1.expectArgsUtf8).toBe(args(R, A, M));
    expect(await answer(args(R, A, M))).toBe("H");
  });

  // serde_derive src/de/struct_.rs: a field the struct names, met a second time, is `duplicate_field`; JSON.parse keeps
  // the last of two equal keys, so a check of the parsed object alone cannot see it.
  it("a key the contract reads, named more than once, is near/args-malformed, its escapes decoded", async () => {
    const rows = rowsOf(
      [
        ["receiver_id twice, Not An Id first", args('"receiver_id":"Not An Id"', R, A, M), "near/args-malformed"],
        ["receiver_id twice, Not An Id last", args(R, '"receiver_id":"Not An Id"', A, M), "near/args-malformed"],
        ["receiver_id twice, each merchant.testnet", args(R, A, M, R), "near/args-malformed"],
        ["receiver_id twice, two account ids", args(R, A, M, '"receiver_id":"other.testnet"'), "near/args-malformed"],
        ["receiver_id three times", args(R, R, A, M, R), "near/args-malformed"],
        ["amount twice, each 1000000", args(R, A, A, M), "near/args-malformed"],
        ["amount twice, a number first", args(R, '"amount":1', A, M), "near/args-malformed"],
        ["memo twice, the LCP string last", args(R, A, '"memo":"a free-form memo"', M), "near/args-malformed"],
        ["memo twice, the LCP string first", args(R, A, M, '"memo":"a free-form memo"'), "near/args-malformed"],
        ["memo twice, each the LCP string", args(R, A, M, M), "near/args-malformed"],
        ["memo twice, null first", args(R, A, '"memo":null', M), "near/args-malformed"],
        ["receiver\\u005fid after receiver_id", args(R, A, M, '"receiver\\u005fid":"merchant.testnet"'), "near/args-malformed"],
        ["receiver\\u005Fid before receiver_id", args('"receiver\\u005Fid":"merchant.testnet"', R, A, M), "near/args-malformed"],
        ["\\u0061mount after amount", args(R, A, M, '"\\u0061mount":"1000000"'), "near/args-malformed"],
        ["m\\u0065mo after memo", args(R, A, M, `"m\\u0065mo":${JSON.stringify(JSON.parse(V.V1.expectArgsUtf8).memo)}`), "near/args-malformed"],
        ["memo written all in escapes, after memo", args(R, A, M, '"\\u006d\\u0065\\u006d\\u006f":"x"'), "near/args-malformed"],
      ] as const,
      "repeated keys",
      { exact: 16 },
    );
    expect(await answers(rows)).toEqual(wanted(rows));
  });

  // serde_derive src/de/struct_.rs skips every other key as `IgnoredAny`, each time it appears; near-sdk refuses
  // unknown keys only for a method marked `deny_unknown_arguments` (attr_sig_info.rs). A skipped value's strings and
  // keys are skipped by `ignore_str`, which takes a lone surrogate escape (serde_json src/read.rs, src/de.rs).
  it("any other key is skipped, however often it repeats, and so is what it holds", async () => {
    const rows = rowsOf(
      [
        ["note twice", args(R, A, M, '"note":"a"', '"note":"b"'), "H"],
        ["Receiver_id, another key", args(R, A, M, '"Receiver_id":"Not An Id"'), "H"],
        ["receiver_id and a space, another key", args(R, A, M, '"receiver_id ":"Not An Id"'), "H"],
        ["memo and NUL, another key", args(R, A, M, '"memo\\u0000":"x"'), "H"],
        ["receiver_id twice inside another key's object", args(R, A, M, '"extra":{"receiver_id":"x","receiver_id":"y"}'), "H"],
        ["memo twice inside another key's array", args(R, A, M, '"extra":[{"memo":1,"memo":2},{"memo":3}]'), "H"],
        ["a lone surrogate key inside another key's object", args(R, A, M, '"extra":{"\\ud800":1}'), "H"],
        ["a lone surrogate in another key's value", args(R, A, M, '"note":"\\ud800"'), "H"],
        ["a surrogate pair key", args(R, A, M, '"\\ud83d\\ude00":1'), "H"],
        ["a key holding an escaped quote and receiver_id", args(R, A, M, '"a\\",\\"receiver_id":1'), "H"],
        ["a value holding receiver_id's text", args(R, A, M, '"note":"\\",\\"receiver_id\\":\\"Not An Id"'), "H"],
        ["a value holding braces and a comma", args(R, A, M, '"note":"}{,[\\"memo\\":"'), "H"],
        ["whitespace around each token", `\t{ ${R.replace(":", " : ")} ,\n${A} ,\r${M} }\n`, "H"],
      ] as const,
      "other keys",
      { exact: 13 },
    );
    expect(await answers(rows)).toEqual(wanted(rows));
  });

  // serde_json src/de.rs (MapKey) reads each key of the object with `parse_str`, which validates escapes; a lone
  // surrogate is refused (src/read.rs, `parse_unicode_escape`), whatever key it is.
  it("a key of the object that decodes to a lone surrogate is near/args-malformed", async () => {
    const rows = rowsOf(
      [
        ["\\ud800", args(R, A, M, '"\\ud800":1'), "near/args-malformed"],
        ["\\udc00", args(R, A, M, '"\\udc00":1'), "near/args-malformed"],
        ["\\ud800 inside a key", args(R, A, M, '"a\\ud800b":1'), "near/args-malformed"],
        ["two leading surrogates", args(R, A, M, '"\\ud800\\ud800":1'), "near/args-malformed"],
        ["a pair written trailing first", args(R, A, M, '"\\ude00\\ud83d":1'), "near/args-malformed"],
        ["a leading surrogate first in the object", args('"\\udbff":null', R, A, M), "near/args-malformed"],
      ] as const,
      "lone surrogate keys",
      { exact: 6 },
    );
    expect(await answers(rows)).toEqual(wanted(rows));
  });

  // near-sdk-core src/json_types/integers.rs: `U128` reads a `String`, then `str::parse::<u128>`; Rust's
  // `from_str_radix` (core src/num/mod.rs) takes an optional `+` and then ASCII digits only, leading zeros included,
  // and refuses an empty string, a sign alone, `-` on an unsigned type, any other character and a value past u128::MAX.
  it("amount: a string u128::from_str reads binds, and anything else is near/args-malformed", async () => {
    const max = ((1n << 128n) - 1n).toString();
    const over = (1n << 128n).toString();
    const rows = rowsOf(
      [
        ["1000000", withAmount('"1000000"'), "H"],
        ["+1000000", withAmount('"+1000000"'), "H"],
        ["0001000000", withAmount('"0001000000"'), "H"],
        ["0", withAmount('"0"'), "H"],
        ["+0", withAmount('"+0"'), "H"],
        ["00", withAmount('"00"'), "H"],
        ["2^128 - 1", withAmount(`"${max}"`), "H"],
        ["+ and 2^128 - 1", withAmount(`"+${max}"`), "H"],
        ["200 zeros and 1", withAmount(`"${"0".repeat(200)}1"`), "H"],
        ["200 zeros and 2^128 - 1", withAmount(`"${"0".repeat(200)}${max}"`), "H"],
        ["digits written as escapes", withAmount('"\\u0031\\u0030"'), "H"],
        ["no amount", args(R, M), "near/args-malformed"],
        ["no amount and no memo", args(R), "near/args-malformed"],
        ["null", withAmount("null"), "near/args-malformed"],
        ["the number 1000000", withAmount("1000000"), "near/args-malformed"],
        ["the number 1e6", withAmount("1e6"), "near/args-malformed"],
        ["true", withAmount("true"), "near/args-malformed"],
        ["an array", withAmount('["1000000"]'), "near/args-malformed"],
        ["an object", withAmount('{"amount":"1000000"}'), "near/args-malformed"],
        ["empty", withAmount('""'), "near/args-malformed"],
        ["+ alone", withAmount('"+"'), "near/args-malformed"],
        ["- alone", withAmount('"-"'), "near/args-malformed"],
        ["-1", withAmount('"-1"'), "near/args-malformed"],
        ["-0", withAmount('"-0"'), "near/args-malformed"],
        ["++1", withAmount('"++1"'), "near/args-malformed"],
        ["+-1", withAmount('"+-1"'), "near/args-malformed"],
        ["a space first", withAmount('" 1"'), "near/args-malformed"],
        ["a space last", withAmount('"1 "'), "near/args-malformed"],
        ["1.0", withAmount('"1.0"'), "near/args-malformed"],
        ["1e6", withAmount('"1e6"'), "near/args-malformed"],
        ["0x10", withAmount('"0x10"'), "near/args-malformed"],
        ["1_000", withAmount('"1_000"'), "near/args-malformed"],
        ["Arabic-Indic digits", withAmount('"١٠"'), "near/args-malformed"],
        ["fullwidth 1", withAmount('"１"'), "near/args-malformed"],
        ["a lone surrogate", withAmount('"\\ud800"'), "near/args-malformed"],
        ["2^128", withAmount(`"${over}"`), "near/args-malformed"],
        ["+ and 2^128", withAmount(`"+${over}"`), "near/args-malformed"],
        ["200 zeros and 2^128", withAmount(`"${"0".repeat(200)}${over}"`), "near/args-malformed"],
        ["a bad amount before a bad receiver_id", args(`"amount":"x"`, '"receiver_id":"Not An Id"', M), "near/args-malformed"],
        ["a bad amount and no memo", args(R, '"amount":"x"'), "near/args-malformed"],
      ] as const,
      "amounts",
      { exact: 40 },
    );
    expect(await answers(rows)).toEqual(wanted(rows));
  });

  // serde src/private/de.rs and serde_json src/de.rs: an absent `Option` field and `null` are `None`; anything else is
  // read as a `String`. The pairing refuses a `memo` that carries no hash with its own codes, kept here.
  it("memo: the pairing's own codes, after the contract's rules", async () => {
    const memo = (m: string) => args(R, A, `"memo":${m}`);
    const rows = rowsOf(
      [
        ["no memo", args(R, A), "near/memo-missing"],
        ["null", memo("null"), "near/memo-missing"],
        ["a number", memo("7"), "near/memo-missing"],
        ["true", memo("true"), "near/memo-missing"],
        ["an object", memo("{}"), "near/memo-missing"],
        ["an array", memo('["x"]'), "near/memo-missing"],
        ["empty", memo('""'), "near/memo-not-lcp"],
        ["free-form", memo('"a free-form memo"'), "near/memo-not-lcp"],
        ["a lone surrogate", memo('"\\ud800"'), "near/memo-not-lcp"],
      ] as const,
      "memos",
      { exact: 9 },
    );
    expect(await answers(rows)).toEqual(wanted(rows));
  });

  // ftTransferArgs writes what the option filter serves: an amount that is the canonical decimal string of a positive
  // integer below 2^128 (the filter's rule), each of which u128::from_str reads.
  it("ftTransferArgs writes an amount the option filter serves and refuses anything else as near/option-malformed", () => {
    const max = ((1n << 128n) - 1n).toString();
    const writes = rowsOf(["1000000", "1", max], "written amounts", { exact: 3 });
    for (const amount of writes) {
      const a = ftTransferArgs(O.payTo, amount, H);
      if (!(a instanceof Uint8Array)) throw new Error(`${amount}: ${JSON.stringify(a)}`);
      expect(JSON.parse(new TextDecoder().decode(a))).toEqual({ receiver_id: O.payTo, amount, memo: JSON.parse(M.slice(7)) });
    }
    const refused = rowsOf(
      [
        ...["0", "0001000000", `0${max}`],
        ...["+1000000", "", "-1", "1.0", " 1", "1e6", "0x10", (1n << 128n).toString(), "0".repeat(79), 1000000, 1000000n, null, undefined],
      ],
      "refused amounts",
      { exact: 16 },
    );
    const want = { refused: true, code: "near/option-malformed" };
    expect(refused.map((amount) => [amount, ftTransferArgs(O.payTo, amount as string, H)])).toEqual(refused.map((amount) => [amount, want]));
    // The amount is read before the hash, as build's filter reads the option before the hash.
    expect(ftTransferArgs(O.payTo, "+1", "0x12" as AtrHash)).toEqual(want);
    expect(ftTransferArgs(O.payTo, O.amount, "0x12" as AtrHash)).toEqual({ refused: true, code: "x402/payload-malformed" });
  });
});
