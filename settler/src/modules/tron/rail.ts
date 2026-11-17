/**
 * Rule 5 of `x402/exact/tron/lcp-trc20-memo` against one network's FullNode and Solidity node: `/verify` checks the
 * signed transaction against the requirements, the owner's permission, its reference block and the ids the node already
 * holds, and simulates it; `/settle` repeats that, broadcasts, and reads the payment by lcp's read until it is final.
 * Which payments were already settled is the settler's record, not the rail's: the rail keeps no row.
 */
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { pairingOf } from "@integraledger/lcp";
import { isRefusal } from "@integraledger/lcp/core";
import { ReaderError } from "@integraledger/lcp/evm";
import {
  decodeTronTx,
  exactTronMemo,
  tronAddress,
  tronCarrier,
  type TronBlock,
  type TronCursor,
  type TronInfo,
  type TronLevel,
  type TronNetwork,
  type TronNow,
  type TronRaw,
  type TronReader,
  type TronStatus,
} from "@integraledger/lcp/tron";
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
import { isSpent, NodeError, postJson, sleep, type Spent } from "../../http.js";
import { settleReason, unexpectedSettle, unexpectedVerify } from "../../unexpected.js";
import { base58check } from "./base58check.js";

export interface TronNode {
  network: `tron:${number}`;
  fullNode: string;
  solidityNode: string;
}

const POLL_MS = 1_000;

/**
 * Where the settler's read of a payment starts its search for H: the last solidified block before the broadcast, by
 * its number and `blockID`, which lcp's read takes as its search position.
 */
export type TronPosition = TronCursor;

/** A transaction that passed every check that does not depend on time or chain state. */
interface Checked {
  network: string;
  hex: string;
  raw: TronRaw;
  txid: string;
  payer: string;
  /** The addresses (0x41 ‖ 20 bytes, hex) whose keys made the signatures, in the order signed, each once. */
  signers: string[];
  maxTimeoutSeconds: number;
}

function hexOf(b: Uint8Array): string {
  return Buffer.from(b).toString("hex");
}

/** A permission's threshold or a key's weight: java-tron prints an int64 as a JSON number, read as a safe one ≥ 0. */
function int64(v: unknown): bigint | undefined {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? BigInt(v) : undefined;
}

/**
 * Why the FullNode did not accept a broadcast: java-tron's `code` and `message`, or a `malformed` NodeError for an
 * answer that has no `code`.
 */
function refusalOf(sent: unknown): Error {
  if (!isObject(sent) || typeof sent["code"] !== "string") {
    return new NodeError("malformed", true, "/wallet/broadcasthex: code");
  }
  return new Error(`${sent["code"]}: ${typeof sent["message"] === "string" ? sent["message"] : ""}`);
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** `transfer(payTo, amount)` call data: the selector, payTo's 20 bytes as a word, amount as a 32-byte word. */
function transferCall(payTo: Uint8Array, amount: bigint): Uint8Array {
  const out = new Uint8Array(68);
  out.set([0xa9, 0x05, 0x9c, 0xbb], 0);
  out.set(payTo.subarray(1), 16);
  let v = amount;
  for (let i = 67; i >= 36; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

/** The Tron address (0x41 ‖ 20 bytes) whose key made the 65-byte signature over the transaction id. */
function signerOf(signature: Uint8Array, txid: Uint8Array): Uint8Array | undefined {
  const v = signature[64]!;
  const bit = v >= 27 ? v - 27 : v;
  if (bit !== 0 && bit !== 1) return undefined;
  try {
    const point = secp256k1.Signature.fromBytes(signature.subarray(0, 64), "compact")
      .addRecoveryBit(bit)
      .recoverPublicKey(txid);
    const key = point.toBytes(false);
    const out = new Uint8Array(21);
    out[0] = 0x41;
    out.set(keccak_256(key.subarray(1)).subarray(12), 1);
    return out;
  } catch {
    // The payer's own signature bytes do not recover a key: refused `invalid_payload` to the client that sent them.
    return undefined;
  }
}

/** A `getnowblock` answer: its number, `blockID` and time in milliseconds. */
function nowOf(o: unknown): TronNow {
  const id = isObject(o) ? o["blockID"] : undefined;
  const header = isObject(o) ? o["block_header"] : undefined;
  const raw = isObject(header) ? header["raw_data"] : undefined;
  const number = isObject(raw) ? raw["number"] : undefined;
  const timestamp = isObject(raw) ? raw["timestamp"] : undefined;
  if (typeof id !== "string" || !/^[0-9a-f]{64}$/.test(id)) throw new NodeError("malformed", true, "getnowblock blockID");
  if (!Number.isSafeInteger(number) || !Number.isSafeInteger(timestamp)) {
    throw new NodeError("malformed", true, "getnowblock fields");
  }
  return { number: BigInt(number as number), blockId: `0x${id}`, timestamp: BigInt(timestamp as number) };
}

/**
 * A block as `getblockbylimitnext` and `getblockbynum` print it with `visible` false: its `blockID`, its header's
 * `raw_data` `number` and `parentHash`, and each transaction's `raw_data_hex`; a block with no transactions has no
 * `transactions` member (java-tron `framework/src/main/java/org/tron/core/services/http/Util.java`,
 * `printBlockToJSON`). Throws for any other shape, which lcp's read takes as a read that failed.
 */
function blockOf(o: unknown): TronBlock {
  const id = isObject(o) ? o["blockID"] : undefined;
  const header = isObject(o) ? o["block_header"] : undefined;
  const raw = isObject(header) ? header["raw_data"] : undefined;
  const number = isObject(raw) ? raw["number"] : undefined;
  const parent = isObject(raw) ? raw["parentHash"] : undefined;
  const txs = isObject(o) ? (o["transactions"] ?? []) : undefined;
  if (typeof id !== "string" || !/^[0-9a-f]{64}$/.test(id) || typeof parent !== "string" || !/^[0-9a-f]{64}$/.test(parent)) {
    throw new NodeError("malformed", true, "block blockID, parentHash");
  }
  if (!Number.isSafeInteger(number) || !Array.isArray(txs)) throw new NodeError("malformed", true, "block number, transactions");
  const transactions = (txs as unknown[]).map((t) => {
    const hex = isObject(t) ? t["raw_data_hex"] : undefined;
    if (typeof hex !== "string") throw new NodeError("malformed", true, "block transactions[].raw_data_hex");
    return hex;
  });
  return { blockId: `0x${id}`, number: BigInt(number as number), parentHash: `0x${parent}`, transactions };
}

/** The x402 answer to `/settle` for lcp's read of the payment, where it is final for the transaction; else undefined. */
function finalAnswer(st: TronStatus, c: Checked): SettleAnswer | undefined {
  // Success is given only for the transaction presented, the one the rail broadcast: a transaction the payer signed
  // again over H is another payment, and the one presented can still land until its expiration.
  if (st.state === "settled") {
    return st.presented === "yes" ? { success: true, transaction: c.txid, network: c.network, payer: c.payer } : undefined;
  }
  if (st.state === "failed") return failed("invalid_transaction_state", st.transaction?.replace(/^0x/, "") ?? c.txid, c.network);
  return undefined;
}

export function createTron(nodes: readonly TronNode[], settleWaitMs: number, log: OperatorLog) {
  const byNetwork = new Map(nodes.map((n) => [n.network as string, n]));
  /** The fields that name a payment in an operator entry. */
  const about = (c: Checked) => ({ network: c.network, payer: c.payer, transaction: c.txid });
  /**
   * `p`, rejecting as it does, after its rejection is given to the operator log as a failed call to `call`. A call its
   * deadline left no time for was not sent, and writes no entry.
   */
  const reported = <T>(c: Checked, call: string, p: Promise<T>): Promise<T> =>
    p.catch((e: unknown) => {
      if (!isSpent(e)) log({ event: "node-call-failed", ...about(c), call }, e);
      throw e;
    });
  /**
   * `unexpected_verify_error` for an answer to `call` this facilitator cannot read: a `node-call-failed` entry whose
   * cause is a `malformed` NodeError naming the part it cannot read.
   */
  const malformed = (c: Checked, call: string, part: string) =>
    unexpectedVerify(
      log,
      { event: "node-call-failed", ...about(c), call },
      new NodeError("malformed", true, `${call}: ${part}`),
    );
  /** The entry for a settle whose deadline, `settleWaitMs` after its request, passed before `before`. */
  const deadlinePassed = (c: Checked, before: string) => ({
    event: "settle-deadline-passed",
    ...about(c),
    before,
    settleWaitMs,
  });
  /**
   * `unexpected_verify_error` for a `/verify` read its bound left no time for: the call `call` was not sent, and the
   * entry is a failed call's, its cause a `spent` NodeError.
   */
  const notSent = (c: Checked, call: string) =>
    unexpectedVerify(log, { event: "node-call-failed", ...about(c), call }, new NodeError("spent", false, call));

  /**
   * Every check of rule 5 that reads neither the clock nor the node. The signatures are one to five, as lcp decodes
   * them, each over the transaction id; each must recover a key, and no key may sign twice, which java-tron refuses
   * (`TransactionCapsule.checkWeight`). Whether the owner's permission accepts them is read from the node.
   */
  async function check(r: FacilitatorRequest): Promise<Checked | InvalidReason> {
    const req = r.paymentRequirements;
    if (!byNetwork.has(req.network)) return "invalid_network";
    if (pairingOf(req as never) !== "x402/exact/tron/lcp-trc20-memo") return "invalid_payment_requirements";
    const hex = r.paymentPayload.payload["transaction"];
    if (typeof hex !== "string") return "invalid_payload";
    const tx = decodeTronTx(hex);
    if (isRefusal(tx)) return "invalid_payload";
    const carried = await tronCarrier(tx);
    if (isRefusal(carried)) return "invalid_payload";
    const asset = await tronAddress(req.asset);
    const payTo = await tronAddress(req.payTo);
    if (isRefusal(asset) || isRefusal(payTo)) return "invalid_payment_requirements";
    if (!sameBytes(tx.raw.contractAddress, asset)) return "invalid_payload";
    if (!sameBytes(tx.raw.callData, transferCall(payTo, BigInt(req.amount)))) return "invalid_payload";
    const txid = carried.txid.slice(2);
    const signers: string[] = [];
    for (const signature of tx.signatures) {
      const signer = signerOf(signature, Buffer.from(txid, "hex"));
      if (signer === undefined) return "invalid_payload";
      if (signers.includes(hexOf(signer))) return "unsupported_permission";
      signers.push(hexOf(signer));
    }
    return {
      network: req.network,
      hex,
      raw: tx.raw,
      txid,
      payer: base58check(tx.raw.owner),
      signers,
      maxTimeoutSeconds: req.maxTimeoutSeconds,
    };
  }

  /**
   * A FullNode call's JSON answer, as `answer`, bounded by `deadline` (a `performance.now()` time) and by the node call
   * bound; a call that fails gives `unexpected_verify_error`. A call `deadline` leaves no time for is not sent: the
   * answer names it, with no entry, and the caller answers for it.
   */
  async function ask(
    c: Checked,
    path: string,
    body: unknown,
    deadline: number,
  ): Promise<{ answer: unknown } | InvalidReason | Spent> {
    const url = `${byNetwork.get(c.network)!.fullNode}${path}`;
    try {
      return { answer: await postJson(url, body, deadline - performance.now()) };
    } catch (e) {
      if (isSpent(e)) return { spent: path };
      return unexpectedVerify(log, { event: "node-call-failed", ...about(c), call: path }, e);
    }
  }

  /**
   * The owner's permission accepts the signatures: every key that signed is one of the permission's keys, and the
   * weights the permission gives those keys add up to at least its threshold, as java-tron weighs them
   * (`TransactionCapsule.checkWeight`). An account the node does not hold, or one with no owner permission set, has
   * java-tron's default owner permission: the address's own key, weight 1, threshold 1.
   */
  async function permitted(c: Checked, deadline: number): Promise<InvalidReason | Spent | null> {
    const call = "/wallet/getaccount";
    const read = await ask(c, call, { address: hexOf(c.raw.owner) }, deadline);
    if (typeof read === "string" || "spent" in read) return read;
    const account = read.answer;
    if (!isObject(account)) return malformed(c, call, "the account");
    const permission = account["owner_permission"] ?? {
      threshold: 1,
      keys: [{ address: hexOf(c.raw.owner), weight: 1 }],
    };
    if (!isObject(permission) || !Array.isArray(permission["keys"])) return malformed(c, call, "owner_permission.keys");
    const threshold = int64(permission["threshold"]);
    if (threshold === undefined) return malformed(c, call, "owner_permission.threshold");
    const weights = new Map<string, bigint>();
    for (const key of permission["keys"] as unknown[]) {
      if (!isObject(key) || typeof key["address"] !== "string") {
        return malformed(c, call, "owner_permission.keys[].address");
      }
      const w = int64(key["weight"]);
      if (w === undefined) return malformed(c, call, "owner_permission.keys[].weight");
      weights.set(key["address"].toLowerCase(), w);
    }
    let weight = 0n;
    for (const signer of c.signers) {
      const w = weights.get(signer);
      if (w === undefined) return "unsupported_permission";
      weight += w;
    }
    return weight >= threshold ? null : "unsupported_permission";
  }

  /**
   * TaPoS as the node checks it: `ref_block_bytes` are bytes 6–7 of a block number, and `ref_block_hash` must equal
   * bytes 8–15 of the id of the latest block at or below the FullNode's head whose number ends in those two bytes.
   */
  async function tapos(c: Checked, deadline: number): Promise<InvalidReason | Spent | null> {
    const refBytes = c.raw.refBlockBytes;
    const refHash = c.raw.refBlockHash;
    if (refBytes.length !== 2 || refHash.length !== 8) return "invalid_transaction";
    const now = await ask(c, "/wallet/getnowblock", {}, deadline);
    if (typeof now === "string" || "spent" in now) return now;
    const header = isObject(now.answer) ? now.answer["block_header"] : undefined;
    const raw = isObject(header) ? header["raw_data"] : undefined;
    const head = isObject(raw) ? raw["number"] : undefined;
    if (typeof head !== "number" || !Number.isSafeInteger(head) || head < 0) {
      return malformed(c, "/wallet/getnowblock", "block_header.raw_data.number");
    }
    const low = (refBytes[0]! << 8) | refBytes[1]!;
    const number = head - ((head % 65_536) - low + 65_536) % 65_536;
    if (number < 0) return "invalid_transaction";
    const read = await ask(c, "/wallet/getblock", { id_or_num: String(number), detail: false }, deadline);
    if (typeof read === "string" || "spent" in read) return read;
    const block = read.answer;
    if (!isObject(block)) return malformed(c, "/wallet/getblock", "the block");
    if (Object.keys(block).length === 0) return "invalid_transaction";
    const id = block["blockID"];
    if (typeof id !== "string" || !/^[0-9a-f]{64}$/.test(id) || BigInt(`0x${id.slice(0, 16)}`) !== BigInt(number)) {
      return malformed(c, "/wallet/getblock", "blockID");
    }
    return id.slice(16, 32) === hexOf(refHash) ? null : "invalid_transaction";
  }

  /**
   * The FullNode does not hold the transaction id at `path`: `/wallet/gettransactionbyid` for its blocks, or
   * `/wallet/gettransactionfrompending` for its pending pool. Each answers `{}` for an id it does not hold.
   */
  async function unheld(c: Checked, path: string, deadline: number): Promise<InvalidReason | Spent | null> {
    const read = await ask(c, path, { value: c.txid }, deadline);
    if (typeof read === "string" || "spent" in read) return read;
    if (!isObject(read.answer)) return malformed(c, path, "the transaction");
    return Object.keys(read.answer).length === 0 ? null : "invalid_transaction_state";
  }

  /** The two id reads, made together: the FullNode's blocks, then its pending pool. */
  function idReads(c: Checked, deadline: number): Promise<[InvalidReason | Spent | null, InvalidReason | Spent | null]> {
    return Promise.all([
      unheld(c, "/wallet/gettransactionbyid", deadline),
      unheld(c, "/wallet/gettransactionfrompending", deadline),
    ]);
  }

  /** The node's simulation of `transfer(payTo, amount)` from the owner on the asset. */
  async function simulated(c: Checked, deadline: number): Promise<InvalidReason | Spent | null> {
    const call = "/wallet/triggerconstantcontract";
    const read = await ask(
      c,
      call,
      {
        owner_address: hexOf(c.raw.owner),
        contract_address: hexOf(c.raw.contractAddress),
        function_selector: "transfer(address,uint256)",
        parameter: hexOf(c.raw.callData.subarray(4)),
      },
      deadline,
    );
    if (typeof read === "string" || "spent" in read) return read;
    const sim = read.answer;
    if (!isObject(sim) || !isObject(sim["result"])) return malformed(c, call, "result");
    if (sim["result"]["result"] !== true) return "invalid_transaction";
    const ret = isObject(sim["transaction"]) ? sim["transaction"]["ret"] : undefined;
    if (Array.isArray(ret) && ret.some((x) => isObject(x) && x["ret"] === "FAILED")) return "invalid_transaction";
    return null;
  }

  /**
   * The checks made before any node call, in this order: the expiration window, then `deadline`. The first refusal is
   * the answer. A deadline spent here sends no node call.
   */
  function beforeReads(c: Checked, deadline: number): InvalidReason | null {
    const now = BigInt(Date.now());
    const expiration = c.raw.expiration;
    if (expiration <= now || expiration > now + BigInt(c.maxTimeoutSeconds) * 1000n) return "invalid_payload";
    if (deadline - performance.now() <= 0) return unexpectedVerify(log, deadlinePassed(c, "node reads"));
    return null;
  }

  /**
   * The node reads, made together: the owner's permission, TaPoS, the ids the node holds in its blocks and in its
   * pending pool (`ids`), and the simulation. The first refusal in that order is the answer. Each call is bounded by
   * the node call bound and by `deadline`, and one that `deadline` leaves no time for is not sent and is named in its
   * place in that order.
   */
  async function nodeReads(
    c: Checked,
    deadline: number,
    ids: Promise<[InvalidReason | Spent | null, InvalidReason | Spent | null]>,
  ): Promise<InvalidReason | Spent | null> {
    const [account, reference, [inBlocks, inPool], simulation] = await Promise.all([
      permitted(c, deadline),
      tapos(c, deadline),
      ids,
      simulated(c, deadline),
    ]);
    return [account, reference, inBlocks, inPool, simulation].find((r) => r !== null) ?? null;
  }

  /** Every check of `/verify`: the transaction, and the node reads. */
  async function verify(r: FacilitatorRequest): Promise<VerifyAnswer> {
    const c = await check(r);
    if (typeof c === "string") return invalid(c);
    const now = beforeReads(c, Infinity) ?? (await nodeReads(c, Infinity, idReads(c, Infinity)));
    if (now === null) return { isValid: true, payer: c.payer };
    return invalid(typeof now === "string" ? now : notSent(c, now.spent), c.payer);
  }

  /**
   * The reader lcp's Tron read takes, over the network's FullNode (`/wallet`) and Solidity node (`/walletsolidity`),
   * each call bounded by `deadline` and by the node call bound. A receipt lookup that finds nothing, and each block
   * read, names the latest block at its level on the node that answered, read from that node just before. A read that
   * fails is given to the operator log; one `deadline` leaves no time for is not sent, and writes no entry. The FullNode
   * keeps the block history, as this settler requires of it, so the reader declares it archival.
   */
  function statusReader(c: Checked, deadline: number): TronReader {
    const node = byNetwork.get(c.network)!;
    const left = () => deadline - performance.now();
    const api = (level: TronLevel) => (level === "solid" ? `${node.solidityNode}/walletsolidity` : `${node.fullNode}/wallet`);
    const path = (level: TronLevel, call: string) => `${level === "solid" ? "/walletsolidity" : "/wallet"}/${call}`;
    const now = (level: TronLevel) =>
      reported(c, path(level, "getnowblock"), postJson(`${api(level)}/getnowblock`, {}, left()).then(nowOf));
    /** The latest block's number at `level`, read from the node that answers the call after it, or null. */
    const headOf = (level: TronLevel) => now(level).then((b) => b.number, () => null);
    /** A block read whose answer is over the byte bound rejects as lcp's reader errors do, with `too-large`. */
    const read = (level: TronLevel, call: string, body: unknown) =>
      reported(c, path(level, call), postJson(`${api(level)}/${call}`, body, left())).catch((e: unknown) => {
        throw e instanceof NodeError && e.code === "too-large" ? new ReaderError("too-large", e.message) : e;
      });
    return {
      network: c.network as TronNetwork,
      archival: true,
      async info(txid, level) {
        const readTo = await now(level).then((b) => b.timestamp, () => null);
        const o = await reported(
          c,
          path(level, "gettransactioninfobyid"),
          postJson(`${api(level)}/gettransactioninfobyid`, { value: txid.replace(/^0x/, "") }, left()),
        );
        if (!isObject(o)) throw new NodeError("malformed", true, "gettransactioninfobyid");
        if (Object.keys(o).length === 0) return { notFound: true, timestamp: readTo };
        const blockNumber = o["blockNumber"];
        const result = isObject(o["receipt"]) ? o["receipt"]["result"] : undefined;
        if (!Number.isSafeInteger(blockNumber) || typeof result !== "string") {
          throw new NodeError("malformed", true, "gettransactioninfobyid fields");
        }
        const logs = (Array.isArray(o["log"]) ? o["log"] : []).filter(
          (l): l is TronInfo["logs"][number] =>
            isObject(l) && typeof l["address"] === "string" && Array.isArray(l["topics"]),
        );
        return { blockNumber: BigInt(blockNumber as number), result, logs };
      },
      transaction() {
        return Promise.reject(new NodeError("malformed", false, "not read by this settler"));
      },
      now,
      async blocks(start, end, level) {
        const head = await headOf(level);
        const o = await read(level, "getblockbylimitnext", { startNum: Number(start), endNum: Number(end) });
        if (!isObject(o)) throw new NodeError("malformed", true, "getblockbylimitnext");
        const blocks = o["block"] ?? [];
        if (!Array.isArray(blocks)) throw new NodeError("malformed", true, "getblockbylimitnext block");
        return { head, blocks: blocks.map(blockOf) };
      },
      async block(num, level) {
        const head = await headOf(level);
        const o = await read(level, "getblockbynum", { num: Number(num) });
        if (!isObject(o)) throw new NodeError("malformed", true, "getblockbynum");
        return { head, block: Object.keys(o).length === 0 ? null : blockOf(o) };
      },
    };
  }

  /**
   * lcp's read of the payment, the act `payment` at the final mark, `solidified`, its search for H starting after
   * `from` where it is given, or resuming from `search`. A request whose payment the form's checks refuse, or that lcp's
   * `reference` refuses, is read as nothing: `unreadable`, `unparseable`, as lcp answers a reference that is not one.
   */
  async function status(r: FacilitatorRequest, deadline: number, from?: TronPosition, search?: unknown): Promise<TronStatus> {
    const c = await check(r);
    if (typeof c === "string") return { state: "unreadable", reason: "unparseable", foreign: [] };
    return read(c, r, deadline, from, search);
  }

  async function read(c: Checked, r: FacilitatorRequest, deadline: number, from?: TronPosition, search?: unknown): Promise<TronStatus> {
    const ref = await exactTronMemo.reference(r.paymentPayload as never, r.paymentRequirements as never);
    if (isRefusal(ref)) return { state: "unreadable", reason: "unparseable", foreign: [] };
    const resume = search ?? from;
    return exactTronMemo.status(ref, statusReader(c, deadline), {
      act: "payment",
      finality: "solidified",
      ...(resume === undefined ? {} : { search: resume as never }),
    });
  }

  /**
   * Reads the payment by lcp's read every second until `deadline`, answering with the first final answer: success for
   * the transaction broadcast once lcp's read settles it at the solidified level, and `invalid_transaction_state`
   * naming the transaction once it answers `failed`. Each live answer's search position is where the next read
   * resumes. Once `deadline` has passed, nothing is read: the answer is pending with the id. Broadcasts nothing.
   */
  async function watch(c: Checked, r: FacilitatorRequest, deadline: number, from: TronPosition | undefined): Promise<SettleAnswer> {
    let search: TronCursor | undefined;
    for (;;) {
      if (deadline - performance.now() <= 0) return pending(c.txid, c.network);
      const st = await read(c, r, deadline, from, search);
      const final = finalAnswer(st, c);
      if (final !== undefined) {
        if (!final.success) log({ event: "settlement-failed", ...about(c), why: st.state === "failed" ? st.reason : undefined });
        return final;
      }
      if (st.state === "pending" && st.search !== undefined) search = st.search;
      if (performance.now() + POLL_MS > deadline) return pending(c.txid, c.network);
      await sleep(POLL_MS);
    }
  }

  /** The answer to a `/settle` of a payment the node already holds: the id is consumed, and the answer names it. */
  function consumed(c: Checked): SettleAnswer {
    return failed("invalid_transaction_state", c.txid, c.network);
  }

  /**
   * The last solidified block, read before the broadcast, where the read's search for H starts; undefined when the
   * read fails, the read then searching nothing and holding the payment's absence to the lookups by id.
   */
  async function solidified(c: Checked, deadline: number): Promise<TronPosition | undefined> {
    const node = byNetwork.get(c.network)!;
    try {
      const b = await reported(
        c,
        "/walletsolidity/getnowblock",
        postJson(`${node.solidityNode}/walletsolidity/getnowblock`, {}, deadline - performance.now()).then(nowOf),
      );
      return { number: b.number, blockId: b.blockId };
    } catch {
      return undefined;
    }
  }

  /**
   * Broadcasts, then reads the payment until `deadline`. A `DUP_TRANSACTION_ERROR` says the node already holds the
   * transaction id, so the payment is consumed. Any other refusal, or a request that cannot have reached the node, gives
   * `unexpected_settle_error` with no transaction: nothing was broadcast, the id is not consumed, and the answer is not
   * final. So does a broadcast `deadline` leaves no time for: it is not sent, and its entry is `settle-deadline-passed`.
   */
  async function submit(c: Checked, r: FacilitatorRequest, deadline: number): Promise<SettleAnswer> {
    const node = byNetwork.get(c.network)!;
    const from = await solidified(c, deadline);
    let sent: unknown;
    try {
      sent = await postJson(`${node.fullNode}/wallet/broadcasthex`, { transaction: c.hex }, deadline - performance.now());
    } catch (e) {
      if (isSpent(e)) return unexpectedSettle(log, deadlinePassed(c, "/wallet/broadcasthex"));
      const entry = { event: "node-call-failed", ...about(c), call: "/wallet/broadcasthex" };
      if (e instanceof NodeError && !e.sent) return unexpectedSettle(log, entry, e);
      log(entry, e);
      return pending(c.txid, c.network);
    }
    if (isObject(sent) && sent["code"] === "DUP_TRANSACTION_ERROR") return consumed(c);
    if (!isObject(sent) || sent["result"] !== true) {
      const entry = { event: "node-call-failed", ...about(c), call: "/wallet/broadcasthex" };
      return unexpectedSettle(log, entry, refusalOf(sent));
    }
    return watch(c, r, deadline, from);
  }

  /**
   * Answers within `settleWaitMs`, less a reserve in which the settler stores the answer: a second, or a quarter of a
   * shorter wait. The expiration window and then the deadline are checked before any node call: a deadline spent there
   * sends none, and gives `unexpected_settle_error`, or `invalid_payload` for an expiration outside the window. A node
   * read the deadline leaves no time for once the reads have started is not sent either, and in its place among the
   * refusals gives `unexpected_settle_error`, with one entry naming the call; for an expiration outside the window, an
   * id read not sent finds nothing, and the answer is `invalid_payload`, with no entry. The node's id reads answer
   * first: an id the node holds, in a block or its pending pool, is consumed, whatever else the checks refuse, the
   * expiration window among them, and a node that does not answer them gives `unexpected_settle_error`.
   */
  async function settle(r: FacilitatorRequest): Promise<SettleAnswer> {
    const deadline = performance.now() + settleWaitMs;
    const left = () => deadline - performance.now();
    const network = r.paymentRequirements.network;
    const c = await check(r);
    if (typeof c === "string") return failed(settleReason(c), "", network);
    // An expiration outside the window waits for the id reads while the deadline leaves time for them.
    const before = beforeReads(c, deadline);
    if (before !== null && (before !== "invalid_payload" || left() <= 0)) {
      return failed(settleReason(before), "", network);
    }
    const ids = idReads(c, deadline);
    const now = before ?? (await nodeReads(c, deadline, ids));
    const held = await ids;
    if (held.includes("invalid_transaction_state")) return consumed(c);
    if (now !== null) {
      // An expired transaction's id reads look only for a held id: one the deadline leaves no time for leaves the
      // expiration's refusal, as the deadline check before the reads gives it.
      const refused = held.find((r) => r !== null && (before === null || typeof r === "string")) ?? now;
      if (typeof refused === "object") return unexpectedSettle(log, deadlinePassed(c, refused.spent));
      return failed(settleReason(refused), "", network);
    }
    const waitUntil = deadline - Math.min(1_000, settleWaitMs / 4);
    if (waitUntil - performance.now() <= 0) return unexpectedSettle(log, deadlinePassed(c, "/wallet/broadcasthex"));
    return submit(c, r, waitUntil);
  }

  /**
   * Where the settler's read of the payment `r` searches for H from: the last solidified block, read before anything
   * is broadcast; undefined for a payment the form's checks refuse, or where the read fails.
   */
  async function position(r: FacilitatorRequest, deadline: number): Promise<TronPosition | undefined> {
    const c = await check(r);
    return typeof c === "string" ? undefined : solidified(c, deadline);
  }

  return { verify, settle, check, status, position, networks: nodes.map((n) => n.network as string) };
}
