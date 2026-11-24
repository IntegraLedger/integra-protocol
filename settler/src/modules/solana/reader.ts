/**
 * lcp's Solana reader over one Solana JSON-RPC endpoint: the calls `SvmReader` names, each a POST of one JSON-RPC
 * request bounded by the settler's node bounds and by the read's deadline, a `performance.now()` time. Every failure
 * rejects, an error answer of the node among them, so lcp reads it as `unreadable`.
 */
import type { SolanaNetwork, SvmCommitment, SvmInner, SvmLanded, SvmReader, SvmSignature, SvmTokenBalance } from "@integraledger/lcp/svm";
import { getBase58Encoder, getCompiledTransactionMessageDecoder, getTransactionDecoder } from "@solana/kit";
import { isObject } from "../../answers.js";
import { NodeError, postJson } from "../../http.js";

/** One JSON-RPC call: its `result`, or a rejection where the node answers an error or no result. */
export async function solanaRpc(url: string, method: string, params: unknown[], deadline: number): Promise<unknown> {
  const answer = await postJson(url, { jsonrpc: "2.0", id: 1, method, params }, deadline - performance.now());
  if (!isObject(answer)) throw new NodeError("malformed", true, `${method}: the answer is not an object`);
  if (answer["error"] !== undefined) throw new NodeError("malformed", true, `${method}: ${JSON.stringify(answer["error"])}`);
  if (!("result" in answer)) throw new NodeError("malformed", true, `${method}: no result`);
  return answer["result"];
}

function malformed(what: string): never {
  throw new NodeError("malformed", true, what);
}

function int(v: unknown, what: string): bigint {
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return BigInt(v);
  return malformed(`${what} is not a slot`);
}

const base58 = getBase58Encoder();

function keyBytes(v: unknown, what: string): Uint8Array {
  if (typeof v !== "string") return malformed(`${what} is not base58`);
  try {
    return new Uint8Array(base58.encode(v));
  } catch {
    return malformed(`${what} is not base58`);
  }
}

function base64Of(v: unknown, what: string): Uint8Array {
  if (!Array.isArray(v) || typeof v[0] !== "string" || v[1] !== "base64") return malformed(`${what} is not base64 data`);
  return new Uint8Array(Buffer.from(v[0], "base64"));
}

function balances(v: unknown): SvmTokenBalance[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v)) return malformed("token balances are not a list");
  return v.map((b) => {
    if (!isObject(b) || typeof b["accountIndex"] !== "number" || typeof b["mint"] !== "string") {
      return malformed("a token balance");
    }
    return {
      account: b["accountIndex"],
      mint: b["mint"],
      ...(typeof b["owner"] === "string" ? { owner: b["owner"] } : {}),
    };
  });
}

function inner(v: unknown): SvmInner[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) return malformed("inner instructions are not a list");
  const out: SvmInner[] = [];
  for (const group of v) {
    if (!isObject(group) || typeof group["index"] !== "number" || !Array.isArray(group["instructions"])) {
      return malformed("an inner instruction group");
    }
    for (const ix of group["instructions"]) {
      if (!isObject(ix) || typeof ix["programIdIndex"] !== "number" || !Array.isArray(ix["accounts"])) {
        return malformed("an inner instruction");
      }
      out.push({
        index: group["index"],
        program: ix["programIdIndex"],
        accounts: ix["accounts"].map((a) => (typeof a === "number" ? a : malformed("an inner instruction account"))),
        data: keyBytes(ix["data"], "an inner instruction's data"),
      });
    }
  }
  return out;
}

/** A landed transaction as `getTransaction` gives it with encoding `base64`. */
export function landedOf(result: unknown): SvmLanded {
  if (!isObject(result) || !isObject(result["meta"])) return malformed("a transaction without meta");
  const meta = result["meta"];
  const loaded = isObject(meta["loadedAddresses"]) ? meta["loadedAddresses"] : {};
  const keys = (v: unknown) => (Array.isArray(v) ? v.map((k) => keyBytes(k, "a loaded address")) : []);
  const pre = balances(meta["preTokenBalances"]);
  const post = balances(meta["postTokenBalances"]);
  return {
    wire: base64Of(result["transaction"], "the transaction"),
    err: meta["err"] ?? null,
    ...(result["slot"] === undefined ? {} : { slot: int(result["slot"], "the slot") }),
    loaded: { writable: keys(loaded["writable"]), readonly: keys(loaded["readonly"]) },
    inner: inner(meta["innerInstructions"]),
    ...(pre === undefined ? {} : { pre }),
    ...(post === undefined ? {} : { post }),
  };
}

/** lcp's reader for `network` over the JSON-RPC endpoint at `url`, its calls ending by `deadline`. */
export function svmReader(network: SolanaNetwork, url: string, deadline: number): SvmReader {
  const call = (method: string, params: unknown[]) => solanaRpc(url, method, params, deadline);
  const slot = async (commitment: SvmCommitment) => int(await call("getSlot", [{ commitment }]), "getSlot");
  return {
    network,
    slot,
    async transaction(signature, commitment) {
      const at = await slot(commitment);
      const result = await call("getTransaction", [
        signature,
        { encoding: "base64", commitment, maxSupportedTransactionVersion: 1 },
      ]);
      return result === null ? { notFound: true, slot: at } : landedOf(result);
    },
    async signatures(address, page) {
      // lcp gives `minContextSlot` as a bigint, which JSON cannot carry: the node takes it as a JSON number, within the
      // range this reader reads a slot in.
      const { minContextSlot, ...rest } = page;
      if (minContextSlot !== undefined && (minContextSlot < 0n || minContextSlot > BigInt(Number.MAX_SAFE_INTEGER))) {
        return malformed("getSignaturesForAddress's minContextSlot is not a slot");
      }
      const options = minContextSlot === undefined ? rest : { ...rest, minContextSlot: Number(minContextSlot) };
      const result = await call("getSignaturesForAddress", [address, options]);
      if (!Array.isArray(result)) return malformed("getSignaturesForAddress is not a list");
      return result.map((s): SvmSignature => {
        if (!isObject(s) || typeof s["signature"] !== "string") return malformed("a signature entry");
        const memo = s["memo"];
        return { signature: s["signature"], slot: int(s["slot"], "a signature's slot"), memo: typeof memo === "string" ? memo : null };
      });
    },
    async blockhashValid(blockhash, commitment) {
      const result = await call("isBlockhashValid", [blockhash, { commitment }]);
      if (!isObject(result) || !isObject(result["context"]) || typeof result["value"] !== "boolean") {
        return malformed("isBlockhashValid");
      }
      return { valid: result["value"], slot: int(result["context"]["slot"], "the context slot") };
    },
    async firstAvailableBlock() {
      return int(await call("getFirstAvailableBlock", []), "getFirstAvailableBlock");
    },
    async account(address, commitment) {
      const result = await call("getAccountInfo", [address, { encoding: "base64", commitment }]);
      if (!isObject(result) || !isObject(result["context"])) return malformed("getAccountInfo");
      const at = int(result["context"]["slot"], "the context slot");
      const value = result["value"];
      if (value === null) return { slot: at, value: null };
      if (!isObject(value) || typeof value["owner"] !== "string") return malformed("an account");
      return { slot: at, value: { owner: value["owner"], data: base64Of(value["data"], "the account's data") } };
    },
  };
}

/** The Compute Budget program, whose instructions set a transaction's compute-unit limit (2) and price (3). */
const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";
/** Solana's base fee per signature, in lamports. */
const LAMPORTS_PER_SIGNATURE = 5_000n;
/** The most compute units one transaction may request, the bound where none is set. */
const MAX_COMPUTE_UNITS = 1_400_000n;

/**
 * The most a transaction's own fields let it pay, in lamports: its base fee, one per signature its message requires,
 * and its priority fee, its compute-unit limit times its price in micro-lamports, rounded up.
 */
export function feeBound(wireBase64: string): bigint {
  const tx = getTransactionDecoder().decode(Buffer.from(wireBase64, "base64"));
  const message = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
  const base = BigInt(message.header.numSignerAccounts) * LAMPORTS_PER_SIGNATURE;
  if (!("instructions" in message)) {
    // A version-1 message states its priority fee in lamports among its configuration values, the first when its mask
    // sets both bits of it (TRANSACTION_CONFIG_PRIORITY_FEE_LAMPORTS_BIT_MASK, 3).
    const first = (message.configMask & 3) === 3 ? message.configValues[0] : undefined;
    return base + (first?.kind === "u64" ? first.value : 0n);
  }
  let limit = MAX_COMPUTE_UNITS;
  let price = 0n;
  for (const ix of message.instructions) {
    if (message.staticAccounts[ix.programAddressIndex] !== COMPUTE_BUDGET || ix.data === undefined) continue;
    const data = Buffer.from(ix.data);
    if (data[0] === 2 && data.length >= 5) limit = BigInt(data.readUInt32LE(1));
    if (data[0] === 3 && data.length >= 9) price = data.readBigUInt64LE(1);
  }
  return base + (limit * price + 999_999n) / 1_000_000n;
}

/**
 * The fee a transaction a class sent paid, as the node shows it once included (`meta.fee`); until then the bound of the
 * transaction the payer gave, where the payment carries one; a transaction neither shown nor given rejects.
 */
export async function chargedOn(
  url: string,
  signature: string,
  given: string | undefined,
  deadline: number,
): Promise<{ fee: bigint; included: boolean }> {
  const result = await solanaRpc(url, "getTransaction", [signature, { encoding: "base64", commitment: "confirmed", maxSupportedTransactionVersion: 1 }], deadline);
  if (result !== null) {
    const meta = isObject(result) ? result["meta"] : undefined;
    return { fee: int(isObject(meta) ? meta["fee"] : undefined, "the fee"), included: true };
  }
  if (given === undefined) throw new NodeError("malformed", true, `the node holds no transaction ${signature}`);
  return { fee: feeBound(given), included: false };
}
