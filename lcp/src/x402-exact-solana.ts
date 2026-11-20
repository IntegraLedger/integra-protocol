/**
 * The `x402/exact/solana` pairing: the ATR hash placed as the option's `extra.memo` in LCP string form, written by the
 * payer as the transaction's one Memo instruction, read back from the signed message, and read from the settlement.
 *
 * @module
 */
import { toLcpString, type AtrHash } from "./core.js";
import {
  COMPUTE_BUDGET,
  MEMO_V4,
  TOKEN_2022,
  buildTokenMessage,
  decodeSvmTx,
  isKey,
  keyBytes,
  isPayerInput,
  isSolanaNetwork,
  svmCarrier,
  staticNonce,
  versionNotAdmitted,
  svmOptionFilter,
  svmSigning,
  builtVersion,
  X402_V1,
  wireOf,
  type SolanaNetwork,
  type SvmPaymentPayload,
  type SvmTx,
} from "./internal/svm.js";
import {
  svmRecover,
  svmReference,
  svmStatus,
  type SvmQuery,
  type SvmReader,
  type SvmRef,
  type SvmStatus,
  x402SvmReference,
} from "./internal/svm-read.js";
import { transferHookAccounts } from "./internal/svm-transfer-hook.js";
import { isObject, normalHash } from "./fields.js";
import {
  acceptedBy,
  advertiseFor,
  chosen,
  filterOf,
  isAmount,
  isTimeoutSeconds,
  offeredAt,
  paymentWith,
  readFor,
  withExtra,
  withOption,
  withoutExtra,
  x402Broadcaster,
  type X402Read,
  type X402Forms,
} from "./internal/x402.js";
import { toBase64 } from "./rail-bytes.js";
import { carriesRefused, isRefusal, refusal, type Refusal } from "./refusal.js";
import {
  tie,
  type LcpPattern,
  type PaymentRequired,
  type PaymentRequirements,
} from "./x402.js";
import { SOLANA } from "./internal/data/solana.js";
import { x402Payee } from "./internal/payee.js";
import type { Entry } from "./internal/registry.js";
export type { Broadcaster } from "./internal/broadcaster.js";
export type { SvmPaymentPayload } from "./internal/svm.js";
export type { X402Read } from "./internal/x402.js";

const ID = "x402/exact/solana" as const;
/**
 * The compute unit limit `build` writes where it resolves a transfer hook and its caller names none: @x402/svm 2.31.0's
 * default maximum, `DEFAULT_MAX_COMPUTE_UNITS` (`dist/esm/chunk-DAIKIZVB.mjs:16`), which its facilitator admits, since
 * the hook program's own cost is its own and no rule states it.
 */
const HOOK_COMPUTE_UNITS = 400_000;
const MAX_MEMO = 256;
const U64_LIMIT = 1n << 64n;
const DECIMAL = /^[0-9]{1,20}$/;

/** What the payer signs, and how its signature completes the payment. */
export interface SvmUnsigned<P = SvmPaymentPayload> {
  request: { kind: "solana-message"; message: Uint8Array<ArrayBuffer> };
  /** A 64-byte Ed25519 signature by the payer. */
  complete(signature: Uint8Array): P | Refusal;
}

export interface SvmChoice {
  required: PaymentRequired;
  accepted: PaymentRequirements;
  payer: string;
  decimals: number;
  tokenProgram: string;
  recentBlockhash: string;
  computeUnitLimit?: number;
  computeUnitPrice?: bigint;
  /**
   * A reader of the option's network, through whose `account` `build` reads a Token-2022 mint at `confirmed` and, where
   * its `TransferHook` extension names a program, the accounts the transfer hook needs (the profile's rule 9). Absent,
   * `build` reads nothing and writes `TransferChecked` with its four accounts, which a mint whose hook names a program
   * does not take.
   */
  reader?: Pick<SvmReader, "network" | "account">;
}

function utf8Length(s: string): number {
  return new TextEncoder().encode(s).length;
}

/**
 * True for an option of this pairing: `exact` on a Solana network, with `asset`, `payTo` and `extra.feePayer` each the
 * base58 of a 32-byte key, and an `extra.memo`, when present, of at most 256 UTF-8 bytes.
 */
function isThis(option: PaymentRequirements): boolean {
  if (!isObject(option) || option.scheme !== "exact") return false;
  if (!isSolanaNetwork(option.network) || !isKey(option.asset) || !isKey(option.payTo)) return false;
  const extra: unknown = option.extra;
  if (!isObject(extra) || !isKey(extra["feePayer"])) return false;
  const memo = extra["memo"];
  return memo === undefined || (typeof memo === "string" && utf8Length(memo) <= MAX_MEMO);
}

/**
 * The pairing's option filter, which `advertise`, `read`, `build`, `bound` and `reference` apply: an option of this
 * pairing whose amount `build` can pay and whose timeout is a positive safe integer (`payable`), else
 * `x402/option-malformed`; then one that no Solana build honours (`unbuiltOption`: an `extra.transactionVersions` that
 * admits neither version, or an `extra.splits`) is refused.
 */
const filter = svmOptionFilter(filterOf(isThis, payable));

/**
 * True when the amount is `"0"` or a positive amount (`isAmount`), a u64 in decimal, and the timeout a positive safe
 * integer. A zero `TransferChecked` lands, and @x402/svm 2.31.0's exact facilitator compares the transfer's amount with
 * the option's by equality (`dist/esm/chunk-RCDWMK2L.mjs:1010-1011`, `amount !== BigInt(requirements.amount)`).
 */
function payable(o: PaymentRequirements): boolean {
  return (
    (o.amount === "0" || isAmount(o.amount)) &&
    DECIMAL.test(o.amount) &&
    BigInt(o.amount) < U64_LIMIT &&
    isTimeoutSeconds(o.maxTimeoutSeconds)
  );
}

/**
 * The option without `extra.memo`: the option as the seller issued it, before the carrier was placed. An option that
 * carries a `refused` member is `x402/option-malformed`; a value that is not an object comes back as it is.
 */
function unplaced(option: PaymentRequirements): PaymentRequirements | Refusal {
  if (isObject(option) && carriesRefused(option)) return refusal("x402/option-malformed");
  return withoutExtra(option, "memo");
}

/** The challenge's `extensions.legalContext` set, and the chosen option's `extra.memo` set to the hash's LCP string. */
function advertise(
  doc: PaymentRequired,
  h: AtrHash,
  link: string,
  offer: PaymentRequirements,
  agreementUrl?: string,
): PaymentRequired | Refusal {
  const placed = advertiseFor(filter)(doc, h, link, offer, agreementUrl);
  if (isRefusal(placed)) return placed;
  const memo = toLcpString(h);
  const current = offer.extra?.["memo"];
  if (current !== undefined && current !== memo) return refusal("svm/carrier-occupied");
  return withOption(placed, offeredAt(placed.accepts, offer), withExtra(offer, "memo", memo));
}

function read(doc: PaymentRequired): X402Read | Refusal {
  return readFor(filter)(doc);
}

/**
 * The message the payer signs for the chosen option, whose one memo is the option's `extra.memo`: version 1 where the
 * option's `extra.transactionVersions` holds 1, as @x402/svm 2.31.0's exact client writes it, else v0 (`builtVersion`).
 * H is checked first, then the form of the choice's payer, token program, decimals, blockhash and compute budget
 * (`isPayerInput`) and its reader, then its document and option, then the option's memo against H. With a reader,
 * a Token-2022 mint whose `TransferHook` extension names a program has its hook's accounts appended to
 * `TransferChecked` (`transferHookAccounts`), at a compute unit limit of 400,000 where the choice names none; a reader of
 * another network is `svm/wrong-reader`.
 */
async function build(c: SvmChoice, h: AtrHash): Promise<SvmUnsigned | Refusal> {
  if (normalHash(h) === null) return refusal("x402/payload-malformed");
  if (!isObject(c)) return refusal("x402/not-v2");
  if (!isPayerInput(c) || !Number.isInteger(c.decimals) || c.decimals < 0 || c.decimals > 255) {
    return refusal("svm/input-malformed");
  }
  if (c.reader !== undefined && (!isObject(c.reader) || typeof c.reader.account !== "function")) return refusal("svm/input-malformed");
  const ok = chosen(c.required, c.accepted, filter);
  if (ok !== true) return ok;
  const { accepted, required } = c;
  const version = builtVersion(accepted.extra);
  if (version === null) return refusal("x402/option-malformed");
  const memo = accepted.extra!["memo"];
  if (memo !== toLcpString(h)) return refusal("svm/carrier-mismatch");
  if (c.reader !== undefined && c.reader.network !== accepted.network) return refusal("svm/wrong-reader");
  const hook =
    c.reader === undefined || c.tokenProgram !== TOKEN_2022
      ? []
      : await transferHookAccounts(c.reader, { mint: accepted.asset, payer: c.payer, payTo: accepted.payTo, amount: BigInt(accepted.amount) });
  if (isRefusal(hook)) return hook;
  const message = await buildTokenMessage({
    feePayer: accepted.extra!["feePayer"] as string,
    payer: c.payer,
    mint: accepted.asset,
    tokenProgram: c.tokenProgram,
    decimals: c.decimals,
    payTo: accepted.payTo,
    amount: BigInt(accepted.amount),
    recentBlockhash: c.recentBlockhash,
    memo,
    computeUnitLimit: c.computeUnitLimit ?? (hook.length > 0 ? HOOK_COMPUTE_UNITS : 40_000),
    computeUnitPrice: c.computeUnitPrice ?? 1n,
    ...(version === 1 ? { v1: X402_V1 } : {}),
  }, hook);
  if (isRefusal(message)) return message;
  const signing = svmSigning(message, c.payer);
  return {
    request: signing.request,
    complete(signature: Uint8Array): SvmPaymentPayload | Refusal {
      const wire = signing.wire(signature);
      if (isRefusal(wire)) return wire;
      return paymentWith(required, accepted, { transaction: toBase64(wire) });
    },
  };
}

/** The payment's option and decoded transaction, or the refusal that names what is wrong. */
function presentedTx(presented: unknown) {
  if (!isObject(presented) || presented["x402Version"] !== 2) return refusal("x402/not-v2");
  const accepted = acceptedBy(presented["accepted"], filter);
  if (isRefusal(accepted)) return accepted;
  const payload = presented["payload"];
  if (!isObject(payload)) return refusal("x402/payload-malformed");
  const wire = wireOf(payload["transaction"]);
  if (isRefusal(wire)) return wire;
  const tx = decodeSvmTx(wire);
  if (isRefusal(tx)) return tx;
  return { accepted, tx };
}

/**
 * The hash in the one memo of the transaction the payer signed, which must equal the option's `extra.memo`. Neither
 * signature is verified here; the chain verifies every signer's signature over the message it executes.
 */
async function bound(presented: unknown): Promise<AtrHash | Refusal> {
  const p = presentedTx(presented);
  return isRefusal(p) ? p : boundOf(p.accepted, p.tx);
}

function boundOf(accepted: PaymentRequirements, tx: SvmTx): AtrHash | Refusal {
  const fromTable = staticNonce(tx);
  if (fromTable !== null) return fromTable;
  const version = versionNotAdmitted(accepted.extra, tx, "x402");
  if (version !== null) return version;
  const unadmitted = notAdmitted(tx);
  if (unadmitted !== null) return unadmitted;
  const carrier = svmCarrier(tx);
  if (isRefusal(carrier)) return carrier;
  if (carrier.memo !== accepted.extra?.["memo"]) return refusal("svm/carrier-mismatch");
  return carrier.h;
}

const MEMO_V4_KEY = keyBytes(MEMO_V4)!;
const COMPUTE_BUDGET_KEY = keyBytes(COMPUTE_BUDGET)!;

/**
 * `svm/instruction-not-admitted` where the transaction holds an instruction @x402/svm 2.31.0's exact facilitator does
 * not admit under any configuration, else null: a Memo v4 instruction, since every verify path of that facilitator, the
 * default instruction layout, an allow-listed one and a smart wallet's, requires exactly one Memo instruction of the
 * program `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`, equal to `extra.memo` (`dist/esm/chunk-RCDWMK2L.mjs:1018-1023`;
 * `chunk-7TSGYOB2.mjs:314-322`; `MEMO_PROGRAM_ADDRESS`, `chunk-DAIKIZVB.mjs:5`), and lcp's carrier admits one memo of
 * either program, so a Memo v4 instruction beside it is no payment that facilitator and lcp both take; and, in a
 * version-1 message, a Compute Budget instruction, which it refuses before any other check
 * (`chunk-RCDWMK2L.mjs:194-198`).
 */
function notAdmitted(tx: SvmTx): Refusal | null {
  const v1 = tx.message[0] === 0x81;
  for (const ix of tx.instructions) {
    const program = tx.keys[ix.program];
    if (program === undefined) continue;
    if (same(program, MEMO_V4_KEY) || (v1 && same(program, COMPUTE_BUDGET_KEY))) return refusal("svm/instruction-not-admitted");
  }
  return null;
}

function same(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/**
 * The read keys for finding this payment later: digest, fee payer, blockhash, and the transaction id once signed; and
 * the payee of `option`, the option the payment answers (`x402Payee`).
 */
async function reference(presented: unknown, option: PaymentRequirements): Promise<SvmRef | Refusal> {
  const p = presentedTx(presented);
  if (isRefusal(p)) return p;
  const h = boundOf(p.accepted, p.tx);
  if (typeof h !== "string") return h;
  return x402SvmReference(p.accepted, p.tx, h, option);
}

const pattern: LcpPattern = Object.freeze({
  pattern: "native-field",
  profile: ID,
  onChain: true,
  zeroPartyRecoverable: true,
  forwardIndexable: false,
});

/**
 * `x402/exact/solana`. The payee broadcasts (`broadcaster` answers `"payee"`): the seller's facilitator, the option's
 * `feePayer`, co-signs and sends the transaction the payer signed; `status` reads it.
 */
export const exactSvm = Object.freeze({
  id: ID,
  data: SOLANA[ID],
  pattern,
  claims: true as boolean,
  unplaced,
  tie,
  advertise,
  read,
  build,
  bound,
  broadcaster: x402Broadcaster("payee"),
  reference,
  status: svmStatus,
  recover: svmRecover,
}) satisfies Entry<
  typeof ID,
  SvmPaymentPayload,
  SvmRef,
  SvmReader,
  X402Forms & {
    choice: SvmChoice;
    unsigned: SvmUnsigned<SvmPaymentPayload>;
    landed: object;
    network: SolanaNetwork;
    query: SvmQuery;
    answer: SvmStatus;
  }
>;
