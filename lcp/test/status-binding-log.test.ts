// The EVM pairings whose reference always names the log carrying H or its commitment, given a ref without that log, and
// the MPP EVM and Tempo session and Tempo subscription pairings, given a ref without the key their own writers name for
// the opening or the close. A read that cannot check H, or the close, is pending `unreadable`, never failed or settled
// (docs/guides/rails.md, "Reading settlement": failed means the rail itself says so). The transfer digest is SHA-256
// over from, to and the uint256 value, by node:crypto.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { BINDINGS } from "../src/index.js";
import {
  AUTHORIZATION_USED_TOPIC,
  DELEGATION_MANAGER,
  ESCROW,
  PAYMENT_AUTHORIZED_TOPIC,
  REDEEMED_DELEGATION_TOPIC,
  TRANSFER_TOPIC,
  type EvmLog,
  type EvmReader,
  type EvmRef,
  type Hex,
} from "../src/evm.js";
import { sessionEvm, sessionTempo, subscriptionTempo, type SessionRef } from "../src/mpp.js";
import {
  ACCESS_KEY_SPEND_TOPIC,
  ACCOUNT_KEYCHAIN,
  CHANNEL_CLOSED_V1_TOPIC,
  CHANNEL_CLOSED_V2_TOPIC,
  CHANNEL_OPENED_V2_TOPIC,
  KEY_AUTHORIZATION_WITNESS_TOPIC,
  KEY_REVOKED_TOPIC,
  TRANSFER_WITH_MEMO_TOPIC,
} from "../src/tempo.js";
import { BATCH_SETTLEMENT, DEPOSITED_TOPIC } from "../src/x402-batch-settlement.js";

const NET = "eip155:84532" as const;
const TOKEN = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Hex;
// The published Anvil development accounts 0 and 1.
const PAYER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const PAYEE = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const H = "0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" as Hex; // SHA-256("abc"), FIPS 180-2
const word = (hex: string) => hex.slice(2).toLowerCase().padStart(64, "0");
const digest = ("0x" +
  createHash("sha256")
    .update(Buffer.from(PAYER.slice(2) + PAYEE.slice(2) + word("0x2710"), "hex"))
    .digest("hex")) as Hex;
const transferLog = { address: TOKEN, topic0: TRANSFER_TOPIC, identity: "from,to,value" as const, digest };
const paid = { address: TOKEN, topics: ["0x" + word(TRANSFER_TOPIC), "0x" + word(PAYER), "0x" + word(PAYEE)] as Hex[], data: ("0x" + word("0x2710")) as Hex };

/** Each pairing, with the binding log its own reference names. */
const PAIRINGS: [string, NonNullable<EvmRef["bindingLog"]>][] = [
  ["x402/exact/eip155/erc7710-salt", { address: DELEGATION_MANAGER, topic0: REDEEMED_DELEGATION_TOPIC, dataWord: 5, value: H }],
  ["x402/auth-capture/eip155/eip3009", { address: ESCROW["v1.1"].escrow, topic0: PAYMENT_AUTHORIZED_TOPIC, index: 1, value: H }],
  ["x402/auth-capture/eip155/permit2", { address: ESCROW["v1.0"].escrow, topic0: ESCROW["v1.0"].chargedTopic, index: 1, value: H }],
  ["x402/batch-settlement/eip155", { address: BATCH_SETTLEMENT, topic0: DEPOSITED_TOPIC, index: 1, value: H }],
  ["mpp/charge/evm/authorization", { address: TOKEN, topic0: AUTHORIZATION_USED_TOPIC, index: 2, value: H }],
  ["mpp/charge/tempo/memo", { address: TOKEN, topic0: TRANSFER_WITH_MEMO_TOPIC, index: 3, value: H }],
  ["mpp/charge/tempo/push", { address: TOKEN, topic0: TRANSFER_WITH_MEMO_TOPIC, index: 3, value: H }],
  ["mpp/charge/usdc/evm", { address: TOKEN, topic0: AUTHORIZATION_USED_TOPIC, index: 2, value: H }],
];

/** A reader holding one successful receipt with the payer's transfer and `logs`; it counts its calls. */
function reader(calls: string[], logs: EvmLog[] = []): EvmReader {
  return {
    network: NET,
    receipt: async () => (calls.push("receipt"), { status: 1, blockNumber: 100n, logs: [paid, ...logs] }),
    blockNumber: async () => (calls.push("blockNumber"), 100n),
    transaction: async () => (calls.push("transaction"), null),
    call: async () => (calls.push("call"), "0x"),
  };
}

describe("a ref without its pairing's binding log", () => {
  const unreadable = { state: "pending", why: "unreadable" };
  for (const [id, own] of PAIRINGS) {
    it(`${id}: pending unreadable, with nothing read; its own binding log is read`, async () => {
      const b = BINDINGS.find((x) => x.id === id) as unknown as {
        status: (ref: EvmRef & { transaction: Hex }, reader: EvmReader) => Promise<unknown>;
      };
      const tx = ("0x" + "ab".repeat(32)) as Hex;
      const refs = [
        { network: NET, transaction: tx, transferLog },
        { network: NET, transaction: tx, transferLog, bindingLog: { ...own, topic0: ("0x" + "22".repeat(32)) as Hex } },
        { network: NET, transaction: tx, transferLog, bindingLog: { ...own, value: "0x12" as Hex } },
        { network: NET, transaction: tx, transferLog, bindingLog: { address: own.address, topic0: own.topic0, value: H } },
      ];
      for (const ref of refs) {
        const calls: string[] = [];
        expect(await b.status(ref as EvmRef & { transaction: Hex }, reader(calls))).toEqual(unreadable);
        expect(calls).toEqual([]);
      }
      const calls: string[] = [];
      const read = await b.status({ network: NET, transaction: tx, transferLog, bindingLog: own }, reader(calls));
      expect(read).toEqual({ state: "failed", why: "binding-log-not-found" });
      expect(calls).toEqual(["receipt", "blockNumber"]);
    });
  }
  it("covers each of the eight pairings", () => {
    expect(PAIRINGS.map(([id]) => BINDINGS.some((b) => b.id === id))).toEqual(Array(8).fill(true));
  });
});

// Each ref below has the shape a writer of these pairings gives it, with the key that ties the read to the opening or
// the close: `reference` of an EVM `hash` or `permit2` opening (`opens`), of an EIP-3009 opening (`AuthorizationUsed`'s
// binding log), of a Tempo opening (`opened`) and of a subscription's activation (`KeyAuthorizationWitness`'s binding
// log); `closeRef` of each (`closes`, `ChannelClosed`'s binding log, `revokes`); and `keySearch` (`accessKey.account`).
// Without that key, the reader's receipt holds the payer's transfer and nothing else, and nothing is read.
describe("a session or subscription ref without the key its writer names", () => {
  const unreadable = { state: "pending", why: "unreadable" };
  const tx = ("0x" + "ab".repeat(32)) as Hex;
  const ESCROW = "0x1111111111111111111111111111111111111111" as Hex;
  const channel = ("0x" + "cd".repeat(32)) as Hex;
  const fromTo = { ...transferLog, identity: "from,to" as const };
  const opens = { escrow: ESCROW, channel, h: H, chainId: 84532 };
  const accessKey = { keyId: PAYEE as Hex, token: TOKEN, to: digest };
  type Status = (ref: SessionRef & { transaction: Hex }, reader: EvmReader) => Promise<unknown>;
  const CASES: [string, Status, SessionRef, keyof SessionRef | "accessKey.account"][] = [
    ["mpp/session/evm hash opening", sessionEvm.status, { network: NET, transferLog: fromTo, opens }, "opens"],
    ["mpp/session/evm permit2 opening", sessionEvm.status, { network: NET, settleBy: "1790000060", transferLog, opens }, "opens"],
    [
      "mpp/session/evm authorization opening",
      sessionEvm.status,
      { network: NET, settleBy: "1790000060", transferLog, bindingLog: { address: TOKEN, topic0: AUTHORIZATION_USED_TOPIC, index: 2, value: H } },
      "bindingLog",
    ],
    ["mpp/session/evm close", sessionEvm.status, { network: NET, closes: { escrow: ESCROW, channel } }, "closes"],
    [
      "mpp/session/tempo opening",
      sessionTempo.status,
      { network: NET, settleBy: "1790000060", search: { address: ESCROW, topics: [CHANNEL_OPENED_V2_TOPIC, channel] }, opened: { address: ESCROW, version: "v2", channel, h: H, chainId: 84532 } },
      "opened",
    ],
    [
      "mpp/session/tempo close",
      sessionTempo.status,
      { network: NET, bindingLog: { address: ESCROW, topic0: CHANNEL_CLOSED_V2_TOPIC, index: 1, value: channel } },
      "bindingLog",
    ],
    [
      "mpp/subscription/tempo activation",
      subscriptionTempo.status,
      { network: NET, transferLog, accessKey, bindingLog: { address: ACCOUNT_KEYCHAIN, topic0: KEY_AUTHORIZATION_WITNESS_TOPIC, index: 2, value: H } },
      "bindingLog",
    ],
    ["mpp/subscription/tempo key search", subscriptionTempo.status, { network: NET, transferLog, accessKey: { ...accessKey, account: PAYER as Hex } }, "accessKey.account"],
    ["mpp/subscription/tempo close", subscriptionTempo.status, { network: NET, revokes: { account: PAYER as Hex, keyId: PAYEE as Hex } }, "revokes"],
  ];
  for (const [label, status, ref, key] of CASES) {
    it(`${label}: without its ${key}, pending unreadable with nothing read; with it, the receipt is read`, async () => {
      const without: SessionRef =
        key === "accessKey.account" ? { ...ref, accessKey } : (Object.fromEntries(Object.entries(ref).filter(([k]) => k !== key)) as SessionRef);
      const none: string[] = [];
      expect(await status({ ...without, transaction: tx }, reader(none))).toEqual(unreadable);
      expect(none).toEqual([]);
      const calls: string[] = [];
      expect(await status({ ...ref, transaction: tx }, reader(calls))).not.toEqual(unreadable);
      expect(calls[0]).toBe("receipt");
    });
  }
  it("a binding log under an event none of these pairings writes is not their key", async () => {
    const calls: string[] = [];
    const ref = { network: NET, transaction: tx, transferLog, bindingLog: { address: TOKEN, topic0: TRANSFER_WITH_MEMO_TOPIC, index: 3, value: H } };
    for (const status of [sessionEvm.status, sessionTempo.status, subscriptionTempo.status]) {
      expect(await status(ref as SessionRef & { transaction: Hex }, reader(calls))).toEqual(unreadable);
    }
    expect(calls).toEqual([]);
  });

  // Each pairing reads only the keys its own writers give (docs/guides/sessions.md, "names a key another of the three
  // writes"): a key that only another of the three pairings writes is not its key, even with the log that key
  // names in the receipt, and its own key beside another pairing's key is not read either.
  const topic = (a: string) => ("0x" + word(a)) as Hex;
  const KEY = PAYEE as Hex;
  const KEYS: [string, string, SessionRef, EvmLog[]][] = [
    ["opens", "mpp/session/evm", { network: NET, opens }, []],
    ["closes", "mpp/session/evm", { network: NET, closes: { escrow: ESCROW, channel } }, []],
    [
      "AuthorizationUsed's binding log",
      "mpp/session/evm",
      { network: NET, bindingLog: { address: TOKEN, topic0: AUTHORIZATION_USED_TOPIC, index: 2, value: H } },
      [{ address: TOKEN, topics: [AUTHORIZATION_USED_TOPIC, topic(PAYER), H], data: "0x" }],
    ],
    ["opened", "mpp/session/tempo", { network: NET, opened: { address: ESCROW, version: "v2", channel, h: H, chainId: 84532 } }, []],
    [
      "ChannelClosed v1's binding log",
      "mpp/session/tempo",
      { network: NET, bindingLog: { address: ESCROW, topic0: CHANNEL_CLOSED_V1_TOPIC, index: 1, value: channel } },
      [{ address: ESCROW, topics: [CHANNEL_CLOSED_V1_TOPIC, channel], data: "0x" }],
    ],
    [
      "ChannelClosed v2's binding log",
      "mpp/session/tempo",
      { network: NET, bindingLog: { address: ESCROW, topic0: CHANNEL_CLOSED_V2_TOPIC, index: 1, value: channel } },
      [{ address: ESCROW, topics: [CHANNEL_CLOSED_V2_TOPIC, channel], data: "0x" }],
    ],
    [
      "KeyAuthorizationWitness's binding log",
      "mpp/subscription/tempo",
      { network: NET, bindingLog: { address: ACCOUNT_KEYCHAIN, topic0: KEY_AUTHORIZATION_WITNESS_TOPIC, index: 2, value: H } },
      [{ address: ACCOUNT_KEYCHAIN, topics: [KEY_AUTHORIZATION_WITNESS_TOPIC, topic(PAYER), H], data: "0x" }],
    ],
    [
      "an accessKey with account",
      "mpp/subscription/tempo",
      { network: NET, accessKey: { ...accessKey, account: PAYER as Hex } },
      [{ address: ACCOUNT_KEYCHAIN, topics: [ACCESS_KEY_SPEND_TOPIC, topic(PAYER), topic(KEY), topic(TOKEN)], data: "0x" }],
    ],
    [
      "revokes",
      "mpp/subscription/tempo",
      { network: NET, revokes: { account: PAYER as Hex, keyId: KEY } },
      [{ address: ACCOUNT_KEYCHAIN, topics: [KEY_REVOKED_TOPIC, topic(PAYER), topic(KEY)], data: "0x" }],
    ],
  ];
  const THREE: Record<string, Status> = {
    "mpp/session/evm": sessionEvm.status,
    "mpp/session/tempo": sessionTempo.status,
    "mpp/subscription/tempo": subscriptionTempo.status,
  };
  for (const [id, status] of Object.entries(THREE)) {
    it(`${id}: a ref whose one key another of these pairings writes is pending unreadable with nothing read; that pairing reads it`, async () => {
      const foreign = KEYS.filter(([, writer]) => writer !== id);
      expect(foreign.length).toBe(6);
      const got: unknown[] = [];
      const read: unknown[] = [];
      for (const [key, writer, member, logs] of foreign) {
        const ref = { ...member, transferLog, transaction: tx };
        const none: string[] = [];
        got.push([key, await status(ref, reader(none, logs)), none]);
        const calls: string[] = [];
        const answer = (await THREE[writer]!(ref, reader(calls, logs))) as { why?: string };
        read.push([key, answer.why === "unreadable" ? "unreadable" : "read", calls[0]]);
      }
      expect(got).toEqual(foreign.map(([key]) => [key, unreadable, []]));
      expect(read).toEqual(foreign.map(([key]) => [key, "read", "receipt"]));
    });
    it(`${id}: its own key beside a key another of these pairings writes is pending unreadable, with nothing read`, async () => {
      const own = KEYS.filter(([, writer]) => writer === id);
      const foreign = KEYS.filter(([, writer]) => writer !== id);
      const labels: string[] = [];
      const got: unknown[] = [];
      for (const [ownKey, , ownMember, ownLogs] of own) {
        for (const [key, , member, logs] of foreign) {
          if (ownMember.bindingLog !== undefined && member.bindingLog !== undefined) continue;
          const none: string[] = [];
          const ref = { ...ownMember, ...member, transferLog, transaction: tx };
          labels.push(`${ownKey} with ${key}`);
          got.push([`${ownKey} with ${key}`, await status(ref, reader(none, [...ownLogs, ...logs])), none]);
        }
      }
      expect(labels.length).toBeGreaterThanOrEqual(14);
      expect(got).toEqual(labels.map((label) => [label, unreadable, []]));
    });
  }
});
