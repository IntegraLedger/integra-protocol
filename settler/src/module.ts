/**
 * What a module gives the settler's core, for one scheme on one network. A module is an x402 facilitator for that
 * scheme and network (`SchemeNetworkFacilitator` of `@x402/core`), either a class x402 publishes or the settler's own,
 * with three things beside it: a descriptor, which the kind's `extra` in `/supported` states; what the record needs to
 * key a payment, keep its row and tell a final answer from a live one; and what a fee budget needs to count the fees
 * the module's key pays.
 *
 * x402's facilitator class dispatches a payment to the first registration whose scheme matches and whose networks hold
 * the payment's network, and gives a registration of several networks of one namespace the pattern `<namespace>:*`, so
 * a registration names exactly one network, and an own module that settles a payer variant a published class refuses is
 * reached through that class's registration, by a claim, never by a second registration.
 */
import type { PairingData, PairingId, StatusAnswer } from "@integraledger/lcp";
import type { Network, PaymentPayload, PaymentRequirements, SchemeNetworkFacilitator } from "@x402/core/types";

/** The settler's modules, one per chain form, each loaded only where its network is configured. */
export type ModuleName =
  | "algorand"
  | "aptos"
  | "cardano"
  | "casper"
  | "concordium"
  | "erc7710"
  | "evm"
  | "evm-mpp"
  | "hedera"
  | "lnbtc"
  | "near"
  | "polkadot"
  | "solana"
  | "stacks"
  | "starknet"
  | "stellar"
  | "sui"
  | "tempo"
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

/** Members of a kind's `extra` that a module adds beside the settler's own, each a published scheme's member. */
export interface AddedExtra {
  /**
   * Sui, where the module sponsors gas: the endpoint of the gas station the module serves, which the option carries, so
   * that the buyer's client asks it to fill the transaction's gas data.
   */
  readonly gasStation?: string;
}

/**
 * What the kind states in `/supported`, beside the members its x402 facilitator's `getExtra` returns, which are kept
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
   * `extra.acceptsZero`: whether the module settles a payment of amount zero, as a seller choosing a zero agreement
   * needs to know. True only where every pairing in `pairings` takes zero.
   */
  readonly acceptsZero: boolean;
  /** Further members of `extra`, where the module adds any. */
  readonly added?: AddedExtra;
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
}

/** A payment the form's pure checks refuse, with x402's reason; nothing is read and nothing is recorded. */
export interface Refused {
  readonly refused: string;
}

/** An answer of lcp's read, as `status` answers it, its ledger position, marks and search position the pairing's own. */
export type ReadAnswer = StatusAnswer<unknown, unknown, unknown>;

/**
 * The answers after which the instrument can never land again: `settled`, a success; `failed`, with a failed result
 * that consumed the single-use value (`transaction-failed`), a value another act consumed (`instrument-consumed`), or a
 * validity that passed with the value unconsumed (`instrument-unused`). The settler gives lcp's read no position, so
 * `before-position` does not arise; were it given one, the act at or before it would have consumed the value.
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
   * from.
   */
  read(payment: P, at: { readonly deadline: number; readonly search?: unknown }): Promise<ChainRead>;
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
}

/** A module: an x402 facilitator for one scheme on one network, and what the core needs beside it. */
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
