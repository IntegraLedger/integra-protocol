/**
 * The Aptos module for `x402/exact/aptos` on each configured network: `@x402/aptos` 2.31.0's facilitator class,
 * registered unchanged. Where it sponsors, the key is the seller's fee payer (`extra.key` `fee-payer`), which signs
 * the payer's transaction as its fee payer: it reaches the module as the `FacilitatorAptosSigner` the class takes, and
 * its address is in `signers` and the class's `extra.feePayer`. Where it does not sponsor, the payer pays its own gas,
 * the class submits what the payer signed, and the key signs nothing (`none`, no signer): the class pays the gas of any
 * payment whose option names one of the key's addresses as `extra.feePayer`, whatever it was built with, so the module
 * refuses such an option before the class is asked. lcp's checks name the instrument, the
 * sender and its sequence number; lcp's read goes through the seller's REST endpoint. The script form,
 * `x402/exact/aptos/lcp-script`, is not built here.
 */
import { isRefusal, type Refusal } from "@integraledger/lcp";
import { exactAptos, type AptosCommitted, type AptosNetwork, type AptosReader, type AptosRef } from "@integraledger/lcp/aptos";
import type { PaymentRequirements as LcpOption } from "@integraledger/lcp/x402";
import type { FacilitatorAptosSigner } from "@x402/aptos";
import { ExactAptosScheme } from "@x402/aptos/exact/facilitator";
import type { Network, SchemeNetworkFacilitator } from "@x402/core/types";
import { isObject } from "../../answers.js";
import { NODE_MAX_BYTES, NODE_TIMEOUT_MS, NodeError, site } from "../../http.js";
import {
  outcomeOf,
  type Charged,
  type FeeMeter,
  type Instrumented,
  type Module,
  type ModuleStarter,
  type Refused,
  type Registration,
  type X402Payment,
} from "../../module.js";

export interface AptosConfig {
  /** The network, exactly one. */
  readonly network: AptosNetwork;
  /** The seller's account, as `@x402/aptos`'s facilitator class takes it. */
  readonly signer: FacilitatorAptosSigner;
  /** Whether the module pays the payer's gas as its fee payer; default true, as the class's own default. */
  readonly sponsor?: boolean;
  /** The seller's REST endpoint (its base, without `/v1`), which lcp's read and the fee count use. */
  readonly node: string;
}

function reasonOf(r: Refusal): string {
  if (r.code === "x402/not-v2") return "invalid_x402_version";
  if (r.code.startsWith("x402/option") || r.code === "aptos/option-malformed") return "invalid_payment_requirements";
  return "invalid_payload";
}

async function checked(p: X402Payment): Promise<AptosRef | Refusal> {
  const bound = await exactAptos.bound(p.payload);
  if (isRefusal(bound)) return bound;
  // The requirements arrive as JSON, which lcp's option type names.
  return exactAptos.reference(p.payload, p.requirements as LcpOption);
}

/** One bounded GET of the REST endpoint: the status, the JSON answer and the headers. */
async function rest(url: string, deadline: number): Promise<{ status: number; json: unknown; headers: Headers }> {
  const ms = Math.min(NODE_TIMEOUT_MS, deadline - performance.now());
  if (ms <= 0) throw new NodeError("spent", false, site(url));
  let res: Response;
  try {
    res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(Math.ceil(ms)) });
  } catch (e) {
    throw new NodeError("transport", true, e instanceof Error ? e.message : String(e), { cause: e });
  }
  const text = await res.text();
  if (text.length > NODE_MAX_BYTES) throw new NodeError("too-large", true, site(url));
  if (res.status !== 404 && (res.status < 200 || res.status > 299)) throw new NodeError("http-status", true, `status ${res.status}`);
  try {
    return { status: res.status, json: JSON.parse(text), headers: res.headers };
  } catch (e) {
    throw new NodeError("malformed", true, "the answer is not JSON", { cause: e });
  }
}

function header(h: Headers, name: string): bigint {
  const v = h.get(name);
  if (v === null || !/^\d+$/.test(v)) throw new NodeError("malformed", true, `the ${name} header`);
  return BigInt(v);
}

/** lcp's reader over the REST endpoint at `base`, its calls ending by `deadline`. */
export function aptosReader(network: AptosNetwork, base: string, deadline: number): AptosReader {
  const root = `${base.replace(/\/+$/, "")}/v1`;
  return {
    network,
    async byHash(hash) {
      const a = await rest(`${root}/transactions/by_hash/${encodeURIComponent(hash)}`, deadline);
      if (a.status === 404) return null;
      if (isObject(a.json) && a.json["type"] === "pending_transaction") return { type: "pending_transaction" };
      return a.json as AptosCommitted;
    },
    async bySequence(sender, n) {
      const a = await rest(`${root}/accounts/${encodeURIComponent(sender)}/transactions?start=${n}&limit=1`, deadline);
      const first = a.status === 200 && Array.isArray(a.json) ? a.json[0] : undefined;
      if (isObject(first) && first["sequence_number"] === n.toString()) return first as unknown as AptosCommitted;
      return { notFound: true, timestampUsecs: header(a.headers, "x-aptos-ledger-timestampusec"), oldestVersion: header(a.headers, "x-aptos-ledger-oldest-version") };
    },
    async account(sender) {
      const a = await rest(`${root}/accounts/${encodeURIComponent(sender)}`, deadline);
      const seq = a.status === 200 && isObject(a.json) ? a.json["sequence_number"] : "0";
      if (typeof seq !== "string" || !/^\d+$/.test(seq)) throw new NodeError("malformed", true, "an account");
      return {
        sequenceNumber: BigInt(seq),
        timestampUsecs: header(a.headers, "x-aptos-ledger-timestampusec"),
        oldestVersion: header(a.headers, "x-aptos-ledger-oldest-version"),
      };
    },
    async ledger() {
      const a = await rest(root, deadline);
      const chainId = isObject(a.json) ? a.json["chain_id"] : undefined;
      const t = isObject(a.json) ? a.json["ledger_timestamp"] : undefined;
      if (typeof chainId !== "number" || typeof t !== "string" || !/^\d+$/.test(t)) throw new NodeError("malformed", true, "the ledger");
      return { chainId, timestampUsecs: BigInt(t) };
    },
  };
}

/**
 * What a transaction the key sponsored cost it, in octas: the gas used times its unit price once the node shows it
 * committed, else `bound`, the most its own fields let it pay.
 */
async function feeOf(c: AptosConfig, transaction: string, bound: bigint, deadline: number): Promise<Charged> {
  const t: unknown = await aptosReader(c.network, c.node, deadline).byHash(transaction as AptosRef["sender"]);
  const used = isObject(t) ? t["gas_used"] : undefined;
  const price = isObject(t) ? t["gas_unit_price"] : undefined;
  if (typeof used === "string" && /^\d+$/.test(used) && typeof price === "string" && /^\d+$/.test(price)) {
    return { fee: BigInt(used) * BigInt(price), included: true };
  }
  return { fee: bound, included: false };
}

/**
 * The fee payer's signer object as the class takes it, each transaction it sponsors given to the network's fee meter
 * once submitted and again once the class's wait for it ends, every other member unchanged: the class answers a
 * payment whose wait threw naming no transaction, though it was submitted. A submission that throws gives no hash, and
 * is not counted.
 */
function counted(c: AptosConfig, meter: FeeMeter): FacilitatorAptosSigner {
  const sponsored = new Map<string, bigint>();
  const count = (hash: string, bound: bigint) => meter.sent(hash, () => feeOf(c, hash, bound, performance.now() + NODE_TIMEOUT_MS));
  return new Proxy(c.signer, {
    get(inner, member) {
      const value: unknown = Reflect.get(inner, member);
      if (typeof value !== "function") return value;
      if (member === "signAndSubmitAsFeePayer") {
        return async (...args: Parameters<FacilitatorAptosSigner["signAndSubmitAsFeePayer"]>) => {
          const pending = (await value.apply(inner, args)) as Awaited<ReturnType<FacilitatorAptosSigner["signAndSubmitAsFeePayer"]>>;
          const raw = args[0].rawTransaction;
          const bound = BigInt(raw.max_gas_amount) * BigInt(raw.gas_unit_price);
          sponsored.set(pending.hash, bound);
          count(pending.hash, bound);
          return pending;
        };
      }
      if (member === "waitForTransaction") {
        return async (...args: Parameters<FacilitatorAptosSigner["waitForTransaction"]>) => {
          try {
            return await value.apply(inner, args);
          } finally {
            const bound = sponsored.get(args[0]);
            if (bound !== undefined) {
              sponsored.delete(args[0]);
              count(args[0], bound);
            }
          }
        };
      }
      return value.bind(inner);
    },
  });
}

/** The class, where the module does not sponsor stating no signer, its key signing nothing. */
function unsponsored(cls: SchemeNetworkFacilitator): SchemeNetworkFacilitator {
  return {
    scheme: cls.scheme,
    caipFamily: cls.caipFamily,
    getExtra: (n) => cls.getExtra(n),
    getSigners: () => [],
    verify: (payload, requirements, context) => cls.verify(payload, requirements, context),
    settle: (payload, requirements, context) => cls.settle(payload, requirements, context),
  };
}

/**
 * The module of `x402/exact/aptos` on the configured network. With `meter`, the network's fee meter, every transaction
 * the key sponsors is counted.
 */
export function aptosModule(c: AptosConfig, meter?: FeeMeter): Module {
  const network = c.network as Network;
  const sponsor = c.sponsor !== false;
  const cls = new ExactAptosScheme(meter === undefined ? c.signer : counted(c, meter), sponsor);
  return {
    // A zero amount is not established on Aptos, so the kind does not take zero.
    descriptor: { name: "aptos", key: sponsor ? "fee-payer" : "none", pairings: [exactAptos.id], acceptsZero: false },
    network,
    facilitator: sponsor ? cls : unsponsored(cls),
    record: {
      async instrument(p): Promise<Instrumented | Refused> {
        if (!sponsor && p.requirements.extra?.["feePayer"] !== undefined) return { refused: "invalid_payment_requirements" };
        const ref = await checked(p);
        if (isRefusal(ref)) return { refused: reasonOf(ref), message: ref.code };
        return {
          pairing: exactAptos.id,
          // The sequence number is single-use for the sender; the hash changes with the fee payer's signature.
          instrument: { by: "single-use", network, signer: ref.sender, value: ref.sequenceNumber },
          nonce: exactAptos.data.nonce,
          keep: { until: "lapse", at: Number(ref.expiresAt) * 1000 },
        };
      },
      async read(p, at) {
        const ref = await checked(p);
        if (isRefusal(ref)) return outcomeOf({ state: "unreadable", reason: "unparseable", foreign: [] });
        const search = at.search as bigint | undefined;
        const named: AptosRef = at.transaction === undefined ? ref : { ...ref, transaction: at.transaction as AptosRef["sender"] };
        return outcomeOf(
          await exactAptos.status(named, aptosReader(c.network, c.node, at.deadline), {
            act: "payment",
            finality: "committed",
            ...(search === undefined ? {} : { search }),
          }),
        );
      },
    },
    fees: {
      // The class's own rule: with extra.feePayer the module's key pays the gas; without it the payer does.
      paysFee: (p) => typeof p.requirements.extra?.["feePayer"] === "string",
      payerBroadcast: () => false,
      async charged(p, sent) {
        const ref = await checked(p);
        if (isRefusal(ref)) throw new TypeError(`a payment lcp refuses was sent: ${ref.code}`);
        return feeOf(c, sent.transaction, BigInt(ref.maxGasAmount ?? "0") * BigInt(ref.gasUnitPrice ?? "0"), sent.deadline);
      },
    },
  };
}

export function aptosRegistration(c: AptosConfig, meter?: FeeMeter): Registration {
  return { network: c.network as Network, module: aptosModule(c, meter), own: [] };
}

/** The module's start: one registration of `exact` per configured network, its fee meter counting what the key sponsors. */
export const starter: ModuleStarter<readonly AptosConfig[]> = {
  name: "aptos",
  async start(config, core) {
    return { registrations: config.map((c) => aptosRegistration(c, core.meter(c.network as Network))) };
  },
};
