// The MPP EVM charges' reads and references, beyond the read kit's cases: a reference given another challenge than
// the one the credential echoes, a use of the nonce on another contract whose signature does not verify there, and
// Arc's system log beside a USDC transfer in the named transaction.
import { describe, expect, it } from "vitest";
import { addressWord, concat, hexOf, keccakHex, uintWord, type Hex } from "../src/evm-abi.js";
import { AUTHORIZATION_USED_TOPIC, TRANSFER_TOPIC } from "../src/evm.js";
import { evmAuthorization, evmHash, place, type MppChallenge, type MppCredential } from "../src/mpp.js";
import { SYSTEM_TRANSFER_EMITTER } from "../src/internal/mpp-evm-read.js";
import { ledgerReader } from "./eip155-tempo-mpp-ledger.js";
import { C_E, H, link, load } from "./mpp-fixtures.js";

const A = load("mpp-charge-evm-authorization.json");
const PAYER = A.fixed.payer.toLowerCase() as Hex;
const PAYEE = "0x209693bc6afc0c5328ba36faf03c514ef312287c" as Hex;
const OTHER = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Hex;
const NONCE = keccakHex("nonce");
const topic = (a: Hex): Hex => hexOf(addressWord(a));
const word = (v: bigint): Hex => hexOf(uintWord(v));

describe("mpp/charge/evm/authorization's reference", () => {
  it("refuses an option that is not the challenge the credential echoes: mpp/challenge-not-option", async () => {
    const [first, second] = place([C_E, C_E], H, link, C_E, 0) as (MppChallenge & { id: string })[];
    const u = await evmAuthorization.build({ challenge: first!, from: A.fixed.payer, now: A.fixed.now, tokenDomain: A.fixed.tokenDomain }, H);
    if ("refused" in u) throw new Error(u.code);
    const cred = u.complete(A.MV5.expectSignature) as MppCredential;
    expect(await evmAuthorization.reference(cred, first!)).not.toHaveProperty("refused");
    const other = { ...first!, id: `${first!.id.split(".")[0]}.7` };
    expect(await evmAuthorization.reference(cred, other)).toEqual({ refused: true, code: "mpp/challenge-not-option" });
    expect(await evmAuthorization.reference(cred, { ...first!, expires: "2030-01-01T00:00:00Z" })).toEqual({
      refused: true,
      code: "mpp/challenge-not-option",
    });
    expect(second).toBeDefined();
  });
});

describe("mpp/charge/evm/authorization's status, a use on another contract", () => {
  const ref = {
    network: "eip155:84532" as const,
    payee: PAYEE,
    payer: PAYER,
    authorization: { at: "0x036cbd53842c5426634e7929541ec2318f3dcf7e" as Hex, nonce: NONCE, deadline: "999999999999" },
    presented: { token: OTHER, from: PAYER, to: PAYEE, value: "5", nonce: NONCE },
  };
  const tx = `0x${"12".repeat(32)}` as Hex;
  const logs = [
    { address: OTHER, topics: [AUTHORIZATION_USED_TOPIC, topic(PAYER), NONCE], data: "0x" as Hex },
    { address: OTHER, topics: [TRANSFER_TOPIC, topic(PAYER), topic(PAYEE)], data: word(5n) },
  ];
  // transferWithAuthorization(from, to, value, 0, validBefore, nonce, v, r, s) with a signature the payer did not make.
  const forged = hexOf(
    concat([new Uint8Array([0xe3, 0xee, 0x16, 0x0e]), addressWord(PAYER), addressWord(PAYEE), uintWord(5n), uintWord(0n), uintWord(10n ** 12n), uintWord(BigInt(NONCE)), uintWord(27n), uintWord(1n), uintWord(1n)]),
  );
  const read = (input: Hex) =>
    evmAuthorization.status(
      ref,
      ledgerReader({
        network: "eip155:84532",
        heads: { latest: 20n, safe: 20n, finalized: 20n },
        txs: [{ hash: tx, block: 10n, status: 1, from: PAYEE, to: OTHER, input, logs }],
        call: (_to, data) =>
          data === "0x06fdde03" || data === "0x54fd4d50"
            ? hexOf(concat([uintWord(32n), uintWord(1n), uintWord(0x41n << 248n)]))
            : word(0n),
      }),
      { act: "payment", finality: "finalized" },
    );

  it("counts for nothing where its signature does not verify in that contract's domain", async () => {
    expect(await read(forged)).toEqual({ state: "pending", reason: "instrument-live", foreign: [] });
  });

  it("holds the search at it where the transaction carries no call the read can decode", async () => {
    expect(await read("0x")).toMatchObject({ state: "pending", reason: "instrument-live", search: 10n });
    const answer = await evmAuthorization.status(
      { ...ref, authorization: { ...ref.authorization, deadline: "0" } },
      ledgerReader({
        network: "eip155:84532",
        heads: { latest: 20n, safe: 20n, finalized: 20n },
        txs: [{ hash: tx, block: 10n, status: 1, from: PAYEE, to: OTHER, input: "0x", logs }],
        call: () => word(0n),
      }),
      { act: "payment", finality: "finalized" },
    );
    expect(answer).toEqual({ state: "pending", reason: "search-incomplete", search: 10n, undecoded: [tx], foreign: [] });
  });
});

describe("mpp/charge/evm/hash's status, on Arc", () => {
  // Arc's documentation, *USDC system events* (read on 2026-11-16): a USDC transfer emits the system emitter's
  // `Transfer`, in 18 decimals and first, beside the USDC contract's own in 6.
  const USDC = "0x3600000000000000000000000000000000000000" as Hex;
  const tx = `0x${"34".repeat(32)}` as Hex;
  const logs = [
    { address: SYSTEM_TRANSFER_EMITTER, topics: [TRANSFER_TOPIC, topic(PAYER), topic(PAYEE)], data: word(5n * 10n ** 12n) },
    { address: USDC, topics: [TRANSFER_TOPIC, topic(PAYER), topic(PAYEE)], data: word(5n) },
  ];
  const read = (l: typeof logs) =>
    evmHash.status(
      { network: "eip155:5042002", payee: PAYEE, payer: PAYER, transaction: tx },
      {
        ...ledgerReader({
          network: "eip155:5042002",
          heads: { latest: 20n, safe: 20n, finalized: 20n },
          txs: [{ hash: tx, block: 10n, status: 1, from: PAYER, to: USDC, input: "0x", logs: l }],
        }),
        archival: true,
      },
      { act: "payment", finality: "finalized" },
    );

  it("records the USDC contract's own Transfer as what moved, never the system log", async () => {
    expect(await read(logs)).toMatchObject({
      state: "settled",
      moved: [{ asset: USDC, amount: "5", to: PAYEE, transaction: tx, place: 1 }],
    });
  });

  it("takes a plain native send, the system log alone, as an act that names no account", async () => {
    expect(await read(logs.slice(0, 1))).toMatchObject({ state: "failed", reason: "instrument-consumed", moved: [] });
  });
});
