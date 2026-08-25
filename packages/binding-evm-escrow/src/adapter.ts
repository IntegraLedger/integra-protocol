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
import { type Abi, decodeEventLog, type Log, parseAbi } from "viem";
import { AUTH_CAPTURE_ESCROW } from "./collectors.js";
import { type EscrowEventName, EVENT_TO_STATE } from "./lifecycle.js";
import { ESCROW_MANIFEST } from "./manifest.js";

const PI_TUPLE =
  "(address operator, address payer, address receiver, address token, uint120 maxAmount, uint48 preApprovalExpiry, uint48 authorizationExpiry, uint48 refundExpiry, uint16 minFeeBps, uint16 maxFeeBps, address feeReceiver, uint256 salt)";

/** The six escrow lifecycle events. `PaymentAuthorized`/`PaymentCharged` carry the cleartext `PaymentInfo`
 *  (→ salt → atrHash); the rest join on the indexed `paymentInfoHash`. */
export const ESCROW_EVENTS_ABI: Abi = parseAbi([
  `event PaymentAuthorized(bytes32 indexed paymentInfoHash, ${PI_TUPLE} paymentInfo, uint256 amount, address tokenCollector)`,
  `event PaymentCharged(bytes32 indexed paymentInfoHash, ${PI_TUPLE} paymentInfo, uint256 amount, address tokenCollector, uint16 feeBps, address feeReceiver)`,
  "event PaymentCaptured(bytes32 indexed paymentInfoHash, uint256 amount, uint16 feeBps, address feeReceiver)",
  "event PaymentVoided(bytes32 indexed paymentInfoHash, uint256 amount)",
  "event PaymentReclaimed(bytes32 indexed paymentInfoHash, uint256 amount)",
  "event PaymentRefunded(bytes32 indexed paymentInfoHash, uint256 amount, address tokenCollector)",
]);

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

/** `salt = uint256(atrHash)` — the 32-byte atrHash reinterpreted as a uint256. */
export function saltFromAtrHash(atrHash: `0x${string}`): bigint {
  return BigInt(atrHash);
}
/** Recover the atrHash from a `PaymentInfo.salt` — the reverse (lowercase 0x, 32 bytes). */
export function atrHashFromSalt(salt: bigint): `0x${string}` {
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

/** How to point the adapter at a deployment. `chainId` is required; the other two default — `escrow` to
 *  the canonical deterministic `AuthCaptureEscrow`, `fromBlock` to the full history. Widen `fromBlock`
 *  knowingly: enumeration from `earliest` is a full-history scan on a busy chain. */
export interface EscrowAdapterConfig {
  chainId: number;
  /** The `AuthCaptureEscrow` address; defaults to the canonical deterministic deployment. */
  escrow?: `0x${string}`;
  /** Enumeration lower bound; defaults to the full history (`earliest`). */
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
 * Decode every escrow lifecycle event in a log set (ignoring anything that is not one).
 *
 * Exported because it is the only way a consumer reaches the asset behind the weld: `observe` returns
 * `LifecycleTransition[]`, a shape fixed by `binding-core` that has no room for `token`/`payer`/`receiver`.
 * A caller checking that a settlement moved the asset its record names calls this directly.
 */
export function decodeEscrowLogs(
  logs: readonly Log[],
  escrow: string,
): DecodedEscrowLog[] {
  const want = escrow.toLowerCase();
  const out: DecodedEscrowLog[] = [];
  for (const log of logs) {
    if (log.address.toLowerCase() !== want) continue;
    try {
      const decoded = decodeEventLog({
        abi: ESCROW_EVENTS_ABI,
        data: log.data,
        topics: log.topics,
      });
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
      out.push({
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
    } catch {
      // not an escrow lifecycle event — ignore
    }
  }
  return out;
}

/** Construct the escrow WeldAdapter for one chain. */
export function createEscrowAdapter(config: EscrowAdapterConfig): WeldAdapter {
  const escrow = config.escrow ?? AUTH_CAPTURE_ESCROW;
  return {
    manifest: ESCROW_MANIFEST,

    async propose(
      atrHash: `0x${string}`,
      ctx: unknown,
    ): Promise<Outcome<EscrowProposal>> {
      const c = ctx as EscrowProposalContext;
      // The salt is filled from the atrHash — never re-derived. No value-level Refusal
      // on this path; a malformed atrHash is a programming error surfaced by BigInt() (fail-fast).
      const paymentInfo: PaymentInfo = { ...c, salt: saltFromAtrHash(atrHash) };
      return { ok: true, value: { paymentInfo } };
    },

    async recover(
      ref: SettlementRef,
      ports: VerifierPorts,
    ): Promise<Outcome<`0x${string}`>> {
      const logs = (await ports.chain.getTransactionLogs(ref)) as Log[];
      // Only PaymentAuthorized/PaymentCharged carry the cleartext PaymentInfo (→ salt → atrHash).
      const salted = decodeEscrowLogs(logs, escrow).filter(
        (e): e is typeof e & { salt: bigint } => e.salt !== undefined,
      );
      if (salted.length === 0)
        return {
          refused: true,
          haltClass: "verification-failure",
          code: "escrow/no-recoverable-event",
          detail: `no PaymentAuthorized/PaymentCharged with a cleartext PaymentInfo in this settlement`,
        };
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
      const events = decodeEscrowLogs(logs, escrow);
      if (events.length === 0) return { ok: true, value: [] };
      const at = await ports.chain.blockTime(ref);
      return {
        ok: true,
        value: events.map((e) => ({
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
      return decodeEscrowLogs(logs, escrow)
        .filter((e) => e.salt === want)
        .map((e) => refOf(config.chainId, e.txHash ?? undefined, e.logIndex));
    },
  };
}
