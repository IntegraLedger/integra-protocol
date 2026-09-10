/**
 * The Hedera transaction-memo adapter — thin I/O over an INJECTED reader port, PURE (no @hashgraph/sdk in
 * the runtime graph; the SDK is a devDependency reachable only from the opt-in integration test). It
 * intentionally does NOT implement binding-core's `WeldAdapter`: that port is EVM-shaped (`SettlementRef`
 * carries a `0x`-hex `txHash`, `ChainReader` speaks `eth_getLogs`), and Hedera speaks `0.0.NNN@sec.nanos`
 * transaction ids + a Mirror Node REST surface. Rather than lie through those types, this exposes a
 * Hedera-native surface (a transaction-id ref, a `HederaReader` port) alongside the shared, chain-agnostic
 * `BindingManifest`. Unifying the port shape across EVM and non-EVM rails is future work; forcing it here
 * would misrepresent the rail.
 *
 * `propose` returns the `transactionMemo` string the buyer sets on their HTS `TransferTransaction`;
 * `recover` reads the atrHash back from a settled transaction's memo; `observe` reports the settled
 * transition; `enumerate` is the best-effort account scan the manifest declares (`forwardIndexable: false`).
 */
import type { BindingManifest, Outcome } from "@integraledger/lcp-binding-core";
import { atrHashEquals, isAtrHash } from "@integraledger/lcp-kernel";
import { decodeMemoAtrHash, encodeMemoAtrHash } from "./memo.js";

/** A Hedera settlement reference — a canonical transaction id, e.g. "0.0.1001@1700000000.000000000". */
export interface HederaSettlementRef {
  transactionId: string;
}

/**
 * The minimal view of a settled transaction this binding cares about. A Mirror Node result may present the
 * memo either already-decoded (`memo`) OR as the raw base64 field (`memoBase64`, the Mirror `memo_base64`).
 * `recover` handles BOTH forms so a reader that passes the raw REST field straight through still recovers
 * the atrHash (rather than false-refusing a genuinely welded settlement — the zeroPartyRecoverable claim).
 */
export interface HederaTxView {
  /** The decoded memo text, if the reader decoded it. */
  memo?: string;
  /** The raw Mirror Node `memo_base64` field, if the reader passed it through undecoded. */
  memoBase64?: string;
  /**
   * The transaction's consensus result (Mirror Node `result`, e.g. "SUCCESS" or "INSUFFICIENT_ACCOUNT_BALANCE").
   * ONLY "SUCCESS" is a settlement: a Hedera transaction can reach consensus — and get a Mirror record carrying
   * whatever `transactionMemo` the submitter set — yet FAIL post-consensus and move no funds. Recovery is
   * fail-closed: any value other than "SUCCESS", INCLUDING absent, is not honoured as a weld (mirrors
   * binding-xrpl's validated/tesSUCCESS gate). A faithful Mirror Node reader always supplies this field.
   */
  result?: string;
}

/** Reads settled transactions / an account's transaction ids — wraps a Mirror Node REST client. */
export interface HederaReader {
  /** Fetch one settled transaction's view (or null if the Mirror Node has no such transaction). */
  txView(transactionId: string): Promise<HederaTxView | null>;
  /** List an account's recent transaction ids (most-recent-first), for the enumerate scan. */
  transactionsFor(accountId: string, limit?: number): Promise<string[]>;
}

/**
 * Base64-decode a Mirror Node `memo_base64` value to its UTF-8 string, or `null` if it is not base64.
 *
 * ⛔⛔ **`atob` THROWS, AND THE BUYER CHOOSES THESE BYTES.** The memo is the payer's own 100 bytes, so
 * `memo_base64` is counterparty-derived, and `atob` raises a `DOMException` on any character outside the
 * standard base64 alphabet or on a length that is not a valid quantum. Nothing on this rail caught it, so
 * the throw escaped `readTxView` → `recover`/`observe`/`enumerate` — surfaces whose whole contract is to
 * return a Refusal saying WHICH of the readings applies. Worst on `enumerate`: the scan reads every
 * transaction on the account in one loop, so ONE unreadable memo threw away the entire result set,
 * genuine settlements included, and the caller got an exception instead of the settlements that did weld.
 *
 * The reachable path is a normalising hop in front of the reader, not a dishonest node: a faithful Mirror
 * Node emits STANDARD base64, and the buyer decides whether their 100 memo bytes encode to one containing
 * `+` or `/`. Any transport that base64url-normalises turns that buyer choice into `-`/`_`, which `atob`
 * rejects — so the buyer picks, byte by byte, whether the reading survives.
 *
 * ⭐ Returning `null` here is NOT "no memo": the caller lifts it to its own `malformed-memo-encoding`
 * reading, which is a statement about the READER, not about the chain. A memo we could not decode and a
 * memo that carries no atrHash must not be the same answer.
 */
function decodeMemoBase64(memoBase64: string): string | null {
  let bin: string;
  try {
    bin = atob(memoBase64);
  } catch {
    return null;
  }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}

/** The memo text a tx view carries: the decoded form if the reader decoded it, else the raw base64 field
 *  decoded here — three outcomes (text, no memo field at all, a memo field that is not base64), because
 *  collapsing the last two is the defect `decodeMemoBase64` documents. Resolved inline in `readTxView`
 *  rather than through a carrier type: a carrier needs a discriminant token, and a token that is only ever
 *  compared one way is a value no behaviour depends on — it reads as tested while nothing tests it. */

/** Why a tx view yielded no settled weld — distinguished so `recover`/`observe` report WHY (mirrors
 *  binding-stellar): a transaction the Mirror Node does not have is not a failed one, and a failed one is
 *  not a missing memo. One reading shared by every surface, so they cannot disagree about what a view means. */
export type HederaSettlementReading =
  | { settled: true; atrHash: `0x${string}` }
  | {
      settled: false;
      reason:
        | "no-such-transaction"
        | "unsuccessful-transaction"
        | "no-atr-memo"
        /** The view carried a `memoBase64` that is not base64 — we could not READ the memo. Distinct from
         *  `no-atr-memo`, which is the memo read and found to carry no atrHash: one impeaches the reader,
         *  the other is a verdict about the settlement, and a caller must be able to tell them apart. */
        | "malformed-memo-encoding";
    };

/**
 * Read a settled-transaction view as a settlement. Pure. Fail-closed: a transaction whose `result` is
 * anything other than "SUCCESS" (a failure code, or absent) moved no funds, so its memo — if any — is not
 * a weld (mirrors binding-xrpl's validated/tesSUCCESS gate); both read `unsuccessful-transaction`.
 */
export function readTxView(view: HederaTxView | null): HederaSettlementReading {
  if (view === null) return { settled: false, reason: "no-such-transaction" };
  if (view.result !== "SUCCESS")
    return { settled: false, reason: "unsuccessful-transaction" };
  let text: string;
  if (view.memo !== undefined) text = view.memo;
  else if (view.memoBase64 !== undefined) {
    const decoded = decodeMemoBase64(view.memoBase64);
    // ⛔ The reader handed over bytes it called base64 and they are not. We never READ the memo, so this
    // is a statement about the reader; `no-atr-memo` would be a statement about the settlement.
    if (decoded === null)
      return { settled: false, reason: "malformed-memo-encoding" };
    text = decoded;
  } else return { settled: false, reason: "no-atr-memo" };
  const atrHash = decodeMemoAtrHash(text);
  if (atrHash === null) return { settled: false, reason: "no-atr-memo" };
  return { settled: true, atrHash };
}

/** Recover the atrHash from a settled-transaction view, or `null` if it is not a SUCCESS settlement whose
 *  memo carries an atrHash. The null-collapsing convenience over `readTxView` — the reasons live there. */
export function recoverAtrHashFromTxView(
  view: HederaTxView,
): `0x${string}` | null {
  const reading = readTxView(view);
  return reading.settled ? reading.atrHash : null;
}

/** The Hedera rail's surface. `propose` returns a STRING for you to set as the transaction's
 *  `transactionMemo` — nothing here builds or signs the transfer. Recovery is a Mirror Node read, so a
 *  settlement is not visible the instant it reaches consensus; `enumerate` is an account scan, not an
 *  index. */
export interface HederaAdapter {
  manifest: BindingManifest;
  /** The `transactionMemo` string to set on the settlement transaction (throws on a malformed atrHash). */
  propose(atrHash: string): string;
  /** Recover the atrHash from a settled transaction, or a `verification-failure` Refusal if none binds. */
  recover(
    ref: HederaSettlementRef,
    reader: HederaReader,
  ): Promise<Outcome<`0x${string}`>>;
  /** Report the settled transition (the tx reached consensus and carries a valid atr memo). */
  observe(
    ref: HederaSettlementRef,
    reader: HederaReader,
  ): Promise<Outcome<{ state: "settled"; atrHash: `0x${string}` }>>;
  /** Best-effort account scan for settlements bearing `atrHash` (NOT a native index — see the manifest). */
  enumerate(
    atrHash: string,
    accountId: string,
    reader: HederaReader,
    limit?: number,
  ): Promise<HederaSettlementRef[]>;
}

/** Construct the Hedera adapter. **The manifest is injected, not baked in** — pass this package's own
 *  `HEDERA_MANIFEST`; a manifest whose `rail` is not `"hedera"` throws, because an adapter over another
 *  rail's manifest would publish that rail's claims as its own. This is the package's entry point. */
export function createHederaAdapter(manifest: BindingManifest): HederaAdapter {
  // Fail-fast: an adapter constructed over another rail's manifest would report that rail's claims as
  // this one's. The EVM adapters bake their module const in; the injectable factories refuse instead.
  // Stryker disable next-line all: the guard runs during test-module load (the repository's
  // test suite constructs the adapter at describe scope), so its mutants are 'static' — outside the vitest
  // runner's per-test attribution and unkillable by any test that in fact kills them behaviorally
  // (each rail pins both arms: valid manifest constructs, wrong rail throws by message).
  if (manifest.rail !== "hedera")
    throw new Error(
      `createHederaAdapter: manifest.rail "${manifest.rail}" is not "hedera"`,
    );
  // Closure helper (not `this`) so the returned methods stay destructure-safe.
  /** Every refusal on this rail is a verification failure, namespaced `hedera/…` (mirrors binding-stellar,
   *  whose granularity is the model: `recover` and `observe` report WHY, because a failed transaction is
   *  not a missing memo and a transaction the Mirror Node does not have is neither). */
  const refuse = (code: string, detail: string): Outcome<never> => ({
    refused: true,
    haltClass: "verification-failure",
    code: `hedera/${code}`,
    detail,
  });

  async function doRecover(
    ref: HederaSettlementRef,
    reader: HederaReader,
  ): Promise<Outcome<`0x${string}`>> {
    const reading = readTxView(await reader.txView(ref.transactionId));
    if (reading.settled) return { ok: true, value: reading.atrHash };
    switch (reading.reason) {
      case "no-such-transaction":
        return refuse(
          "no-such-transaction",
          `the Mirror Node has no transaction ${ref.transactionId} — nothing settled there`,
        );
      case "unsuccessful-transaction":
        return refuse(
          "unsuccessful-transaction",
          `transaction ${ref.transactionId} did not succeed (a non-SUCCESS result, or no result at all) — its memo is not a weld`,
        );
      case "no-atr-memo":
        return refuse(
          "no-atr-memo",
          `no atrHash transactionMemo on SUCCESS transaction ${ref.transactionId}`,
        );
      case "malformed-memo-encoding":
        // ⛔ NOT a statement about the settlement. The reader handed over a `memoBase64` that is not
        // base64, so the memo was never read — saying `no-atr-memo` here would report a transport fault
        // as a chain verdict, which is the collapse this rail's three-reason split exists to prevent.
        return refuse(
          "malformed-memo-encoding",
          `the reader supplied a memoBase64 for transaction ${ref.transactionId} that is not base64 — the memo could not be read, which is not the same as its carrying no atrHash`,
        );
    }
  }

  return {
    manifest,

    propose(atrHash: string): string {
      return encodeMemoAtrHash(atrHash);
    },

    recover(
      ref: HederaSettlementRef,
      reader: HederaReader,
    ): Promise<Outcome<`0x${string}`>> {
      return doRecover(ref, reader);
    },

    async observe(
      ref: HederaSettlementRef,
      reader: HederaReader,
    ): Promise<Outcome<{ state: "settled"; atrHash: `0x${string}` }>> {
      const rec = await doRecover(ref, reader);
      if ("refused" in rec) return rec;
      return { ok: true, value: { state: "settled", atrHash: rec.value } };
    },

    async enumerate(
      atrHash: string,
      accountId: string,
      reader: HederaReader,
      limit?: number,
    ): Promise<HederaSettlementRef[]> {
      // Fail-fast, like propose: a malformed atrHash can never match a decoded memo, and the silent []
      // it would produce is indistinguishable from "no settlements" (mirrors encodeMemoAtrHash's loud
      // refusal).
      if (!isAtrHash(atrHash))
        throw new Error(
          `enumerate: atrHash must be a 0x-prefixed 32-byte value, got "${atrHash}"`,
        );
      const ids = await reader.transactionsFor(accountId, limit);
      const out: HederaSettlementRef[] = [];
      for (const transactionId of ids) {
        const reading = readTxView(await reader.txView(transactionId));
        if (reading.settled && atrHashEquals(reading.atrHash, atrHash))
          out.push({ transactionId });
      }
      return out;
    },
  };
}
