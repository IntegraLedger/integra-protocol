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
import { HEDERA_MIRROR_MAX_PAGE } from "./constants.js";
import { decodeMemoAtrHash, encodeMemoAtrHash } from "./memo.js";

/** A Hedera settlement reference — a canonical transaction id, e.g. "0.0.1001@1700000000.000000000". */
export interface HederaSettlementRef {
  transactionId: string;
}

/**
 * The transaction memo as a reader supplies it — ONE field carrying its own spelling.
 *
 * ⛔⛔ **IT WAS TWO OPTIONAL FIELDS, `memo` AND `memoBase64`, WITH NOTHING SAYING WHICH ONE MEANT
 * ANYTHING.** Four states were representable and only two were intelligible. `memo: ""` — the shape a
 * reader produces the moment it writes `memo: tx.memo ?? ""` beside the raw field it also passes through —
 * won over a `memoBase64` carrying the real weld, so `recover` refused `no-atr-memo` about a settlement
 * that welded correctly, and the package's own test pinned that precedence under a comment claiming "a
 * caller cannot get a different answer than the raw bytes would give". It compared `ATR` against
 * `toMemoBase64(OTHER)`: a different answer is exactly what it got. When the two disagreed, whichever
 * field the reader happened to fill decided the verdict, silently, and neither the reader nor the caller
 * was told a choice had been made.
 *
 * ⭐ **THE FIX IS THE TYPE, NOT A TIE-BREAK RULE.** A precedence rule (or a refusal when the two disagree)
 * would keep four states and add arbitration; one field with a declared encoding leaves two. There is
 * nothing to arbitrate, because a reader can no longer say two things at once — and `""` now means "the
 * memo is empty", which is a fact, rather than "I had nowhere else to put my ignorance".
 *
 * The discriminant earns its keep: both arms are read, `text` straight through and `base64` through
 * {@link decodeMemoBase64}, and the two lead to different readings on the same bytes. That is what
 * distinguishes it from the `why: "absent"` token this rail tried and withdrew — a value compared one way,
 * which reads as tested while nothing tests it.
 */
export type HederaMemo =
  /** The reader decoded the memo. `value` is the memo text as the payer set it. */
  | { readonly encoding: "text"; readonly value: string }
  /** The reader passed the Mirror Node `memo_base64` field through undecoded. `value` is that field —
   *  STANDARD base64, decoded here, and refused as `malformed-memo-encoding` when it is not. */
  | { readonly encoding: "base64"; readonly value: string };

/**
 * The minimal view of a settled transaction this binding cares about. The memo travels as one
 * {@link HederaMemo} whichever form the reader has it in, so a reader that passes the raw Mirror REST
 * field straight through still recovers the atrHash (rather than false-refusing a genuinely welded
 * settlement — the zeroPartyRecoverable claim).
 */
export interface HederaTxView {
  /** The transaction memo, in whichever spelling the reader holds. Absent when the Mirror Node record
   *  carries none — which is a different fact from a memo that is present and empty. */
  memo?: HederaMemo;
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
        /** The view's memo was spelled `base64` and is not base64 — we could not READ the memo. Distinct from
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
  const memo = view.memo;
  if (memo === undefined) return { settled: false, reason: "no-atr-memo" };
  const text =
    memo.encoding === "text" ? memo.value : decodeMemoBase64(memo.value);
  // ⛔ The reader handed over bytes it called base64 and they are not. We never READ the memo, so this is
  // a statement about the reader; `no-atr-memo` would be a statement about the settlement.
  if (text === null)
    return { settled: false, reason: "malformed-memo-encoding" };
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
  /**
   * Best-effort account scan for settlements bearing `atrHash` (NOT a native index — see the manifest).
   *
   * ⛔ `limit` is the scan DEPTH and it is yours to set. Omitted, this asks the Mirror Node for its largest
   * page ({@link HEDERA_MIRROR_MAX_PAGE}) and THROWS if the page comes back full — see the enumerate body
   * for why a short answer here cannot be reported any other way.
   */
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
        // ⛔ NOT a statement about the settlement. The reader declared the memo `base64` and it is not,
        // so the memo was never read — saying `no-atr-memo` here would report a transport fault as a
        // chain verdict, which is the collapse this rail's three-reason split exists to prevent.
        return refuse(
          "malformed-memo-encoding",
          `the reader spelled the memo of transaction ${ref.transactionId} \`base64\` and it is not base64 — the memo could not be read, which is not the same as its carrying no atrHash`,
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
      if (limit !== undefined && (!Number.isInteger(limit) || limit < 1))
        throw new Error(
          `enumerate: limit must be a positive integer, got ${limit}`,
        );
      // ⛔ NOT `reader.transactionsFor(accountId, limit)`. Forwarding an absent `limit` handed the depth of
      // this scan to the Mirror Node, whose default is 25 (measured — see HEDERA_MIRROR_MAX_PAGE), and a
      // settlement past it came back as an empty array nobody could tell from "no settlements".
      const depth = limit ?? HEDERA_MIRROR_MAX_PAGE;
      const ids = await reader.transactionsFor(accountId, depth);
      // ⛔⛔ A FULL PAGE WITH NO `limit` NAMED IS A REFUSAL, NOT AN ANSWER. An explicit `limit` is the
      // caller's own bound and a full result is exactly what they asked for; an absent one means "every
      // settlement on this account", and this rail cannot serve that — the reader port returns ids and no
      // cursor, so there is nothing to page with. Answering the first `depth` would be a scan silently
      // shorter than the question, which is the one failure a best-effort enumerate can never signal.
      if (limit === undefined && ids.length >= depth)
        throw new Error(
          `enumerate: the account scan of ${accountId} came back full at ${ids.length} of ${depth} transactions, so it cannot tell a complete answer from a truncated one — this rail's reader port carries no cursor to page with, so name the depth you want with an explicit \`limit\` and take the bound as yours`,
        );
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
