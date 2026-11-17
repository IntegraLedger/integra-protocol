/**
 * `mpp/session/hedera/stock`: MPP's `session` intent with the stock method `hedera`, at coverage `none`. The stock
 * client sends `approve` and the escrow's `open` itself, with a random salt, so nothing the payer signs carries H; the
 * session is served after the agreement, and the opening is the sale's only where it comes after the agreement was
 * recorded and the account that opened it signed the agreement, which the caller compares (the profile
 * `mpp/session/hedera-solana-xrpl`). lcp builds nothing here: there is no `build`, no `buildWithin` and no `recover`.
 * The read takes the opening by the transaction hash its credential names, through the network's JSON-RPC relay, and
 * resolves the escrow's `ChannelOpened` payer and payee to account ids through the mirror.
 */
import type { AtrHash, Json } from "./core.js";
import { addressOfWord, bytesOf, hexOf, keccak, sameBytes, wordAt, type Hex } from "./evm-abi.js";
import { isAddress, normalHash } from "./fields.js";
import { HEDERA } from "./internal/data/hedera.js";
import { isLog, isReceipt, type EvmLog, type EvmReceipt } from "./internal/evm.js";
import { CHANNEL_OPENED_TOPIC, hederaChannelId } from "./internal/hedera-session.js";
import { decide, type Act, type Facts, type Ledger, type Seen, type StatusAnswer, type StatusQuery, type UnreadableReason } from "./internal/read.js";
import type { Entry } from "./internal/registry.js";
import {
  credentialOf,
  decodeObject,
  deepFreeze,
  echoedFor,
  isObject,
  issuedDigest,
  measuring,
  measuringAsync,
  place,
  read,
  sessionBroadcaster,
  tie,
  type MppChallenge,
  type MppCredential,
  type MppForms,
} from "./mpp-challenge.js";
import type { Broadcaster } from "./internal/broadcaster.js";
import { hederaSessionNetworkOf } from "./mpp-rail-checks.js";
import { carriesRefused, isRefusal, refusal, type Refusal } from "./refusal.js";
import type { LcpPattern } from "./x402.js";

const STOCK = "mpp/session/hedera/stock" as const;

type HederaNetwork = "hedera:mainnet" | "hedera:testnet" | "hedera:previewnet" | "hedera:devnet";
type Obj = { [k: string]: Json };
type Kind = "open" | "within" | "close";

/** `open(address payee, address token, uint128 deposit, bytes32 salt, address authorizedSigner)`, the escrow's call. */
const OPEN_SELECTOR = /* @__PURE__ */ hexOf(keccak("open(address,address,uint128,bytes32,address)").subarray(0, 4));

/** The most logs of the opening's receipt the read takes. */
const MAX_LOGS = 64;

/**
 * The read keys of a stock opening: the network, the opening's transaction hash its credential names, the escrow the
 * challenge names, the channel the credential names, and the challenge's `recipient`, the payee. Addresses and hashes
 * are lowercase. The position the opening must come after, the relay's block number read when the agreement settled,
 * is the caller's.
 */
export interface HederaStockRef {
  network: HederaNetwork;
  transaction: Hex;
  escrow: Hex;
  channel: Hex;
  payee: Hex;
}

/**
 * The reader of a stock session: the network's JSON-RPC relay, and three reads of its mirror. Every failure rejects.
 */
export interface HederaStockReader {
  readonly network: HederaNetwork;
  /** `eth_getTransactionReceipt` through the relay; null when it holds none. */
  receipt(tx: Hex): Promise<EvmReceipt | null>;
  /** `eth_getTransactionByHash` through the relay: the recipient and the calldata the sender signed; null when none. */
  transaction(tx: Hex): Promise<{ to: Hex | null; input: Hex } | null>;
  /**
   * `GET /api/v1/accounts/{address}` of the mirror: the account id its `account` member names, `shard.realm.num`; null
   * on the mirror's 404.
   */
  account(address: Hex): Promise<string | null>;
  /**
   * `GET /api/v1/contracts/results/{transactionIdOrHash}` of the mirror for the transaction hash: the answer's `result`,
   * the transaction's result as the network records it, `CONTRACT_REVERT_EXECUTED` for a revert executed in the EVM;
   * null on the mirror's 404.
   */
  contractResult(tx: Hex): Promise<string | null>;
  /**
   * The number of the oldest block the mirror holds, from which the relay answers, `number` of
   * `GET /api/v1/blocks?order=asc&limit=1`, or `archival` where the endpoint is declared archival.
   */
  oldestBlock(): Promise<bigint | "archival">;
}

/** What `status` answers: positions are the relay's block numbers, and its one mark `finalized`, which is final. */
export type HederaStockStatus = StatusAnswer<bigint, "finalized", bigint>;
type StockQuery = StatusQuery<HederaStockRef, bigint, "finalized", bigint>;

const LEDGER: Ledger<bigint, "finalized"> = Object.freeze({
  coverage: HEDERA[STOCK].coverage,
  final: "finalized" as const,
  markOrder: () => 0,
  positionOrder: (a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0),
});

// ── the challenge ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The network and channel a Hedera session challenge names for the client to resume, as `channel.ref` spells it: its
 * `methodDetails.channelId`, a 32-byte hash, lowercase. Null when it names none; `mpp/request-malformed` for a channel
 * or `methodDetails` that cannot be read, and `pairingsOf`'s code for a network it does not name.
 */
export function hederaSessionResume(c: MppChallenge): { network: string; channel: string } | null | Refusal {
  if (!isObject(c) || c.intent !== "session" || c.method !== "hedera" || typeof c.request !== "string") {
    return refusal("mpp/not-this-pairing");
  }
  const request = decodeObject(c.request);
  if (request === undefined) return refusal("mpp/request-malformed");
  const md = request["methodDetails"];
  if (md !== undefined && !isObject(md)) return refusal("mpp/request-malformed");
  const details = (md ?? {}) as Obj;
  const named = details["channelId"];
  if (named === undefined) return null;
  const channel = normalHash(named);
  if (channel === null) return refusal("mpp/request-malformed");
  const network = hederaSessionNetworkOf(details);
  return isRefusal(network) ? network : { network, channel };
}

// ── the credential ───────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A stock session credential's kind by its action, one of the four draft-hedera-session-00 defines: `open`, `topUp` and
 * `voucher` within the channel, and `close`. Any other action, `use` among them, is `mpp/session-action`.
 */
function stockKind(presented: MppCredential): Kind | Refusal {
  if (!isObject(presented) || !isObject(presented.payload)) return refusal("mpp/credential-malformed");
  const a = presented.payload["action"];
  if (a === "open" || a === "close") return a;
  return a === "voucher" || a === "topUp" ? "within" : refusal("mpp/session-action");
}

/**
 * Who broadcasts a stock session payment, as draft-hedera-session-00 has it: the payer an opening or a top-up, each a
 * transaction it sends itself and names by `txHash`; the resource server a voucher, which it redeems when it closes,
 * and the close, which it sends.
 */
function stockBroadcasts(credential: MppCredential): Broadcaster | Refusal {
  const action = credential.payload["action"];
  if (action === "open" || action === "topUp") return "payer";
  return action === "voucher" || action === "close" ? "payee" : refusal("mpp/session-action");
}

/** The `methodDetails` of the echoed challenge, read from its request, which must be a `session` on `hedera`. */
function echoedDetails(presented: MppCredential): Obj | Refusal {
  const c = credentialOf(presented);
  if (isRefusal(c)) return c;
  if (c.challenge.intent !== "session" || c.challenge.method !== "hedera") return refusal("mpp/not-this-pairing");
  const request = decodeObject(c.challenge.request);
  if (request === undefined) return refusal("mpp/request-malformed");
  const md = request["methodDetails"];
  if (md === undefined) return {};
  return isObject(md) ? (md as Obj) : refusal("mpp/request-malformed");
}

/**
 * The network and the payload's `channelId`, lowercase, of any credential `stockKind` takes; an opening's challenge is
 * held to the pairing's filter (`echoedFor`), a later one read as the resource server issued it (`echoedDetails`).
 */
async function stockRef(presented: MppCredential): Promise<{ network: string; channel: string } | Refusal> {
  const k = stockKind(presented);
  if (isRefusal(k)) return k;
  let details: Obj;
  if (k === "open") {
    const e = echoedFor(presented, STOCK);
    if (isRefusal(e)) return e;
    details = e.checked.details;
  } else {
    const d = echoedDetails(presented);
    if (isRefusal(d)) return d;
    details = d;
  }
  const network = hederaSessionNetworkOf(details);
  if (isRefusal(network)) return network;
  const channel = normalHash(presented.payload["channelId"]);
  return channel === null ? refusal("mpp/credential-malformed") : { network, channel };
}

/**
 * Nothing the payer signs carries H at coverage `none`: once the credential is an opening whose echoed challenge the
 * pairing takes, `mpp/no-signed-place`; another action is `mpp/session-action`. The challenge's id and `opaque` name H,
 * which lcp's MPP checks read.
 */
async function stockBound(input: unknown, _given?: { act: Act; h: AtrHash }): Promise<AtrHash | Refusal> {
  const presented = credentialOf(input);
  if (isRefusal(presented)) return presented;
  const e = echoedFor(presented, STOCK);
  if (isRefusal(e)) return e;
  if (e.payload["action"] !== "open") return refusal("mpp/session-action");
  return refusal("mpp/no-signed-place");
}

/**
 * The read keys of an opening (`HederaStockRef`): the network; the payload's `txHash` and `channelId`, each a 32-byte
 * hash, else `mpp/credential-malformed`; the challenge's `methodDetails.escrowContract`; and the `recipient` of
 * `option`, the challenge the payment answers, an address, else `mpp/request-malformed`. Another action is
 * `mpp/session-action`. `option` is held to the challenge the credential echoes by the members fixed at issue
 * (`issuedDigest`), as issued or as placed: one that is not it is `mpp/challenge-not-option`, since the payee the read
 * tests is the one of the challenge the payment answers; one that is no challenge is `mpp/challenge-malformed`.
 */
async function stockReference(
  input: unknown,
  option: MppChallenge,
  _given?: { act: Act; h: AtrHash },
): Promise<HederaStockRef | Refusal> {
  const presented = credentialOf(input);
  if (isRefusal(presented)) return presented;
  const e = echoedFor(presented, STOCK);
  if (isRefusal(e)) return e;
  if (e.payload["action"] !== "open") return refusal("mpp/session-action");
  const offered = await issuedDigest(option);
  if (isRefusal(offered)) return offered;
  const echoed = await issuedDigest(presented.challenge);
  if (isRefusal(echoed) || echoed !== offered) return refusal("mpp/challenge-not-option");
  const network = hederaSessionNetworkOf(e.checked.details);
  if (isRefusal(network)) return network;
  const escrow = e.checked.details["escrowContract"];
  if (!isAddress(escrow)) return refusal("mpp/request-malformed");
  const transaction = normalHash(e.payload["txHash"]);
  const channel = normalHash(e.payload["channelId"]);
  if (transaction === null || channel === null) return refusal("mpp/credential-malformed");
  const request = isObject(option) && typeof option.request === "string" ? decodeObject(option.request) : undefined;
  const payee = request === undefined ? undefined : request["recipient"];
  if (!isAddress(payee)) return refusal("mpp/request-malformed");
  return {
    network,
    transaction: transaction as Hex,
    escrow: escrow.toLowerCase() as Hex,
    channel: channel as Hex,
    payee: payee.toLowerCase() as Hex,
  };
}

// ── the read ─────────────────────────────────────────────────────────────────────────────────────────────────────

function isStockRef(ref: unknown): ref is HederaStockRef {
  return (
    isObject(ref) &&
    typeof ref["network"] === "string" &&
    normalHash(ref["transaction"]) !== null &&
    normalHash(ref["channel"]) !== null &&
    isAddress(ref["escrow"]) &&
    isAddress(ref["payee"])
  );
}

function isStockQuery(q: unknown): q is StockQuery {
  if (!isObject(q)) return false;
  const { act, finality, after, others } = q;
  return (
    (act === "payment" || act === "agreement") &&
    finality === "finalized" &&
    (after === undefined || (typeof after === "bigint" && after >= 0n)) &&
    (others === undefined || (Array.isArray(others) && others.every(isObject)))
  );
}

/**
 * The opening's `ChannelOpened` logs among the receipt's: from the escrow, four topics, the first the event's and the
 * second the channel, and four 32-byte words of data, with the place of each among the receipt's logs.
 */
function channelOpened(logs: readonly EvmLog[], escrow: Hex, channel: Hex): { log: EvmLog; place: number }[] {
  return logs.flatMap((log, place) =>
    sameBytes(log.address.toLowerCase(), escrow) &&
    log.topics.length === 4 &&
    log.topics[0]!.toLowerCase() === CHANNEL_OPENED_TOPIC &&
    log.topics[1]!.toLowerCase() === channel &&
    bytesOf(log.data)?.length === 128
      ? [{ log, place }]
      : [],
  );
}

/**
 * The members of a `ChannelOpened` log, `ChannelOpened(bytes32 indexed channelId, address indexed payer, address
 * indexed payee, address token, address authorizedSigner, bytes32 salt, uint256 deposit)`, where the channel id the
 * escrow computes from them is the one the log names; undefined otherwise.
 */
function openedMembers(log: EvmLog, escrow: Hex, network: HederaNetwork): { payer: Hex; payee: Hex; token: Hex; deposit: bigint } | undefined {
  const data = bytesOf(log.data)!;
  const payerWord = bytesOf(log.topics[2]);
  const payeeWord = bytesOf(log.topics[3]);
  const payer = payerWord === undefined ? undefined : addressOfWord(payerWord);
  const payee = payeeWord === undefined ? undefined : addressOfWord(payeeWord);
  const token = addressOfWord(wordAt(data, 0)!);
  const signer = addressOfWord(wordAt(data, 1)!);
  const salt = hexOf(wordAt(data, 2)!);
  if (payer === undefined || payee === undefined || token === undefined || signer === undefined) return undefined;
  const chainId = network === "hedera:mainnet" ? 295 : 296;
  const id = hederaChannelId({ payer, payee, token, salt, authorizedSigner: signer, escrow, chainId });
  if (id !== log.topics[1]!.toLowerCase()) return undefined;
  return { payer, payee, token, deposit: BigInt(hexOf(wordAt(data, 3)!)) };
}

/** Whether `address` is the recipient's, by address or by the account the mirror resolves both to. */
async function namesPayee(address: Hex, recipient: Hex, reader: HederaStockReader): Promise<boolean> {
  if (sameBytes(address.toLowerCase(), recipient)) return true;
  const [a, b] = [await reader.account(address), await reader.account(recipient)];
  return typeof a === "string" && a === b;
}

/**
 * The read of a stock opening, as the profile `read-status` answers it at coverage `none` (the profile
 * `mpp/session/hedera-solana-xrpl`): the transaction the credential names, by its receipt through the relay, at its one
 * mark, `finalized`, every block the relay serves being final. A revert took the sender nonce it signed only where it
 * was executed in the EVM, the mirror's contract result for the hash being `CONTRACT_REVERT_EXECUTED`, one that failed
 * the node's validations before the EVM leaving the nonce as it was (HIP-844, *Rationale*). Such a revert is the act's
 * own failed result, `transaction-failed`, where its sender signed the escrow's `open` to the challenge's recipient, as
 * `eth_getTransactionByHash` gives the call; an `open` to another account consumed the opening's nonce,
 * `instrument-consumed`, and so does a revert of any other call. Any other failed result, or none on the mirror, shows
 * no nonce taken, `INSUFFICIENT_GAS` coming both before and in the EVM (HIP-844, *Backward Compatibility*), and the
 * same signed bytes can still land under the same hash: with the value unread and the lookup not ended, it is
 * `pending`, `search-incomplete`, never `failed`. A receipt that succeeded holding exactly one `ChannelOpened` from the
 * escrow naming the channel, whose members give the channel id it names, is the opening: its signer is the account id
 * the mirror resolves its payer to, or the payer's address where the mirror resolves none, an address of no account; it
 * is the payee's own act where that account is the one the challenge's `recipient` resolves to; and it names the
 * payee's account where its `payee` is the `recipient` or resolves to the same account. What moved is the deposit, by
 * the transaction and the log's place among the receipt's logs. Any other receipt that succeeded consumed the opening's
 * transaction and is no opening of the channel. No receipt is `not-found` where the mirror holds the blocks after the
 * position the caller gives, or is archival, and `history-gap` otherwise. The read reads no nonce state and makes no
 * search, the named transaction's receipt, and for a revert its contract result, being all it reads of the opening's
 * sender nonce; it reads the payer against no account: the caller compares the signer with the account that signed the
 * agreement.
 */
export async function hederaStockStatus(
  ref: HederaStockRef,
  reader: HederaStockReader,
  query: StockQuery,
): Promise<HederaStockStatus> {
  const unreadable = (reason: UnreadableReason): HederaStockStatus => ({ state: "unreadable", reason, foreign: [] });
  if (!isStockRef(ref) || !isStockQuery(query)) return unreadable("unparseable");
  if (!isObject(reader) || reader.network !== ref.network) return unreadable("chain-mismatch");
  const tx = ref.transaction.toLowerCase() as Hex;
  let receipt: EvmReceipt | null;
  try {
    receipt = await reader.receipt(tx);
  } catch {
    return unreadable("transport");
  }
  if (receipt === null) {
    let oldest: bigint | "archival";
    try {
      oldest = await reader.oldestBlock();
    } catch {
      return unreadable("transport");
    }
    if (oldest !== "archival" && typeof oldest !== "bigint") return unreadable("unparseable");
    const history = oldest === "archival" || (query.after !== undefined && oldest <= query.after + 1n);
    return decide({ seen: [], search: { whole: true }, history }, query, LEDGER);
  }
  if (!isReceipt(receipt) || !receipt.logs.every(isLog)) return unreadable("unparseable");
  if (receipt.logs.length > MAX_LOGS) return unreadable("too-large");
  // What was presented is the transaction the credential names, and every row read here is that transaction.
  const row = { transaction: tx, position: receipt.blockNumber, mark: "finalized" as const, consumed: true, carries: false, presented: "yes" as const };
  let seen: Seen<bigint, "finalized">;
  // A revert executed in the EVM took the sender nonce; any other failed result shows none taken (HIP-844).
  let executed = true;
  if (receipt.status === 0) {
    // The revert is the act's own failed result where the sender signed the escrow's `open`, the payer's by rule, the
    // named transaction being the act at coverage none, its sender not read; the account it names is the `payee` that
    // call signs, since a revert moved nothing.
    let result: string | null;
    let signed: { to: Hex | null; input: Hex } | null;
    try {
      result = await reader.contractResult(tx);
      signed = await reader.transaction(tx);
    } catch {
      return unreadable("transport");
    }
    if (result !== null && typeof result !== "string") return unreadable("unparseable");
    executed = result === "CONTRACT_REVERT_EXECUTED";
    const input = isObject(signed) ? bytesOf(signed.input) : undefined;
    const open =
      isObject(signed) && typeof signed.to === "string" && sameBytes(signed.to.toLowerCase(), ref.escrow.toLowerCase()) &&
      input !== undefined && input.length === 164 && hexOf(input.subarray(0, 4)) === OPEN_SELECTOR
        ? addressOfWord(input.subarray(4, 36))
        : undefined;
    let account: "payee" | "other" | "none" = "none";
    if (open !== undefined) {
      try {
        account = await namesPayee(open, ref.payee.toLowerCase() as Hex, reader) ? "payee" : "other";
      } catch {
        return unreadable("transport");
      }
    }
    seen = { ...row, result: "failed", consumed: executed, party: "payer", kind: open === undefined ? "other" : "same", account };
  } else {
    const opened = channelOpened(receipt.logs, ref.escrow.toLowerCase() as Hex, ref.channel.toLowerCase() as Hex);
    const members = opened.length === 1 ? openedMembers(opened[0]!.log, ref.escrow.toLowerCase() as Hex, ref.network) : undefined;
    if (members === undefined) {
      seen = { ...row, result: "succeeded", party: "payer", kind: "other", account: "none" };
    } else {
      let payer: string | null;
      let payee: string | null;
      let recipient: string | null;
      try {
        payer = await reader.account(members.payer);
        payee = await reader.account(members.payee);
        recipient = sameBytes(members.payee, ref.payee.toLowerCase()) ? payee : await reader.account(ref.payee.toLowerCase() as Hex);
      } catch {
        return unreadable("transport");
      }
      for (const id of [payer, payee, recipient]) if (id !== null && typeof id !== "string") return unreadable("unparseable");
      const named = sameBytes(members.payee, ref.payee.toLowerCase()) || (payee !== null && payee === recipient);
      const to = payee ?? members.payee;
      seen = {
        ...row,
        result: "succeeded",
        // The payee's own act: its payer is the recipient by address, or resolves to the account the recipient does.
        party: sameBytes(members.payer, ref.payee.toLowerCase()) || (payer !== null && payer === recipient) ? "payee" : "payer",
        kind: "same",
        account: named ? "payee" : "other",
        signer: payer ?? members.payer,
        moved: [{ asset: members.token, amount: members.deposit.toString(), to, transaction: tx, place: opened[0]!.place }],
      };
    }
  }
  // The opening's own transaction is included and, where it succeeded or was executed in the EVM, consumed the
  // opening's account nonce, the act's one value read. A failed result not shown executed there leaves the value unread
  // and the lookup not ended, since the same signed bytes can still land under the same hash.
  const facts: Facts<bigint, "finalized", bigint> = executed
    ? {
        seen: [seen],
        value: { consumed: true, lapsed: false, mark: "finalized", head: { consumed: true } },
        search: { whole: true },
        history: true,
      }
    : { seen: [seen], search: { whole: false }, history: true };
  return decide(facts, query, LEDGER);
}

// ── the record ───────────────────────────────────────────────────────────────────────────────────────────────────

/** The challenge as issued: no request member carries H. A challenge that carries a `refused` member is refused. */
function unplaced(option: MppChallenge): MppChallenge | Refusal {
  if (isObject(option) && carriesRefused(option)) return refusal("mpp/challenge-malformed");
  return option;
}

/** MPP's `place`: the id derived from H and `opaque`; `request` is left unchanged. */
function advertise(
  doc: readonly MppChallenge[],
  h: AtrHash,
  link: string,
  offer: MppChallenge,
  position: number | null,
  act?: Act,
  agreementUrl?: string,
) {
  return place(doc, h, link, offer, position, act, agreementUrl);
}

async function notBoundWithin(_presented: MppCredential): Promise<AtrHash | Refusal> {
  return refusal("mpp/not-bound-within");
}

/**
 * `mpp/session/hedera/stock`, the stock client's session at coverage `none`, served after the agreement. `broadcaster`
 * answers `"payer"` for the opening and a top-up, which the buyer's client sends, and `"payee"` for a voucher and the
 * close; `status` reads the opening (`hederaStockStatus`).
 */
export const sessionHederaStock = Object.freeze({
  id: STOCK,
  data: HEDERA[STOCK],
  pattern: deepFreeze({
    pattern: "opaque-challenge",
    zeroPartyRecoverable: false,
    profile: "mpp/session/hedera-solana-xrpl",
    onChain: true,
    forwardIndexable: false,
  } satisfies LcpPattern),
  claims: false as const,
  unplaced,
  tie,
  advertise,
  read,
  bound: stockBound,
  broadcaster: sessionBroadcaster(stockKind, stockBroadcasts, () => refusal("mpp/session-action"), echoedDetails),
  reference: stockReference,
  status: hederaStockStatus,
  channel: Object.freeze({
    kind: measuring((p: MppCredential) => stockKind(p)),
    ref: measuringAsync(stockRef),
    boundWithin: measuringAsync(notBoundWithin),
    until: (): number | undefined => undefined,
  }),
}) satisfies Entry<
  typeof STOCK,
  MppCredential,
  HederaStockRef,
  HederaStockReader,
  MppForms & {
    choice: never;
    unsigned: never;
    landed: object;
    network: never;
    query: StockQuery;
    answer: HederaStockStatus;
  }
>;
