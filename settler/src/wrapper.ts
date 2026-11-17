/**
 * The wrapper the settler registers with x402's facilitator class for one scheme on one network: it states the kind's
 * `extra` (the settler's members with every member the module's facilitator states), gives the signers of every
 * module behind it, and hands a payment an own module claims to that module before the published class sees it. The
 * published verification and settlement run unchanged.
 */
import type { PairingId } from "@integraledger/lcp";
import type {
  FacilitatorContext,
  FacilitatorExtension,
  Network,
  PaymentPayload,
  PaymentRequirements,
  SchemeNetworkFacilitator,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";
import { PHASE, type Instrumented, type KeyPurpose, type Module, type Phase, type Registration, type X402Payment } from "./module.js";

/** The members of a kind's `extra` that the settler states, which no module's facilitator may state itself. */
export const SETTLER_MEMBERS = ["key", "acceptsZero", "pairings", "feeBudget"] as const;

/** What a kind declares: one registration's modules, the published one and its own ones, as one kind. */
export interface Kind {
  readonly registration: Registration;
  readonly scheme: string;
  readonly network: Network;
  readonly key: KeyPurpose;
  /** True only where every module behind the kind takes zero. */
  readonly acceptsZero: boolean;
  /** Every pairing a module behind the kind submits, each once. */
  readonly pairings: readonly PairingId[];
  /** Whether the network has a fee budget. */
  readonly feeBudget: boolean;
}

/** Every module behind a registration: its own modules, in the order they are tried, then the published one. */
export function modulesOf(r: Registration): Module[] {
  return [...r.own.map((h) => h.module), r.module];
}

/**
 * The kind of a registration. Its key is the one key purpose its modules hold: `none` where none holds one. Two
 * modules behind one kind whose keys sign for different purposes are refused, since a kind states one.
 */
export function kindOf(r: Registration, feeBudget: boolean): Kind {
  const modules = modulesOf(r);
  const keys = [...new Set(modules.map((m) => m.descriptor.key).filter((k) => k !== "none"))];
  if (keys.length > 1) {
    throw new TypeError(`${r.module.facilitator.scheme} on ${r.network}: its modules' keys sign for ${keys.join(" and ")}`);
  }
  const pairings = [...new Set(modules.flatMap((m) => m.descriptor.pairings))];
  return {
    registration: r,
    scheme: r.module.facilitator.scheme,
    network: r.network,
    key: keys[0] ?? "none",
    acceptsZero: modules.every((m) => m.descriptor.acceptsZero),
    pairings,
    feeBudget,
  };
}

/**
 * The module a payment goes to: the first own module whose claim takes it, by the option's member or by what the
 * payment holds, else the registration's module. A claim reads neither the chain nor the clock.
 */
export function route(r: Registration, payload: PaymentPayload, requirements: PaymentRequirements): Module {
  for (const h of r.own) {
    const claims = h.claim.by === "option" ? h.claim.claims(requirements) : h.claim.claims(payload, requirements);
    if (claims) return h.module;
  }
  return r.module;
}

/**
 * The amount of the option a payment answers: the requirements' own, but at `/settle` of x402's `upto`, whose
 * requirements then carry the charge, at most the maximum the payment authorises and zero where the resource server
 * charges nothing (a close that moves nothing), the maximum, as the option the payment accepted states it.
 */
function optionAmount(kind: Kind, p: X402Payment, phase: Phase): string {
  return String(phase === "settle" && kind.scheme === "upto" ? p.payload.accepted?.amount : p.requirements.amount);
}

/**
 * The kind's declaration, held to a payment before the class is asked: an option of amount zero where the kind does
 * not take zero, and a form outside the pairings the module the payment goes to submits, are refused
 * `invalid_payment_requirements`.
 */
export function declared(kind: Kind, module: Module, p: X402Payment, i: Instrumented, phase: Phase): string | undefined {
  if (!kind.acceptsZero && /^0+$/.test(optionAmount(kind, p, phase))) return "invalid_payment_requirements";
  if (!module.descriptor.pairings.includes(i.pairing)) return "invalid_payment_requirements";
  return undefined;
}

/**
 * The wrapper of one kind, as x402's class registers it for the kind's one network, in one phase: the context it gives
 * a module's `verify` names that phase (`phaseOf`), every extension x402's class gives kept.
 */
export class Wrapper implements SchemeNetworkFacilitator {
  readonly scheme: string;
  readonly caipFamily: string;

  constructor(
    readonly kind: Kind,
    readonly phase: Phase,
  ) {
    this.scheme = kind.scheme;
    this.caipFamily = kind.registration.module.facilitator.caipFamily;
  }

  private phased(given?: FacilitatorContext): FacilitatorContext {
    const named = { key: PHASE, phase: this.phase };
    return {
      getExtension: <T extends FacilitatorExtension>(key: string): T | undefined =>
        key === PHASE ? (named as unknown as T) : given?.getExtension<T>(key),
    };
  }

  /**
   * The kind's `extra`: each own module's members, then the published module's, which win where two state one, then the
   * settler's, which no module states (the core refuses one that does at its start).
   */
  getExtra(network: Network): Record<string, unknown> {
    const { registration: r } = this.kind;
    const own = r.own.map((h) => h.module.facilitator.getExtra(network) ?? {});
    return {
      ...Object.assign({}, ...own),
      ...(r.module.facilitator.getExtra(network) ?? {}),
      key: this.kind.key,
      acceptsZero: this.kind.acceptsZero,
      pairings: this.kind.pairings,
      ...(this.kind.feeBudget ? { feeBudget: true } : {}),
    };
  }

  /** Every address a module behind the kind signs with, each once. */
  getSigners(network: string): string[] {
    return [...new Set(modulesOf(this.kind.registration).flatMap((m) => m.facilitator.getSigners(network)))];
  }

  verify(payload: PaymentPayload, requirements: PaymentRequirements, context?: FacilitatorContext): Promise<VerifyResponse> {
    return route(this.kind.registration, payload, requirements).facilitator.verify(payload, requirements, this.phased(context));
  }

  settle(payload: PaymentPayload, requirements: PaymentRequirements, context?: FacilitatorContext): Promise<SettleResponse> {
    return route(this.kind.registration, payload, requirements).facilitator.settle(payload, requirements, context);
  }
}

/**
 * Why a registration cannot be served, or undefined: its network is not its modules', its own modules hold another
 * scheme, or a module's facilitator states a member the settler states.
 */
export function unsound(r: Registration): string | undefined {
  for (const m of modulesOf(r)) {
    if (m.network !== r.network) return `a module of ${r.network} serves ${m.network}`;
    if (m.facilitator.scheme !== r.module.facilitator.scheme) {
      return `${r.network}: an own module of ${m.facilitator.scheme} behind ${r.module.facilitator.scheme}`;
    }
    const extra = m.facilitator.getExtra(r.network) ?? {};
    const stated = SETTLER_MEMBERS.filter((k) => k in extra);
    if (stated.length > 0) return `${r.network}: a module's facilitator states ${stated.join(", ")}`;
  }
  return undefined;
}
