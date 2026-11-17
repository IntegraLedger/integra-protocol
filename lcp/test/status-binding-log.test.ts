// The MPP EVM and Tempo session and Tempo subscription pairings, given a ref without the key their own writers name for
// the opening or the close. A read that cannot check H, or the close, is unreadable `unparseable`, never failed or
// settled: the ref is not one the pairing's writers give (the profile read-status, the reasons of `unreadable`). The
// transfer digest is SHA-256 over from, to and the uint256 value, by node:crypto.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  TRANSFER_TOPIC,
  type EvmLog,
  type EvmReader,
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
import { rowsOf } from "./rows.js";

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

const FINAL = { act: "payment", finality: "finalized" } as const;
const unreadable = { state: "unreadable", reason: "unparseable", foreign: [] };
/** The read keys of a ref, which the calls below give the option's payee. */
type Keys = Omit<SessionRef, "payee">;

/**
 * A reader holding one successful receipt with the payer's transfer and `logs`; it counts its calls. Its blocks, logs
 * and a zero word for every call serve the EVM session's opening read, a search (mpp-session-evm-open.test.ts).
 */
function reader(calls: string[], logs: EvmLog[] = []): EvmReader {
  return {
    network: NET,
    receipt: async () => (calls.push("receipt"), { status: 1, blockNumber: 100n, logs: [paid, ...logs] }),
    blockNumber: async () => (calls.push("blockNumber"), 100n),
    transaction: async () => (calls.push("transaction"), null),
    call: async () => (calls.push("call"), ("0x" + "00".repeat(32)) as Hex),
    ...{
      block: async () => (calls.push("block"), { number: 100n, timestamp: 1_790_000_000n }),
      logs: async () => (calls.push("logs"), []),
    },
  } as EvmReader;
}

// Each ref below has the shape a writer of these pairings gives it, with the key that ties the read to the opening or
// the close: `reference` of an EVM `hash` or `permit2` opening (`opens`), of an EIP-3009 opening (`AuthorizationUsed`'s
// binding log), of a Tempo opening (`opened`) and of a subscription's activation (`KeyAuthorizationWitness`'s binding
// log); `closeRef` of each (`closes`, `ChannelClosed`'s binding log, `revokes`); and `keySearch` (`accessKey.account`).
// Without that key, the reader's receipt holds the payer's transfer and nothing else, and nothing is read.
describe("a session or subscription ref without the key its writer names", () => {
  const tx = ("0x" + "ab".repeat(32)) as Hex;
  const ESCROW = "0x1111111111111111111111111111111111111111" as Hex;
  const channel = ("0x" + "cd".repeat(32)) as Hex;
  const fromTo = { ...transferLog, identity: "from,to" as const };
  const opens = { escrow: ESCROW, channel, h: H, chainId: 84532 };
  // The EVM opening's other read keys, as `reference` writes them for an `authorization` funding.
  const NONCE = ("0x" + "ee".repeat(32)) as Hex;
  const opening: Keys = {
    network: NET,
    opens,
    payer: PAYER.toLowerCase() as Hex,
    funding: { type: "authorization", token: TOKEN.toLowerCase() as Hex, at: TOKEN.toLowerCase() as Hex, nonce: NONCE, deadline: "1790000060" },
    presented: { funding: "authorization", token: TOKEN.toLowerCase(), from: PAYER.toLowerCase(), to: ESCROW, value: "10000", nonce: NONCE },
  };
  const accessKey = { keyId: PAYEE as Hex, token: TOKEN, to: digest };
  type Status = (ref: SessionRef & { transaction: Hex }, reader: EvmReader, query: typeof FINAL) => Promise<unknown>;
  // The EVM opening is read by its funding's search, whose first call reads the heads (`block`).
  const CASES: [string, Status, Keys, keyof Keys | "accessKey.account", string?][] = [
    ["mpp/session/evm opening", sessionEvm.status, opening, "opens", "block"],
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
  for (const [label, status, ref, key, first = "receipt"] of CASES) {
    it(`${label}: without its ${key}, unreadable unparseable with nothing read; with it, the receipt is read`, async () => {
      const without: Keys =
        key === "accessKey.account" ? { ...ref, accessKey } : (Object.fromEntries(Object.entries(ref).filter(([k]) => k !== key)) as Keys);
      const none: string[] = [];
      expect(await status({ ...without, payee: PAYEE, transaction: tx }, reader(none), FINAL)).toEqual(unreadable);
      expect(none).toEqual([]);
      const calls: string[] = [];
      expect(await status({ ...ref, payee: PAYEE, transaction: tx }, reader(calls), FINAL)).not.toEqual(unreadable);
      expect(calls[0]).toBe(first);
    });
  }
  it("a binding log under an event none of these pairings writes is not their key", async () => {
    const calls: string[] = [];
    const ref = { network: NET, payee: PAYEE, transaction: tx, transferLog, bindingLog: { address: TOKEN, topic0: TRANSFER_WITH_MEMO_TOPIC, index: 3, value: H } };
    for (const status of [sessionEvm.status, sessionTempo.status, subscriptionTempo.status]) {
      expect(await status(ref as SessionRef & { transaction: Hex }, reader(calls), FINAL)).toEqual(unreadable);
    }
    expect(calls).toEqual([]);
  });

  // Each pairing reads only the keys its own writers give (docs/guides/sessions.md, "names a key another of the three
  // writes"): a key that only another of the three pairings writes is not its key, even with the log that key
  // names in the receipt, and its own key beside another pairing's key is not read either.
  const topic = (a: string) => ("0x" + word(a)) as Hex;
  const KEY = PAYEE as Hex;
  const KEYS: [string, string, Keys, EvmLog[]][] = [
    ["opens", "mpp/session/evm", opening, []],
    ["closes", "mpp/session/evm", { network: NET, closes: { escrow: ESCROW, channel } }, []],
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
  /** The keys the other two pairings write: the EVM session writes two, the Tempo session three, the subscription three. */
  const FOREIGN: Record<string, number> = { "mpp/session/evm": 6, "mpp/session/tempo": 5, "mpp/subscription/tempo": 5 };
  const THREE: Record<string, Status> = {
    "mpp/session/evm": sessionEvm.status,
    "mpp/session/tempo": sessionTempo.status,
    "mpp/subscription/tempo": subscriptionTempo.status,
  };
  for (const [id, status] of rowsOf(Object.entries(THREE), "THREE, the three session and subscription pairings", { exact: 3 })) {
    it(`${id}: a ref whose one key another of these pairings writes is unreadable unparseable with nothing read; that pairing reads it`, async () => {
      const foreign = rowsOf(KEYS, "KEYS", {
        exact: FOREIGN[id]!,
        keep: ["the keys another of the three pairings writes", ([, writer]) => writer !== id],
        leave: [`the keys ${id} writes, which the next test sets beside these`, ([, writer]) => writer === id],
      });
      expect(foreign.length).toBe(FOREIGN[id]);
      const got: unknown[] = [];
      const read: unknown[] = [];
      for (const [key, writer, member, logs] of foreign) {
        const ref = { ...member, payee: PAYEE, transferLog, transaction: tx };
        const none: string[] = [];
        got.push([key, await status(ref, reader(none, logs), FINAL), none]);
        const calls: string[] = [];
        const answer = (await THREE[writer]!(ref, reader(calls, logs), FINAL)) as { state: string };
        read.push([key, answer.state === "unreadable" ? "unreadable" : "read", calls[0]]);
      }
      expect(got).toEqual(foreign.map(([key]) => [key, unreadable, []]));
      expect(read).toEqual(foreign.map(([key]) => [key, "read", key === "opens" ? "block" : "receipt"]));
    });
    it(`${id}: its own key beside a key another of these pairings writes is unreadable unparseable, with nothing read`, async () => {
      const own = rowsOf(KEYS, "KEYS", {
        keep: [`the keys ${id} writes`, ([, writer]) => writer === id],
        leave: ["the keys another of the three pairings writes, set beside each of these below", ([, writer]) => writer !== id],
      });
      const foreign = rowsOf(KEYS, "KEYS", {
        exact: FOREIGN[id]!,
        keep: ["the keys another of the three pairings writes", ([, writer]) => writer !== id],
        leave: [`the keys ${id} writes, the own keys above`, ([, writer]) => writer === id],
      });
      const labels: string[] = [];
      const got: unknown[] = [];
      for (const [ownKey, , ownMember, ownLogs] of own) {
        for (const [key, , member, logs] of foreign) {
          if (ownMember.bindingLog !== undefined && member.bindingLog !== undefined) continue;
          const none: string[] = [];
          const ref = { ...ownMember, ...member, payee: PAYEE, transferLog, transaction: tx };
          labels.push(`${ownKey} with ${key}`);
          got.push([`${ownKey} with ${key}`, await status(ref, reader(none, [...ownLogs, ...logs]), FINAL), none]);
        }
      }
      expect(labels.length).toBeGreaterThanOrEqual(12);
      expect(got).toEqual(labels.map((label) => [label, unreadable, []]));
    });
  }
});
