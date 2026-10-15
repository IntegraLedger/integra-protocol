// NEAR account ids as nearcore reads them, at every place the near entry point reads one. The oracle is
// near-account-id 3.0.0's `validate` (src/validation.rs), the crate version nearcore locks, written out below; its
// borsh reader (src/borsh.rs) and its serde reader (src/serde.rs) each call it, so nearcore refuses a delegate action
// whose sender or receiver it refuses, and a NEP-141 contract refuses `ft_transfer` arguments whose `receiver_id` it
// refuses (near-contract-standards: `fn ft_transfer(&mut self, receiver_id: AccountId, …)`). Each surface is held to
// the oracle over one generated sweep: boundary lengths, each separator first, last and doubled, uppercase, non-ASCII,
// every printable ASCII character, ASCII controls, the typed forms the crate names, and drawn strings.
import { readFileSync } from "node:fs";
import { sha256 } from "@noble/hashes/sha2.js";
import { describe, expect, it } from "vitest";
import type { AtrHash } from "../src/core.js";
import { isNearAccountId } from "../src/internal/near-delegate.js";
import { exactNear, ftTransferArgs, nearCarrier, nearLapsed, type NearOutcome, type NearReader, type NearRef } from "../src/near.js";
import type { PaymentRequired, PaymentRequirements } from "../src/x402.js";
import { counting } from "./fixtures/counting-reader.js";
import { rowsOf } from "./rows.js";

const V = JSON.parse(readFileSync(new URL("../vectors/x402-exact-near.json", import.meta.url), "utf8"));
const H: AtrHash = V.fixed.H;
const O: PaymentRequirements = V.fixed.O;
const REF: NearRef & { transaction: string } = V.V3.ref;
/** Each sweep's bound: its time grows with the machine's load. */
const SWEEP_MS = 300_000;

type Kind = "TooShort" | "TooLong" | "InvalidChar" | "RedundantSeparator";

/**
 * near-account-id 3.0.0's `validate` (src/validation.rs, lines 43-94), written out. `account_id.len()` is the string's
 * length in UTF-8 bytes; MIN_LEN is 2 and MAX_LEN 64 (lines 3-6). `chars()` gives each code point; a lowercase ASCII
 * letter or a digit is no separator, `-`, `_` and `.` are separators, and any other character is InvalidChar. The
 * last character is taken to be a separator before the first, so a separator first, a separator after a separator,
 * and a separator last are each RedundantSeparator. Null where it answers Ok.
 */
function validate(accountId: string): Kind | null {
  const len = new TextEncoder().encode(accountId).length;
  if (len < 2) return "TooShort";
  if (len > 64) return "TooLong";
  let lastCharIsSeparator = true;
  for (const c of accountId) {
    const cp = c.codePointAt(0)!;
    let currentCharIsSeparator: boolean;
    if ((cp >= 0x61 && cp <= 0x7a) || (cp >= 0x30 && cp <= 0x39)) currentCharIsSeparator = false;
    else if (cp === 0x2d || cp === 0x5f || cp === 0x2e) currentCharIsSeparator = true;
    else return "InvalidChar";
    if (currentCharIsSeparator && lastCharIsSeparator) return "RedundantSeparator";
    lastCharIsSeparator = currentCharIsSeparator;
  }
  if (lastCharIsSeparator) return "RedundantSeparator";
  return null;
}

/** A byte source: SHA-256 of `${label}:${counter}`, one digest after another. */
function bytesFrom(label: string): (n: number) => Uint8Array {
  const utf8 = new TextEncoder();
  let counter = 0;
  let block = new Uint8Array(0);
  let at = 0;
  return (n) => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (at === block.length) {
        block = sha256(utf8.encode(`${label}:${counter++}`));
        at = 0;
      }
      out[i] = block[at++]!;
    }
    return out;
  };
}

const ALNUM = "abcdefghijklmnopqrstuvwxyz0123456789";
const SEPARATORS = ["-", "_", "."];
const BASE = "alice.near";
/** `c` first, in the middle and last of BASE. */
const placed = (c: string) => [`${c}${BASE}`, `${BASE.slice(0, 3)}${c}${BASE.slice(3)}`, `${BASE}${c}`];
const hex = (n: number) => Array.from({ length: n }, (_, i) => "0123456789abcdef"[(i * 7 + 3) % 16]).join("");
/** near-account-id 3.0.0's own test data (src/test_data.rs, lines 1-55): ids it reads, and ids it refuses. */
const OK_ACCOUNT_IDS = [
  "aa", "a-a", "a-aa", "100", "0o", "com", "near", "bowen", "b-o_w_e-n", "b.owen", "bro.wen", "a.ha", "a.b-a.ra",
  "system", "over.9000", "google.com", "illia.cheapaccounts.near", "0o0ooo00oo00o", "alex-skidanov", "10-4.8-2",
  "b-o_w_e-n", "no_lols", "0123456789012345678901234567890123456789012345678901234567890123", "near.a",
];
const BAD_ACCOUNT_IDS = [
  "a", "A", "Abc", "-near", "near-", "-near-", "near.", ".near", "near@", "@near", "\u043d\u0435\u0430\u0440", "@@@@@", "0__0",
  "0_-_0", "0_-_0", "..", "a..near", "nEar", "_bowen", "hello world",
  "abcdefghijklmnopqrstuvwxyz.abcdefghijklmnopqrstuvwxyz.abcdefghijklmnopqrstuvwxyz",
  "01234567890123456789012345678901234567890123456789012345678901234", "some-complex-address@gmail.com",
  "sub.buy_d1gitz@atata@b0-rg.c_0_m",
];
const NON_ASCII = [
  "\u00e9", "\u0192", "\u212a", "\u017f", "\u0130", "\u0131", "\uff41", "\uff10", "\u0430", "\u00a0",
  "\ufeff", "\u200b", "\u2024", "\ufe52", "\uff0e", "\u2010", "\u00ad", "\u{1f600}", "\ud800", "\udc00",
];

/** The sweep's groups, each a list of strings. */
function sweep(): Record<string, string[]> {
  const lengths: string[] = [];
  for (const n of [0, 1, 2, 3, 63, 64, 65, 66]) {
    lengths.push("a".repeat(n), "9".repeat(n));
    // a, then each separator in turn and a: valid at an odd length, a separator last at an even one.
    lengths.push(Array.from({ length: n }, (_, i) => (i % 2 === 0 ? "a" : SEPARATORS[(i >> 1) % 3])).join(""));
  }
  const separators: string[] = [];
  for (const s of SEPARATORS) {
    separators.push(s, `${s}${s}`, `${s}a`, `a${s}`, `${s}a${s}`, `ali${s}ce`, ...placed(s));
    for (const t of SEPARATORS) separators.push(`ali${s}${t}ce`, `ali${s}ce${t}x`);
  }
  const uppercase: string[] = [BASE.toUpperCase(), "Alice.near", "alice.NEAR"];
  for (let c = 0x41; c <= 0x5a; c++) uppercase.push(...placed(String.fromCharCode(c)));
  const nonAscii: string[] = [];
  for (const c of NON_ASCII) nonAscii.push(...placed(c), `a${c}`, c);
  const printable: string[] = [];
  for (let c = 0x20; c <= 0x7e; c++) printable.push(...placed(String.fromCharCode(c)));
  const controls: string[] = [];
  for (let c = 0; c <= 0x1f; c++) controls.push(placed(String.fromCharCode(c))[1]!);
  controls.push(placed("\u007f")[1]!);
  // The typed forms near-account-id names (get_account_type): NEAR-implicit, ETH-implicit, deterministic, universal.
  const typed = [
    hex(64), hex(64).toUpperCase(), hex(63), hex(65), `${hex(63)}g`,
    `0x${hex(40)}`, `0x${hex(40).toUpperCase()}`, `0X${hex(40)}`, `0x${hex(39)}`, `0x${hex(41)}`,
    `0s${hex(40)}`, `0u${"0123456789abcdefghjkmnpqrstvwxyz".repeat(2).slice(0, 52)}`, `0u${"z".repeat(52)}`,
  ];
  // Drawn strings: half an id of one to five parts of 1 to 12 letters and digits joined by separators, then edited
  // once (a character inserted, replaced or removed) half the time; half drawn character by character.
  const take = bytesFrom("near-account-ids");
  const below = (n: number) => {
    const b = take(4);
    return (b[0]! * 2 ** 24 + b[1]! * 2 ** 16 + b[2]! * 2 ** 8 + b[3]!) % n;
  };
  const anyChar = () => {
    const k = below(20);
    if (k < 13) return ALNUM[below(ALNUM.length)]!;
    if (k < 16) return SEPARATORS[below(3)]!;
    if (k < 17) return String.fromCharCode(0x41 + below(26));
    if (k < 19) return String.fromCharCode(0x20 + below(95));
    return NON_ASCII[below(NON_ASCII.length)]!;
  };
  const drawn: string[] = [];
  for (let i = 0; i < 4096; i++) {
    if (i % 2 === 0) {
      const parts = Array.from({ length: 1 + below(5) }, () => Array.from({ length: 1 + below(12) }, () => ALNUM[below(ALNUM.length)]).join(""));
      let id = parts.map((p, j) => (j === 0 ? p : `${SEPARATORS[below(3)]}${p}`)).join("");
      if (below(2) === 0) {
        const at = below(id.length + 1);
        const edit = below(3);
        id = edit === 0 ? id.slice(0, at) + anyChar() + id.slice(at) : edit === 1 ? id.slice(0, at) + anyChar() + id.slice(at + 1) : id.slice(0, at) + id.slice(at + 1);
      }
      drawn.push(id);
    } else {
      drawn.push(Array.from({ length: below(71) }, anyChar).join(""));
    }
  }
  return { crate: [...OK_ACCOUNT_IDS, ...BAD_ACCOUNT_IDS], lengths, separators, uppercase, nonAscii, printable, controls, typed, drawn };
}

const GROUPS = sweep();
const ALL = Object.values(GROUPS).flat();
/** What the oracle answers over each group: its size and how many of each answer. */
const COUNTS = {
  crate: { total: 48, ok: 24, TooShort: 2, TooLong: 2, InvalidChar: 9, RedundantSeparator: 11 },
  lengths: { total: 24, ok: 10, TooShort: 6, TooLong: 6, InvalidChar: 0, RedundantSeparator: 2 },
  separators: { total: 45, ok: 15, TooShort: 3, TooLong: 0, InvalidChar: 0, RedundantSeparator: 27 },
  uppercase: { total: 81, ok: 0, TooShort: 0, TooLong: 0, InvalidChar: 81, RedundantSeparator: 0 },
  nonAscii: { total: 100, ok: 0, TooShort: 0, TooLong: 0, InvalidChar: 100, RedundantSeparator: 0 },
  printable: { total: 285, ok: 111, TooShort: 0, TooLong: 0, InvalidChar: 168, RedundantSeparator: 6 },
  controls: { total: 33, ok: 0, TooShort: 0, TooLong: 0, InvalidChar: 33, RedundantSeparator: 0 },
  typed: { total: 13, ok: 9, TooShort: 0, TooLong: 1, InvalidChar: 3, RedundantSeparator: 0 },
  drawn: { total: 4096, ok: 1962, TooShort: 88, TooLong: 324, InvalidChar: 1265, RedundantSeparator: 457 },
};
const total = (k: "ok" | "refused") =>
  Object.values(COUNTS).reduce((n, c) => n + (k === "ok" ? c.ok : c.total - c.ok), 0);

/**
 * The text a wire carries: UTF-8 cannot carry a lone surrogate, which TextEncoder writes as U+FFFD. A leading U+FEFF
 * is a character of the string, so the decoder keeps it.
 */
const onWire = (s: string) => new TextDecoder("utf-8", { ignoreBOM: true }).decode(new TextEncoder().encode(s));

/** Runs each string of the sweep through `answer`, and returns the strings where it differs from the oracle's. */
async function differences(
  label: string,
  answer: (s: string) => Promise<"ok" | "refused" | string> | "ok" | "refused" | string,
  oracleInput: (s: string) => string = (s) => s,
): Promise<{ ok: number; refused: number; differ: string[] }> {
  let ok = 0;
  let refused = 0;
  const differ: string[] = [];
  for (const s of rowsOf(ALL, `the sweep, at ${label}`, { exact: total("ok") + total("refused") })) {
    const want = validate(oracleInput(s)) === null ? "ok" : "refused";
    const got = await answer(s);
    if (got === "ok") ok++;
    else if (got === "refused") refused++;
    if (got !== want && differ.length < 10) differ.push(`${JSON.stringify(s)}: ${got}, oracle ${want}`);
  }
  return { ok, refused, differ };
}

const each = { ok: () => total("ok"), refused: () => total("refused") };
const isRefusal = (v: unknown, code: string) =>
  typeof v === "object" && v !== null && (v as { refused?: unknown }).refused === true && (v as { code?: unknown }).code === code;

// V2's signed delegate action: the sender and the receiver as u32-length strings, the count of actions, the action's
// variant index, the method name and the arguments as u32-length bytes, then the rest.
const v2 = Buffer.from(V.V2.expectSignedDelegateAction, "base64");
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};
const str = (s: string) => {
  const b = Buffer.from(new TextEncoder().encode(s));
  return Buffer.concat([u32(b.length), b]);
};
const senderEnd = 4 + v2.readUInt32LE(0);
const receiverEnd = senderEnd + 4 + v2.readUInt32LE(senderEnd);
const methodAt = receiverEnd + 4 + 1;
const argsAt = methodAt + 4 + v2.readUInt32LE(methodAt);
const argsEnd = argsAt + 4 + v2.readUInt32LE(argsAt);
const withCount = (b: Buffer, count: number, countAt: number) => {
  const c = Buffer.from(b);
  c.writeUInt32LE(count, countAt);
  return c;
};
const sdaWithSender = (s: string, count = 1) => {
  const b = Buffer.concat([str(s), v2.subarray(senderEnd)]);
  return withCount(b, count, b.length - (v2.length - receiverEnd)).toString("base64");
};
const sdaWithReceiver = (s: string, count = 1) => {
  const b = Buffer.concat([v2.subarray(0, senderEnd), str(s), v2.subarray(receiverEnd)]);
  return withCount(b, count, b.length - (v2.length - receiverEnd)).toString("base64");
};
const v1Args = JSON.parse(V.V1.expectArgsUtf8);
const sdaWithArgsReceiver = (s: string) =>
  Buffer.concat([v2.subarray(0, argsAt), str(JSON.stringify({ ...v1Args, receiver_id: s })), v2.subarray(argsEnd)]).toString("base64");

const payment = (signedDelegateAction: string, accepted: PaymentRequirements = O) => ({
  x402Version: 2,
  resource: V.fixed.resource,
  accepted,
  payload: { signedDelegateAction },
});
const required: PaymentRequired = { x402Version: 2, resource: V.fixed.resource, accepts: [O] };
const choice = () => ({
  required,
  accepted: O,
  payer: V.fixed.payer as string,
  publicKey: V.fixed.publicKey as string,
  accessKeyNonce: BigInt(V.fixed.accessKeyNonce),
  finalHeight: BigInt(V.fixed.finalHeight),
});

type Fixture = {
  status: string;
  delegate: { senderId: string; publicKey: string; nonce: string; receiverId: string; methodName: string; argsBase64: string };
  receipts: NearOutcome["receipts"];
};
const SETTLED: { outcome: Fixture; expect: unknown } = V.V3.status[0];
function readerFor(outcome: Fixture, relayers: readonly string[] = V.V3.relayers): NearReader {
  return {
    network: REF.network,
    relayers,
    txStatus: async () => ({ ...outcome, delegate: { ...outcome.delegate, nonce: BigInt(outcome.delegate.nonce) } }),
    finalHeight: async () => 0n,
    accessKeyNonce: async () => null,
  };
}

describe("NEAR account ids as near-account-id 3.0.0 reads them", () => {
  it("the sweep: each group's size and the oracle's answers over it", () => {
    const counted = Object.fromEntries(
      Object.entries(GROUPS).map(([name, list]) => {
        const c = { total: list.length, ok: 0, TooShort: 0, TooLong: 0, InvalidChar: 0, RedundantSeparator: 0 };
        for (const s of list) c[validate(s) ?? "ok"]++;
        return [name, c];
      }),
    );
    expect(counted).toEqual(COUNTS);
    // The oracle reads each of the crate's own ids and refuses each of its bad ones, as its tests require.
    expect(rowsOf(OK_ACCOUNT_IDS, "OK_ACCOUNT_IDS", { exact: 24 }).map(validate)).toEqual(new Array(24).fill(null));
    expect(rowsOf(BAD_ACCOUNT_IDS, "BAD_ACCOUNT_IDS", { exact: 24 }).filter((id) => validate(id) === null)).toEqual([]);
  });

  it("isNearAccountId answers as validate", async () => {
    const r = await differences("isNearAccountId", (s) => (isNearAccountId(s) ? "ok" : "refused"));
    expect(r).toEqual({ ok: each.ok(), refused: each.refused(), differ: [] });
    for (const v of [undefined, null, 7, ["alice.near"], { toString: () => "alice.near" }, new String("alice.near")]) {
      expect(isNearAccountId(v)).toBe(false);
    }
  });

  it("the delegate's sender and receiver: nearCarrier and bound read an account id, refuse anything else as near/sda-malformed, and reference's ref is one status reads", { timeout: SWEEP_MS }, async () => {
    for (const [where, sda, field] of [
      ["sender", sdaWithSender, "payer"],
      ["receiver", sdaWithReceiver, "asset"],
    ] as const) {
      const r = await differences(
        `the ${where}`,
        async (s) => {
          const text = sda(s);
          const c = nearCarrier(text);
          const b = await exactNear.bound(payment(text));
          if (isRefusal(c, "near/sda-malformed") && isRefusal(b, "near/sda-malformed")) return "refused";
          if ("refused" in c || c[field] !== onWire(s) || b !== H) return `read as ${JSON.stringify(c)}, bound ${JSON.stringify(b)}`;
          const ref = await exactNear.reference(payment(text));
          if ("refused" in ref || ref[field] !== onWire(s)) return `reference ${JSON.stringify(ref)}`;
          const { reader, calls } = counting(readerFor(SETTLED.outcome));
          const answer = await exactNear.status({ ...ref, transaction: REF.transaction }, reader);
          return calls.length > 0 ? "ok" : `status read nothing: ${JSON.stringify(answer)}`;
        },
        onWire,
      );
      expect([where, r]).toEqual([where, { ok: each.ok(), refused: each.refused(), differ: [] }]);
    }
  });

  it("the sender and the receiver are read as account ids before the count of actions", { timeout: SWEEP_MS }, async () => {
    for (const [where, sda] of [
      ["sender", sdaWithSender],
      ["receiver", sdaWithReceiver],
    ] as const) {
      const r = await differences(
        `the ${where}, with a count of two`,
        (s) => {
          const c = nearCarrier(sda(s, 2));
          return isRefusal(c, "near/actions") ? "ok" : isRefusal(c, "near/sda-malformed") ? "refused" : JSON.stringify(c);
        },
        onWire,
      );
      expect([where, r]).toEqual([where, { ok: each.ok(), refused: each.refused(), differ: [] }]);
    }
  });

  it("ft_transfer's receiver_id: bound reads an account id and refuses anything else as near/args-malformed", { timeout: SWEEP_MS }, async () => {
    const r = await differences("the arguments' receiver_id", async (s) => {
      const b = await exactNear.bound(payment(sdaWithArgsReceiver(s)));
      return b === H ? "ok" : isRefusal(b, "near/args-malformed") ? "refused" : JSON.stringify(b);
    });
    expect(r).toEqual({ ok: each.ok(), refused: each.refused(), differ: [] });
    // A receiver_id that is absent or not a string is no account id.
    const { receiver_id: _r, ...noReceiver } = v1Args;
    for (const args of [noReceiver, { ...v1Args, receiver_id: 7 }, { ...v1Args, receiver_id: null }]) {
      const text = Buffer.concat([v2.subarray(0, argsAt), str(JSON.stringify(args)), v2.subarray(argsEnd)]).toString("base64");
      expect([args, await exactNear.bound(payment(text))]).toEqual([args, { refused: true, code: "near/args-malformed" }]);
    }
  });

  it("the option's payTo and asset: advertise, read, build, bound and reference serve an account id and refuse anything else as near/option-malformed", { timeout: SWEEP_MS }, async () => {
    for (const field of ["payTo", "asset"] as const) {
      const r = await differences(`the option's ${field}`, async (s) => {
        const option = { ...O, [field]: s } as PaymentRequirements;
        const doc: PaymentRequired = { x402Version: 2, resource: V.fixed.resource, accepts: [option] };
        const advertised = exactNear.advertise(doc, H, V.fixed.link, option);
        const answers = [
          advertised,
          await exactNear.build({ ...choice(), required: doc, accepted: option }, H),
          await exactNear.bound(payment(V.V2.expectSignedDelegateAction, option)),
          await exactNear.reference(payment(V.V2.expectSignedDelegateAction, option)),
        ];
        if (answers.every((a) => isRefusal(a, "near/option-malformed"))) {
          const placedO = exactNear.advertise(required, H, V.fixed.link, O);
          if ("refused" in placedO) return placedO.code;
          const read = exactNear.read({ ...placedO, accepts: [option] });
          return isRefusal(read, "x402/no-payable-option") ? "refused" : JSON.stringify(read);
        }
        if (answers.some((a) => typeof a === "object" && a !== null && "refused" in a)) return JSON.stringify(answers.map((a) => (a as { code?: string }).code));
        const read = exactNear.read(advertised as PaymentRequired);
        return "refused" in read || read.offer.options.length !== 1 ? JSON.stringify(read) : "ok";
      });
      expect([field, r]).toEqual([field, { ok: each.ok(), refused: each.refused(), differ: [] }]);
    }
  });

  it("ftTransferArgs writes a payTo that is an account id and refuses anything else as near/option-malformed", async () => {
    const r = await differences("ftTransferArgs", (s) => {
      const a = ftTransferArgs(s, O.amount, H);
      if (isRefusal(a, "near/option-malformed")) return "refused";
      return a instanceof Uint8Array && JSON.parse(new TextDecoder().decode(a)).receiver_id === s ? "ok" : JSON.stringify(a);
    });
    expect(r).toEqual({ ok: each.ok(), refused: each.refused(), differ: [] });
  });

  it("build reads a payer that is an account id and refuses anything else as x402/option-malformed", { timeout: SWEEP_MS }, async () => {
    const r = await differences("build's payer", async (s) => {
      const u = await exactNear.build({ ...choice(), payer: s }, H);
      if (isRefusal(u, "x402/option-malformed")) return "refused";
      return "request" in u ? "ok" : JSON.stringify(u);
    });
    expect(r).toEqual({ ok: each.ok(), refused: each.refused(), differ: [] });
  });

  it("a ref's payer and asset: status is pending unreadable and nearLapsed false, each with nothing read, for one that is not an account id", { timeout: SWEEP_MS }, async () => {
    const lapsed = V.V3.lapsed.find((row: { expect: boolean }) => row.expect === true);
    for (const field of ["payer", "asset"] as const) {
      const r = await differences(`a ref's ${field}`, async (s) => {
        const { reader, calls } = counting(readerFor(SETTLED.outcome));
        const answer = await exactNear.status({ ...REF, [field]: s }, reader);
        if (calls.length === 0) return JSON.stringify(answer) === JSON.stringify({ state: "pending", why: "unreadable" }) ? "refused" : JSON.stringify(answer);
        return "ok";
      });
      expect([field, r]).toEqual([field, { ok: each.ok(), refused: each.refused(), differ: [] }]);
    }
    const r = await differences("nearLapsed's payer", async (s) => {
      const keyNonce = lapsed.keyNonce;
      const { reader, calls } = counting<NearReader>({
        ...readerFor(SETTLED.outcome),
        finalHeight: async () => BigInt(lapsed.finalHeight),
        accessKeyNonce: async () => ({ nonce: BigInt(keyNonce.nonce), blockHeight: BigInt(keyNonce.blockHeight) }),
      });
      const answer = await nearLapsed({ ...REF, payer: s }, reader);
      if (calls.length === 0) return answer === false ? "refused" : `true with nothing read`;
      return answer === true ? "ok" : "false after reading";
    });
    expect(r).toEqual({ ok: each.ok(), refused: each.refused(), differ: [] });
  });

  it("the reader's answer: a delegate sender or receiver, or a receipt's executor, that is not an account id is unreadable", { timeout: SWEEP_MS }, async () => {
    const recoverRef = { network: REF.network, transaction: REF.transaction };
    const edits: [string, (s: string) => Fixture][] = [
      ["the delegate's sender", (s) => ({ ...SETTLED.outcome, delegate: { ...SETTLED.outcome.delegate, senderId: s } })],
      ["the delegate's receiver", (s) => ({ ...SETTLED.outcome, delegate: { ...SETTLED.outcome.delegate, receiverId: s } })],
      ["a receipt's executor", (s) => ({ ...SETTLED.outcome, receipts: [...SETTLED.outcome.receipts, { executor: s, outcome: "success" }] })],
    ];
    for (const [where, edit] of edits) {
      const r = await differences(where, async (s) => {
        const reader = readerFor(edit(s));
        const status = await exactNear.status(REF, reader);
        const recovered = await exactNear.recover(recoverRef, reader);
        const unreadable = JSON.stringify(status) === JSON.stringify({ state: "pending", why: "unreadable" });
        if (unreadable && isRefusal(recovered, "near/unreadable")) return "refused";
        return !unreadable && recovered === H ? "ok" : `${JSON.stringify(status)} ${JSON.stringify(recovered)}`;
      });
      expect([where, r]).toEqual([where, { ok: each.ok(), refused: each.refused(), differ: [] }]);
    }
  });

  it("the reader's relayers: a list whose first four are not each an account id is pending unreadable and near/no-relayer, with nothing read", { timeout: SWEEP_MS }, async () => {
    const recoverRef = { network: REF.network, transaction: REF.transaction };
    const r = await differences("a relayer", async (s) => {
      const relayers = ["relayer.testnet", "relayer.near", "r2.testnet", s];
      const { reader, calls } = counting(readerFor(SETTLED.outcome, relayers));
      const status = await exactNear.status(REF, reader);
      const recovered = await exactNear.recover(recoverRef, reader);
      if (calls.length === 0) {
        const unreadable = JSON.stringify(status) === JSON.stringify({ state: "pending", why: "unreadable" });
        return unreadable && isRefusal(recovered, "near/no-relayer") ? "refused" : `${JSON.stringify(status)} ${JSON.stringify(recovered)}`;
      }
      return JSON.stringify(status) === JSON.stringify(SETTLED.expect) && recovered === H ? "ok" : `${JSON.stringify(status)} ${JSON.stringify(recovered)}`;
    });
    expect(r).toEqual({ ok: each.ok(), refused: each.refused(), differ: [] });
    // A fifth relayer is never asked, so it is not read.
    const fifth = readerFor(SETTLED.outcome, ["relayer.testnet", "relayer.near", "r2.testnet", "r3.testnet", "Not An Id"]);
    expect(await exactNear.status(REF, fifth)).toEqual(SETTLED.expect);
    expect(await exactNear.recover(recoverRef, fifth)).toBe(H);
  });
});
