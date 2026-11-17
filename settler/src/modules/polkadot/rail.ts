/**
 * Rule 5 of `x402/exact/polkadot/lcp-assets-remark` against one network's RPC node: `/verify` decodes the extrinsic
 * with the network's runtime metadata, checks its call against the requirements and asks the node to validate it;
 * `/settle` repeats that, submits, and reads the payment by lcp's read until it is final. Which payments were already
 * settled is the settler's record, not the rail's: the rail keeps no row.
 */
import { ApiPromise } from "@polkadot/api";
import type { ApiOptions } from "@polkadot/api/types";
import { pairingOf } from "@integraledger/lcp";
import { isRefusal } from "@integraledger/lcp/core";
import {
  decodeProfileCall,
  exactPolkadotRemark,
  extrinsicHash,
  ss58Decode,
  type PolkadotCursor,
  type PolkadotNetwork,
  type PolkadotReader,
  type PolkadotStatus,
} from "@integraledger/lcp/polkadot";
import {
  failed,
  invalid,
  isObject,
  pending,
  type FacilitatorRequest,
  type InvalidReason,
  type OperatorLog,
  type SettleAnswer,
  type VerifyAnswer,
} from "../../answers.js";
import { NODE_MAX_BYTES, NODE_TIMEOUT_MS, NodeError, Slots, isSpent, postJson, sleep, within, type Spent } from "../../http.js";
import { settleReason, unexpectedSettle, unexpectedVerify } from "../../unexpected.js";

/**
 * Where the settler's read of a payment it submitted searches: after `after`, the block before the first that can hold
 * the extrinsic, which lcp's read takes as the position the payment came after; and from `search`, lcp's search
 * position, which holds the head at which the chain answered the extrinsic valid.
 */
export interface PolkadotPosition {
  readonly after: bigint;
  readonly search: PolkadotCursor;
}

export interface PolkadotNode {
  network: PolkadotNetwork;
  rpc: string;
}

const POLL_MS = 1_000;
/**
 * The longest a metadata load may take. Each of its calls is bounded by the node call bound and by the time the load
 * has left, and a call the load has no time left for is not sent: a load given up at this bound has no call in flight
 * and sends no further call.
 */
const INIT_TIMEOUT_MS = 30_000;
/** `TransactionSource::External`. */
const EXTERNAL = "02";
/**
 * How many `chain_getBlock` reads, each bounded by the runtime's `System.BlockLength`, run at once in this process:
 * for Polkadot Asset Hub's runtime 2005000, at most 4 × 28,504,064 = 114,016,256 bytes of block answers.
 */
export const BLOCK_READS = 4;
/** The slots of `BLOCK_READS`, shared by every network and every scan in this process. */
export const blockReads = new Slots(BLOCK_READS);
/** The JSON-RPC error `author_submitExtrinsic` gives for an extrinsic already in the pool. */
const ALREADY_IMPORTED = 1013;
/** The JSON-RPC error for an extrinsic the pool refuses as invalid; its message or data names the reason. */
const INVALID_TRANSACTION = 1010;
/** The JSON-RPC error for an extrinsic the pool has recently seen and will not take again for a while. */
const TEMPORARILY_BANNED = 1012;

type Provider = NonNullable<ApiOptions["provider"]>;

/** No slot of `blockReads` came free before the pass's deadline, so block `n` was not read. */
class NoBlockReadSlot extends Error {
  constructor(n: number) {
    super(`block ${n}: no block read slot before the deadline`);
  }
}

/** A JSON-RPC error answer: the node read the call and refused it. */
class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data: string,
  ) {
    super(message);
  }
}

/**
 * True when a refused submission says the node has already seen the extrinsic or its nonce (already in the pool,
 * temporarily banned, or an outdated nonce): the payment's replay primitive, the payer's nonce, is consumed.
 */
function seenBefore(e: RpcError): boolean {
  if (e.code === ALREADY_IMPORTED || e.code === TEMPORARILY_BANNED) return true;
  return e.code === INVALID_TRANSACTION && /outdated|stale/i.test(`${e.message} ${e.data}`);
}

async function rpc(url: string, method: string, params: unknown[], timeoutMs?: number, maxBytes?: number): Promise<unknown> {
  const answer = await postJson(url, { jsonrpc: "2.0", id: 1, method, params }, timeoutMs, maxBytes);
  if (!isObject(answer)) throw new NodeError("malformed", true, `${method}: not a JSON-RPC answer`);
  const error = answer["error"];
  if (isObject(error)) {
    const data = error["data"] === undefined ? "" : String(error["data"]);
    throw new RpcError(typeof error["code"] === "number" ? error["code"] : 0, String(error["message"]), data);
  }
  return answer["result"];
}

/**
 * A provider for `@polkadot/api`, with no subscriptions, for one metadata load that ends at `deadline` (on
 * `performance.now()`). Every call is one JSON-RPC POST bounded by the node call bound and by the time left before
 * `deadline`; once `deadline` has passed, a call is not sent and fails as `spent`. `@polkadot/api` goes on with a
 * load's calls once its caller stops waiting for the load; this bound ends them, so a load given up at its deadline has
 * no call in flight and sends no further call.
 */
function boundedProvider(url: string, deadline: number): Provider {
  const provider = {
    hasSubscriptions: false,
    isClonable: false,
    isConnected: true,
    clone(): Provider {
      return boundedProvider(url, deadline);
    },
    async connect(): Promise<void> {},
    async disconnect(): Promise<void> {},
    on(): () => void {
      return () => {};
    },
    send<T>(method: string, params: unknown[]): Promise<T> {
      const left = deadline - performance.now();
      if (left <= 0) return Promise.reject(new NodeError("spent", false, method));
      return rpc(url, method, params, left) as Promise<T>;
    },
    subscribe(): Promise<number | string> {
      return Promise.reject(new Error("subscriptions are not used"));
    },
    unsubscribe(): Promise<boolean> {
      return Promise.resolve(false);
    },
  };
  return provider as unknown as Provider;
}

function hexOf(b: Uint8Array): string {
  return Buffer.from(b).toString("hex");
}

function isLowerHex(v: unknown): v is string {
  return typeof v === "string" && /^0x(?:[0-9a-f]{2})+$/.test(v);
}

function blockNumber(header: unknown): number | undefined {
  const n = isObject(header) ? header["number"] : undefined;
  if (typeof n === "number") return n;
  if (typeof n === "string" && /^0x[0-9a-f]+$/i.test(n)) return Number.parseInt(n, 16);
  return undefined;
}

/**
 * The runtime's bounds, from its metadata. `blockAnswerBytes` is the most bytes a `chain_getBlock` answer can take for
 * a block within `System.BlockLength`: an extrinsic of n encoded bytes (n >= 2: its length prefix and its version
 * byte) is at most 2n + 5 JSON characters (`"0x…",`), so the body's largest class limit L takes at most 9L/2; a
 * header digest item of n >= 1 bytes takes at most 7n, within `maxHeaderSize`; and `NODE_MAX_BYTES` more holds the
 * header's fixed fields and the JSON-RPC envelope. `blockHashCount` is `System.BlockHashCount`.
 */
interface RuntimeBounds {
  blockAnswerBytes: number;
  blockHashCount: number;
}

function isCount(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
}

/** `System.BlockLength` and `System.BlockHashCount` from the metadata; undefined when either is missing or malformed. */
function runtimeBounds(api: ApiPromise): RuntimeBounds | undefined {
  const system = api.consts["system"];
  const length = system?.["blockLength"]?.toJSON();
  const count = Number(system?.["blockHashCount"]?.toString());
  if (!isObject(length) || !isObject(length["max"]) || !isCount(count) || count === 0) return undefined;
  const classes = [length["max"]["normal"], length["max"]["operational"], length["max"]["mandatory"]];
  if (!classes.every(isCount)) return undefined;
  const header = length["maxHeaderSize"];
  const headerBytes = isCount(header) ? header : 0;
  const body = Math.max(...classes);
  return { blockAnswerBytes: NODE_MAX_BYTES + Math.ceil((9 * body) / 2) + 7 * headerBytes, blockHashCount: count };
}

interface EventRecordLike {
  phase: { isApplyExtrinsic: boolean; asApplyExtrinsic: { toNumber(): number } };
  event: { section: string; method: string; data: readonly { toString(): string; toHex(): string; toPrimitive(): unknown }[] };
}

/** An extrinsic that passed every check that does not ask the node about chain state. */
interface Checked {
  network: PolkadotNetwork;
  api: ApiPromise;
  hex: string;
  id: string;
  payer: string;
  era: { birth(current: number): number; death(current: number): number };
  /** The storage key of `System.Events`. */
  eventsKey: string;
  bounds: RuntimeBounds;
}

/** What rule 5 checks from the request alone: the lcp profile, the requirements, and the extrinsic's hash. */
interface Local {
  node: PolkadotNode;
  extrinsic: string;
  call: string;
  id: string;
}

export function createPolkadot(nodes: readonly PolkadotNode[], settleWaitMs: number, log: OperatorLog) {
  const byNetwork = new Map(nodes.map((n) => [n.network as string, n]));
  const apis = new Map<string, Promise<ApiPromise>>();
  /** The fields that name a payment in an operator entry: the payer once the extrinsic is decoded. */
  const about = (c: { network: string; id: string; payer?: string }) => ({
    network: c.network,
    ...(c.payer === undefined ? {} : { payer: c.payer }),
    transaction: c.id,
  });
  /**
   * `unexpected_verify_error` for an answer to `call` this facilitator cannot read: a `node-call-failed` entry whose
   * cause is a `malformed` NodeError naming the part it cannot read.
   */
  const malformed = (c: { network: string; id: string; payer?: string }, call: string, part: string) =>
    unexpectedVerify(
      log,
      { event: "node-call-failed", ...about(c), call },
      new NodeError("malformed", true, `${call}: ${part}`),
    );
  /** The entry for a settle whose deadline, `settleWaitMs` after its request, passed before `before`. */
  const deadlinePassed = (c: { network: string; id: string; payer?: string }, before: string) => ({
    event: "settle-deadline-passed",
    ...about(c),
    before,
    settleWaitMs,
  });
  /**
   * `unexpected_verify_error` for a `/verify` step whose own bound left no time for its call `call`: the call was not
   * sent, and the entry is a failed call's, its cause a `spent` NodeError.
   */
  const notSent = (c: { network: string; id: string; payer?: string }, call: string) =>
    unexpectedVerify(log, { event: "node-call-failed", ...about(c), call }, new NodeError("spent", false, call));
  /**
   * The network's metadata, loaded once and loaded again when the node's runtime version changes, within `timeoutMs`:
   * the version read, the wait for a load another request started, and the wait for a new load. One failed load is one
   * failure, with one operator entry. A load that fails while the request that started it waits is that request's
   * failure, which it reports; one that fails once that request has stopped waiting goes to the operator log from the
   * handler below, with that request's payment `fields` and the load's cause. Once `timeoutMs` is spent, a new load is
   * not started and a load in flight is not waited for: that is a `spent` NodeError.
   */
  async function apiFor(node: PolkadotNode, fields: Record<string, string>, timeoutMs: number): Promise<ApiPromise> {
    const deadline = performance.now() + timeoutMs;
    const left = () => deadline - performance.now();
    const version = await rpc(node.rpc, "state_getRuntimeVersion", [], timeoutMs);
    const spec = isObject(version) ? version["specVersion"] : undefined;
    if (typeof spec !== "number") throw new NodeError("malformed", true, "state_getRuntimeVersion: no specVersion");
    let loading = apis.get(node.network);
    if (loading !== undefined) {
      // A load that failed has gone to the operator log, from the request that started it or from the handler below;
      // a new one is made.
      // With no time left, a load in flight ends the wait at once: this request sends nothing.
      const spent = left() <= 0;
      const api = await within(loading.catch(() => undefined), left()).catch((e: unknown) => {
        throw spent ? new NodeError("spent", false, "metadata") : e;
      });
      if (api !== undefined && api.runtimeVersion.specVersion.toNumber() === spec) return api;
      apis.delete(node.network);
      void api?.disconnect();
    }
    if (left() <= 0) throw new NodeError("spent", false, "metadata");
    const fresh = load(node);
    apis.set(node.network, fresh);
    let waiting = true;
    // Registered before the wait below, so a failure that ends the wait reaches this handler while `waiting` holds.
    fresh.catch((e: unknown) => {
      if (apis.get(node.network) === fresh) apis.delete(node.network);
      if (!waiting) log({ event: "node-call-failed", ...fields, call: "metadata" }, e);
    });
    try {
      return await within(fresh, left());
    } finally {
      waiting = false;
    }
  }

  /**
   * The network's metadata, loaded through a provider whose calls end at the load's deadline, `INIT_TIMEOUT_MS` after
   * the load starts. The load is given up at that deadline: it has no call in flight then and sends none after it, and
   * a later request starts a fresh load.
   */
  async function load(node: PolkadotNode): Promise<ApiPromise> {
    const deadline = performance.now() + INIT_TIMEOUT_MS;
    const api = new ApiPromise({ provider: boundedProvider(node.rpc, deadline), noInitWarn: true, initWasm: false });
    try {
      await within(api.isReadyOrError, deadline - performance.now());
    } catch (e) {
      void api.disconnect();
      throw e;
    }
    if (api.genesisHash.toHex().slice(2, 34) !== node.network.slice("polkadot:".length)) {
      void api.disconnect();
      throw new Error(`the node at ${node.network} serves another chain`);
    }
    return api;
  }

  /** The checks of rule 5 that read nothing from the node. */
  async function local(r: FacilitatorRequest): Promise<Local | InvalidReason> {
    const req = r.paymentRequirements;
    const node = byNetwork.get(req.network);
    if (node === undefined) return "invalid_network";
    if (pairingOf(req as never) !== "x402/exact/polkadot/lcp-assets-remark") return "invalid_payment_requirements";
    const { extrinsic, call } = r.paymentPayload.payload;
    if (!isLowerHex(extrinsic) || !isLowerHex(call)) return "invalid_payload";
    const bound = await exactPolkadotRemark.bound({ x402Version: 2, accepted: req as never, payload: { extrinsic, call } } as never);
    if (typeof bound !== "string") return "invalid_payload";
    const profile = decodeProfileCall(Buffer.from(call.slice(2), "hex"));
    const dest = ss58Decode(req.payTo);
    if (isRefusal(profile) || isRefusal(dest)) return "invalid_payload";
    if (profile.assetId !== Number(req.asset) || profile.amount !== BigInt(req.amount)) return "invalid_payload";
    if (hexOf(profile.dest) !== hexOf(dest)) return "invalid_payload";
    return {
      node,
      extrinsic,
      call,
      id: extrinsicHash(Buffer.from(extrinsic.slice(2), "hex")),
    };
  }

  /**
   * The checks of rule 5 that decode the extrinsic with the network's metadata, within `timeoutMs`. A metadata read that
   * `timeoutMs` leaves no time for is not made, and the answer is `{ spent: "metadata" }`.
   */
  async function decode(l: Local, timeoutMs: number): Promise<Checked | InvalidReason | Spent> {
    const fields = about({ network: l.node.network, id: l.id });
    let api: ApiPromise;
    try {
      api = await apiFor(l.node, fields, timeoutMs);
    } catch (e) {
      if (isSpent(e)) return { spent: "metadata" };
      return unexpectedVerify(log, { event: "node-call-failed", ...fields, call: "metadata" }, e);
    }
    let xt;
    try {
      xt = api.createType("Extrinsic", l.extrinsic);
    } catch {
      // The payer's own extrinsic bytes do not decode: refused `invalid_payload` to the client that sent them.
      return "invalid_payload";
    }
    if (!xt.isSigned || xt.type !== 4 || xt.toHex() !== l.extrinsic || xt.method.toHex() !== l.call) return "invalid_payload";
    const calls = xt.method.args[0] as unknown as readonly { section: string; method: string }[] | undefined;
    if (
      xt.method.section !== "utility" ||
      xt.method.method !== "batchAll" ||
      !Array.isArray(calls) ||
      calls.length !== 2 ||
      calls[0]!.section !== "assets" ||
      calls[0]!.method !== "transferKeepAlive" ||
      calls[1]!.section !== "system" ||
      calls[1]!.method !== "remarkWithEvent"
    ) {
      return "invalid_payload";
    }
    if (!xt.era.isMortalEra) return "invalid_payload";
    const payer = xt.signer.toString();
    const decoded = { network: l.node.network, id: l.id, payer };
    const eventsKey = api.query["system"]?.["events"]?.key();
    if (eventsKey === undefined) return malformed(decoded, "metadata", "System.Events");
    const bounds = runtimeBounds(api);
    if (bounds === undefined) return malformed(decoded, "metadata", "System.BlockLength, System.BlockHashCount");
    return {
      network: l.node.network,
      api,
      hex: l.extrinsic,
      id: l.id,
      payer,
      era: xt.era.asMortalEra,
      eventsKey,
      bounds,
    };
  }

  /**
   * The last block that can include the extrinsic, for a block `at` from its era's birth to that last block: the era's
   * last block, and no later than `BlockHashCount` + 1 blocks after its birth. Each block's execution keeps the hashes of
   * the `BlockHashCount` + 1 blocks before it in `System.BlockHash`, and `CheckMortality` refuses an extrinsic whose
   * birth block's hash is not there.
   */
  function lastBlock(c: Checked, at: number): number {
    const birth = c.era.birth(at);
    return Math.min(c.era.death(at) - 1, birth + c.bounds.blockHashCount + 1);
  }

  /**
   * `TaggedTransactionQueue_validate_transaction` at the best block, within `timeoutMs`: the best block's height, at which
   * the chain answered the extrinsic valid. A call `timeoutMs` leaves no time for is not sent, and the answer names it.
   */
  async function validate(
    c: Checked,
    timeoutMs = 3 * NODE_TIMEOUT_MS,
  ): Promise<{ best: number } | InvalidReason | Spent> {
    const url = byNetwork.get(c.network)!.rpc;
    const deadline = performance.now() + timeoutMs;
    const left = () => deadline - performance.now();
    let best: unknown;
    let header: unknown;
    let validity: unknown;
    let call = "chain_getBlockHash";
    try {
      best = await rpc(url, call, [], left());
      if (!isLowerHex(best) || best.length !== 66) return malformed(c, call, "the block hash");
      call = "chain_getHeader";
      header = await rpc(url, call, [best], left());
      call = "state_call";
      validity = await rpc(
        url,
        call,
        ["TaggedTransactionQueue_validate_transaction", `0x${EXTERNAL}${c.hex.slice(2)}${best.slice(2)}`, best],
        left(),
      );
    } catch (e) {
      if (isSpent(e)) return { spent: call };
      return unexpectedVerify(log, { event: "node-call-failed", ...about(c), call }, e);
    }
    const height = blockNumber(header);
    if (height === undefined) return malformed(c, "chain_getHeader", "number");
    if (typeof validity !== "string") return malformed(c, "state_call", "the validity");
    if (!validity.startsWith("0x00")) return "invalid_transaction";
    return { best: height };
  }

  async function verify(r: FacilitatorRequest): Promise<VerifyAnswer> {
    const l = await local(r);
    if (typeof l === "string") return invalid(l);
    const c = await decode(l, INIT_TIMEOUT_MS);
    if (typeof c === "string") return invalid(c);
    if ("spent" in c) return invalid(notSent({ network: l.node.network, id: l.id }, c.spent));
    const v = await validate(c);
    if (typeof v === "string") return invalid(v, c.payer);
    if ("spent" in v) return invalid(notSent(c, v.spent), c.payer);
    return { isValid: true, payer: c.payer };
  }

  /**
   * The finalized head's height, read before `deadline`. Undefined when a read fails or the header names no number, a
   * node answer this facilitator cannot read; either is a `node-call-failed` entry with the call. A read `deadline`
   * leaves no time for is not sent, and the answer names it.
   */
  async function finalizedHeight(c: Checked, url: string, deadline: number): Promise<number | undefined | Spent> {
    let call = "chain_getFinalizedHead";
    try {
      const hash = await rpc(url, call, [], deadline - performance.now());
      call = "chain_getHeader";
      const height = blockNumber(await rpc(url, call, [hash], deadline - performance.now()));
      if (height === undefined) throw new NodeError("malformed", true, `${call}: number`);
      return height;
    } catch (e) {
      if (isSpent(e)) return { spent: call };
      log({ event: "node-call-failed", ...about(c), call }, e);
      return undefined;
    }
  }

  /** A JSON-RPC block number, as a header prints it. */
  function heightOf(header: unknown, call: string): bigint {
    const n = blockNumber(header);
    if (n === undefined) throw new NodeError("malformed", true, `${call}: number`);
    return BigInt(n);
  }

  /**
   * The reader lcp's Polkadot read takes, over the network's JSON-RPC node, each call bounded by `deadline` and by the
   * node call bound: a block's extrinsics by `chain_getBlock`, read in one of `blockReads`' slots and bounded by the
   * runtime's `System.BlockLength`; an extrinsic's events by `System.Events` at its block, decoded with the network's
   * metadata, each argument as the codec gives it plainly (an account in SS58, an amount as an integer or its decimal,
   * a result as `{ ok }` or `{ err }`); the account nonce from `System.Account` at the finalized head or the best
   * block; the heights from the headers; and the validation at the best block. A read that fails rejects, and lcp's
   * read answers it `unreadable`.
   */
  function reader(c: Checked, deadline: number): PolkadotReader {
    const url = byNetwork.get(c.network)!.rpc;
    const left = () => deadline - performance.now();
    const call = (method: string, params: unknown[], maxBytes?: number) => rpc(url, method, params, left(), maxBytes);
    const hashAt = async (block: `0x${string}` | bigint): Promise<string | null> => {
      if (typeof block !== "bigint") return block;
      const hash = await call("chain_getBlockHash", [Number(block)]);
      if (hash === null) return null;
      if (!isLowerHex(hash) || hash.length !== 66) throw new NodeError("malformed", true, "chain_getBlockHash");
      return hash;
    };
    const blockAt = async (hash: string): Promise<{ height: bigint; extrinsics: string[] } | null> => {
      const release = await blockReads.take(left());
      if (release === undefined) throw new NodeError("spent", false, "chain_getBlock: no block read slot");
      let block: unknown;
      try {
        block = await call("chain_getBlock", [hash], c.bounds.blockAnswerBytes);
      } finally {
        release();
      }
      if (block === null) return null;
      const inner = isObject(block) ? block["block"] : undefined;
      const xts = isObject(inner) ? inner["extrinsics"] : undefined;
      if (!isObject(inner) || !Array.isArray(xts) || !xts.every(isLowerHex)) throw new NodeError("malformed", true, "chain_getBlock");
      return { height: heightOf(inner["header"], "chain_getBlock"), extrinsics: xts as string[] };
    };
    const finalizedHash = async () => {
      const hash = await call("chain_getFinalizedHead", []);
      if (!isLowerHex(hash) || hash.length !== 66) throw new NodeError("malformed", true, "chain_getFinalizedHead");
      return hash;
    };
    return {
      network: c.network,
      async rawExtrinsics(block) {
        const hash = await hashAt(block);
        const read = hash === null ? null : await blockAt(hash);
        return read === null ? null : (read.extrinsics as `0x${string}`[]);
      },
      async extrinsic(block, index) {
        const hash = await hashAt(block);
        const read = hash === null ? null : await blockAt(hash);
        const xt = read?.extrinsics[index];
        if (hash === null || read === null || xt === undefined) return null;
        const raw = await call("state_getStorage", [c.eventsKey, hash]);
        const records = c.api.createType("Vec<EventRecord>", raw) as unknown as readonly EventRecordLike[];
        const mine = records.filter((r) => r.phase.isApplyExtrinsic && r.phase.asApplyExtrinsic.toNumber() === index);
        const events = mine.map((r) => ({
          pallet: r.event.section,
          method: r.event.method,
          data: r.event.data.map((d) => d.toPrimitive() as never),
        }));
        return {
          at: { height: read.height, hash: hash as `0x${string}` },
          hash: extrinsicHash(Buffer.from(xt.slice(2), "hex")),
          success: events.some((e) => e.pallet === "system" && e.method === "ExtrinsicSuccess"),
          events,
        };
      },
      async finalizedHeight() {
        return heightOf(await call("chain_getHeader", [await finalizedHash()]), "chain_getHeader");
      },
      async headHeight() {
        return heightOf(await call("chain_getHeader", []), "chain_getHeader");
      },
      async accountNonce(account, at) {
        const hash = at === "finalized" ? await finalizedHash() : await call("chain_getBlockHash", []);
        const key = c.api.query["system"]?.["account"]?.key(account);
        if (key === undefined) throw new NodeError("malformed", true, "metadata: System.Account");
        const raw = await call("state_getStorage", [key, hash]);
        if (raw === null) return 0n;
        const info = c.api.createType("AccountInfo", raw) as unknown as { nonce: { toBigInt(): bigint } };
        return info.nonce.toBigInt();
      },
      async validate(extrinsic) {
        const best = await call("chain_getBlockHash", []);
        if (!isLowerHex(best) || best.length !== 66) throw new NodeError("malformed", true, "chain_getBlockHash");
        const head = heightOf(await call("chain_getHeader", [best]), "chain_getHeader");
        const validity = await call("state_call", [
          "TaggedTransactionQueue_validate_transaction",
          `0x${EXTERNAL}${extrinsic.slice(2)}${best.slice(2)}`,
          best,
        ]);
        if (typeof validity !== "string") throw new NodeError("malformed", true, "state_call: the validity");
        return { valid: validity.startsWith("0x00"), head };
      },
    };
  }

  /**
   * lcp's read of the payment, the act `payment` at the final mark, `finalized`, after the position `from` the settler
   * read before its submission, resuming from `search`, the search position an earlier answer returned, or else from
   * the one `from` holds. A request whose payment the form's checks refuse, or that lcp's `reference` or `bound` refuses, is read
   * as nothing: `unreadable`, `unparseable`. One whose metadata cannot be loaded is `unreadable`, `transport`.
   */
  async function status(r: FacilitatorRequest, deadline: number, from?: PolkadotPosition, search?: unknown): Promise<PolkadotStatus> {
    const l = await local(r);
    if (typeof l === "string") return { state: "unreadable", reason: "unparseable", foreign: [] };
    const c = await decode(l, deadline - performance.now());
    if (typeof c === "string") return { state: "unreadable", reason: "unparseable", foreign: [] };
    if ("spent" in c) return { state: "unreadable", reason: "transport", foreign: [] };
    return read(c, r, deadline, from, search);
  }

  async function read(c: Checked, r: FacilitatorRequest, deadline: number, from?: PolkadotPosition, search?: unknown): Promise<PolkadotStatus> {
    const ref = await exactPolkadotRemark.reference(r.paymentPayload as never, r.paymentRequirements as never);
    const h = await exactPolkadotRemark.bound(r.paymentPayload as never);
    if (isRefusal(ref) || isRefusal(h)) return { state: "unreadable", reason: "unparseable", foreign: [] };
    const resume = search ?? from?.search;
    return exactPolkadotRemark.status({ ...ref, h }, reader(c, deadline), {
      act: "payment",
      finality: "finalized",
      ...(from === undefined ? {} : { after: from.after }),
      ...(resume === undefined ? {} : { search: resume as never }),
    });
  }

  /**
   * Reads the payment by lcp's read every second until `deadline`, from the search position `from`, answering with the
   * first final answer: success once lcp's read settles the extrinsic presented at the finalized head, naming its
   * timepoint, and `invalid_transaction_state` naming the transaction once it answers `failed`. Each live answer's
   * search position is where the next read resumes. Once `deadline` has passed, nothing is read: the answer is pending
   * with the extrinsic's hash. Submits nothing.
   */
  async function watch(c: Checked, r: FacilitatorRequest, from: PolkadotPosition, deadline: number): Promise<SettleAnswer> {
    let search = from.search;
    for (;;) {
      if (deadline - performance.now() <= 0) return pending(c.id, c.network);
      const st = await read(c, r, deadline, from, search);
      if (st.state === "settled" && st.presented === "yes") {
        return { success: true, transaction: st.transaction, network: c.network, payer: c.payer };
      }
      if (st.state === "failed") {
        log({ event: "settlement-failed", ...about(c), why: st.reason, ...(st.transaction === undefined ? {} : { at: st.transaction }) });
        return failed("invalid_transaction_state", st.transaction ?? c.id, c.network);
      }
      if (st.state === "pending" && st.search !== undefined) search = st.search;
      if (performance.now() + POLL_MS > deadline) return pending(c.id, c.network);
      await sleep(POLL_MS);
    }
  }

  /**
   * Submits, then reads the payment until `deadline`. A refusal that says the node has already seen the extrinsic or
   * its nonce is a consumed payment: `invalid_transaction_state` with the extrinsic's hash. Any other refusal, or a
   * request that cannot have reached the node, gives `unexpected_settle_error` with no transaction: nothing was
   * submitted, the nonce is not consumed, and the answer is not final. So does a submission `deadline` leaves no time
   * for: it is not sent, and its entry is `settle-deadline-passed`.
   */
  async function submit(c: Checked, r: FacilitatorRequest, from: PolkadotPosition, deadline: number): Promise<SettleAnswer> {
    const url = byNetwork.get(c.network)!.rpc;
    try {
      await rpc(url, "author_submitExtrinsic", [c.hex], deadline - performance.now());
    } catch (e) {
      if (isSpent(e)) return unexpectedSettle(log, deadlinePassed(c, "author_submitExtrinsic"));
      const entry = { event: "node-call-failed", ...about(c), call: "author_submitExtrinsic" };
      const notSubmitted = e instanceof RpcError ? !seenBefore(e) : e instanceof NodeError && !e.sent;
      if (notSubmitted) return unexpectedSettle(log, entry, e);
      log(entry, e);
      return e instanceof RpcError ? failed("invalid_transaction_state", c.id, c.network) : pending(c.id, c.network);
    }
    return watch(c, r, from, deadline);
  }

  /**
   * Answers within `settleWaitMs`, less a reserve in which the settler stores the answer: a second, or a quarter of a
   * shorter wait. The deadline is checked before each node read: the decode, the finalized head read and the
   * validation. A deadline spent there sends no node call, and gives `unexpected_settle_error`; so does a call inside
   * one of them that the deadline leaves no time for, which is not sent, with its entry naming the call. A refusal the
   * client's own bytes give comes first, so the decode's refusals, which need the metadata, are given when the deadline
   * leaves time for it. The read starts after the finalized head read before validation (never before the era's birth):
   * validation at the best block shows the extrinsic absent from that block's ancestry, and the finalized head is in
   * every later best chain; its position keeps the head the validation answered valid at, which proves the era's last
   * block.
   */
  async function settle(r: FacilitatorRequest): Promise<SettleAnswer> {
    const deadline = performance.now() + settleWaitMs;
    const left = () => deadline - performance.now();
    const network = r.paymentRequirements.network;
    const l = await local(r);
    if (typeof l === "string") return failed(l, "", network);
    const hashed = { network: l.node.network, id: l.id };
    if (left() <= 0) return unexpectedSettle(log, deadlinePassed(hashed, "node reads"));
    const c = await decode(l, left());
    if (typeof c === "string") return failed(settleReason(c), "", network);
    if ("spent" in c) return unexpectedSettle(log, deadlinePassed(hashed, c.spent));
    if (left() <= 0) return unexpectedSettle(log, deadlinePassed(c, "finalized head"));
    const finalized = await finalizedHeight(c, l.node.rpc, deadline);
    if (typeof finalized === "object") return unexpectedSettle(log, deadlinePassed(c, finalized.spent));
    if (left() <= 0) return unexpectedSettle(log, deadlinePassed(c, "validation"));
    const v = await validate(c, left());
    if (typeof v === "string") return failed(settleReason(v), "", network);
    if ("spent" in v) return unexpectedSettle(log, deadlinePassed(c, v.spent));
    const waitUntil = deadline - Math.min(1_000, settleWaitMs / 4);
    if (waitUntil - performance.now() <= 0) return unexpectedSettle(log, deadlinePassed(c, "author_submitExtrinsic"));
    return submit(c, r, startAt(c, finalized, v.best), waitUntil);
  }

  /**
   * Where the read of an extrinsic validated at the best block `best` searches from: after the finalized head read
   * before that validation (never before the era's birth), keeping `best` as the head the chain answered it valid at.
   */
  function startAt(c: Checked, finalized: number | undefined, best: number): PolkadotPosition {
    const birth = c.era.birth(best);
    const since = Math.min(finalized === undefined ? birth : Math.max(birth, finalized + 1), lastBlock(c, best));
    return { after: BigInt(since) - 1n, search: { next: BigInt(since), hits: [], validated: BigInt(best) } };
  }

  /**
   * Where the settler's read of the payment `r` searches from, read before anything is submitted as `/settle` reads it:
   * the finalized head, then the validation at the best block. Undefined for a payment the form's checks refuse, where
   * a read fails, and where the chain does not answer the extrinsic valid.
   */
  async function position(r: FacilitatorRequest, deadline: number): Promise<PolkadotPosition | undefined> {
    const l = await local(r);
    if (typeof l === "string") return undefined;
    const c = await decode(l, deadline - performance.now());
    if (typeof c === "string" || "spent" in c) return undefined;
    const finalized = await finalizedHeight(c, l.node.rpc, deadline);
    if (typeof finalized === "object") return undefined;
    const v = await validate(c, deadline - performance.now());
    if (typeof v === "string" || "spent" in v) return undefined;
    return startAt(c, finalized, v.best);
  }

  async function close(): Promise<void> {
    const all = [...apis];
    apis.clear();
    // A load that failed has gone to the operator log from `decode` or `apiFor`; a failed disconnect goes there here.
    await Promise.all(
      all.map(([network, p]) =>
        p.then(
          (api) => api.disconnect().catch((e: unknown) => log({ event: "node-call-failed", network, call: "disconnect" }, e)),
          () => undefined,
        ),
      ),
    );
  }

  return { verify, settle, local, status, position, close, networks: nodes.map((n) => n.network as string) };
}
