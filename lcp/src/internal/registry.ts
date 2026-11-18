/**
 * The registry's types: a pairing's data, plain values under one interface, and its codec, typed per family by what
 * the payer presents, the reference a read takes, the reader the caller supplies, and one descriptor of the family's
 * other types.
 */
import type { AtrHash } from "./core.js";
import type { Refusal } from "../refusal.js";
import type { Broadcaster } from "./broadcaster.js";
import type { Act, RecoverInput } from "./read.js";

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

/** A decimal digit other than zero. */
type NonZeroDigit = "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";

/** Present where the pairing's payment can itself be an agreement. */
export interface AgreementData {
  /**
   * The smallest amount the scheme and token admit, in base units: `"0"`, or a decimal with no sign and no leading
   * zero; or `rule`, which `advertise` evaluates.
   */
  readonly floor: "0" | `${NonZeroDigit}${string}` | "rule";
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
 *
 * Every pairing's data also has `carrier` (`Carrier`), where H rides; `source`, who writes H: lcp's client, or a stock
 * client and release, with the member it copies H from; `nonce`, whether the identical instrument can land more than
 * once (`single-use`, `reusable`, or `unshown` until a vector or a run shows single use); `broadcasts`, the answers the
 * codec's `broadcaster` can give over every credential type the pairing takes; `confirmed`, whether something outside
 * lcp has shown the form as its profile defines it (`yes` or `no`); and `proves`, what the read establishes of a
 * payment through the pairing. Where a public ledger records the payment it has `read` (`ReadData`), what a read of
 * the pairing needs; and, where the pairing's entry states them, `destination`, `asset` and `payer`: how the account
 * the act names, the asset and the payer are identified in the landed transaction.
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
        /** Which agreement the charge can follow: any, one on the same network, or one x402 or MPP pairing's, by its id. */
        readonly agreementOn?: "any" | "same-network" | `x402/${string}` | `mpp/${string}`;
        readonly agreement?: never;
      }
  );

/**
 * A family's own types, as one descriptor: what `read` and `advertise` take and give, what `build` takes and gives,
 * the option a payment answers, and what `status` and `recover` take and answer.
 */
export interface Family {
  /** The advertised document `read` reads. */
  readonly doc: unknown;
  /** What `read` gives: the hash, the link, the agreement URL where the document carries one, and the offer. */
  readonly offered: unknown;
  /** What `advertise` places H in: the document, or nothing where H goes into values the seller places itself. */
  readonly placedIn: unknown;
  /** The offer `advertise` places H on: the x402 option, the MPP challenge, or the protocol's own option. */
  readonly offer: unknown;
  /** The arguments `advertise` takes after `offer`: on MPP the challenge's position, the act, then the agreement URL. */
  readonly rest: readonly unknown[];
  /** What `advertise` gives. */
  readonly advertised: unknown;
  /** The buyer's inputs `build` takes. */
  readonly choice: unknown;
  /** What `build` gives the payer to sign. */
  readonly unsigned: unknown;
  /** The x402 option or MPP challenge a payment answers, which `reference` and `recover` take. */
  readonly option: unknown;
  /**
   * The members of `status`'s reference that `reference` does not give, which the caller adds: the landed transaction,
   * and where the read takes them, H and the position its search starts from; `unknown` where there are none.
   */
  readonly landed: unknown;
  /** The network `recover` takes. */
  readonly network: unknown;
  /** What `status` takes beside the reference and the reader. */
  readonly query: unknown;
  /** What `status` answers. */
  readonly answer: unknown;
  /** The receipt `keySearch` reads; absent where the pairing has no `keySearch`. */
  readonly receipt?: unknown;
}

/** The types of `status` and `recover` of a pairing with no read, which has neither member. */
export interface NoRead {
  readonly landed: never;
  readonly network: never;
  readonly query: never;
  readonly answer: never;
}

/** What a channel's `kind` names a payment: its opening, a payment within it, or its close. */
export type ChannelKind = "open" | "within" | "close";

/**
 * A pairing's codec. `Presented` is what the payer presents, `Ref` the reference `reference` gives, `Reader` the
 * reader the caller supplies to `status`, `recover` and `fetchPresented`, and `F` the family's other types. A pairing
 * with no read has no `status` and no `recover`, and takes `never` for `Reader`, and for `Ref` where it has no
 * `reference`.
 *
 * `build`, `bound` and `reference` take the act, and `bound` and `reference` H with it, where the caller gives them;
 * absent means the act `payment`. On a pairing whose single-use value is H itself or H's low bits, the act `agreement`
 * makes each use the agreement's own value (`agreementValue`, or its low bits as the pairing takes H's) where the
 * payment uses H; on every other pairing the act changes nothing. `status` takes the act in its query.
 */
export interface Codec<Presented, Ref, Reader, F extends Family> {
  /**
   * The buyer's reading of the advertised document: H, the link, the agreement URL where the document carries one, and
   * the offer this pairing serves in it (on x402, an `X402Offer`: the document and the options the pairing serves).
   */
  readonly read: (doc: F["doc"]) => F["offered"] | Refusal;
  /**
   * The seller's placement: a copy of the document with H and the link placed for `offer` as this pairing places
   * them, and the agreement URL where one is given; the arguments after `offer` are the family's (`F["rest"]`).
   */
  readonly advertise: (
    doc: F["placedIn"],
    h: AtrHash,
    link: string,
    offer: F["offer"],
    ...rest: F["rest"]
  ) => F["advertised"] | Refusal;
  /** `advertise` without the checks on a carrier the seller writes after H. */
  readonly advertiseBeforeCarrier?: (
    doc: F["placedIn"],
    h: AtrHash,
    link: string,
    offer: F["offer"],
    ...rest: F["rest"]
  ) => F["advertised"] | Refusal;
  /**
   * What the payer signs, with H in place, or for the act `agreement` on a pairing whose agreement has its own value,
   * that value. Absent where lcp builds no payment for the pairing: the payer's own client builds it.
   */
  readonly build?: (choice: F["choice"], h: AtrHash, act?: Act) => Promise<F["unsigned"] | Refusal>;
  /**
   * H as what was presented carries it. Given the act `agreement` and H on a pairing whose agreement has its own value,
   * it checks that what was presented carries that value in H's place, and gives H where it does.
   */
  readonly bound: (presented: Presented, given?: { readonly act: Act; readonly h: AtrHash }) => Promise<AtrHash | Refusal>;
  /**
   * Who broadcasts what the payer presents: `"payer"` or `"payee"` (`Broadcaster`). A payment of a type or kind the
   * pairing does not take gets the refusal `bound` gives it.
   */
  readonly broadcaster: (presented: Presented) => Promise<Broadcaster | Refusal>;
  /**
   * The read keys of a presented payment, with the payee of the option it answers; given the act `agreement` and H on
   * a pairing whose agreement has its own value, the single-use value it names is that value.
   */
  readonly reference?: (
    presented: Presented,
    option: F["option"],
    given?: { readonly act: Act; readonly h: AtrHash },
  ) => Promise<Ref | Refusal>;
  /** The read of the act the query asks about, from the reference and what the landed transaction adds to it. */
  readonly status?: (ref: Ref & F["landed"], reader: Reader, query: F["query"]) => Promise<F["answer"]>;
  /**
   * The value a landed transaction carries in H's place, in H's spelling: H, or H's low bits as the pairing carries
   * them; and from an agreement's transaction on a pairing whose agreement has its own value, that value, which a
   * holder of the ATR compares with `agreementValue` of its own H, since a digest is not read back to H.
   */
  readonly recover?: (input: RecoverInput<F["network"], F["option"]>, reader: Reader) => Promise<AtrHash | Refusal>;
  /** For a channel, a session or a subscription. */
  readonly channel?: {
    /** Whether the presented payment opens the channel, pays within it, or closes it (`ChannelKind`). */
    readonly kind: (presented: Presented) => ChannelKind | Refusal;
    /** The network and channel the presented payment belongs to; a payment `kind` refuses gets `kind`'s refusal. */
    readonly ref: (presented: Presented) => Promise<{ network: string; channel: string } | Refusal>;
    /**
     * H as a payment within the channel carries it. A pairing whose payments within the channel carry no hash refuses
     * every one (on MPP, `mpp/not-bound-within`).
     */
    readonly boundWithin: (presented: Presented) => Promise<AtrHash | Refusal>;
    /** The time, in Unix seconds, after which the channel takes no payment, where the payment states one. */
    readonly until: (presented: Presented) => number | undefined;
  };
  /** For a form its payer broadcasts: the presented payment completed with the landed transaction it names. */
  readonly fetchPresented?: (presented: Presented, reader: Reader) => Promise<Presented | Refusal>;
  /** For a form its payer broadcasts: the transaction the presented payment names, or undefined. */
  readonly landedTx?: (presented: Presented) => string | undefined;
  /** The read keys of a transfer made under a key the payer authorised over H, from the receipt that registered it. */
  readonly keySearch?: (
    ref: Ref,
    receipt: F extends { readonly receipt: infer R } ? R : never,
    h: AtrHash,
  ) => Ref | Refusal;
  /** What the record proves for a transfer `keySearch` finds. */
  readonly keyProves?: string;
}

/** True where `T` is `never`. */
type IsNever<T> = [T] extends [never] ? true : false;

/**
 * The members a codec may not have where its entry takes `never`: none where `Presented` is `never`, since `bound`
 * takes what is presented; no member that takes the reader where `Reader` is; none that gives or takes the reference
 * where `Ref` is.
 */
type NoneWhereNever<Presented, Ref, Reader> = (IsNever<Presented> extends true ? never : unknown) &
  (IsNever<Reader> extends true
    ? { readonly status?: undefined; readonly recover?: undefined; readonly fetchPresented?: undefined }
    : unknown) &
  (IsNever<Ref> extends true ? { readonly reference?: undefined; readonly keySearch?: undefined } : unknown);

/**
 * A registry entry: its id, its data and its codec. It takes `never` for `Reader` only where the codec has no member
 * that takes a reader, for `Ref` only where it has no `reference`, and never for `Presented`.
 */
export type Entry<Id extends string, Presented, Ref, Reader, F extends Family> = Codec<Presented, Ref, Reader, F> &
  NoneWhereNever<Presented, Ref, Reader> & {
    readonly id: Id;
    readonly data: PairingData;
  };
