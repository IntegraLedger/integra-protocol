// Every EVM pairing with a `status`, given a named transaction whose receipt reads as failed. The Ethereum JSON-RPC
// block tags (ethereum/execution-apis, `BlockTag`): `safe` is safe from reorganization only under honest-majority and
// synchrony assumptions, and `finalized` cannot be reorganized without manual intervention, so a block above
// `finalized` can be replaced by one in which the same transaction succeeds, or carries other logs. A failed answer
// names no mark, so it is given only where the receipt's block is at or below the reader's `finalized` mark; above
// it, or where that mark cannot be read, the read is pending with the same reason. The receipts are ERC-20
// `Transfer` and EIP-3009 `AuthorizationUsed` logs as those standards define them, with the pairings' own events beside
// them; the transfer digest is SHA-256 over the named fields, by node:crypto. The published Anvil development accounts
// 0 and 1 are the payer and the payee; H is SHA-256("abc") (FIPS 180-2).
import { createHash } from "node:crypto";
import { encodeFunctionData, parseAbi } from "viem";
import { describe, expect, it } from "vitest";
import { BINDINGS } from "../src/index.js";
import {
  AUTHORIZATION_USED_TOPIC,
  DELEGATION_MANAGER,
  ESCROW,
  EXACT_PERMIT2_PROXY,
  PAYMENT_AUTHORIZED_TOPIC,
  PERMIT2,
  REDEEMED_DELEGATION_TOPIC,
  ReaderError,
  TRANSFER_TOPIC,
  type EvmLog,
  type EvmReader,
  type EvmTransaction,
  type Hex,
} from "../src/evm.js";
import {
  ACCESS_KEY_SPEND_TOPIC,
  ACCOUNT_KEYCHAIN,
  CHANNEL_CLOSED_V2_TOPIC,
  CHANNEL_OPENED_V2_TOPIC,
  KEY_AUTHORIZATION_WITNESS_TOPIC,
  KEY_REVOKED_TOPIC,
  RECEIVE_POLICY_GUARD,
  TIP20_CHANNEL_RESERVE,
  TRANSFER_WITH_MEMO_TOPIC,
} from "../src/tempo.js";
import { BATCH_SETTLEMENT, CHANNEL_CREATED_TOPIC, DEPOSITED_TOPIC } from "../src/x402-batch-settlement.js";
import { problem, type MppCredential } from "../src/mpp.js";
import { CHANNEL_CLOSED_TOPIC, CHANNEL_OPENED_TOPIC } from "../src/internal/hedera-session.js";
import { REFUSAL_CODES } from "../src/internal/codes.js";
import { readToRepeat } from "../src/refusal.js";
import { load } from "./mpp-fixtures.js";
import { rowsOf } from "./rows.js";

const BASE = "eip155:84532";
const TEMPO = "eip155:42431";
const HEDERA = "hedera:testnet";
const TOKEN = "0x036cbd53842c5426634e7929541ec2318f3dcf7e" as Hex;
const PAYER = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266" as Hex;
const PAYEE = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8" as Hex;
const STRANGER = "0x00000000000000000000000000000000000000ee" as Hex;
const H = "0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" as Hex;
const NONCE = ("0x" + "cd".repeat(32)) as Hex;
const CHANNEL = ("0x" + "56".repeat(32)) as Hex;
const TX = ("0x" + "11".repeat(32)) as Hex;
const VALUE = 10_000n;
const BLOCK = 100n;

const hex64 = (h: string) => h.slice(2).toLowerCase().padStart(64, "0");
const topic = (a: Hex) => ("0x" + hex64(a)) as Hex;
const uint = (v: bigint) => ("0x" + v.toString(16).padStart(64, "0")) as Hex;
const sha256 = (parts: string[]) => ("0x" + createHash("sha256").update(Buffer.from(parts.join(""), "hex")).digest("hex")) as Hex;
const digest = (f: { from?: Hex; to?: Hex; value?: bigint }) =>
  sha256([f.from?.slice(2) ?? "", f.to?.slice(2) ?? "", f.value === undefined ? "" : hex64(uint(f.value))]);

const transfer = (from: Hex, to: Hex, value = VALUE, token = TOKEN): EvmLog => ({
  address: token,
  topics: [TRANSFER_TOPIC, topic(from), topic(to)],
  data: uint(value),
});
const used = (nonce: Hex): EvmLog => ({ address: TOKEN, topics: [AUTHORIZATION_USED_TOPIC, topic(PAYER), nonce], data: "0x" });
const log = (address: Hex, topics: Hex[], data: Hex = "0x"): EvmLog => ({ address, topics, data });

/** One failed read: the reason, and the receipt (and transaction and `eth_call` answers) that give it. */
interface Failure {
  why: string;
  logs: EvmLog[];
  reverted?: true;
  tx?: EvmTransaction;
  call?: (block: bigint) => Hex;
}
/** A pairing, what the ref reads, a ref of the form its writer gives, and its failed reads. */
type Row = [id: string, what: string, network: string, ref: object, failures: Failure[]];

/**
 * A Permit2 nonce whose low byte is 0, so Permit2 records it in bit 0 of `nonceBitmap(owner, nonce >> 8)`; a settle
 * call to the exact proxy that carries it, and one that does not; and a bitmap word with bit 0 set from `BLOCK` on.
 */
const PERMIT2_NONCE = ("0x" + H.slice(2, 64) + "00") as Hex;
const permit2Carrying: EvmTransaction = { from: PAYER, to: EXACT_PERMIT2_PROXY, input: ("0x13cd3b53" + hex64(TOKEN) + PERMIT2_NONCE.slice(2)) as Hex };
const permit2Without: EvmTransaction = { from: PAYER, to: EXACT_PERMIT2_PROXY, input: ("0x13cd3b53" + hex64(TOKEN)) as Hex };
const spentInBlock = (block: bigint) => uint(block >= BLOCK ? 1n : 0n);
const permit2Ref = {
  transaction: TX,
  authorization: { scheme: "permit2", at: PERMIT2, nonce: PERMIT2_NONCE, deadline: "1790000060", asset: TOKEN },
  transferLog: { address: TOKEN, topic0: TRANSFER_TOPIC, identity: "from,to,value", digest: digest({ from: PAYER, to: PAYEE, value: VALUE }) },
};
const permit2Failures: Failure[] = [
  { why: "reverted", logs: [transfer(PAYER, PAYEE)], reverted: true, tx: permit2Carrying, call: spentInBlock },
  { why: "transfer-not-found", logs: [], tx: permit2Carrying, call: spentInBlock },
  { why: "receive-policy-blocked", logs: [transfer(PAYER, RECEIVE_POLICY_GUARD)], tx: permit2Carrying, call: spentInBlock },
  { why: "nonce-not-used", logs: [transfer(PAYER, PAYEE)], tx: permit2Without, call: spentInBlock },
  { why: "nonce-not-used", logs: [transfer(PAYER, PAYEE)], tx: permit2Carrying, call: () => uint(0n) },
  { why: "nonce-not-used", logs: [transfer(PAYER, PAYEE)], tx: permit2Carrying, call: () => uint(1n) },
];

const pulled = (binding: Hex) => ({
  transaction: TX,
  bindingLog: { address: TOKEN, topic0: AUTHORIZATION_USED_TOPIC, index: 2, value: binding },
  transferLog: { address: TOKEN, topic0: TRANSFER_TOPIC, identity: "from,to,value", digest: digest({ from: PAYER, to: PAYEE, value: VALUE }) },
});
const pulledFailures: Failure[] = [
  { why: "reverted", logs: [used(NONCE), transfer(PAYER, PAYEE)], reverted: true },
  { why: "binding-log-not-found", logs: [transfer(PAYER, PAYEE)] },
  { why: "transfer-not-found", logs: [used(NONCE), transfer(PAYER, PAYEE, VALUE + 1n)] },
  { why: "receive-policy-blocked", logs: [used(NONCE), transfer(PAYER, RECEIVE_POLICY_GUARD)] },
];

const escrow = ESCROW["v1.1"];
const authorized = log(escrow.escrow, [PAYMENT_AUTHORIZED_TOPIC, H]);
const leaf = log(DELEGATION_MANAGER, [REDEEMED_DELEGATION_TOPIC, topic(PAYER), topic(STRANGER)], ("0x" +
  [hex64(PAYER), hex64(STRANGER), hex64("0x0"), hex64("0x0"), hex64("0x0"), H.slice(2)].join("")) as Hex);
const memo = (to: Hex, value: bigint) => log(TOKEN, [TRANSFER_WITH_MEMO_TOPIC, topic(PAYER), topic(to), H], uint(value));
const deposited = log(BATCH_SETTLEMENT, [DEPOSITED_TOPIC, CHANNEL]);
const sessionEscrow = "0x1111111111111111111111111111111111111111" as Hex;
/** The Hedera escrow's `ChannelOpened(channel, payer, payee)` with its four data words: token, signer, salt H, deposit. */
const channelOpened = (channel: Hex): EvmLog =>
  log(sessionEscrow, [CHANNEL_OPENED_TOPIC as Hex, channel, topic(PAYER), topic(PAYEE)], ("0x" +
    [hex64(TOKEN), hex64(STRANGER), H.slice(2), hex64(uint(VALUE))].join("")) as Hex);
const keyId = PAYEE;
const witness = log(ACCOUNT_KEYCHAIN, [KEY_AUTHORIZATION_WITNESS_TOPIC, topic(PAYER), H]);
const toPayee = digest({ to: PAYEE });

const ROWS: Row[] = [
  [
    "x402/exact/eip155/eip3009",
    "the payment",
    BASE,
    {
      asset: TOKEN,
      transaction: TX,
      h: H,
      transferLog: { address: TOKEN, topic0: TRANSFER_TOPIC, identity: "from,to,value", digest: digest({ from: PAYER, to: PAYEE, value: VALUE }) },
    },
    [
      { why: "reverted", logs: [log(TOKEN, [AUTHORIZATION_USED_TOPIC, topic(PAYER), H]), transfer(PAYER, PAYEE)], reverted: true },
      { why: "authorization-not-used", logs: [transfer(PAYER, PAYEE)] },
      { why: "transfer-not-found", logs: [log(TOKEN, [AUTHORIZATION_USED_TOPIC, topic(PAYER), H]), transfer(PAYER, PAYEE, VALUE + 1n)] },
    ],
  ],
  ["x402/exact/eip155/permit2", "the payment", BASE, permit2Ref, permit2Failures],
  ["x402/upto/eip155/permit2", "the payment", BASE, permit2Ref, permit2Failures],
  ["mpp/charge/evm/permit2", "the payment", BASE, permit2Ref, permit2Failures],
  [
    "x402/exact/eip155/erc7710-salt",
    "the payment",
    BASE,
    {
      transaction: TX,
      bindingLog: { address: DELEGATION_MANAGER, topic0: REDEEMED_DELEGATION_TOPIC, dataWord: 5, value: H },
      transferLog: { address: TOKEN, topic0: TRANSFER_TOPIC, identity: "from", digest: digest({ from: PAYER }) },
    },
    [
      { why: "reverted", logs: [leaf, transfer(PAYER, PAYEE)], reverted: true },
      { why: "binding-log-not-found", logs: [transfer(PAYER, PAYEE)] },
      { why: "transfer-not-found", logs: [leaf, transfer(STRANGER, PAYEE)] },
    ],
  ],
  [
    "x402/auth-capture/eip155/eip3009",
    "the payment",
    BASE,
    {
      transaction: TX,
      bindingLog: { address: escrow.escrow, topic0: PAYMENT_AUTHORIZED_TOPIC, index: 1, value: H },
      transferLog: {
        address: TOKEN,
        topic0: TRANSFER_TOPIC,
        identity: "from,to,value",
        digest: digest({ from: PAYER, to: escrow.eip3009Collector, value: VALUE }),
      },
    },
    [
      { why: "reverted", logs: [authorized, transfer(PAYER, escrow.eip3009Collector)], reverted: true },
      { why: "binding-log-not-found", logs: [transfer(PAYER, escrow.eip3009Collector)] },
      { why: "transfer-not-found", logs: [authorized] },
      { why: "receive-policy-blocked", logs: [authorized, transfer(PAYER, RECEIVE_POLICY_GUARD)] },
    ],
  ],
  [
    "x402/auth-capture/eip155/permit2",
    "the payment",
    BASE,
    { transaction: TX, bindingLog: { address: escrow.escrow, topic0: PAYMENT_AUTHORIZED_TOPIC, index: 1, value: H } },
    [
      { why: "reverted", logs: [authorized], reverted: true },
      { why: "binding-log-not-found", logs: [] },
    ],
  ],
  [
    "x402/batch-settlement/eip155",
    "the opening",
    BASE,
    {
      transaction: TX,
      settleBy: "1790000060",
      bindingLog: { address: BATCH_SETTLEMENT, topic0: DEPOSITED_TOPIC, index: 1, value: CHANNEL },
      transferLog: {
        address: TOKEN,
        topic0: TRANSFER_TOPIC,
        identity: "from,to,value",
        digest: digest({ from: PAYER, to: BATCH_SETTLEMENT, value: VALUE }),
      },
    },
    [
      { why: "reverted", logs: [transfer(PAYER, BATCH_SETTLEMENT), deposited], reverted: true },
      { why: "binding-log-not-found", logs: [transfer(PAYER, BATCH_SETTLEMENT)] },
      { why: "transfer-not-found", logs: [deposited] },
      // The payer's transfer after the channel's `Deposited`: not this deposit call's.
      { why: "transfer-not-found", logs: [deposited, transfer(PAYER, BATCH_SETTLEMENT)] },
      { why: "receive-policy-blocked", logs: [deposited, transfer(PAYER, RECEIVE_POLICY_GUARD)] },
    ],
  ],
  ["mpp/charge/evm/authorization", "the payment", BASE, pulled(NONCE), pulledFailures],
  ["mpp/charge/usdc/evm", "the payment", BASE, pulled(NONCE), pulledFailures],
  ...(["mpp/charge/evm/transaction", "mpp/charge/evm/hash"] as const).map(
    (id): Row => [
      id,
      "the payment",
      BASE,
      { transaction: TX, asset: TOKEN, transferLog: { address: TOKEN, topic0: TRANSFER_TOPIC, identity: "from", digest: digest({ from: PAYER }) } },
      [
        { why: "reverted", logs: [transfer(PAYER, PAYEE)], reverted: true },
        { why: "transfer-not-found", logs: [transfer(STRANGER, PAYEE)] },
        { why: "receive-policy-blocked", logs: [transfer(PAYER, RECEIVE_POLICY_GUARD)] },
      ],
    ],
  ),
  ...(["mpp/charge/tempo/memo", "mpp/charge/tempo/push"] as const).map(
    (id): Row => [
      id,
      "the payment",
      TEMPO,
      {
        transaction: TX,
        bindingLog: { address: TOKEN, topic0: TRANSFER_WITH_MEMO_TOPIC, index: 3, value: H },
        transferLog: { address: TOKEN, topic0: TRANSFER_WITH_MEMO_TOPIC, identity: "to,value", digest: digest({ to: PAYEE, value: VALUE }) },
      },
      [
        { why: "reverted", logs: [memo(PAYEE, VALUE)], reverted: true },
        { why: "binding-log-not-found", logs: [transfer(PAYER, PAYEE)] },
        { why: "transfer-not-found", logs: [memo(PAYEE, VALUE + 1n)] },
        { why: "receive-policy-blocked", logs: [memo(PAYEE, VALUE + 1n), transfer(PAYER, RECEIVE_POLICY_GUARD)] },
      ],
    ],
  ),
  [
    "mpp/session/evm",
    "a hash opening",
    BASE,
    {
      transaction: TX,
      transferLog: { address: TOKEN, topic0: TRANSFER_TOPIC, identity: "from,to", digest: digest({ from: PAYER, to: sessionEscrow }) },
      opens: { escrow: sessionEscrow, channel: CHANNEL, h: H, chainId: 84532 },
    },
    [
      { why: "reverted", logs: [transfer(PAYER, sessionEscrow)], reverted: true },
      { why: "transfer-not-found", logs: [] },
    ],
  ],
  [
    "mpp/session/evm",
    "an authorization opening",
    BASE,
    {
      transaction: TX,
      settleBy: "1790000060",
      bindingLog: { address: TOKEN, topic0: AUTHORIZATION_USED_TOPIC, index: 2, value: NONCE },
      transferLog: { address: TOKEN, topic0: TRANSFER_TOPIC, identity: "from,to,value", digest: digest({ from: PAYER, to: sessionEscrow, value: VALUE }) },
    },
    [
      { why: "reverted", logs: [used(NONCE), transfer(PAYER, sessionEscrow)], reverted: true },
      { why: "binding-log-not-found", logs: [transfer(PAYER, sessionEscrow)] },
      { why: "transfer-not-found", logs: [used(NONCE)] },
    ],
  ],
  ["mpp/session/evm", "the close", BASE, { transaction: TX, closes: { escrow: sessionEscrow, channel: CHANNEL } }, [{ why: "reverted", logs: [], reverted: true }]],
  [
    "mpp/session/tempo",
    "the opening",
    TEMPO,
    { transaction: TX, settleBy: "1790000060", opened: { address: sessionEscrow, version: "v2", channel: CHANNEL, h: H, chainId: 42431 } },
    [
      {
        why: "reverted",
        logs: [log(sessionEscrow, [CHANNEL_OPENED_V2_TOPIC, CHANNEL, topic(PAYER), topic(PAYEE)], ("0x" +
          [hex64(TOKEN), hex64(PAYEE), hex64(uint(VALUE)), H.slice(2)].join("")) as Hex)],
        reverted: true,
      },
      // A `ChannelOpened` whose salt word is not H: the receipt holds no opening of this channel with H.
      {
        why: "binding-log-not-found",
        logs: [log(sessionEscrow, [CHANNEL_OPENED_V2_TOPIC, CHANNEL, topic(PAYER), topic(PAYEE)], ("0x" +
          [hex64(TOKEN), hex64(PAYEE), hex64(uint(VALUE)), NONCE.slice(2)].join("")) as Hex)],
      },
    ],
  ],
  [
    "mpp/session/tempo",
    "the close",
    TEMPO,
    { transaction: TX, bindingLog: { address: sessionEscrow, topic0: CHANNEL_CLOSED_V2_TOPIC, index: 1, value: CHANNEL } },
    [
      { why: "reverted", logs: [log(sessionEscrow, [CHANNEL_CLOSED_V2_TOPIC, CHANNEL])], reverted: true },
      { why: "binding-log-not-found", logs: [] },
    ],
  ],
  [
    "mpp/subscription/tempo",
    "the activation",
    TEMPO,
    {
      transaction: TX,
      bindingLog: { address: ACCOUNT_KEYCHAIN, topic0: KEY_AUTHORIZATION_WITNESS_TOPIC, index: 2, value: H },
      transferLog: { address: TOKEN, topic0: TRANSFER_TOPIC, identity: "to", digest: toPayee },
      accessKey: { keyId, token: TOKEN, to: toPayee },
    },
    [
      { why: "reverted", logs: [witness, transfer(PAYER, PAYEE)], reverted: true },
      { why: "binding-log-not-found", logs: [transfer(PAYER, PAYEE)] },
      { why: "transfer-not-found", logs: [witness] },
      { why: "receive-policy-blocked", logs: [witness, transfer(PAYER, RECEIVE_POLICY_GUARD)] },
    ],
  ],
  [
    "mpp/subscription/tempo",
    "a transfer under the access key",
    TEMPO,
    {
      transaction: TX,
      accessKey: { keyId, token: TOKEN, to: toPayee, account: PAYER },
      transferLog: { address: TOKEN, topic0: TRANSFER_TOPIC, identity: "to", digest: toPayee },
    },
    [
      { why: "reverted", logs: [transfer(PAYER, PAYEE)], reverted: true },
      // The transfer to the recipient without the keychain's `AccessKeySpend` for the account, key and token.
      { why: "binding-log-not-found", logs: [transfer(PAYER, PAYEE)] },
      { why: "transfer-not-found", logs: [log(ACCOUNT_KEYCHAIN, [ACCESS_KEY_SPEND_TOPIC, topic(PAYER), topic(keyId), topic(TOKEN)])] },
    ],
  ],
  [
    "mpp/subscription/tempo",
    "the revocation",
    TEMPO,
    { transaction: TX, revokes: { account: PAYER, keyId } },
    [
      { why: "reverted", logs: [log(ACCOUNT_KEYCHAIN, [KEY_REVOKED_TOPIC, topic(PAYER), topic(keyId)])], reverted: true },
      { why: "binding-log-not-found", logs: [log(ACCOUNT_KEYCHAIN, [KEY_REVOKED_TOPIC, topic(STRANGER), topic(keyId)])] },
    ],
  ],
  [
    "mpp/session/hedera",
    "the opening",
    HEDERA,
    { transaction: TX, bindingLog: { address: sessionEscrow, topic0: CHANNEL_OPENED_TOPIC, index: 1, value: CHANNEL } },
    [
      { why: "reverted", logs: [log(sessionEscrow, [CHANNEL_OPENED_TOPIC as Hex, CHANNEL, topic(PAYER), topic(PAYEE)])], reverted: true },
      { why: "binding-log-not-found", logs: [] },
    ],
  ],
  // The escrow alone: status reads the escrow's one ChannelOpened with four topics and four data words, as recover does.
  [
    "mpp/session/hedera",
    "the opening, by the escrow alone",
    HEDERA,
    { transaction: TX, escrow: sessionEscrow },
    [
      { why: "reverted", logs: [], reverted: true },
      { why: "binding-log-not-found", logs: [channelOpened(CHANNEL), channelOpened(NONCE)] },
    ],
  ],
  [
    "mpp/session/hedera",
    "the close",
    HEDERA,
    { phase: "close", transaction: TX, escrow: sessionEscrow, channel: CHANNEL },
    [
      { why: "reverted", logs: [log(sessionEscrow, [CHANNEL_CLOSED_TOPIC as Hex, CHANNEL])], reverted: true },
      { why: "binding-log-not-found", logs: [] },
    ],
  ],
];

/**
 * A reader holding the failure's receipt in `BLOCK`, its transaction and `eth_call` answers, and the two marks; a mark
 * given as "fails" rejects with `ReaderError`. It records each mark it is asked for.
 */
function reader(network: string, f: Failure, finalized: bigint | "fails", safe: bigint | "fails", marks: string[]): EvmReader {
  return {
    network: network as EvmReader["network"],
    receipt: async () => ({ status: f.reverted ? 0 : 1, blockNumber: BLOCK, logs: f.logs }),
    blockNumber: async (tag) => {
      marks.push(tag);
      const at = tag === "finalized" ? finalized : safe;
      if (at === "fails") throw new ReaderError("transport");
      return at;
    },
    transaction: async () => f.tx ?? null,
    call: async (_to, _data, block) => (f.call ?? (() => uint(0n)))(block),
  };
}

const statusOf = (id: string) =>
  (BINDINGS.find((b) => b.id === id) as unknown as { status: (ref: object, reader: EvmReader) => Promise<unknown> }).status;

describe("an EVM failed answer is given only at or below the finalized mark", () => {
  for (const [id, what, network, ref, failures] of ROWS) {
    for (const f of rowsOf(failures, `${id}, ${what}: its failed reads`)) {
      it(`${id}, ${what}: ${f.why}`, async () => {
        const status = statusOf(id);
        const full = { network, ...ref };
        for (const [finalized, safe] of [
          [BLOCK, BLOCK],
          [BLOCK + 5n, BLOCK + 10n],
        ] as const) {
          const marks: string[] = [];
          expect(await status(full, reader(network, f, finalized, safe, marks)), `finalized ${finalized}`).toEqual({
            state: "failed",
            why: f.why,
          });
          expect(marks).toContain("finalized");
        }
        for (const [finalized, safe] of [
          [BLOCK - 1n, BLOCK],
          [BLOCK - 1n, BLOCK - 1n],
          ["fails", BLOCK],
          ["fails", "fails"],
        ] as const) {
          const marks: string[] = [];
          expect(await status(full, reader(network, f, finalized, safe, marks)), `finalized ${finalized}, safe ${safe}`).toEqual({
            state: "pending",
            why: f.why,
          });
          expect(marks).toContain("finalized");
        }
      });
    }
  }

  it("covers every EVM pairing with a status, and each failed reason the EVM reads give", () => {
    const evm = BINDINGS.filter((b) => /eip155|\/evm|tempo|session\/hedera/.test(b.id) && "status" in b && b.status);
    expect(new Set(ROWS.map(([id]) => id))).toEqual(new Set(evm.map((b) => b.id)));
    expect(new Set(ROWS.flatMap(([, , , , f]) => f.map((x) => x.why)))).toEqual(
      new Set([
        "reverted",
        "authorization-not-used",
        "transfer-not-found",
        "binding-log-not-found",
        "receive-policy-blocked",
        "nonce-not-used",
      ]),
    );
  });
});

// `fetchPresented` on the Tempo push charge and on the Hedera session reads the presented transaction's receipt and
// refuses one that reverted. That refusal is a failed answer read from a receipt, so it takes the same mark:
// `<ns>/reverted` only where the receipt's block is at or below the reader's `finalized` mark; above it, or where that
// mark cannot be read, `<ns>/not-final`, a read to repeat, which MPP answers 500 `internal-payment-error` with no
// challenge (mpp-challenge.json MV10). The Hedera code is mpp-session-hedera-solana-xrpl.json's agreedRefusals row.
// A receipt that succeeded without the one log `bound` reads H from is read at the same mark, since a block above it
// can be replaced by one with other logs: `<ns>/not-final` above it, and the landed credential at or below it, which
// `bound` refuses (docs/reference/refusals.md, `tempo/memo-not-bound` and `hedera/channel-log-not-found`). Each
// credential is its vector file's B6 buyer row as sent, without the `landed` member `fetchPresented` adds, and the
// receipt's logs are that member's.
describe("a fetchPresented revert, or a receipt without the bound log, is refused only at or below the finalized mark", () => {
  const PU = load("mpp-charge-tempo-push.json");
  const HS = load("mpp-session-hedera-solana-xrpl.json");
  const MV10 = load("mpp-challenge.json").MV10.rows as { code: string; expect: { status: number; type: string } }[];
  const b6 = (file: typeof PU, pairing: string) =>
    file.buyer.rows.find((r: { name: string; pairing: string }) => r.name === "B6" && r.pairing === pairing);
  const asSent = (file: typeof PU, pairing: string) => {
    const { landed: _landed, ...credential } = b6(file, pairing).input.presented;
    return credential as MppCredential;
  };
  const landedLogs = (file: typeof PU, pairing: string) => b6(file, pairing).input.presented.landed.logs as EvmLog[];
  const hederaNotFinal = (HS.agreedRefusals.rows as { case: string; expect: string }[]).find((r) =>
    r.case.startsWith("fetchPresented of a hedera opening whose transaction reverted"),
  )!.expect;
  const CASES: [id: string, network: string, credential: MppCredential, reverted: string, notFinal: string, logs: EvmLog[], unbound: string][] = [
    [
      "mpp/charge/tempo/push",
      TEMPO,
      asSent(PU, "mpp/charge/tempo/push"),
      "tempo/reverted",
      "tempo/not-final",
      landedLogs(PU, "mpp/charge/tempo/push"),
      "tempo/memo-not-bound",
    ],
    [
      "mpp/session/hedera",
      HEDERA,
      asSent(HS, "mpp/session/hedera"),
      "hedera/reverted",
      hederaNotFinal,
      landedLogs(HS, "mpp/session/hedera"),
      "hedera/channel-log-not-found",
    ],
  ];
  const fetchOf = (id: string) =>
    (BINDINGS.find((b) => b.id === id) as unknown as {
      fetchPresented: (c: MppCredential, reader: EvmReader) => Promise<{ refused: true; code: string } | { landed: unknown }>;
    }).fetchPresented;
  const boundOf = (id: string) => (BINDINGS.find((b) => b.id === id) as unknown as { bound: (c: unknown) => Promise<unknown> }).bound;
  const reverted: Failure = { why: "reverted", logs: [], reverted: true };

  for (const [id, network, credential, revertedCode, notFinal, logs, unbound] of CASES) {
    it(`${id}: ${revertedCode} at or below the mark, ${notFinal} above it or where it cannot be read`, async () => {
      const fetchPresented = fetchOf(id);
      for (const [finalized, safe] of [
        [BLOCK, BLOCK],
        [BLOCK + 5n, BLOCK + 10n],
      ] as const) {
        const marks: string[] = [];
        expect(await fetchPresented(credential, reader(network, reverted, finalized, safe, marks)), `finalized ${finalized}`).toEqual({
          refused: true,
          code: revertedCode,
        });
        expect(marks).toContain("finalized");
      }
      for (const [finalized, safe] of [
        [BLOCK - 1n, BLOCK],
        [BLOCK - 1n, BLOCK - 1n],
        ["fails", BLOCK],
        ["fails", "fails"],
      ] as const) {
        const marks: string[] = [];
        expect(
          await fetchPresented(credential, reader(network, reverted, finalized, safe, marks)),
          `finalized ${finalized}, safe ${safe}`,
        ).toEqual({ refused: true, code: notFinal });
        expect(marks).toContain("finalized");
      }
      // A receipt that succeeded with the log `bound` reads is not held to the mark: it lands above it, and no mark is
      // read; `bound` gives H from it.
      const marks: string[] = [];
      const landed = await fetchPresented(credential, reader(network, { why: "", logs }, BLOCK - 1n, BLOCK - 1n, marks));
      expect("landed" in landed && landed.landed).toMatchObject({ blockNumber: BLOCK });
      expect(marks).toEqual([]);
      expect(await boundOf(id)(landed)).toBe(H);
    });

    it(`${id}: a receipt that succeeded without the log bound reads is ${notFinal} above the mark, and lands at or below it, where bound gives ${unbound}`, async () => {
      const fetchPresented = fetchOf(id);
      const without: Failure = { why: "", logs: [] };
      for (const [finalized, safe] of [
        [BLOCK - 1n, BLOCK],
        [BLOCK - 1n, BLOCK - 1n],
        ["fails", BLOCK],
        ["fails", "fails"],
      ] as const) {
        const marks: string[] = [];
        expect(await fetchPresented(credential, reader(network, without, finalized, safe, marks)), `finalized ${finalized}, safe ${safe}`).toEqual({
          refused: true,
          code: notFinal,
        });
        expect(marks).toContain("finalized");
      }
      for (const [finalized, safe] of [
        [BLOCK, BLOCK],
        [BLOCK + 5n, BLOCK + 10n],
      ] as const) {
        const marks: string[] = [];
        const landed = await fetchPresented(credential, reader(network, without, finalized, safe, marks));
        expect("landed" in landed && landed.landed, `finalized ${finalized}`).toMatchObject({ blockNumber: BLOCK, logs: [] });
        expect(marks).toContain("finalized");
        expect(await boundOf(id)(landed)).toEqual({ refused: true, code: unbound });
      }
      // Two copies of the log `bound` reads are not exactly one: the same mark places them.
      const marks: string[] = [];
      expect(await fetchPresented(credential, reader(network, { why: "", logs: [...logs, ...logs] }, BLOCK - 1n, BLOCK - 1n, marks))).toEqual({
        refused: true,
        code: notFinal,
      });
      expect(marks).toContain("finalized");
    });
  }

  it("tempo/not-final and hedera/not-final are codes the package returns, and reads to repeat: 500, no challenge", () => {
    const internal = MV10.find((r) => r.code === "mpp/not-a-code")!.expect;
    for (const code of ["tempo/not-final", hederaNotFinal]) {
      expect(REFUSAL_CODES.has(code), code).toBe(true);
      expect(MV10.find((r) => r.code === code)?.expect, code).toEqual(internal);
      expect(problem(code), code).toEqual(internal);
    }
  });
});

// An EVM, Tempo or Hedera session `recover` that reads a revert, or a receipt, a settle call or a Permit2 bitmap
// without the one use it reads H from, gives a verdict a block above the mark can change, and a refusal names no mark:
// the verdict only where the receipt's block is at or below the reader's `finalized` mark; above it, or where that mark
// cannot be read, the rail's not-final code, a read to repeat (docs/guides/rails.md, "Reading settlement"). The settle
// calls are viem's encodings of the x402 Permit2 proxies' `settle` (x402 contracts/evm/src/x402ExactPermit2Proxy.sol,
// x402UptoPermit2Proxy.sol), and the open call draft-evm-session-00's `open`. The TIP-20 channel reserve's
// `ChannelOpened` carries the salt in data word 3 (TIP-1034).
describe("an EVM, Tempo or Hedera session recover gives a revert or a verdict read from the chain only at or below the finalized mark", () => {
  const PERMIT = {
    name: "permit",
    type: "tuple",
    components: [
      { name: "permitted", type: "tuple", components: [{ name: "token", type: "address" }, { name: "amount", type: "uint256" }] },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  } as const;
  const settleAbi = <const I extends readonly object[]>(inputs: I) =>
    [{ type: "function", name: "settle", stateMutability: "nonpayable", outputs: [], inputs }] as const;
  const PROXY = settleAbi([
    PERMIT,
    { name: "owner", type: "address" },
    { name: "witness", type: "tuple", components: [{ name: "to", type: "address" }, { name: "validAfter", type: "uint256" }] },
    { name: "signature", type: "bytes" },
  ] as const);
  const UPTO_PROXY = settleAbi([
    PERMIT,
    { name: "amount", type: "uint256" },
    { name: "owner", type: "address" },
    {
      name: "witness",
      type: "tuple",
      components: [{ name: "to", type: "address" }, { name: "facilitator", type: "address" }, { name: "validAfter", type: "uint256" }],
    },
    { name: "signature", type: "bytes" },
  ] as const);
  const OPEN = parseAbi(["function open(address payee, address token, uint128 deposit, bytes32 salt, address authorizedSigner)"]);
  const permit = (nonce: Hex) => ({ permitted: { token: TOKEN, amount: VALUE }, nonce: BigInt(nonce), deadline: 1790000060n });
  const settle = (nonce: Hex) =>
    encodeFunctionData({ abi: PROXY, functionName: "settle", args: [permit(nonce), PAYER, { to: PAYEE, validAfter: 0n }, "0x"] });
  const settleUpto = (nonce: Hex) =>
    encodeFunctionData({
      abi: UPTO_PROXY,
      functionName: "settle",
      args: [permit(nonce), VALUE, PAYER, { to: PAYEE, facilitator: STRANGER, validAfter: 0n }, "0x"],
    });
  /** A transaction from the payer to the proxy whose input is these calls, one after another. */
  const calling = (...calls: Hex[]): EvmTransaction => ({
    from: PAYER,
    to: EXACT_PERMIT2_PROXY,
    input: ("0x" + calls.map((c) => c.slice(2)).join("")) as Hex,
  });
  const OTHER_NONCE = ("0x" + NONCE.slice(2, 64) + "00") as Hex;
  const plainTransfer: EvmTransaction = { from: PAYER, to: TOKEN, input: ("0xa9059cbb" + hex64(PAYEE) + hex64(uint(VALUE))) as Hex };
  const leafWith = (salt: Hex) =>
    log(DELEGATION_MANAGER, [REDEEMED_DELEGATION_TOPIC, topic(PAYER), topic(STRANGER)], ("0x" +
      [hex64(PAYER), hex64(STRANGER), hex64("0x0"), hex64("0x0"), hex64("0x0"), salt.slice(2)].join("")) as Hex);
  const created = log(BATCH_SETTLEMENT, [CHANNEL_CREATED_TOPIC, CHANNEL]);
  const reserveOpened = (salt: Hex) =>
    log(TIP20_CHANNEL_RESERVE, [CHANNEL_OPENED_V2_TOPIC, CHANNEL, topic(PAYER), topic(PAYEE)], ("0x" +
      [hex64(TOKEN), hex64(PAYEE), hex64(uint(VALUE)), salt.slice(2)].join("")) as Hex);
  const witnessOf = (h: Hex) => log(ACCOUNT_KEYCHAIN, [KEY_AUTHORIZATION_WITNESS_TOPIC, topic(PAYER), h]);
  /** The Hedera escrow's `ChannelOpened(channel, payer, payee)` with its four data words: token, signer, salt H, deposit. */
  const hederaOpened = log(sessionEscrow, [CHANNEL_OPENED_TOPIC as Hex, CHANNEL, topic(PAYER), topic(PAYEE)], ("0x" +
    [hex64(TOKEN), hex64(STRANGER), H.slice(2), hex64(uint(VALUE))].join("")) as Hex);
  const openCall: EvmTransaction = {
    from: PAYER,
    to: sessionEscrow,
    input: encodeFunctionData({ abi: OPEN, functionName: "open", args: [PAYEE, TOKEN, VALUE, H, STRANGER] }),
  };
  const permit2Rows = (settleOf: (nonce: Hex) => Hex): Failure[] => [
    { why: "evm/reverted", logs: [transfer(PAYER, PAYEE)], reverted: true },
    { why: "evm/no-permit2-settle", logs: [transfer(PAYER, PAYEE)], tx: plainTransfer },
    { why: "evm/ambiguous", logs: [transfer(PAYER, PAYEE)], tx: calling(settleOf(PERMIT2_NONCE), settleOf(OTHER_NONCE)), call: spentInBlock },
    { why: "evm/nonce-not-used", logs: [transfer(PAYER, PAYEE)], tx: calling(settleOf(PERMIT2_NONCE)), call: () => uint(0n) },
    { why: "evm/nonce-not-used", logs: [transfer(PAYER, PAYEE)], tx: calling(settleOf(PERMIT2_NONCE)), call: () => uint(1n) },
  ];

  /** A pairing with a `recover`, the network and ref it reads, and the reads that give each verdict (`why`). */
  type Recovered = [id: string, network: string, ref: object, failures: Failure[], notFinal: string];
  const RECOVERS: Recovered[] = [
    [
      "x402/exact/eip155/eip3009",
      BASE,
      { asset: TOKEN },
      [
        { why: "evm/reverted", logs: [used(H)], reverted: true },
        { why: "evm/no-authorization-use", logs: [transfer(PAYER, PAYEE)] },
        { why: "evm/ambiguous", logs: [used(H), used(NONCE)] },
      ],
      "evm/not-final",
    ],
    [
      "x402/exact/eip155/erc7710-salt",
      BASE,
      {},
      [
        { why: "evm/reverted", logs: [leaf], reverted: true },
        { why: "evm/no-leaf", logs: [transfer(PAYER, PAYEE)] },
        { why: "evm/ambiguous", logs: [leaf, leafWith(NONCE)] },
      ],
      "evm/not-final",
    ],
    ["x402/exact/eip155/permit2", BASE, {}, permit2Rows(settle), "evm/not-final"],
    ["x402/upto/eip155/permit2", BASE, {}, permit2Rows(settleUpto), "evm/not-final"],
    [
      "x402/batch-settlement/eip155",
      BASE,
      {},
      [
        { why: "evm/reverted", logs: [deposited], reverted: true },
        { why: "evm/no-channel-created", logs: [deposited] },
        { why: "evm/ambiguous", logs: [created, created] },
      ],
      "evm/not-final",
    ],
    [
      "mpp/session/evm",
      BASE,
      {},
      [
        { why: "evm/reverted", logs: [transfer(PAYER, sessionEscrow)], reverted: true, tx: openCall },
        // The payer's open call to the escrow, with no `Transfer` of the deposit from the payer into the escrow.
        { why: "evm/no-open-call", logs: [transfer(STRANGER, sessionEscrow)], tx: openCall },
      ],
      "evm/not-final",
    ],
    [
      "mpp/session/tempo",
      TEMPO,
      {},
      [
        { why: "tempo/reverted", logs: [reserveOpened(H)], reverted: true },
        // A v1 escrow's `ChannelOpened`, from another contract and with no salt word: no opening of the reserve.
        { why: "tempo/open-not-found", logs: [log(sessionEscrow, [CHANNEL_OPENED_V2_TOPIC, CHANNEL, topic(PAYER), topic(PAYEE)])] },
        { why: "tempo/ambiguous", logs: [reserveOpened(H), reserveOpened(NONCE)] },
      ],
      "tempo/not-final",
    ],
    [
      "mpp/session/hedera",
      HEDERA,
      { bindingLog: { address: sessionEscrow, topic0: CHANNEL_OPENED_TOPIC, index: 1, value: CHANNEL } },
      [
        { why: "hedera/reverted", logs: [hederaOpened], reverted: true },
        // The escrow's `ChannelOpened` for another channel.
        { why: "hedera/channel-log-not-found", logs: [{ ...hederaOpened, topics: [CHANNEL_OPENED_TOPIC as Hex, NONCE, topic(PAYER), topic(PAYEE)] }] },
      ],
      "hedera/not-final",
    ],
    [
      "mpp/session/hedera",
      HEDERA,
      { escrow: sessionEscrow },
      [
        { why: "hedera/reverted", logs: [], reverted: true },
        // Two of the escrow's `ChannelOpened` logs, for two channels.
        { why: "hedera/channel-log-not-found", logs: [channelOpened(CHANNEL), channelOpened(NONCE)] },
      ],
      "hedera/not-final",
    ],
    [
      "mpp/subscription/tempo",
      TEMPO,
      {},
      [
        { why: "tempo/reverted", logs: [witnessOf(H)], reverted: true },
        { why: "tempo/no-witness", logs: [transfer(PAYER, PAYEE)] },
        { why: "tempo/ambiguous", logs: [witnessOf(H), witnessOf(NONCE)] },
      ],
      "tempo/not-final",
    ],
  ];
  const recoverOf = (id: string) =>
    (BINDINGS.find((b) => b.id === id) as unknown as { recover: (ref: object, reader: EvmReader) => Promise<unknown> }).recover;

  for (const [id, network, ref, failures, notFinal] of RECOVERS) {
    for (const f of rowsOf(failures, `${id}: its verdicts`)) {
      it(`${id}: ${f.why} at or below the mark, ${notFinal} above it or where it cannot be read`, async () => {
        const recover = recoverOf(id);
        const verdict = f.why;
        const full = { network, transaction: TX, ...ref };
        for (const [finalized, safe] of [
          [BLOCK, BLOCK],
          [BLOCK + 5n, BLOCK + 10n],
        ] as const) {
          const marks: string[] = [];
          expect(await recover(full, reader(network, f, finalized, safe, marks)), `finalized ${finalized}`).toEqual({
            refused: true,
            code: verdict,
          });
          expect(marks).toContain("finalized");
        }
        for (const [finalized, safe] of [
          [BLOCK - 1n, BLOCK],
          [BLOCK - 1n, BLOCK - 1n],
          ["fails", BLOCK],
          ["fails", "fails"],
        ] as const) {
          const marks: string[] = [];
          expect(await recover(full, reader(network, f, finalized, safe, marks)), `finalized ${finalized}, safe ${safe}`).toEqual({
            refused: true,
            code: notFinal,
          });
          expect(marks).toContain("finalized");
        }
      });
    }
  }

  it("covers every EVM, Tempo and Hedera session pairing with a recover", () => {
    const evm = BINDINGS.filter(
      (b) => /eip155|\/evm|tempo|session\/hedera/.test(b.id) && typeof (b as { recover?: unknown }).recover === "function",
    );
    expect(new Set(RECOVERS.map(([id]) => id))).toEqual(new Set(evm.map((b) => b.id)));
  });

  // A transaction whose own call is not an escrow open call holds none on any read: its calldata is its own.
  it("mpp/session/evm: a transaction whose own call is not an open call is evm/no-open-call above the mark, with no mark read", async () => {
    const marks: string[] = [];
    const f: Failure = { why: "evm/no-open-call", logs: [transfer(PAYER, sessionEscrow)], tx: plainTransfer };
    expect(await recoverOf("mpp/session/evm")({ network: BASE, transaction: TX }, reader(BASE, f, BLOCK - 1n, BLOCK - 1n, marks))).toEqual({
      refused: true,
      code: "evm/no-open-call",
    });
    expect(marks).toEqual([]);
  });

  it("evm/not-final is a code the package returns, and a read to repeat", () => {
    expect(REFUSAL_CODES.has("evm/not-final")).toBe(true);
    expect(readToRepeat("evm/not-final")).toBe(true);
    expect(readToRepeat("evm/reverted")).toBe(false);
  });
});
