/**
 * What a module gives the settler's core, for one scheme on one network. A module is an x402 facilitator for that
 * scheme and network (`SchemeNetworkFacilitator` of `@x402/core`), either a class x402 publishes or the settler's own,
 * with three things alongside it: a descriptor, which the kind's `extra` in `/supported` states; what the record needs to
 * key a payment, keep its row and tell a final answer from a live one; and what a fee budget needs to count the fees
 * the module's key pays.
 *
 * x402's facilitator class dispatches a payment to the first registration whose scheme matches and whose networks hold
 * the payment's network, and gives a registration of several networks of one namespace the pattern `<namespace>:*`, so
 * a registration names exactly one network, and an own module that settles a payer variant a published class refuses is
 * reached through that class's registration, by a claim, never by a second registration.
 */
import type { PairingData, PairingId, StatusAnswer } from "@integraledger/lcp";
import type { PendingSettlementStore } from "@x402/core/facilitator";
import type {
  FacilitatorContext,
  FacilitatorExtension,
  Network,
  PaymentPayload,
  PaymentRequirements,
  SchemeNetworkFacilitator,
} from "@x402/core/types";
import type { OperatorLog } from "./answers.js";

/** The settler's modules, one per chain form, each loaded only where its network is configured. */
export type ModuleName =
  | "algorand"
  | "aptos"
  | "cardano"
  | "casper"
  | "concordium"
  | "erc7710"
  | "evm"
  | "hedera"
  | "lnbtc"
  | "near"
  | "polkadot"
  | "solana"
  | "starknet"
  | "stellar"
  | "sui"
  | "ton"
  | "tron"
  | "xrpl";

/**
 * `extra.key`: what the module's key signs, where the module is configured with one. `none`: the module holds no key
 * and signs nothing. `relayer`: the key sends the transaction and pays its network fee. `fee-payer`: the key co-signs
 * the payer's transaction as the account that pays its fee. A chain's own name for the role stays in that module's
 * documentation. The key is always the seller's, reaching the module as the signer object its class takes, in the
 * configuration the operator's code passes to the settler's start function.
 */
export type KeyPurpose = "none" | "relayer" | "fee-payer";

/**
 * What the kind states in `/supported`, with the members its x402 facilitator's `getExtra` returns, which are kept
 * unchanged. The fee budget's `extra.feeBudget` is the core's, stated from the operator's configuration.
 */
export interface Descriptor {
  readonly name: ModuleName;
  /** `extra.key`. */
  readonly key: KeyPurpose;
  /**
   * `extra.pairings`: the lcp pairing ids the module submits on this scheme and network. A scheme on one network can
   * hold several forms, so the scheme alone does not name them.
   */
  readonly pairings: readonly PairingId[];
  /**
   * `extra.acceptsZero`: the pairings of `pairings` the module settles at an amount of zero, as a seller choosing a zero
   * agreement needs to know; empty where none does.
   */
  readonly acceptsZero: readonly PairingId[];
  /**
   * Set where the module's `/verify` judges a payment that has already landed, by what the chain shows of it, and does
   * not refuse it for having landed: the core then asks neither its record nor the chain whether the instrument is
   * held before that `/verify`. Every other module's `/verify` refuses an instrument the record or the chain already
   * holds, since `isValid: true` tells the caller that a settle may follow.
   */
  readonly verifiesLanded?: true;
  /**
   * Set where the module's scheme forbids `/verify`, as x402's `exact` scheme on Lightning does: the core answers
   * `/verify` `unsupported_scheme` before anything else, and `/settle` still runs the module's own checks before it
   * submits.
   */
  readonly verifyForbidden?: true;
}

/**
 * The call a facilitator's `verify` is made for: `verify`, the caller's `/verify`; `settle`, the check `/settle` makes
 * before it submits. A scheme can check the two otherwise: x402's `upto` on XRPL refuses at `/verify` a payload carrying
 * the settlement transaction the resource server adds at `/settle` alone, and at `/settle` checks that transaction,
 * against the maximum the payment authorises rather than the charge.
 */
export type Phase = "verify" | "settle";

/** The key of the extension of x402's `FacilitatorContext` by which the core names the phase of a `verify`. */
export const PHASE = "settler-phase";

/** The phase a facilitator's `verify` is called in, from the context the core gives it: `verify` where it names none. */
export function phaseOf(context?: FacilitatorContext): Phase {
  const named = context?.getExtension<FacilitatorExtension & { readonly phase?: unknown }>(PHASE);
  return named?.phase === "settle" ? "settle" : "verify";
}

/** One payment, as the x402 calls carry it: the payload as presented, and the requirements of the option it answers. */
export interface X402Payment {
  readonly payload: PaymentPayload;
  readonly requirements: PaymentRequirements;
}

/**
 * The instrument a payment is: the record's key, one row for it whichever call claimed it. Never the single-use value
 * alone, which two payers can share, and never a hash that a re-signed copy of the same payment changes.
 */
export type Instrument =
  | {
      /** Named by the single-use value its signer signed. */
      readonly by: "single-use";
      readonly network: Network;
      /** The account that signed the single-use value, in the chain's own spelling. */
      readonly signer: string;
      /**
       * The single-use value as signed: an authorization nonce, a sequence number, an account nonce. For an agreement on
       * a pairing whose single-use value is H or H's low bits, the agreement's own value, so that an agreement and a
       * payment of one payer under one H are two instruments.
       */
      readonly value: string;
      /** The token contract, or the nonce key, within which the value is counted, where the form has one. */
      readonly scope?: string;
      /**
       * The digest of the signed bytes as presented, where the form names the instrument by them, so that a second body
       * under a used value is another instrument.
       */
      readonly signed?: string;
    }
  | {
      /** Named by the transaction id, where the chain derives it from the signed content alone, signatures excluded. */
      readonly by: "transaction";
      readonly network: Network;
      readonly transaction: string;
    }
  | {
      /**
       * Named by the digest of the signed payment, where the form's `nonce` is not `single-use` (a batch settlement, an
       * `upto` claim): each signed settle is its own instrument.
       */
      readonly by: "digest";
      readonly network: Network;
      readonly digest: string;
    };

/**
 * How long the record keeps a final row: at least until the form's lapse or life has passed, and for the settler's life
 * where the form has neither or its `nonce` is not `single-use`.
 */
export type Keep =
  | {
      /** Until the time the signed payment itself names, after which it can no longer land: Unix milliseconds. */
      readonly until: "lapse";
      readonly at: number;
    }
  | {
      /** For the longest the rail lets a signed payment stay payable, counted from the claim: milliseconds. */
      readonly until: "life";
      readonly ms: number;
    }
  | { readonly until: "settler" };

/** What the record keeps for a payment, read from the payment and its requirements alone. */
export interface Instrumented {
  /** The lcp pairing the payment is. */
  readonly pairing: PairingId;
  readonly instrument: Instrument;
  /**
   * The pairing's `nonce`, as lcp's registry states it: only under `single-use` may a held claim send the identical
   * signed payment again, and only where the read shows the value unconsumed and its validity open.
   */
  readonly nonce: PairingData["nonce"];
  readonly keep: Keep;
  /**
   * Set where the payment is a later message of a multi-step scheme, on an instrument an earlier payment opened (an
   * auth-capture escrow's capture, void or refund; a batch-settlement channel's claim, settle or refund): its
   * requirements' amount is not an amount it pays, so the kind's zero-amount rule does not hold it. What it moves is
   * bounded on chain by what the opening funded.
   */
  readonly later?: true;
  /**
   * Set where the payment is a later message that carries no single-use value and whose effect the class and the chain
   * make inert on a repeat (a batch-settlement channel's claim, seal or settle: a claim moves only above the total the
   * channel records, a settle only what is claimed and not yet paid out, to the channel's own receiver). It is not
   * recorded: it goes to the class's check and settle each time it is sent, and the answer is the class's, since x402's
   * channel manager sends the same settle message in every round.
   */
  readonly unrecorded?: true;
}

/**
 * A payment the form's pure checks refuse, with x402's reason; nothing is read and nothing is recorded. `message` is
 * lcp's refusal code where lcp gave one, which the answer carries as x402's `invalidMessage` or `errorMessage`.
 */
export interface Refused {
  readonly refused: string;
  readonly message?: string;
}

/** An answer of lcp's read, as `status` answers it, its ledger position, marks and search position the pairing's own. */
export type ReadAnswer = StatusAnswer<unknown, unknown, unknown>;

/**
 * The answers after which the instrument can never land again: `settled`, a success; `failed`, with a failed result
 * that consumed the single-use value (`transaction-failed`), a value another act consumed (`instrument-consumed`), a
 * validity that passed with the value unconsumed (`instrument-unused`), or an act at or before the position the read
 * was given (`before-position`), which consumed the value before anything the settler sent could land.
 */
export type FinalAnswer = Extract<ReadAnswer, { readonly state: "settled" | "failed" }>;

/**
 * Every other answer: the instrument may still land (`instrument-live`, `below-mark`), or the read could not tell
 * (`search-incomplete`, `not-found`, `unreadable`). A row whose read is live is not final, and a repeat reads again.
 */
export type LiveAnswer = Extract<ReadAnswer, { readonly state: "pending" | "unreadable" }>;

/** What the chain shows of an instrument, by lcp's read: final or live, with lcp's answer, which names the transaction. */
export type ChainRead =
  | { readonly outcome: "final"; readonly answer: FinalAnswer }
  | { readonly outcome: "live"; readonly answer: LiveAnswer };

/** Whether lcp's answer is final for the instrument or leaves it live. */
export function outcomeOf(answer: ReadAnswer): ChainRead {
  return answer.state === "settled" || answer.state === "failed"
    ? { outcome: "final", answer }
    : { outcome: "live", answer };
}

/** What the record needs of a module, for every payment it claims. */
export interface RecordNeeds<P = X402Payment> {
  /**
   * The form's pure checks, which read neither the chain nor the clock, and the payment's instrument; or the refusal.
   * The record is read after this and before any check that reads the chain or the clock, a published class's among
   * them.
   */
  instrument(payment: P): Promise<Instrumented | Refused>;
  /**
   * lcp's read of the payment's instrument, by the pairing's search, at the pairing's final mark: what `/settle` answers
   * where a check or the node shows the single-use value used, and what a claim the record already holds reads before
   * anything is sent again. Called only for a payment `instrument` accepted. Its node calls end by `deadline`, a
   * `performance.now()` time. `search` is the search position an earlier live answer returned, which the read resumes
   * from. `from` is what `position` answered at the payment's claim, where the module gives `position` and the record
   * holds a claim; a read without it searches as the pairing does with no position given. `transaction` is the
   * transaction the record holds for the claim, the one the module's `settle` named (or the instrument's own id), where
   * it holds one, for a pairing whose read reads a transaction its caller names.
   */
  read(
    payment: P,
    at: { readonly deadline: number; readonly search?: unknown; readonly from?: unknown; readonly transaction?: string },
  ): Promise<ChainRead>;
  /**
   * Where a pairing's read searches from a position at issue that no x402 call carries (a ledger, a slot, a round): the
   * chain's position for the payment, read from the module's node just before the settler claims it, so that nothing
   * the settler submits can land before it. The core calls it once per claim, keeps what it answers in the row, and
   * gives it back to every later `read` of the payment as `from`. Its node calls end by `deadline`. A failure leaves the
   * row without one.
   */
  position?(payment: P, at: { readonly deadline: number }): Promise<unknown>;
}

/** What a fee budget needs of a module, for every payment it claims. */
export interface FeeNeeds<P = X402Payment> {
  /** Whether the module's key pays the network fee of what it would submit for the payment. */
  paysFee(payment: P): boolean;
  /**
   * Whether the payer broadcast the payment itself, so that the module reads it and sends nothing: such a payment is
   * never refused for a spent budget.
   */
  payerBroadcast(payment: P): boolean;
  /**
   * For a facilitator that sends inside its own `settle` and never calls `FeeMeter.sending`, as a published class does:
   * given the payment and the transaction the facilitator's `settle` named, the fee the chain shows the transaction
   * paid once it is included, or until then the most it can pay as its own fields bound it, in the smallest unit of the
   * network's fee asset. It may read the node; its calls end by `deadline`, a `performance.now()` time its own and
   * not the request's. The core asks it after each such `settle` whose payment `paysFee`, once the answer is stored,
   * and again once the record makes the payment final, and counts what it answers. Before such a `settle` the core
   * refuses the payment `fee_budget_spent` where the network's budget is spent. The core counts only the transactions
   * a `settle` names: one its facilitator sends without naming it (a published class's deployment of the payer's
   * wallet; a send whose wait for its receipt threw) the module counts through its `FeeMeter`, or names. An own module
   * that calls `FeeMeter` leaves it out. A network's fee budget is refused at the settler's start where a module with a
   * key on it neither gives this nor takes its network's meter at its start.
   */
  charged?(payment: P, sent: { readonly transaction: string; readonly deadline: number }): Promise<Charged>;
}

/** A transaction's fee as `FeeNeeds.charged` answers it. */
export interface Charged {
  /** In the smallest unit of the network's fee asset. */
  readonly fee: bigint;
  /** True where the chain shows the transaction included and `fee` is what it paid; false where `fee` is its bound. */
  readonly included: boolean;
}

/** One transaction a module is about to send whose fee its key pays. */
export interface Sending {
  readonly network: Network;
  /** Its id, where it is known before it is sent. */
  readonly transaction?: string;
  /** The most it can pay, as its own fields bound it, in the smallest unit of the network's fee asset. */
  readonly bound: bigint;
}

/** One transaction the module sent, once the chain shows it included. */
export interface Included {
  readonly network: Network;
  readonly transaction: string;
  /** The fee the chain shows it paid, in the smallest unit of the network's fee asset. */
  readonly fee: bigint;
}

/**
 * The core's count of the fees a module's key pays on a network, which a module whose key pays fees is given at its
 * start. The module calls `sending` just before it sends such a transaction, the first or the identical payment again,
 * and sends nothing where it resolves false, the network's budget being spent; and calls `included` once the chain shows
 * the transaction included. Until then the count holds the transaction's bound.
 */
export interface FeeMeter {
  sending(sending: Sending): Promise<boolean>;
  included(included: Included): void;
  /**
   * Counts a transaction the module's key sent without `sending` before it: one a published class sends inside its own
   * `settle` and does not name in its answer, as x402's EVM classes deploy a payer's ERC-6492 wallet before its payment.
   * `shown` reads what the chain shows of its fee, as `FeeNeeds.charged` answers it, or undefined where the node holds
   * no such transaction; the meter calls it only where the network has a budget, and counts what it answers whatever
   * the budget's state, the transaction being sent. Called again once the chain may show more, it counts again, a paid
   * fee never replaced by a bound.
   */
  sent(transaction: string, shown: () => Promise<Charged | undefined>): void;
}

/** A module: an x402 facilitator for one scheme on one network, and what the core needs with it. */
export interface Module<P = X402Payment> {
  readonly descriptor: Descriptor;
  /** The network, exactly one. */
  readonly network: Network;
  /**
   * The facilitator, whose `verify` and `settle` run unchanged: a published class, or the module's own. Its `getExtra`
   * gives the kind's own members, and its `getSigners` the address of a key that pays or co-signs a fee.
   */
  readonly facilitator: SchemeNetworkFacilitator;
  readonly record: RecordNeeds<P>;
  readonly fees: FeeNeeds<P>;
}

/**
 * How an own module claims a payment on the scheme and network of a published class: by a member of the option, where
 * the form is in the option; or by what the payment itself holds, where a payer variant shares its option with the
 * published form. A claim reads neither the chain nor the clock.
 */
export type Claim =
  | { readonly by: "option"; claims(requirements: PaymentRequirements): boolean }
  | { readonly by: "payment"; claims(payload: PaymentPayload, requirements: PaymentRequirements): boolean };

/** An own module that the wrapper hands the payments it claims, before the published class sees them. */
export interface Handoff {
  readonly claim: Claim;
  readonly module: Module;
}

/**
 * One registration with x402's facilitator class: one scheme, the facilitator's, on one network. `own` lists the own
 * modules on the same scheme and network, tried in order; a payment none of them claims goes to `module`.
 */
export interface Registration {
  readonly network: Network;
  readonly module: Module;
  readonly own: readonly Handoff[];
}

/**
 * Durable state a module keeps in the settler's database, under its own name: a pending settlement, an `upto`
 * channel, a scan position. Each value is JSON, a `bigint` within it kept as one. Every call is bounded as the
 * record's are, and a call that fails rejects.
 */
export interface ModuleState {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  /**
   * Writes `value` only where the stored value equals `expected` as JSON, `undefined` being no value stored; true where
   * this call wrote it. Two callers that swap from one value never both write.
   */
  swap(key: string, expected: unknown, value: unknown): Promise<boolean>;
  delete(key: string): Promise<void>;
  /** x402's `PendingSettlementStore` over this state, for a published class that takes one. */
  pendingSettlements(): PendingSettlementStore;
}

/** What the core gives a module at its start. */
export interface Core {
  /** The operator log: what an answer does not carry, one entry per event. */
  readonly log: OperatorLog;
  /** How long a `/settle` waits for the chain before it answers, in milliseconds. */
  readonly settleWaitMs: number;
  /** The module's durable state. */
  readonly state: ModuleState;
  /**
   * The fee meter of `network`, for an own module whose key pays fees there, taken at the module's start: the core
   * refuses a fee budget on a network where a module with a key neither took it nor gives `FeeNeeds.charged`.
   */
  meter(network: Network): FeeMeter;
}

/** An own module offered to the registration another module makes of a scheme on a network. */
export interface OfferedHandoff {
  readonly scheme: string;
  readonly network: Network;
  readonly handoff: Handoff;
}

/**
 * A module once started: its registrations, one per scheme and network; the own modules it offers to registrations
 * other modules make, which the core puts behind each such registration's own modules, in the order of the modules'
 * list, and refuses at start where no module registers that scheme and network; and what closes what it opened.
 */
export interface Started {
  readonly registrations: readonly Registration[];
  readonly handoffs?: readonly OfferedHandoff[];
  close?(): Promise<void>;
}

/**
 * How the core starts a module from configuration alone: the configuration's member named for the module is `C`, and
 * the module's keys reach it inside `C` as the signer objects its classes take. A module whose configuration names no
 * network is not started.
 */
export interface ModuleStarter<C> {
  readonly name: ModuleName;
  start(config: C, core: Core): Promise<Started>;
}
