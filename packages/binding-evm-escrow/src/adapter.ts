/**
 * The Commerce Payments escrow WeldAdapter: the atrHash rides `PaymentInfo.salt`
 * (`salt = uint256(atrHash)`), proven on-chain. `recover`/`enumerate`
 * decode the cleartext `PaymentInfo` in `PaymentAuthorized`/`PaymentCharged` event data (the WLD-3
 * event-data scan — `paymentInfoHash` is the indexed topic, `salt` is not). viem lives here.
 */
import type {
  LifecycleTransition,
  Outcome,
  SettlementRef,
  VerifierPorts,
  WeldAdapter,
} from "@integraledger/lcp-binding-core";
import { refOf } from "@integraledger/lcp-binding-evm-common";
import { canonicalAtrHash } from "@integraledger/lcp-kernel";
import { type Abi, decodeEventLog, type Log, parseAbi } from "viem";
import { requireEscrowAddress } from "./collectors.js";
import { type EscrowEventName, EVENT_TO_STATE } from "./lifecycle.js";
import { ESCROW_MANIFEST } from "./manifest.js";

const PI_TUPLE =
  "(address operator, address payer, address receiver, address token, uint120 maxAmount, uint48 preApprovalExpiry, uint48 authorizationExpiry, uint48 refundExpiry, uint16 minFeeBps, uint16 maxFeeBps, address feeReceiver, uint256 salt)";

/** The six escrow lifecycle events. `PaymentAuthorized`/`PaymentCharged` carry the cleartext `PaymentInfo`
 *  (→ salt → atrHash); the rest join on the indexed `paymentInfoHash`. NOT the whole of what the contract
 *  emits — see {@link ESCROW_ANCILLARY_EVENTS_ABI}. */
export const ESCROW_EVENTS_ABI: Abi = parseAbi([
  `event PaymentAuthorized(bytes32 indexed paymentInfoHash, ${PI_TUPLE} paymentInfo, uint256 amount, address tokenCollector)`,
  `event PaymentCharged(bytes32 indexed paymentInfoHash, ${PI_TUPLE} paymentInfo, uint256 amount, address tokenCollector, uint16 feeBps, address feeReceiver)`,
  "event PaymentCaptured(bytes32 indexed paymentInfoHash, uint256 amount, uint16 feeBps, address feeReceiver)",
  "event PaymentVoided(bytes32 indexed paymentInfoHash, uint256 amount)",
  "event PaymentReclaimed(bytes32 indexed paymentInfoHash, uint256 amount)",
  "event PaymentRefunded(bytes32 indexed paymentInfoHash, uint256 amount, address tokenCollector)",
]);

/**
 * The one event `AuthCaptureEscrow` emits that is NOT a payment lifecycle event, and it is here so that
 * "this package could not read the log" means something.
 *
 * ⛔⛔ **A SEVENTH EVENT EXISTS AND THIS PACKAGE HAD NEVER MODELLED IT.** `AuthCaptureEscrow` at the pinned
 * deployment (base/commerce-payments @ 98b592b, read from the source) declares
 * `TokenStoreCreated(address indexed operator, address tokenStore)` and emits it from `_sendTokens`, which
 * runs on the capture, charge, void, reclaim and refund paths — so it lands in the SAME transaction as a
 * lifecycle event, the first time a given operator's `TokenStore` is deployed. Every real first capture on
 * a new operator carries one.
 *
 * ⭐ That is why the drift guard below could not simply refuse any escrow log it failed to decode: on this
 * contract, an undecodable log is `TokenStoreCreated` far more often than it is drift, and refusing it
 * would turn every operator's first capture into a verification failure. Knowing the full emitted set is
 * what makes the residue — a log the escrow emitted that NEITHER abi decodes — mean the ABI has drifted
 * from the deployment, which is the only reading the guard acts on.
 *
 * It yields no {@link DecodedEscrowLog}: no payment state changes, there is no `paymentInfoHash` to join
 * on, and reporting it as a transition would invent one.
 */
const ESCROW_ANCILLARY_EVENTS_ABI: Abi = parseAbi([
  "event TokenStoreCreated(address indexed operator, address tokenStore)",
]);

/** Everything the deployed escrow emits, in one ABI — the six lifecycle events plus the ancillary one. A
 *  log this cannot decode is the drift signal {@link EscrowLogScan.unreadable} carries. */
const KNOWN_ESCROW_EVENTS_ABI: Abi = [
  ...ESCROW_EVENTS_ABI,
  ...ESCROW_ANCILLARY_EVENTS_ABI,
];

/** `AuthCaptureEscrow.PaymentInfo` — the pre-settlement artifact. `salt` carries the atrHash. */
export interface PaymentInfo {
  operator: `0x${string}`;
  payer: `0x${string}`;
  receiver: `0x${string}`;
  token: `0x${string}`;
  maxAmount: bigint;
  preApprovalExpiry: number;
  authorizationExpiry: number;
  refundExpiry: number;
  minFeeBps: number;
  maxFeeBps: number;
  feeReceiver: `0x${string}`;
  salt: bigint;
}

/**
 * `salt = uint256(atrHash)` — the 32-byte atrHash reinterpreted as a uint256.
 *
 * ⛔ **VALIDATED, because `BigInt` is not a validation.** This was a bare `BigInt(atrHash)` on the
 * strength of a comment saying a malformed value would be "surfaced by BigInt() (fail-fast)". `BigInt`
 * accepts any parseable numeral — a decimal string, a binary or octal literal, a whitespace-padded value,
 * a hash of the wrong length — so it fails fast on almost nothing, and this was the only EVM rail with no
 * atrHash check anywhere in it.
 *
 * The harm is a SILENT ROUND TRIP rather than a crash. A 31-byte value welds and comes back out of
 * {@link atrHashFromSalt} zero-extended — a DIFFERENT hash — so a verifier reports a mismatch against a
 * settlement that welded exactly what it was handed. `"12345"` welds as `0x…3039`.
 *
 * THROWS rather than refusing, which is {@link canonicalAtrHash}'s contract for an emit path and what the
 * original comment meant to arrange: writing a canonical form of a non-hash puts a fabricated reference
 * on a wire. Uppercase hex DIGITS are accepted and lowercased — the ATR canon is case-insensitive on the
 * digits, so a counterparty spelling its own hash that way is conformant.
 */
export function saltFromAtrHash(atrHash: `0x${string}`): bigint {
  return BigInt(canonicalAtrHash(atrHash, "saltFromAtrHash"));
}
/**
 * Recover the atrHash from a `PaymentInfo.salt` — the reverse (lowercase 0x, 32 bytes).
 *
 * ⛔ The range is asserted for the same reason the forward direction validates: `padStart` pads and never
 * truncates, so a salt outside `[0, 2^256)` returns a string LONGER than a bytes32, which then compares
 * unequal to every real atrHash instead of being refused. Unreachable through the adapter — viem decodes
 * `salt` as a uint256 — and reachable by any caller of this export.
 */
export function atrHashFromSalt(salt: bigint): `0x${string}` {
  if (salt < 0n || salt >= 1n << 256n)
    throw new Error(
      `atrHashFromSalt: salt must fit a uint256, got ${salt.toString()}`,
    );
  return `0x${salt.toString(16).padStart(64, "0")}`;
}

/** The per-payment proposal inputs (everything but `salt`, which the adapter fills from the atrHash). */
export type EscrowProposalContext = Omit<PaymentInfo, "salt">;
/** What `propose` returns: the `PaymentInfo` to submit, with `salt` already set from the atrHash. A
 *  single-field object rather than a bare `PaymentInfo` so the return can gain siblings without breaking
 *  callers. This package proposes and reads — it never operates the escrow. */
export interface EscrowProposal {
  paymentInfo: PaymentInfo;
}

/** How to point the adapter at a deployment. `chainId` and `escrow` are required; `fromBlock` defaults to
 *  the full history. Widen `fromBlock` knowingly: enumeration from `earliest` is a full-history scan on a
 *  busy chain. */
export interface EscrowAdapterConfig {
  chainId: number;
  /** The `AuthCaptureEscrow` address. REQUIRED — see {@link requireEscrowAddress} for what a default did.
   *  On Base Mainnet and Base Sepolia that is `AUTH_CAPTURE_ESCROW`, which this package exports. */
  escrow: `0x${string}`;
  /**
   * Enumeration lower bound; defaults to the full history (`earliest`).
   *
   * ⭐ **THIS RAIL'S SCAN BOUND IS A BLOCK WINDOW, AND IT CANNOT TRUNCATE IN SILENCE.** `enumerate` takes
   * no `limit`: the bound is `[fromBlock, latest]`, stated here by the caller, and `eth_getLogs` answers a
   * range it will not serve with an ERROR (a result cap, a block-span cap) rather than a short list. So
   * "the caller asked for everything" means the full history and the node says so when it will not serve
   * it — the opposite of a rail whose server quietly applies a default page size. Widen knowingly all the
   * same: from `earliest` this is a full-history scan on a busy chain.
   */
  fromBlock?: bigint;
}

/**
 * One decoded escrow lifecycle event, INCLUDING the asset the payment moved.
 *
 * The asset fields are carried rather than dropped, and that is what makes `assetBinding: "carried"` a
 * true claim: the axis asks whether a CONSUMER can reach the asset the weld is attached to, not merely
 * whether the chain recorded it. Decoding `salt` and `amount` while discarding the rest of `PaymentInfo`
 * would leave the manifest declaring an asset binding nobody could check.
 */
export interface DecodedEscrowLog {
  name: EscrowEventName;
  /**
   * ⭐⭐ **THE JOIN KEY — the indexed topic on ALL SIX events, and the only thing tying a salt-less one to
   * the payment it belongs to.**
   *
   * Four of the six events carry no cleartext `PaymentInfo`, so {@link WeldAdapter.recover} can never
   * answer for them: a `PaymentCaptured` cannot re-prove its own atrHash. What it carries is this hash,
   * indexed, and `conditional-weld`'s durable log is keyed by exactly it — *"the atrHash has to be
   * recoverable from the authorization artifact AND the capture artifact, joining on the rail's own key
   * (`paymentInfoHash` on Base)"*. A consumer that cannot read this key off the chain has to take a
   * caller's word for which payment a transition belongs to, which is not a join.
   *
   * ⚠️ It was decoded and then not read: `decodeEventLog` returns it as an indexed parameter, and the
   * `args` cast below picked out `paymentInfo` and `amount` only.
   */
  paymentInfoHash: `0x${string}`;
  /** The atrHash weld, as the raw `PaymentInfo.salt` uint256. Absent on events carrying no `PaymentInfo`. */
  salt?: bigint;
  amount: bigint;
  /** ERC-20 the payment moved. Absent on events carrying no `PaymentInfo`. */
  token?: `0x${string}`;
  /** The paying account. Absent on events carrying no `PaymentInfo`. */
  payer?: `0x${string}`;
  /** The receiving account. Absent on events carrying no `PaymentInfo`. */
  receiver?: `0x${string}`;
  logIndex: number | null;
  txHash: `0x${string}` | null;
}

/**
 * One reading of a settlement's logs: the lifecycle events, and the escrow-emitted logs no ABI here could
 * read. Both halves travel together because the empty half is only interpretable in the light of the other.
 *
 * ⛔⛔ **THE `catch {}` SAT AFTER THE ADDRESS FILTER, SO DRIFT READ AS "NO LIFECYCLE".** Every log reaching
 * that catch had already been narrowed to ones the escrow ITSELF emitted, and swallowing those is not the
 * same act as skipping a foreign contract's log. If the deployed contract ever changes an event's
 * non-indexed layout — or its signature, which moves `topics[0]` and makes our ABI match nothing at all —
 * every log of a real settlement lands in the catch and `observe` answers `{ok: true, value: []}`: a
 * confident "this transaction settled nothing" about a transaction that settled. The ABI in this file is
 * transcribed from a PINNED deployment and its own module docblock records that reading HEAD instead once
 * shipped a bug, so drift is the failure this package has already had.
 *
 * Both sibling EVM adapters carry the same shape: `binding-evm-x402` refuses `not-eip3009-settlement` and
 * `binding-evm-mpp` refuses `not-authorization-credential-type` when their event set is empty and the logs
 * say something happened anyway. This is that guard, with the escrow's own unreadable log as the evidence.
 */
export interface EscrowLogScan {
  /** The lifecycle events, in log order. */
  readonly events: DecodedEscrowLog[];
  /** Logs the ESCROW emitted that neither {@link ESCROW_EVENTS_ABI} nor {@link ESCROW_ANCILLARY_EVENTS_ABI}
   *  could decode. Non-empty means this package and the deployment disagree about what the contract emits;
   *  a log from any other address never reaches here. */
  readonly unreadable: readonly Log[];
}

/** Decode one log against everything the escrow is known to emit, or `undefined` when none of it fits.
 *  `undefined` is not "not ours" — the caller has already established the escrow emitted this log. */
function decodeKnownEscrowEvent(log: Log) {
  try {
    return decodeEventLog({
      abi: KNOWN_ESCROW_EVENTS_ABI,
      data: log.data,
      topics: log.topics,
    });
  } catch {
    return undefined;
  }
}

/**
 * Decode a log set into an {@link EscrowLogScan} — the escrow's lifecycle events, plus what it emitted that
 * this package could not read. Logs from any other address are skipped and counted as neither.
 *
 * Exported because it is the only way a consumer reaches the asset behind the weld: `observe` returns
 * `LifecycleTransition[]`, a shape fixed by `binding-core` that has no room for `token`/`payer`/`receiver`.
 * A caller checking that a settlement moved the asset its record names calls this directly.
 *
 * It returns the scan rather than a bare array so that the unreadable half cannot be dropped by omission:
 * a caller that wants the events has to take delivery of the evidence that the list may be short.
 */
export function decodeEscrowLogs(
  logs: readonly Log[],
  escrow: string,
): EscrowLogScan {
  const want = requireEscrowAddress(escrow, "decodeEscrowLogs").toLowerCase();
  const events: DecodedEscrowLog[] = [];
  const unreadable: Log[] = [];
  for (const log of logs) {
    if (log.address.toLowerCase() !== want) continue;
    const decoded = decodeKnownEscrowEvent(log);
    if (decoded === undefined) {
      // The ESCROW emitted this and no ABI here reads it. Not skipped — carried, so a surface that would
      // otherwise answer "nothing here" can say what it could not read instead.
      unreadable.push(log);
      continue;
    }
    // Known, and deliberately not a transition — see ESCROW_ANCILLARY_EVENTS_ABI.
    if (decoded.eventName === "TokenStoreCreated") continue;
    const args = decoded.args as unknown as {
      /** Indexed on every one of the six events — see {@link DecodedEscrowLog.paymentInfoHash}. */
      paymentInfoHash: `0x${string}`;
      paymentInfo?: {
        salt: bigint;
        token: `0x${string}`;
        payer: `0x${string}`;
        receiver: `0x${string}`;
      };
      amount: bigint;
    };
    events.push({
      name: decoded.eventName as unknown as EscrowEventName,
      paymentInfoHash: args.paymentInfoHash,
      ...(args.paymentInfo !== undefined
        ? {
            salt: args.paymentInfo.salt,
            token: args.paymentInfo.token,
            payer: args.paymentInfo.payer,
            receiver: args.paymentInfo.receiver,
          }
        : {}),
      amount: args.amount,
      logIndex: log.logIndex,
      txHash: log.transactionHash,
    });
  }
  return { events, unreadable };
}

/** The refusal a surface returns when its own reading came back empty and the escrow emitted a log this
 *  package could not decode. One place, because `recover` and `observe` must not disagree about what an
 *  unreadable escrow log means. */
function unreadableEventRefusal(
  scan: EscrowLogScan,
  ref: SettlementRef,
): Outcome<never> | null {
  if (scan.unreadable.length === 0) return null;
  return {
    refused: true,
    haltClass: "verification-failure",
    code: "escrow/unreadable-event",
    detail: `settlement ${ref.txHash} carries ${scan.unreadable.length} log(s) that the escrow emitted and this package could not decode as any event it knows the escrow to have — and nothing it could decode. Reporting "no lifecycle" would assert this transaction settled nothing, which the escrow's own logs contradict. The ABI here is transcribed from base/commerce-payments @ 98b592b; drifting from the deployment is what this looks like`,
  };
}

/** Construct the escrow WeldAdapter for one chain. */
export function createEscrowAdapter(config: EscrowAdapterConfig): WeldAdapter {
  // At CONSTRUCTION, not at the first read: an unusable escrow address is a wiring defect that exists
  // before any chain is touched, and every surface below derives its whole answer from it.
  const escrow = requireEscrowAddress(config.escrow, "createEscrowAdapter");
  return {
    manifest: ESCROW_MANIFEST,

    async propose(
      atrHash: `0x${string}`,
      ctx: unknown,
    ): Promise<Outcome<EscrowProposal>> {
      const c = ctx as EscrowProposalContext;
      // The salt is filled from the atrHash — never re-derived. No value-level Refusal on this path; a
      // malformed atrHash is a programming error and `saltFromAtrHash` throws on one. It used to say
      // "surfaced by BigInt()", which surfaced almost nothing — see that function.
      const paymentInfo: PaymentInfo = { ...c, salt: saltFromAtrHash(atrHash) };
      return { ok: true, value: { paymentInfo } };
    },

    async recover(
      ref: SettlementRef,
      ports: VerifierPorts,
    ): Promise<Outcome<`0x${string}`>> {
      const logs = (await ports.chain.getTransactionLogs(ref)) as Log[];
      // Only PaymentAuthorized/PaymentCharged carry the cleartext PaymentInfo (→ salt → atrHash).
      const scan = decodeEscrowLogs(logs, escrow);
      const salted = scan.events.filter(
        (e): e is typeof e & { salt: bigint } => e.salt !== undefined,
      );
      if (salted.length === 0) {
        // Unreadable BEFORE absent: "no salt-bearing event" is a claim about what the escrow emitted, and
        // a log we could not decode is exactly the case where we do not know what it emitted.
        const unreadable = unreadableEventRefusal(scan, ref);
        if (unreadable !== null) return unreadable;
        return {
          refused: true,
          haltClass: "verification-failure",
          code: "escrow/no-recoverable-event",
          detail: `no PaymentAuthorized/PaymentCharged with a cleartext PaymentInfo in this settlement`,
        };
      }
      // Disambiguate by logIndex when the ref pins one — and a pinned index matching NO salt-bearing event
      // is a failure, never a fall-through to the first. One escrow transaction can authorize or charge
      // several independent payments, each with its own salt.
      if (ref.logIndex !== undefined) {
        const match = salted.find((e) => e.logIndex === ref.logIndex);
        if (match === undefined)
          return {
            refused: true,
            haltClass: "verification-failure",
            code: "escrow/log-index-not-found",
            detail: `no salt-bearing escrow event at logIndex ${ref.logIndex} in settlement ${ref.txHash}`,
          };
        return { ok: true, value: atrHashFromSalt(match.salt) };
      }
      // Unpinned. This used to take the FIRST salt-bearing event, which silently answered one payment's
      // atrHash for a transaction that welded several — the same first-wins defect x402's `recover` carried,
      // and the one tempo-mpp refuses by name. Distinctness is the test: the same payment observed through
      // both PaymentAuthorized and PaymentCharged carries one salt and is not ambiguous.
      const distinct = new Set(salted.map((e) => e.salt));
      if (distinct.size > 1)
        return {
          refused: true,
          haltClass: "verification-failure",
          code: "escrow/ambiguous-settlement",
          detail: `settlement ${ref.txHash} carries ${distinct.size} payments with different salts — pin one with ref.logIndex rather than choosing for the caller`,
        };
      return {
        ok: true,
        value: atrHashFromSalt((salted[0] as (typeof salted)[number]).salt),
      };
    },

    async observe(
      ref: SettlementRef,
      ports: VerifierPorts,
    ): Promise<Outcome<LifecycleTransition[]>> {
      const logs = (await ports.chain.getTransactionLogs(ref)) as Log[];
      const scan = decodeEscrowLogs(logs, escrow);
      if (scan.events.length === 0) {
        // An empty transition list is a POSITIVE claim: this transaction moved no payment through this
        // escrow. It is true only when the escrow said nothing we failed to read.
        const unreadable = unreadableEventRefusal(scan, ref);
        if (unreadable !== null) return unreadable;
        return { ok: true, value: [] };
      }
      const at = await ports.chain.blockTime(ref);
      return {
        ok: true,
        value: scan.events.map((e) => ({
          state: EVENT_TO_STATE[e.name],
          at,
          ref: refOf(ref.chainId, ref.txHash, e.logIndex),
        })),
      };
    },

    async enumerate(
      atrHash: `0x${string}`,
      ports: VerifierPorts,
    ): Promise<SettlementRef[]> {
      // Event-data scan (salt is NOT an indexed topic): fetch the salt-bearing events over the range and
      // filter by decoded salt == uint256(atrHash). paymentInfoHash is the only indexed key, so there is
      // no topic filter for salt — this is the manifest's declared "event-data-scan:paymentInfoHash".
      const want = saltFromAtrHash(atrHash);
      const logs = (await ports.chain.getLogs({
        address: escrow,
        events: [ESCROW_EVENTS_ABI[0], ESCROW_EVENTS_ABI[1]], // PaymentAuthorized, PaymentCharged
        fromBlock: config.fromBlock ?? "earliest",
        toBlock: "latest",
      })) as Log[];
      const scan = decodeEscrowLogs(logs, escrow);
      // THROWS rather than answering short, and this surface is the reason the scan carries the half it
      // cannot read. `enumerate` returns a bare array — it has no Refusal channel — so a dropped log here
      // becomes a settlement missing from the answer, indistinguishable from one that never happened. The
      // query above names the two salt-bearing events by ABI, and `TokenStoreCreated` is known and skipped,
      // so a log that comes back and decodes as neither is this package disagreeing with the deployment.
      if (scan.unreadable.length > 0)
        throw new Error(
          `enumerate: ${scan.unreadable.length} log(s) from escrow ${escrow} in this range decode as none of its known events — the event ABI here (base/commerce-payments @ 98b592b) has drifted from the deployment, and continuing would return an enumeration that is short by an unknown amount`,
        );
      return scan.events
        .filter((e) => e.salt === want)
        .map((e) => refOf(config.chainId, e.txHash ?? undefined, e.logIndex));
    },
  };
}
