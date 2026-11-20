/**
 * The Algorand module for `x402/exact/algorand` on one network: `@x402/avm` 2.31.0's facilitator class, registered
 * unchanged behind lcp's checks of the pairing. lcp's `bound` refuses, before anything moves, an entry a logic
 * signature authorises and one that names `asnd`, neither being the payer's signed act. The key is the seller's fee
 * payer, which pools the group's fee by its own zero-amount payment in the same atomic group (`extra.key` `fee-payer`);
 * it reaches the module as the `FacilitatorAvmSigner` the class takes, and its address is in `signers` and the class's
 * `extra.feePayer`. A payer the class cannot settle, a rekeyed account signing with its one key (`sig` with `sgnr`) or
 * a Falcon key (`pqsig`), is claimed by the payment entry's own members and settled by the module's own path
 * (`./own.ts`). The read searches by the payment's own id and its validity, so the module gives the core no position.
 */
import { isRefusal, type Refusal } from "@integraledger/lcp";
import { exactAvm, type AlgorandNetwork, type AvmIndexed, type AvmPage, type AvmReader, type AvmRef } from "@integraledger/lcp/avm";
import type { PaymentRequirements as LcpOption } from "@integraledger/lcp/x402";
import type { FacilitatorAvmSigner } from "@x402/avm";
import { ExactAvmScheme } from "@x402/avm/exact/facilitator";
import type { Network, PaymentPayload, PaymentRequirements, SchemeNetworkFacilitator } from "@x402/core/types";
import { isObject } from "../../answers.js";
import { NODE_MAX_BYTES, NODE_TIMEOUT_MS, NodeError, site } from "../../http.js";
import {
  outcomeOf,
  type FeeNeeds,
  type Handoff,
  type Instrumented,
  type Module,
  type ModuleStarter,
  type Refused,
  type Registration,
} from "../../module.js";
import { feePayerFee, keyEntries, ownAuthority, ownFacilitator } from "./own.js";

export interface AlgorandConfig {
  /** The network, exactly one. */
  readonly network: AlgorandNetwork;
  /** The seller's fee-payer key, as `@x402/avm`'s facilitator class takes it, with its algod node. */
  readonly signer: FacilitatorAvmSigner;
  /** The seller's Indexer, following the network's consensus, which lcp's read uses. */
  readonly indexer: string;
  /** Whether that Indexer is archival, holding every round; lcp's read then needs no header read for its history. */
  readonly archival?: boolean;
}

type Failure = { reason: string; code?: string };

function reasonOf(r: Refusal): string {
  if (r.code === "x402/not-v2") return "invalid_x402_version";
  if (r.code.startsWith("x402/option")) return "invalid_payment_requirements";
  return "invalid_payload";
}

/**
 * The module's checks that read neither the chain nor the clock: its network, lcp's bound and reference, then the fee
 * payer's entry. x402's class and the own path sign every entry of the group that one of the key's addresses sends,
 * whatever the option names, so a group may hold one such entry only, and only where the option's `extra.feePayer`
 * names its sender: with no fee payer in the option the buyer pays its own fee, the choice fixed in what it signs.
 */
async function pure(c: AlgorandConfig, payload: PaymentPayload, requirements: PaymentRequirements): Promise<AvmRef | Failure> {
  const network = c.network;
  if (requirements.network !== network || payload.accepted?.network !== network) return { reason: "invalid_network" };
  const bound = await exactAvm.bound(payload);
  if (isRefusal(bound)) return { reason: reasonOf(bound), code: bound.code };
  // The requirements arrive as JSON, which lcp's option type names.
  const ref = await exactAvm.reference(payload, requirements as LcpOption);
  if (isRefusal(ref)) return { reason: reasonOf(ref), code: ref.code };
  const keyed = keyEntries(payload, c.signer.getAddresses()) ?? [];
  if (keyed.length > 1 || (keyed.length === 1 && keyed[0] !== requirements.extra?.["feePayer"])) {
    return { reason: "invalid_exact_avm_invalid_fee_payer" };
  }
  return ref;
}

const isRef = (v: AvmRef | Failure): v is AvmRef => !("reason" in v);

/** One bounded GET of the Indexer: the JSON answer, or `null` for a 404, the Indexer's answer for what it does not hold. */
async function getJson(url: string, deadline: number): Promise<unknown> {
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
  if (res.status === 404) return null;
  if (res.status < 200 || res.status > 299) throw new NodeError("http-status", true, `status ${res.status}`);
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new NodeError("malformed", true, "the answer is not JSON", { cause: e });
  }
}

function round(v: unknown): bigint {
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return BigInt(v);
  throw new NodeError("malformed", true, "a round");
}

/** A transaction as the Indexer answers it, in lcp's terms. */
function indexed(t: Record<string, unknown>): AvmIndexed {
  const sig = isObject(t["signature"]) ? t["signature"] : {};
  const signature = (["sig", "multisig", "logicsig", "pqsig"] as const).find((k) => sig[k] !== undefined) ?? "none";
  const x = t["asset-transfer-transaction"];
  const text = (v: unknown) => (typeof v === "string" ? v : null);
  if (typeof t["id"] !== "string" || typeof t["sender"] !== "string" || typeof t["tx-type"] !== "string") {
    throw new NodeError("malformed", true, "a transaction");
  }
  return {
    id: t["id"],
    confirmedRound: round(t["confirmed-round"]),
    type: t["tx-type"],
    sender: t["sender"],
    authAddr: text(t["auth-addr"]),
    signature,
    note: new Uint8Array(Buffer.from(typeof t["note"] === "string" ? t["note"] : "", "base64")),
    transfer: isObject(x)
      ? {
          assetId: round(x["asset-id"]),
          receiver: String(x["receiver"]),
          amount: round(x["amount"]),
          closeTo: text(x["close-to"]),
          closeAmount: x["close-amount"] === undefined ? 0n : round(x["close-amount"]),
          assetSender: text(x["sender"]),
        }
      : null,
    inner: Array.isArray(t["inner-txns"]) ? t["inner-txns"].filter(isObject).map((i) => indexed({ id: t["id"], ...i })) : [],
  };
}

/** lcp's reader over the Indexer at `url`, its calls ending by `deadline`. */
export function avmReader(c: AlgorandConfig, deadline: number): AvmReader {
  const base = c.indexer.replace(/\/+$/, "");
  const get = (path: string) => getJson(`${base}${path}`, deadline);
  return {
    network: c.network,
    ...(c.archival ? { archival: true } : {}),
    async transaction(txid) {
      const a = await get(`/v2/transactions/${encodeURIComponent(txid)}`);
      if (a === null) {
        const health = await get("/health");
        return { currentRound: round(isObject(health) ? health["round"] : undefined), found: null };
      }
      if (!isObject(a) || !isObject(a["transaction"])) throw new NodeError("malformed", true, "a transaction lookup");
      return { currentRound: round(a["current-round"]), found: indexed(a["transaction"]) };
    },
    async header(r) {
      return (await get(`/v2/blocks/${r}?header-only=true`)) !== null;
    },
    async accountPage(account, q): Promise<AvmPage> {
      const query = new URLSearchParams({ "min-round": String(q.minRound) });
      if (q.maxRound !== undefined) query.set("max-round", String(q.maxRound));
      if (q.next !== undefined) query.set("next", q.next);
      const a = await get(`/v2/accounts/${encodeURIComponent(account)}/transactions?${query}`);
      if (!isObject(a) || !Array.isArray(a["transactions"])) throw new NodeError("malformed", true, "an account page");
      const transactions = a["transactions"].map((t) => {
        try {
          return indexed(t as Record<string, unknown>);
        } catch {
          return { unparseable: true as const, id: isObject(t) && typeof t["id"] === "string" ? t["id"] : "" };
        }
      });
      const next = a["next-token"];
      return { currentRound: round(a["current-round"]), transactions, ...(typeof next === "string" ? { next } : {}) };
    },
  };
}

/** The published class with the module's pure checks before it on both calls. */
function behind(cls: SchemeNetworkFacilitator, c: AlgorandConfig): SchemeNetworkFacilitator {
  return {
    scheme: cls.scheme,
    caipFamily: cls.caipFamily,
    getExtra: (n) => cls.getExtra(n),
    getSigners: (n) => cls.getSigners(n),
    async verify(payload, requirements, context) {
      const r = await pure(c, payload, requirements);
      if (isRef(r)) return cls.verify(payload, requirements, context);
      return { isValid: false, invalidReason: r.reason, ...(r.code ? { invalidMessage: r.code } : {}) };
    },
    async settle(payload, requirements, context) {
      const r = await pure(c, payload, requirements);
      if (isRef(r)) return cls.settle(payload, requirements, context);
      return { success: false, errorReason: r.reason, ...(r.code ? { errorMessage: r.code } : {}), transaction: "", network: requirements.network };
    },
  };
}

/** The record's members, the same on both paths. */
function recordOf(c: AlgorandConfig): Module["record"] {
  const network = c.network as Network;
  return {
    async instrument(p): Promise<Instrumented | Refused> {
      const r = await pure(c, p.payload, p.requirements);
      if (!isRef(r)) return { refused: r.reason, ...(r.code === undefined ? {} : { message: r.code }) };
      return {
        pairing: exactAvm.id,
        // The id is the hash of the transaction's own fields; no signature is in it.
        instrument: { by: "transaction", network, transaction: r.txid },
        nonce: exactAvm.data.nonce,
        // Its life ends at lastValid, a round, which no clock bounds from above.
        keep: { until: "settler" },
      };
    },
    async read(p, at) {
      const r = await pure(c, p.payload, p.requirements);
      if (!isRef(r)) return outcomeOf({ state: "unreadable", reason: "unparseable", foreign: [] });
      const search = at.search as Parameters<typeof exactAvm.status>[2]["search"];
      return outcomeOf(await exactAvm.status(r, avmReader(c, at.deadline), { act: "payment", finality: "final", ...(search ? { search } : {}) }));
    },
  };
}

/** The fee budget's members, the same on both paths: the key pays the fee its own transaction in the group names. */
function feesOf(c: AlgorandConfig): FeeNeeds {
  return {
    // The key pays where the group holds its zero payment, which the class and the own path sign; the checks admit
    // one, under an option naming it as `extra.feePayer`.
    paysFee: (p) => (keyEntries(p.payload, c.signer.getAddresses()) ?? []).length > 0,
    payerBroadcast: () => false,
    async charged(p, sent) {
      const fee = feePayerFee(c.signer, p.payload);
      const shown = await avmReader(c, sent.deadline).transaction(sent.transaction);
      return { fee, included: shown.found !== null };
    },
  };
}

/** The descriptor of `x402/exact/algorand`, one kind for both paths. */
function descriptor(): Module["descriptor"] {
  // lcp's floor is 0: the scheme sets none, the class compares amounts by equality, and a zero transfer needs no opt-in.
  return { name: "algorand", key: "fee-payer", pairings: [exactAvm.id], acceptsZero: [exactAvm.id] };
}

/**
 * The registration of `x402/exact/algorand` on the configured network: the published class, and behind its
 * registration the own path for a rekeyed payer's one key and a Falcon key, claimed by the payment entry's members.
 */
export function algorandRegistration(c: AlgorandConfig): Registration {
  const network = c.network as Network;
  const module: Module = {
    descriptor: descriptor(),
    network,
    facilitator: behind(new ExactAvmScheme(c.signer), c),
    record: recordOf(c),
    fees: feesOf(c),
  };
  const admitted = async (payload: PaymentPayload, r: PaymentRequirements) => {
    const ref = await pure(c, payload, r);
    return isRef(ref) ? { txid: ref.txid } : ref;
  };
  const own: Handoff = {
    claim: { by: "payment", claims: (payload: PaymentPayload) => ownAuthority(payload) !== undefined },
    module: { descriptor: descriptor(), network, facilitator: ownFacilitator(c.signer, admitted), record: recordOf(c), fees: feesOf(c) },
  };
  return { network, module, own: [own] };
}

/** How the core starts the module: the configuration's `algorand` member lists the networks, one entry each. */
export const starter: ModuleStarter<readonly AlgorandConfig[]> = {
  name: "algorand",
  async start(networks) {
    return { registrations: networks.map(algorandRegistration) };
  },
};
