/**
 * The Hedera module for `x402/exact/hedera` on each configured network: `@x402/hedera` 2.31.0's facilitator class,
 * registered unchanged. The class takes only a payment whose transaction id names an account the facilitator manages
 * as `extra.feePayer`, so the key is always the seller's fee-payer account's (`extra.key` `fee-payer`): it signs the
 * buyer's transfer as the account that pays its fee. It reaches the module as the `FacilitatorHederaSigner` the class
 * takes, and its account is in `signers` and the class's `extra.feePayer`. lcp's checks of the pairing come first and
 * name the instrument; lcp's read goes through the seller's Mirror Node.
 *
 * The transfer-executor form, `x402/exact/hedera/transfer-executor`, is built in `./executor.ts` and is not started
 * from configuration: no member of this configuration names an executor, and x402's specification of the method
 * admits none by default.
 */
import { setTimeout as sleep } from "node:timers/promises";
import { isRefusal, type Refusal } from "@integraledger/lcp";
import { exactHedera, type HederaNetwork, type HederaRef } from "@integraledger/lcp/hedera";
import type { PaymentRequirements as LcpOption } from "@integraledger/lcp/x402";
import type { Network, SchemeNetworkFacilitator } from "@x402/core/types";
import type { FacilitatorHederaSigner } from "@x402/hedera";
import { ExactHederaScheme } from "@x402/hedera/exact/facilitator";
import {
  outcomeOf,
  type Instrumented,
  type Keep,
  type Module,
  type ModuleStarter,
  type Refused,
  type Registration,
  type X402Payment,
} from "../../module.js";
import { chargedFee, mirrorId, mirrorReader, sdkId, spelledAsSent, type Mirror } from "./mirror.js";

export interface HederaConfig {
  /** The network, exactly one. */
  readonly network: HederaNetwork;
  /** The seller's fee-payer account and its key, as `@x402/hedera`'s facilitator class takes them. */
  readonly signer: FacilitatorHederaSigner;
  /** The seller's Mirror Node, its REST interface's base URL, which lcp's read and the fee count use. */
  readonly mirror: string;
  /** Whether that Mirror Node holds every record since the network began. */
  readonly archival?: boolean;
}

/** The x402 reason for one of lcp's refusals: the version, the option, or else the payload. */
export function reasonOf(r: Refusal): string {
  if (r.code === "x402/not-v2") return "invalid_x402_version";
  if (r.code.startsWith("x402/option") || r.code === "hedera/option-malformed") return "invalid_payment_requirements";
  return "invalid_payload";
}

export function mirrorOf(c: HederaConfig): Mirror {
  return { network: c.network, base: c.mirror, archival: c.archival === true };
}

/** lcp's checks of the payment, which read neither the chain nor the clock, and its read keys; or the refusal. */
async function checked(p: X402Payment): Promise<HederaRef | Refusal> {
  const bound = await exactHedera.bound(p.payload);
  if (isRefusal(bound)) return bound;
  // The requirements arrive as JSON, which lcp's option type names.
  return exactHedera.reference(p.payload, p.requirements as LcpOption);
}

/** How long `charged` waits before it asks the mirror again for a transaction it does not hold yet. */
const MIRROR_POLL_MS = 250;

/** The time after which a body can no longer land: its valid start plus its valid duration, in Unix milliseconds. */
function lapseOf(ref: HederaRef): Keep {
  const [seconds, nanos] = ref.validStart.split(".");
  return { until: "lapse", at: (Number(seconds) + ref.validDuration) * 1000 + Math.ceil(Number(nanos ?? "0") / 1e6) };
}

/**
 * The class, its settle naming the payment's own transaction id where it answers `transaction_failed` naming none: the
 * class answers so a submission that threw, which a node may have taken, and the id, the payer's, is known before the
 * send, so the record holds it, lcp's read reads it and the fee budget counts it.
 */
function naming(cls: SchemeNetworkFacilitator): SchemeNetworkFacilitator {
  return {
    scheme: cls.scheme,
    caipFamily: cls.caipFamily,
    getExtra: (n) => cls.getExtra(n),
    getSigners: (n) => cls.getSigners(n),
    verify: (payload, requirements, context) => cls.verify(payload, requirements, context),
    async settle(payload, requirements, context) {
      const s = await cls.settle(payload, requirements, context);
      if (s.success || s.transaction !== "" || s.errorReason !== "transaction_failed") return s;
      const ref = await checked({ payload, requirements });
      return isRefusal(ref) ? s : { ...s, transaction: sdkId(ref.transactionId) ?? ref.transactionId };
    },
  };
}

/** The module of `x402/exact/hedera` on the configured network. */
export function hederaModule(c: HederaConfig): Module {
  const network = c.network as Network;
  const mirror = mirrorOf(c);
  return {
    // A zero transfer is not established on Hedera, so the kind does not take zero.
    descriptor: { name: "hedera", key: "fee-payer", pairings: [exactHedera.id], acceptsZero: [] },
    network,
    facilitator: naming(new ExactHederaScheme(c.signer)),
    record: {
      async instrument(p): Promise<Instrumented | Refused> {
        const ref = await checked(p);
        if (isRefusal(ref)) return { refused: reasonOf(ref), message: ref.code };
        return {
          pairing: exactHedera.id,
          // The transaction id, the payment's single-use value (profile rule 9), and its payer: every body of a list is
          // the same payment (rule 6), so a list reordered or trimmed is the same instrument, and the chain takes one
          // transaction under the id.
          instrument: { by: "single-use", network, signer: ref.payer, value: ref.transactionId },
          nonce: exactHedera.data.nonce,
          keep: lapseOf(ref),
        };
      },
      async read(p, at) {
        const ref = await checked(p);
        if (isRefusal(ref)) return outcomeOf({ state: "unreadable", reason: "unparseable", foreign: [] });
        const search = at.search as string | undefined;
        const answer = await exactHedera.status(ref, mirrorReader(mirror, at.deadline), {
          act: "payment",
          finality: "consensus",
          ...(search === undefined ? {} : { search }),
        });
        return outcomeOf(spelledAsSent(answer));
      },
    },
    fees: {
      // The class makes the configured fee payer the account of the transaction id, which pays the fee.
      paysFee: () => true,
      payerBroadcast: () => false,
      // The mirror holds a transaction seconds after consensus, so it is asked until the deadline; only then is the
      // transaction counted at its bound, the maxFee the payer signed, which a failed read also leaves.
      async charged(p, sent) {
        const id = mirrorId(sent.transaction) ?? sent.transaction;
        for (;;) {
          const fee = await chargedFee(mirror, id, sent.deadline).catch(() => undefined);
          if (fee !== undefined) return { fee, included: true };
          if (performance.now() + MIRROR_POLL_MS >= sent.deadline) break;
          await sleep(MIRROR_POLL_MS);
        }
        const ref = await checked(p);
        if (isRefusal(ref)) throw new TypeError(`a payment lcp refuses was sent: ${ref.code}`);
        return { fee: BigInt(ref.presented.maxFee), included: false };
      },
    },
  };
}

export function hederaRegistration(c: HederaConfig): Registration {
  return { network: c.network as Network, module: hederaModule(c), own: [] };
}

/** The module's start: one registration of `exact` per configured network. */
export const starter: ModuleStarter<readonly HederaConfig[]> = {
  name: "hedera",
  async start(config) {
    return { registrations: config.map(hederaRegistration) };
  },
};
