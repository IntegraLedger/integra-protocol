/**
 * The Solana module: `@x402/svm` 2.31.0's facilitator classes for `x402/exact/solana`, `x402/upto/solana` and
 * `x402/batch-settlement/solana`, each registered unchanged for one network, behind lcp's checks of the pairing.
 *
 * The seller's fee-payer key co-signs every transaction the payer signed as its fee payer (and, on the channel forms,
 * pays the channel's rent), so `extra.key` is `fee-payer` and the key's address is in `signers` and in the class's own
 * `extra.feePayer`. The key reaches the module as the signer object the classes take, `FacilitatorSvmSigner`, which
 * the operator's code makes (for example with `toFacilitatorSvmSigner` over the same node), so the settler reads no key
 * material. The channel forms need the payment-channels program, which is deployed on devnet and testnet and not on
 * mainnet, and durable channel storage, which the settler's database gives: on mainnet only `exact` is made.
 */
import { isRefusal, type PairingData, type PairingId, type Refusal } from "@integraledger/lcp";
import type { SolanaNetwork, SvmQuery, SvmReader, SvmRef, SvmStatus } from "@integraledger/lcp/svm";
import { batchSvm } from "@integraledger/lcp/x402-batch-settlement";
import { exactSvm } from "@integraledger/lcp/x402-exact-solana";
import { uptoSvm } from "@integraledger/lcp/x402-upto-solana";
import type { PaymentRequirements as LcpOption } from "@integraledger/lcp/x402";
import type { FacilitatorSvmSigner } from "@x402/svm";
import { BatchSvmScheme, type BatchPendingSettlementStore, type PaymentChannelStorage } from "@x402/svm/batch-settlement/facilitator";
import { ExactSvmScheme } from "@x402/svm/exact/facilitator";
import { UptoSvmScheme } from "@x402/svm/upto/facilitator";
import type { PendingSettlementStore } from "@x402/core/facilitator";
import type { FacilitatorContext, Network, PaymentPayload, PaymentRequirements, SchemeNetworkFacilitator, VerifyResponse } from "@x402/core/types";
import { getBase58Decoder, getTransactionDecoder } from "@solana/kit";
import { createHash } from "node:crypto";
import { isObject } from "../../answers.js";
import { NODE_TIMEOUT_MS } from "../../http.js";
import {
  outcomeOf,
  phaseOf,
  type ChainRead,
  type FeeMeter,
  type Instrumented,
  type Module,
  type ModuleStarter,
  type Refused,
  type Registration,
  type X402Payment,
} from "../../module.js";
import { chargedOn, svmReader } from "./reader.js";
import { batchPendingStore, channelStorage } from "./state.js";

/** Solana mainnet, where the payment-channels program the `upto` and batch-settlement forms call is not deployed. */
export const SOLANA_MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

/** The durable state the channel forms' classes keep, from the settler's database. */
export interface SolanaChannelState {
  /** The channels the `upto` and batch-settlement classes open, read back at a claim and by rent cleanup. */
  readonly channels: PaymentChannelStorage;
  /** The signatures `upto` and `exact` broadcast and have not yet seen confirmed, so a retried settle reconciles. */
  readonly pending: PendingSettlementStore;
  /** The batch-settlement class's own pending signatures. */
  readonly batchPending: BatchPendingSettlementStore;
}

export interface SolanaConfig {
  /** The network, exactly one. */
  readonly network: SolanaNetwork;
  /**
   * The seller's Solana JSON-RPC endpoint, which lcp's read uses: one whose `getFirstAvailableBlock` is at or below the
   * slot at which each payment was issued.
   */
  readonly node: string;
  /** The seller's fee-payer key, as `@x402/svm`'s facilitator classes take it. */
  readonly signer: FacilitatorSvmSigner;
  /** The message versions the classes accept and state in `extra.transactionVersions`; their default is `[0, 1]`. */
  readonly transactionVersions?: readonly (0 | 1)[];
}

/** The x402 reason for an lcp refusal: the version, the option, or else the payload. */
export function reasonOf(r: Refusal): string {
  if (r.code === "x402/not-v2") return "invalid_x402_version";
  if (r.code.startsWith("x402/option") || r.code === "x402/flow-missing") return "invalid_payment_requirements";
  return "invalid_payload";
}

/** The payment as lcp reads it: the payload as presented, which holds the option it accepted. */
function presented(payload: PaymentPayload): unknown {
  return payload;
}

/** A refusal before the class: the module's network, then lcp's checks of the pairing. */
type Check = (payload: PaymentPayload, requirements: PaymentRequirements) => Promise<{ reason: string; code?: string } | null>;

/** The class's check at `/settle`, the one the core makes before it claims and submits, where it is not its `verify`. */
type SettleCheck = (
  cls: SchemeNetworkFacilitator,
  payload: PaymentPayload,
  requirements: PaymentRequirements,
  context?: FacilitatorContext,
) => Promise<VerifyResponse>;

/**
 * The published class, unchanged, with the module's checks before it on both calls: a payment they refuse is answered
 * by x402's failure shape with lcp's code as its message, and the class never sees it. At `/settle`, the class's check
 * is `atSettle` where given, else its `verify`.
 */
function behind(cls: SchemeNetworkFacilitator, check: Check, atSettle?: SettleCheck): SchemeNetworkFacilitator {
  return {
    scheme: cls.scheme,
    caipFamily: cls.caipFamily,
    getExtra: (network) => cls.getExtra(network),
    getSigners: (network) => cls.getSigners(network),
    async verify(payload, requirements, context) {
      const refused = await check(payload, requirements);
      if (refused !== null) {
        return { isValid: false, invalidReason: refused.reason, ...(refused.code ? { invalidMessage: refused.code } : {}) };
      }
      if (atSettle !== undefined && phaseOf(context) === "settle") return atSettle(cls, payload, requirements, context);
      return cls.verify(payload, requirements, context);
    },
    async settle(payload, requirements, context) {
      const refused = await check(payload, requirements);
      if (refused !== null) {
        return {
          success: false,
          errorReason: refused.reason,
          ...(refused.code ? { errorMessage: refused.code } : {}),
          transaction: "",
          network: requirements.network,
        };
      }
      return cls.settle(payload, requirements, context);
    },
  };
}

/** JSON with every object's keys in order, so one value has one spelling. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (isObject(v)) {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

/**
 * The digest that names a settle which carries no H, a claim against a channel or a batch's voucher, refund or top-up:
 * SHA-256 over the network, the amount the resource server asks for and the payload as presented, so each signed
 * settle is its own row.
 */
export function collectionDigest(network: string, p: X402Payment): string {
  const body = canonical({ network, amount: p.requirements.amount, payload: p.payload.payload });
  return `0x${createHash("sha256").update(body).digest("hex")}`;
}

/** A wire's transaction id: its first signature, the fee payer's, base58; undefined where the wire does not decode. */
function txidOf(wireBase64: string): string | undefined {
  try {
    const first = Object.values(getTransactionDecoder().decode(Buffer.from(wireBase64, "base64")).signatures)[0];
    return first ? getBase58Decoder().decode(first) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The fee payer's signer object as the classes take it, each transaction it sends given to the network's fee meter
 * once the send ends, every other member unchanged. x402's classes send every transaction through `sendTransaction`,
 * and answer one whose send threw naming no transaction, though the node may have taken it; its id is in the wire, so
 * the meter counts it at the wire's own bound until the node shows its fee.
 */
function counted(signer: FacilitatorSvmSigner, meter: FeeMeter, node: string): FacilitatorSvmSigner {
  return new Proxy(signer, {
    get(inner, member) {
      const value: unknown = Reflect.get(inner, member);
      if (typeof value !== "function") return value;
      if (member === "sendTransaction") {
        return async (wire: string, network: string) => {
          try {
            return await value.call(inner, wire, network);
          } finally {
            const transaction = txidOf(wire);
            if (transaction !== undefined) {
              meter.sent(transaction, () => chargedOn(node, transaction, wire, performance.now() + NODE_TIMEOUT_MS));
            }
          }
        };
      }
      return value.bind(inner);
    },
  });
}

/** A pairing's lcp entry, as far as the module uses it. */
interface Pairing {
  readonly id: PairingId;
  readonly data: PairingData;
  bound(presented: unknown): Promise<unknown>;
  reference(presented: unknown, option: LcpOption): Promise<SvmRef | Refusal>;
  status(ref: SvmRef, reader: SvmReader, query: SvmQuery): Promise<SvmStatus>;
}

/** lcp's checks of a payment of `pairing`, and its reference; the refusal where the module's network differs. */
async function checked(
  network: SolanaNetwork,
  pairing: Pairing,
  payload: PaymentPayload,
  requirements: PaymentRequirements,
): Promise<SvmRef | { reason: string; code?: string }> {
  if (requirements.network !== network || payload.accepted?.network !== network) return { reason: "invalid_network" };
  const bound = await pairing.bound(presented(payload));
  if (isRefusal(bound)) return { reason: reasonOf(bound), code: bound.code };
  // The requirements arrive as JSON, which lcp's option type names.
  const ref = await pairing.reference(presented(payload), requirements as LcpOption);
  if (isRefusal(ref)) return { reason: reasonOf(ref), code: ref.code };
  return ref;
}

const isRef = (v: SvmRef | { reason: string }): v is SvmRef => !("reason" in v);

/** The position the core keeps at a claim: the node's finalized slot, below every slot a later submission lands in. */
interface Position {
  readonly slot: bigint;
}

/**
 * lcp's read of the payment act `ref` names, at the one mark, `finalized`, resuming `search`, after the slot the claim
 * read (`from`), where the core holds one: a node that holds the blocks from that slot on then serves the read.
 */
async function readOf(
  pairing: Pairing,
  node: string,
  ref: SvmRef,
  at: { readonly deadline: number; readonly search?: unknown; readonly from?: unknown },
): Promise<ChainRead> {
  const reader = svmReader(ref.network, node, at.deadline);
  const search = at.search as SvmQuery["search"];
  const after = (at.from as Position | undefined)?.slot;
  return outcomeOf(
    await pairing.status(ref, reader, {
      act: "payment",
      finality: "finalized",
      ...(search ? { search } : {}),
      ...(typeof after === "bigint" ? { after } : {}),
    }),
  );
}

/** The transaction the payer gave, base64, where the payload carries one: `exact`'s, or an `upto` opening's. */
function givenWire(p: X402Payment): string | undefined {
  const body = p.payload.payload;
  const wire = body["transaction"] ?? body["openTransaction"];
  return typeof wire === "string" ? wire : undefined;
}

/**
 * The instrument of a payment lcp's checks accept: the message the payer signed, by its digest, which holds every
 * byte the payer signed and no signature, so a copy signed again is the same instrument; `single-use` where the
 * pairing's single-use value is that signed message, else named by that digest alone. A blockhash bounds its life in
 * blocks, which no clock bounds from above, and a durable nonce does not bound it: the row is kept for the settler's
 * life.
 */
function instrumentOf(pairing: Pairing, nonce: Instrumented["nonce"], ref: SvmRef): Instrumented {
  const digest = ref.digest ?? "";
  return {
    pairing: pairing.id,
    instrument:
      nonce === "single-use"
        ? { by: "single-use", network: ref.network as Network, signer: ref.payer, value: digest }
        : { by: "digest", network: ref.network as Network, digest },
    nonce,
    keep: { until: "settler" },
  };
}

/**
 * The module for one pairing whose every settle carries H in the signed message (`exact`), or whose opening does and
 * whose later settles are collection (`isOpening` false: an `upto` claim, a batch's voucher, top-up or refund), which
 * lcp does not read: those go to the class with the network checked, and each is its own row.
 */
function moduleOf(
  c: SolanaConfig,
  pairing: Pairing,
  cls: SchemeNetworkFacilitator,
  acceptsZero: readonly PairingId[],
  isOpening: (p: X402Payment) => boolean,
  atSettle?: SettleCheck,
): Module {
  const network = c.network as Network;
  const check: Check = async (payload, requirements) => {
    if (!isOpening({ payload, requirements })) {
      return requirements.network === network && payload.accepted?.network === network ? null : { reason: "invalid_network" };
    }
    const r = await checked(c.network, pairing, payload, requirements);
    return isRef(r) ? null : r;
  };
  return {
    descriptor: { name: "solana", key: "fee-payer", pairings: [pairing.id], acceptsZero },
    network,
    facilitator: behind(cls, check, atSettle),
    record: {
      async instrument(p): Promise<Instrumented | Refused> {
        if (!isOpening(p)) {
          if (p.requirements.network !== network || p.payload.accepted?.network !== network) return { refused: "invalid_network" };
          return {
            pairing: pairing.id,
            instrument: { by: "digest", network, digest: collectionDigest(network, p) },
            nonce: "unshown",
            keep: { until: "settler" },
          };
        }
        const r = await checked(c.network, pairing, p.payload, p.requirements);
        return isRef(r) ? instrumentOf(pairing, pairing.data.nonce, r) : { refused: r.reason, ...(r.code === undefined ? {} : { message: r.code }) };
      },
      async read(p, at) {
        if (!isOpening(p)) {
          // A collection settle carries no H and lcp has no read of it: the read finds nothing it can test.
          return outcomeOf({ state: "pending", reason: "not-found", foreign: [] });
        }
        const r = await checked(c.network, pairing, p.payload, p.requirements);
        if (!isRef(r)) return outcomeOf({ state: "unreadable", reason: "unparseable", foreign: [] });
        return readOf(pairing, c.node, r, at);
      },
      async position(_p, at): Promise<Position> {
        return { slot: await svmReader(c.network, c.node, at.deadline).slot("finalized") };
      },
    },
    fees: {
      // The key co-signs as fee payer every transaction this module sends, the claims and closes among them.
      paysFee: () => true,
      payerBroadcast: () => false,
      charged: (p, sent) => chargedOn(c.node, sent.transaction, givenWire(p), sent.deadline),
    },
  };
}

/**
 * Whether an `upto` payload goes through lcp's checks as an opening: every payload but one `UptoSvmScheme.settle`
 * positively reads as a claim against an open channel, `type` `claim` or a `voucherSignature` with no `type`. The class
 * takes a payload with neither for a deposit where the amount equals `maxAmount` as numbers, however `maxAmount` is
 * spelt, so the module never tells a deposit by the spelling.
 */
function uptoOpening(p: X402Payment): boolean {
  const body = p.payload.payload;
  const type = body["type"];
  if (type === "claim") return false;
  return !(type === undefined && typeof body["voucherSignature"] === "string");
}

/**
 * The `upto` class's check at `/settle`. The resource server stamps `type` on each settle it sends (x402's `upto`
 * server: `deposit` before its handler runs, `claim` after it), and the class's `verify`, the check of the buyer's
 * opening, refuses a payload that carries one. A deposit is checked by that `verify` as the buyer sent it, without
 * the stamp. A claim, which that `verify` never takes, is checked by the class's `settle` before it sends anything (the
 * channel it opened, the receiver authorizer, the validity window, the voucher): here it is valid, naming the
 * payload's payer.
 */
const uptoAtSettle: SettleCheck = async (cls, payload, requirements, context) => {
  const body = payload.payload;
  if (!uptoOpening({ payload, requirements })) {
    const from = body["from"];
    return { isValid: true, ...(typeof from === "string" ? { payer: from } : {}) };
  }
  if (body["type"] !== "deposit") return cls.verify(payload, requirements, context);
  const { type: _stamp, ...signed } = body;
  return cls.verify({ ...payload, payload: signed }, requirements, context);
};

/**
 * Whether a batch-settlement payload goes through lcp's checks as an opening: a deposit that lcp's channel read does not
 * place within an open channel (a top-up), that is its `open`, and a deposit lcp cannot read, which its checks refuse.
 * Every other type is a voucher or a call on the channel the resource server makes, which lcp does not read.
 */
function batchOpening(p: X402Payment): boolean {
  if (p.payload.payload["type"] !== "deposit") return false;
  return batchSvm.channel.kind(p.payload as Parameters<typeof batchSvm.channel.kind>[0]) !== "within";
}

/**
 * The Solana modules for one network: `exact` always; `upto` and batch settlement where the network is not mainnet and
 * durable channel state is given. With `meter`, the network's fee meter, every transaction the classes send is counted.
 */
export function solanaModules(config: SolanaConfig, state?: SolanaChannelState, meter?: FeeMeter): Module[] {
  const c = meter === undefined ? config : { ...config, signer: counted(config.signer, meter, config.node) };
  const versions = c.transactionVersions === undefined ? {} : { transactionVersions: c.transactionVersions };
  const pending = state === undefined ? {} : { pendingSettlementStore: state.pending };
  const exact = new ExactSvmScheme(c.signer, undefined, { ...versions, ...pending });
  // lcp's floor on x402/exact/solana is 0: a zero TransferChecked lands, and the class compares amounts by equality.
  const modules = [moduleOf(c, exactSvm, exact, [exactSvm.id], () => true)];
  if (c.network === SOLANA_MAINNET || state === undefined) return modules;
  const upto = new UptoSvmScheme(c.signer, { ...versions, channelStorage: state.channels, pendingSettlementStore: state.pending });
  const batch = new BatchSvmScheme(c.signer, {
    ...versions,
    channelStorage: state.channels,
    pendingSettlementStore: state.batchPending,
  });
  // upto: lcp's filter admits a positive amount only. Batch settlement: zero through it has not been read.
  modules.push(moduleOf(c, uptoSvm, upto, [], uptoOpening, uptoAtSettle));
  modules.push(moduleOf(c, batchSvm, batch, [], batchOpening));
  return modules;
}

/**
 * How the core starts the module: the configuration's `solana` member lists the networks, one entry each, and each
 * form made on a network is one registration of x402's class. The channels, and every class's pending signatures, are
 * kept in the settler's database, and each network's fee meter counts every transaction the classes send.
 */
export const starter: ModuleStarter<readonly SolanaConfig[]> = {
  name: "solana",
  async start(networks, core) {
    const state: SolanaChannelState = {
      channels: channelStorage(core.state),
      pending: core.state.pendingSettlements(),
      batchPending: batchPendingStore(core.state),
    };
    return {
      registrations: networks.flatMap((c) =>
        solanaModules(c, state, core.meter(c.network as Network)).map((module): Registration => ({ network: module.network, module, own: [] })),
      ),
    };
  },
};
