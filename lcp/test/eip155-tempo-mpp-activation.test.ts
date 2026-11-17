// mpp/subscription/tempo's read of an activation by its search (profile mpp-session-evm-tempo.md rule 7), on the live
// Moderato activation, row "L2" of vectors/mpp-subscription-tempo.json (read from https://rpc.moderato.tempo.xyz on
// 2026-09-25): the account whose root key signed the key authorization it carries is the witness log's account, and the
// read settles on it only where that account is the reference's payer and the key authorization's one recipient the
// option's payee.
import { readFileSync } from "node:fs";
import { keccak256 } from "viem";
import { describe, expect, it } from "vitest";
import type { Hex } from "../src/evm-abi.js";
import type { EvmLog } from "../src/evm.js";
import { readKeyAuthorization } from "../src/internal/key-authorization.js";
import { carriedKeyAuthorization, keyAuthorizationSigner } from "../src/internal/tempo-envelope.js";
import { subscriptionTempo, type SessionRef } from "../src/mpp.js";
import { ACCOUNT_KEYCHAIN, KEY_AUTHORIZATION_WITNESS_TOPIC } from "../src/tempo.js";
import { ledgerReader } from "./eip155-tempo-mpp-ledger.js";

const V = JSON.parse(readFileSync(new URL("../vectors/mpp-subscription-tempo.json", import.meta.url), "utf8"));
const LIVE = V["L2"] as { raw: Hex; receipt: { status: 0 | 1; blockNumber: string; logs: EvmLog[] }; transferTo: Hex; transferToken: Hex; expectSettled: { transaction: Hex } };
const TX = LIVE.expectSettled.transaction;
const BLOCK = BigInt(LIVE.receipt.blockNumber);
const bytes = (h: string): Uint8Array => new Uint8Array(Buffer.from(h.slice(2), "hex"));

describe("the activation read on the live Moderato activation", () => {
  const carried = carriedKeyAuthorization(bytes(LIVE.raw)) as Hex;
  const witness = LIVE.receipt.logs[0]!;
  const account = `0x${witness.topics[1]!.slice(26)}` as Hex;
  const key = readKeyAuthorization(carried) as { keyId: Hex };
  const reader = ledgerReader({
    network: "eip155:42431",
    heads: { latest: BLOCK + 10n, safe: BLOCK + 5n, finalized: BLOCK + 5n },
    txs: [{ hash: TX, block: BLOCK, status: 1, from: account, to: null, input: "0x", logs: LIVE.receipt.logs, raw: LIVE.raw }],
  });
  const ref = (over: Partial<SessionRef>): SessionRef => ({
    network: "eip155:42431",
    payee: LIVE.transferTo,
    bindingLog: { address: ACCOUNT_KEYCHAIN, topic0: KEY_AUTHORIZATION_WITNESS_TOPIC, index: 2, value: witness.topics[2]! as never },
    accessKey: { keyId: key.keyId.toLowerCase() as Hex, token: LIVE.transferToken, to: `0x${"00".repeat(32)}` },
    payer: account,
    signed: keccak256(carried),
    ...over,
  });
  const query = { act: "payment", finality: "finalized", after: BLOCK - 100n } as const;

  it("recovers the witness log's account as the root key's signer, and settles with what moved from it", async () => {
    expect(witness.topics[0]).toBe(KEY_AUTHORIZATION_WITNESS_TOPIC);
    expect(keyAuthorizationSigner(bytes(carried))).toBe(account);
    expect(await subscriptionTempo.status(ref({}) as never, reader as never, query)).toEqual({
      state: "settled",
      transaction: TX,
      position: BLOCK,
      finality: "finalized",
      presented: "yes",
      signer: account,
      moved: [{ asset: LIVE.transferToken, to: LIVE.transferTo, amount: "1000000", transaction: TX, place: 3 }],
      foreign: [],
    });
  });

  it("names it a foreign item where the option's payee is another, the payer another, or the key another", async () => {
    const other = "0x4444444444444444444444444444444444444444" as Hex;
    const pending = (reason: string) => ({ state: "pending", reason: "search-incomplete", foreign: [{ transaction: TX, position: BLOCK, signer: account, reason }] });
    for (const [over, reason] of [
      [{ payee: other }, "other-account"],
      [{ payer: other }, "other-signer"],
      [{ accessKey: { keyId: other, token: LIVE.transferToken, to: `0x${"00".repeat(32)}` as Hex } }, "other-kind"],
    ] as const) {
      expect(await subscriptionTempo.status(ref(over) as never, reader as never, query), reason).toMatchObject(pending(reason));
    }
    expect(await subscriptionTempo.status(ref({ signed: `0x${"11".repeat(32)}` }) as never, reader as never, query)).toMatchObject({ state: "settled", presented: "no" });
  });
});

describe("the activation read while a reverted activation's witness log is not shown", () => {
  // A reverted activation's receipt holds its witness log (the recorded Moderato receipt in
  // fixtures/tempo-access-key.json), and whether the endpoint's log search returns it is not shown: this ledger's
  // search returns no reverted receipt's logs, so the search does not meet it.
  const carried = carriedKeyAuthorization(bytes(LIVE.raw)) as Hex;
  const witness = LIVE.receipt.logs[0]!;
  const account = `0x${witness.topics[1]!.slice(26)}` as Hex;
  const key = readKeyAuthorization(carried) as { keyId: Hex };
  const reader = ledgerReader({
    network: "eip155:42431",
    heads: { latest: BLOCK + 10n, safe: BLOCK + 5n, finalized: BLOCK + 5n },
    txs: [{ hash: TX, block: BLOCK, status: 0, from: account, to: null, input: "0x", logs: LIVE.receipt.logs, raw: LIVE.raw }],
  });
  const ref: SessionRef = {
    network: "eip155:42431",
    payee: LIVE.transferTo,
    bindingLog: { address: ACCOUNT_KEYCHAIN, topic0: KEY_AUTHORIZATION_WITNESS_TOPIC, index: 2, value: witness.topics[2]! as never },
    accessKey: { keyId: key.keyId.toLowerCase() as Hex, token: LIVE.transferToken, to: `0x${"00".repeat(32)}` },
    payer: account,
    signed: keccak256(carried),
  };

  it("answers search-incomplete, never not-found, where the search read whole met nothing", async () => {
    const query = { act: "payment", finality: "finalized", after: BLOCK - 100n } as const;
    expect(await subscriptionTempo.status(ref as never, reader as never, query)).toEqual({ state: "pending", reason: "search-incomplete", foreign: [] });
  });
});
