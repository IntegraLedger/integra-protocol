// The subscription's access-key search, on receipts recorded from Tempo Moderato. The attribution rule, from Tempo's
// transaction specification and account keychain (TIP-1011's `AccessKeySpend`, TIP-1053's witness event): a transfer
// made under access key K for account A in token T is a status-1 receipt holding the account keychain's
// `AccessKeySpend(A, K, T)`; the receipt that registered K for A holds `KeyAuthorizationWitness(A, W)` and
// `KeyAuthorized(A, K)` whatever its status. Every expected value below is the recording's (topics and data as the node
// returned them), a constant computed with viem 2.56.8's keccak256, or a digest computed with `sha256sum`.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { keccak256, stringToHex } from "viem";
import { TRANSFER_TOPIC } from "../src/evm.js";
import { keySearch, sessionStatus, subscriptionTempo, type SessionRef } from "../src/mpp.js";
import { ACCESS_KEY_SPEND_TOPIC, ACCOUNT_KEYCHAIN, KEY_AUTHORIZED_TOPIC } from "../src/tempo.js";
import { readerFor } from "./mpp-fixtures.js";

const NETWORK = "eip155:42431";
type Hex = `0x${string}`;
const F = JSON.parse(readFileSync(new URL("./fixtures/tempo-access-key.json", import.meta.url), "utf8")) as {
  account: Hex;
  token: Hex;
  recipient: Hex;
  finalized: string;
  revertedActivation: { witness: Hex; keyId: Hex; receipt: Receipt };
  chargeUnderKey: { keyId: Hex; amount: string; receipt: Receipt };
  otherKeyActivation: { witness: Hex; keyId: Hex; receipt: Receipt };
};
interface Receipt {
  transactionHash: Hex;
  status: 0 | 1;
  blockNumber: string;
  logs: { address: Hex; topics: Hex[]; data: Hex }[];
}
const word = (a: string) => `0x${"0".repeat(24)}${a.slice(2).toLowerCase()}` as Hex;
const receiptOf = (r: Receipt) => ({ status: r.status, blockNumber: BigInt(r.blockNumber), logs: r.logs });
const reader = (r: Receipt, finalized = BigInt(F.finalized)) =>
  readerFor(NETWORK, { status: r.status, blockNumber: r.blockNumber, logs: r.logs } as never, finalized, finalized);
/** `printf da8a13b652f86744b76547882fbae3cb7a5bdd37 | xxd -r -p | sha256sum` */
const TO_RECIPIENT = "0x08c0f673575156523bbb6d18cced9f717abb843c54a256dc04cfbf0fe4db1a74" as Hex;
/** The key's read keys as the subscription `reference` records them at claim, for the recorded activation. */
const recorded: SessionRef = {
  network: NETWORK,
  accessKey: { keyId: F.revertedActivation.keyId, token: F.token, to: TO_RECIPIENT },
};

describe("the keychain's constants", () => {
  it("AccessKeySpend and KeyAuthorized are the keccak256 of their signatures, and the live logs carry them", () => {
    expect(ACCESS_KEY_SPEND_TOPIC).toBe(keccak256(stringToHex("AccessKeySpend(address,address,address,uint256,uint256)")));
    expect(KEY_AUTHORIZED_TOPIC).toBe(keccak256(stringToHex("KeyAuthorized(address,address,uint8,uint64)")));
    expect(F.chargeUnderKey.receipt.logs[0]!.topics[0]).toBe(ACCESS_KEY_SPEND_TOPIC);
    expect(F.revertedActivation.receipt.logs[1]!.topics[0]).toBe(KEY_AUTHORIZED_TOPIC);
  });
});

describe("keySearch: the account the witness names, and the key's read keys", () => {
  it("on the reverted activation (status 0), gives the account and the AccessKeySpend filter", () => {
    expect(F.revertedActivation.receipt.status).toBe(0);
    const k = keySearch(recorded, receiptOf(F.revertedActivation.receipt), F.revertedActivation.witness);
    expect(k).toEqual({
      network: NETWORK,
      accessKey: { keyId: F.revertedActivation.keyId, token: F.token, to: TO_RECIPIENT, account: F.account },
      transferLog: { address: F.token, topic0: TRANSFER_TOPIC, identity: "to", digest: TO_RECIPIENT },
      search: { address: ACCOUNT_KEYCHAIN, topics: [ACCESS_KEY_SPEND_TOPIC, word(F.account), word(F.revertedActivation.keyId), word(F.token)] },
    });
  });

  it("refuses a receipt whose witness is another hash, or whose registered key is another key", () => {
    const r = receiptOf(F.revertedActivation.receipt);
    expect(keySearch(recorded, r, F.otherKeyActivation.witness)).toEqual({ refused: true, code: "tempo/no-witness" });
    const other: SessionRef = { ...recorded, accessKey: { ...recorded.accessKey!, keyId: F.otherKeyActivation.keyId } };
    expect(keySearch(other, r, F.revertedActivation.witness)).toEqual({ refused: true, code: "tempo/key-not-authorized" });
    expect(keySearch({ network: NETWORK }, r, F.revertedActivation.witness)).toEqual({ refused: true, code: "tempo/no-access-key" });
  });

  it("refuses the same logs from a contract other than the account keychain", () => {
    const moved = receiptOf(F.revertedActivation.receipt);
    const logs = moved.logs.map((l) => ({ ...l, address: "0x20c0000000000000000000000000000000000001" as Hex }));
    expect(keySearch(recorded, { ...moved, logs }, F.revertedActivation.witness)).toEqual({ refused: true, code: "tempo/no-witness" });
  });
});

describe("sessionStatus on the key's read keys", () => {
  const key = keySearch(recorded, receiptOf(F.revertedActivation.receipt), F.revertedActivation.witness) as SessionRef;

  it("a later charge under the key, final: settled at the finalized mark", async () => {
    const r = F.chargeUnderKey.receipt;
    expect(await sessionStatus({ ...key, transaction: r.transactionHash }, reader(r))).toEqual({
      state: "settled",
      finality: "finalized",
      blockNumber: BigInt(r.blockNumber),
    });
  });

  it("the same charge below the finalized mark is settled at `latest` only", async () => {
    const r = F.chargeUnderKey.receipt;
    const s = await sessionStatus({ ...key, transaction: r.transactionHash }, reader(r, BigInt(r.blockNumber) - 1n));
    expect(s).toEqual({ state: "settled", finality: "latest", blockNumber: BigInt(r.blockNumber) });
  });

  it("the reverted activation, whose only AccessKeySpend is its fee, is failed: reverted", async () => {
    const r = F.revertedActivation.receipt;
    expect(await sessionStatus({ ...key, transaction: r.transactionHash }, reader(r))).toEqual({ state: "failed", why: "reverted" });
  });

  it("a transfer to the recipient under another key of the account is not this key's: binding-log-not-found", async () => {
    const r = F.otherKeyActivation.receipt;
    expect(r.status).toBe(1);
    expect(await sessionStatus({ ...key, transaction: r.transactionHash }, reader(r))).toEqual({ state: "failed", why: "binding-log-not-found" });
  });

  it("the plant: the key's spend for another account is not this account's", async () => {
    const r = F.chargeUnderKey.receipt;
    const logs = r.logs.map((l) =>
      l.topics[0] === ACCESS_KEY_SPEND_TOPIC ? { ...l, topics: [l.topics[0]!, word("0x70997970C51812dc3A010C7d01b50e0d17dc79C8"), l.topics[2]!, l.topics[3]!] } : l,
    );
    const planted = { ...r, logs };
    expect(await sessionStatus({ ...key, transaction: r.transactionHash }, reader(planted))).toEqual({ state: "failed", why: "binding-log-not-found" });
  });

  it("a charge under the key whose Transfer goes elsewhere has no transfer to the recipient: transfer-not-found", async () => {
    const r = F.chargeUnderKey.receipt;
    const logs = r.logs.map((l) =>
      l.topics[0] === TRANSFER_TOPIC && l.topics[2] === word(F.recipient) ? { ...l, topics: [l.topics[0]!, l.topics[1]!, word("0x70997970C51812dc3A010C7d01b50e0d17dc79C8")] } : l,
    );
    expect(await sessionStatus({ ...key, transaction: r.transactionHash }, reader({ ...r, logs }))).toEqual({ state: "failed", why: "transfer-not-found" });
  });

  it("the binding offers keySearch", () => {
    expect(subscriptionTempo.keySearch).toBe(keySearch);
  });
});
