/**
 * The registry's types: a pairing's data, plain values under one interface, and its codec, typed per family by what
 * the payer presents, the reference a read takes and the reader the caller supplies.
 */
import type { AtrHash } from "./core.js";
import type { Refusal } from "../refusal.js";
import type { Broadcaster } from "./broadcaster.js";

/**
 * `full`: the payer's own signed act, on a public ledger, binds all of H, a 256-bit digest over a preimage that holds H,
 * or on Starknet H's low 250 bits. `none`: no public payer-signed act carries H.
 */
export type Coverage = "full" | "none";

/** Where H rides. */
export interface Carrier {
  /** The field of what the payer signs that carries H, in the profile's words; null where none does. */
  readonly signed: string | null;
  /**
   * The member of the option or challenge request the seller writes H into, as a path from the option (x402) or from
   * the decoded request (MPP); absent where the seller writes it into none.
   */
  readonly member?: readonly string[];
}

/** The longest a signed payment can stay payable where the rail itself bounds it, with the chain rule it comes from. */
export interface Life {
  readonly value: number;
  readonly unit: string;
  readonly rule: string;
}

/** A kind of endpoint a read goes through, as the pairing's chain names it. */
export type EndpointKind =
  | "fullnode-http"
  | "fullnode-rest"
  | "graphql"
  | "grpc-v2"
  | "indexer-rest"
  | "json-rpc"
  | "mirror-rest"
  | "rest-api"
  | "rippled"
  | "stacks-api-rest"
  | "toncenter-v3";

/** What a read of the pairing needs. */
export interface ReadData {
  /** The endpoint kinds the read goes through, each of which a network declares for the read to be made there. */
  readonly endpoint: readonly EndpointKind[];
  /**
   * The kind of a declared archival endpoint the read goes on to where the endpoint does not hold the history or state
   * it needs; absent where the read has none.
   */
  readonly fallback?: EndpointKind;
  /** What the read asks of its endpoints beyond their kinds; absent where nothing. */
  readonly note?: string;
  /** The search key and its bound. */
  readonly search: string;
  /** The history the read needs; absent where the pairing's entry states none. */
  readonly history?: string;
  /** The contracts the read names. */
  readonly contracts: readonly string[];
  /** The signed fact after which the payment can no longer land; absent where the pairing's entry states none. */
  readonly lapse?: string;
  /** Absent where the rail sets no bound or the pairing's entry states none. */
  readonly life?: Life;
}

/** Present where the pairing's payment can itself be an agreement. */
export interface AgreementData {
  /** The smallest amount the scheme and token admit, in base units, or `rule`, which `advertise` evaluates. */
  readonly floor: `${bigint}` | "rule";
  /** Who can pay the fee, by the chain and the published scheme. */
  readonly fee: string;
  /** The fields that show the transaction succeeded. */
  readonly succeeded: string;
  /** Present where the form is offered as an agreement and never as a charge. */
  readonly only?: true;
}

/** The members of a pairing's data that do not turn on its coverage. */
interface DataMembers {
  readonly carrier: Carrier;
  /** Who writes H: lcp's client, or a stock client and release, with the member it copies H from. */
  readonly source: string;
  /** Whether the identical instrument can land more than once; `unshown` until a vector or a run shows single use. */
  readonly nonce: "single-use" | "reusable" | "unshown";
  /** The answers the codec's `broadcaster` can give over every credential type the pairing takes. */
  readonly broadcasts: Broadcaster | "either";
  /** Absent where no public ledger records the payment. */
  readonly read?: ReadData;
  /** How the account the act names is identified in the landed transaction. */
  readonly destination?: string;
  /** How the asset is identified in the landed transaction. */
  readonly asset?: string;
  /** How the payer is identified in the landed transaction. */
  readonly payer?: string;
  /** Whether something outside lcp has shown the form as its profile defines it. */
  readonly confirmed: "yes" | "no";
  /** What the read establishes of a payment through the pairing. */
  readonly proves: string;
}

/**
 * A pairing's data. At coverage `full` it has no `link` and no `agreementOn`; at coverage `none` it has a `link` and
 * no `agreement`, since only a payment that is itself a public proof of H can be an agreement.
 */
export type PairingData = DataMembers &
  (
    | {
        readonly coverage: "full";
        readonly link?: never;
        readonly agreementOn?: never;
        readonly agreement?: AgreementData;
      }
    | {
        readonly coverage: "none";
        /**
         * Whether the payment carries H (`h`), a pointer to its proof transaction (`pointer`), or neither (`none`), in a
         * field that is no public proof.
         */
        readonly link: "h" | "pointer" | "none";
        /** Which agreement the charge can follow: any, one on the same network, or one pairing's. */
        readonly agreementOn?: "any" | "same-network" | `${string}/${string}`;
        readonly agreement?: never;
      }
  );

/**
 * A pairing's codec. `Presented` is what the payer presents, `Ref` the reference `reference` gives and `status` takes,
 * and `Reader` the reader the caller supplies to `status` and `recover`. A pairing with no read takes `never` for
 * both.
 */
export interface Codec<Presented, Ref, Reader> {
  readonly read: (doc: never) => unknown;
  /** On MPP, the arguments after `offer` are the challenge's position and the agreement URL; elsewhere, the agreement URL. */
  readonly advertise: (doc: never, h: AtrHash, link: string, offer: never, ...rest: never[]) => unknown;
  readonly bound: (presented: Presented, ...rest: never[]) => Promise<AtrHash | Refusal> | AtrHash | Refusal;
  readonly broadcaster: (presented: Presented) => Promise<Broadcaster | Refusal>;
  /**
   * The read keys of a presented payment: the members of `Ref` that what was presented holds. The caller adds the
   * members only a landed transaction names before it calls `status`.
   */
  readonly reference?: (presented: Presented, ...rest: never[]) => Promise<Partial<Ref> | Refusal> | Partial<Ref> | Refusal;
  readonly status?: (ref: Ref, reader: Reader, ...rest: never[]) => Promise<unknown>;
  readonly recover?: (ref: never, reader: Reader, ...rest: never[]) => Promise<unknown>;
}

/** A registry entry: its id, its data and its codec. */
export type Entry<Id extends string, Presented, Ref, Reader> = Codec<Presented, Ref, Reader> & {
  readonly id: Id;
  readonly data: PairingData;
};
