/**
 * The Stellar CAP-67 muxed-address adapter — thin I/O with @stellar/stellar-sdk isolated here. Like
 * binding-solana it intentionally does NOT implement binding-core's `WeldAdapter`: that port is EVM-shaped
 * (`SettlementRef.txHash` is a `0x`-hex value, `ChainReader` speaks `eth_getLogs`), and Stellar speaks
 * hex tx hashes over Horizon + CAP-67 M-address destinations. Rather than lie through those types, this
 * exposes a Stellar-native surface (a tx-hash ref, a `StellarReader` port) alongside the shared,
 * chain-agnostic `BindingManifest`. Unifying the port shape across EVM and non-EVM rails is future work;
 * forcing it here would misrepresent the rail.
 *
 * ★ THE SURFACE IS CONFIRM-NOT-RECOVER, BY THE RAIL'S NATURE. Only `atrHash[:8]` rides in the CAP-67 mux
 * id (8 bytes); the full 32-byte atrHash never touches the chain. So:
 *   - `propose(atrHash, basePubkey)` builds the muxed M-address destination the buyer transfers to.
 *   - `verify(atrHash, ref)` is the PRIMARY honest surface: it confirms the known atrHash's prefix-8 equals
 *     the settlement's on-chain mux id → `Outcome<{ confirmed: true; muxIdPrefix8Hex }>` or a
 *     `verification-failure` Refusal. (You bring the atrHash — from `extensions.legalContext.info` — the chain
 *     confirms the match.)
 *   - `recover(ref)` does NOT return a full atrHash (it cannot — the chain holds 8 bytes). It returns an
 *     explicitly-PARTIAL `{ muxIdPrefix8Hex }` documenting that only the prefix is on-chain, so a caller
 *     cannot mistake it for a recovered hash. If you want the atrHash, use `verify` with the off-chain hash.
 *   - `observe` reports the settled transition alongside the on-chain mux prefix.
 *   - `enumerate` is the best-effort account scan the manifest declares (`forwardIndexable: false`).
 *
 * ★ EVERY SURFACE GATES ON TRANSACTION SUCCESS FIRST (`StellarSettlementView.successful`). A failed
 * Stellar transaction is still recorded in the ledger with its fee charged, and the operation's `to`
 * destination lives in the transaction ENVELOPE — so the M-address stays readable on a `txFAILED` result.
 * The confirm-not-recover posture does NOT mitigate that: it changes WHAT is proven (a prefix match rather
 * than a recovered hash), never WHETHER settlement occurred. Without the gate, `verify` returns
 * `confirmed: true` and `observe` returns `state: "settled"` for a transaction that moved nothing.
 */
import type {
  BindingManifest,
  Outcome,
  Refusal,
} from "@integraledger/lcp-binding-core";
import {
  deriveMuxId,
  encodeMuxedAddress,
  recoverMuxIdPrefix8,
  verifyMuxedBinding,
} from "./mux.js";

/** A Stellar settlement reference — a transaction hash (64-hex, as Horizon reports it). */
export interface StellarSettlementRef {
  txHash: string;
}

/** The minimal on-chain view of a settlement this binding cares about: the CAP-67 M-address the SAC
 *  `transfer` paid to, plus whether the transaction actually succeeded. A reader implementation decodes the
 *  destination from the tx's single `transfer(from, to, amount)` op. `null` when the tx has no muxed
 *  destination. */
export interface StellarSettlementView {
  /** The `to` destination of the SAC transfer, a CAP-67 M-address (starts with `M`), or null if none. */
  muxedDestination: string | null;
  /**
   * Horizon's `successful` field for the transaction. ONLY `true` is a settlement: a Stellar transaction
   * that fails is still recorded in the ledger with its fee charged, and the operation's `to` destination
   * lives in the transaction ENVELOPE — so the M-address stays readable on a `txFAILED` result. Confirming
   * it would mint a settlement record out of a failure. Fail-closed: `false` AND absent are both refused,
   * because a reader that supplied no outcome gave no evidence of success (mirrors binding-solana's
   * `err === null` gate and binding-xrpl's validated/tesSUCCESS gate). A faithful Horizon reader always
   * supplies this field; note `/accounts/{id}/transactions` omits failed transactions unless
   * `include_failed=true`, while `/transactions/{hash}` returns them either way.
   */
  successful?: boolean;
}

/**
 * Did this transaction actually settle? Pure, fail-closed — only an explicit `true` counts. Every surface
 * in this binding (`verify`, `recover`, `observe`, `enumerate`) gates on this before honouring a mux id:
 * the confirm-not-recover posture changes WHAT is proven (a prefix match rather than a recovered hash),
 * never WHETHER settlement occurred.
 */
export function isSettledSuccessfully(view: StellarSettlementView): boolean {
  return view.successful === true;
}

/** Reads confirmed Stellar transactions — an injected port over Horizon / the SDK. */
export interface StellarReader {
  /**
   * One transaction's settlement view, or `null` when Horizon has no such transaction.
   *
   * ⛔ The `null` is load-bearing and was missing until 2026-09-03. Without it a reader asked about a hash
   * Horizon has never seen had to INVENT a view, and the only view it could invent —
   * `{ muxedDestination: null }` — is what a real transaction paying an unmuxed address looks like. Every
   * surface then refused `no-muxed-destination` about a transaction that does not exist: a claim about a
   * settlement, made where there was nothing to make a claim about. Four sibling rails carry a
   * `no-such-transaction` reading for precisely this distinction, and cite this one as the model for it.
   */
  settlementView(txHash: string): Promise<StellarSettlementView | null>;
  /** Tx hashes touching an account's payment history (best-effort scan input for `enumerate`). */
  transactionsFor(account: string, limit?: number): Promise<string[]>;
}

/** Build the CAP-67 muxed M-address destination carrying `atrHash[:8]` for a seller base G-pubkey. This is
 *  the `payTo` the buyer's SAC transfer targets; the buyer's signature over that transfer welds the mux id
 *  (signature-grade). Throws on a malformed atrHash / base pubkey (fail-fast). */
export function buildMuxedDestination(
  atrHash: string,
  baseGPubkey: string,
): string {
  return encodeMuxedAddress(baseGPubkey, deriveMuxId(atrHash));
}

function toHex(bytes: Uint8Array): string {
  let out = "0x";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/** The result of `recover`: explicitly PARTIAL. `muxIdPrefix8Hex` is `0x` + 16 hex chars = `atrHash[:8]`,
 *  NOT a full atrHash. `note` states the truncation so no caller mistakes it for a recovered hash. */
export interface StellarMuxPrefixRecovery {
  /** `0x`-prefixed hex of the 8 on-chain mux bytes (`atrHash[:8]`). NOT the full 32-byte atrHash. */
  muxIdPrefix8Hex: string;
  partial: true;
  note: string;
}

/** The result of `verify`: a confirmed prefix-8 match against a KNOWN atrHash. */
export interface StellarMuxConfirmation {
  confirmed: true;
  /** `0x`-prefixed hex of the on-chain mux id that matched `atrHash[:8]`. */
  muxIdPrefix8Hex: string;
}

/** The Stellar rail's surface, and the one whose shape differs most from the others — because only 8 bytes
 *  ride on-chain. A CAP-67 mux id is 8 bytes, so the full atrHash does not fit, and `recover` therefore
 *  answers a PREFIX, never a hash. {@link StellarAdapter.verify} is the primary method here: you bring the
 *  atrHash from off-chain and the chain confirms its first 8 bytes match. A caller reaching for `recover`
 *  expecting the other rails' behaviour is the mistake this rail is shaped to make impossible. */
export interface StellarAdapter {
  manifest: BindingManifest;
  /** Build the muxed M-address destination the buyer transfers to (welds `atrHash[:8]`). */
  propose(atrHash: string, baseGPubkey: string): string;
  /**
   * CONFIRM (primary): does the settlement's on-chain mux id equal the KNOWN atrHash's prefix-8? Returns a
   * confirmation with the matched prefix, or a `verification-failure` Refusal on mismatch / no muxed
   * destination. You supply the atrHash (from off-chain `extensions.legalContext.info`); the chain confirms it.
   */
  verify(
    atrHash: string,
    ref: StellarSettlementRef,
    reader: StellarReader,
  ): Promise<Outcome<StellarMuxConfirmation>>;
  /**
   * RECOVER — explicitly PARTIAL. Returns only the 8-byte on-chain mux prefix (`atrHash[:8]`), never a full
   * atrHash (the chain does not carry one). A `verification-failure` Refusal when the tx has no muxed
   * destination. To obtain the atrHash, use `verify` with the off-chain hash.
   */
  recover(
    ref: StellarSettlementRef,
    reader: StellarReader,
  ): Promise<Outcome<StellarMuxPrefixRecovery>>;
  /** Report the settled transition (the tx is confirmed and its destination is a CAP-67 muxed M-address). */
  observe(
    ref: StellarSettlementRef,
    reader: StellarReader,
  ): Promise<Outcome<{ state: "settled"; muxIdPrefix8Hex: string }>>;
  /**
   * Best-effort account scan for settlements whose mux id matches `atrHash[:8]` (NOT a native index — see
   * the manifest's `forwardIndexable: false`). Confirms, per tx, against the known atrHash.
   */
  enumerate(
    atrHash: string,
    account: string,
    reader: StellarReader,
    limit?: number,
  ): Promise<StellarSettlementRef[]>;
}

/**
 * The `note` every partial recovery carries, exported because callers receive it and matching on a string
 * they cannot import is guesswork. It names the off-chain slot the x402 placement actually writes —
 * `extensions.legalContext.info` — and `rail-invariants` asserts that against the placement's own manifest,
 * because a reader who follows this instruction to a slot nothing writes concludes the reference is absent.
 */
export const STELLAR_PREFIX_NOTE =
  "PARTIAL: only atrHash[:8] rides in the CAP-67 mux id — this is the 8-byte on-chain prefix, NOT the full atrHash; obtain the full hash off-chain (extensions.legalContext.info) and use verify() to confirm the match";

/** Construct the Stellar adapter. **The manifest is injected, not baked in** — pass this package's own
 *  `STELLAR_MANIFEST`; a manifest whose `rail` is not `"stellar"` throws, because an adapter over another
 *  rail's manifest would publish that rail's claims as its own. This is the package's entry point. */
export function createStellarAdapter(
  manifest: BindingManifest,
): StellarAdapter {
  // Fail-fast: an adapter constructed over another rail's manifest would report that rail's claims as
  // this one's. The EVM adapters bake their module const in; the injectable factories refuse instead.
  // Stryker disable next-line all: the guard runs during test-module load (the repository's
  // test suite constructs the adapter at describe scope), so its mutants are 'static' — outside the vitest
  // runner's per-test attribution and unkillable by any test that in fact kills them behaviorally
  // (each rail pins both arms: valid manifest constructs, wrong rail throws by message).
  if (manifest.rail !== "stellar")
    throw new Error(
      `createStellarAdapter: manifest.rail "${manifest.rail}" is not "stellar"`,
    );
  // Closure helpers (not `this`) so the returned methods stay destructure-safe.
  /** Every refusal on this rail is a verification failure, namespaced `stellar/…` (mirrors placement.ts). */
  const refuse = (code: string, detail: string): Refusal => ({
    refused: true,
    haltClass: "verification-failure",
    code: `stellar/${code}`,
    detail,
  });

  /** The refusal a transaction that did not succeed earns — never a mismatch, never a missing destination. */
  const unsuccessful = (txHash: string): Refusal =>
    refuse(
      "unsuccessful-transaction",
      `transaction ${txHash} did not succeed (Horizon successful !== true) — its CAP-67 destination is not a settlement`,
    );

  const noMuxedDestination = (txHash: string): Refusal =>
    refuse("no-muxed-destination", `no CAP-67 muxed destination in ${txHash}`);

  /** A hash Horizon does not have. NOT a settlement that paid the wrong address — nothing was examined. */
  const noSuchTransaction = (txHash: string): Refusal =>
    refuse(
      "no-such-transaction",
      `Horizon has no transaction ${txHash} — nothing was examined, so this is not a statement about a settlement`,
    );

  /**
   * The on-chain mux prefix of a SUCCESSFUL settlement. Returns the refusal reason as a discriminated
   * value so `recover` and `observe` report WHY: a failed transaction is not "no destination".
   */
  async function onChainPrefix(
    ref: StellarSettlementRef,
    reader: StellarReader,
  ): Promise<
    | { prefix: Uint8Array; muxedDestination: string }
    | { reason: "no-such-transaction" }
    | { reason: "no-muxed-destination" }
    | { reason: "unsuccessful" }
  > {
    const view = await reader.settlementView(ref.txHash);
    // FIRST, and before anything is read off the view: a transaction nobody has is not a transaction
    // whose destination was wrong.
    if (view === null) return { reason: "no-such-transaction" };
    if (view.muxedDestination === null)
      return { reason: "no-muxed-destination" };
    if (!isSettledSuccessfully(view)) return { reason: "unsuccessful" };
    // DECODE BEFORE COMPARING. A destination that is not a valid M-address (a plain G-address, a truncated
    // StrKey) carries no mux id at all — that is "no muxed destination", never "the wrong atrHash". Every
    // surface routes through here so the four of them cannot disagree about what a given view means.
    const prefix = recoverMuxIdPrefix8(view.muxedDestination);
    if (prefix === null) return { reason: "no-muxed-destination" };
    return { prefix, muxedDestination: view.muxedDestination };
  }

  /** The refusal for whichever reason `onChainPrefix` gave — shared by all four surfaces. */
  const refusalFor = (
    reason: "no-such-transaction" | "no-muxed-destination" | "unsuccessful",
    txHash: string,
  ): Refusal => {
    if (reason === "unsuccessful") return unsuccessful(txHash);
    if (reason === "no-such-transaction") return noSuchTransaction(txHash);
    return noMuxedDestination(txHash);
  };

  return {
    manifest,

    propose(atrHash: string, baseGPubkey: string): string {
      return buildMuxedDestination(atrHash, baseGPubkey);
    },

    async verify(
      atrHash: string,
      ref: StellarSettlementRef,
      reader: StellarReader,
    ): Promise<Outcome<StellarMuxConfirmation>> {
      // ★ The success gate and the decode both run BEFORE the prefix match: a failed transaction is not
      // "the wrong ATR" (its envelope still carries the M-address), and an undecodable destination is not
      // one either. `mux-prefix-mismatch` therefore means strictly: there WAS a mux id, and it was wrong.
      const found = await onChainPrefix(ref, reader);
      if ("reason" in found) return refusalFor(found.reason, ref.txHash);
      if (!verifyMuxedBinding({ muxedM: found.muxedDestination, atrHash }))
        return refuse(
          "mux-prefix-mismatch",
          `on-chain mux id != atrHash[:8] for ${ref.txHash}`,
        );
      return {
        ok: true,
        value: { confirmed: true, muxIdPrefix8Hex: toHex(found.prefix) },
      };
    },

    async recover(
      ref: StellarSettlementRef,
      reader: StellarReader,
    ): Promise<Outcome<StellarMuxPrefixRecovery>> {
      const found = await onChainPrefix(ref, reader);
      if ("reason" in found) return refusalFor(found.reason, ref.txHash);
      return {
        ok: true,
        value: {
          muxIdPrefix8Hex: toHex(found.prefix),
          partial: true,
          note: STELLAR_PREFIX_NOTE,
        },
      };
    },

    async observe(
      ref: StellarSettlementRef,
      reader: StellarReader,
    ): Promise<Outcome<{ state: "settled"; muxIdPrefix8Hex: string }>> {
      const found = await onChainPrefix(ref, reader);
      if ("reason" in found) return refusalFor(found.reason, ref.txHash);
      return {
        ok: true,
        value: { state: "settled", muxIdPrefix8Hex: toHex(found.prefix) },
      };
    },

    async enumerate(
      atrHash: string,
      account: string,
      reader: StellarReader,
      limit?: number,
    ): Promise<StellarSettlementRef[]> {
      const hashes = await reader.transactionsFor(account, limit);
      const out: StellarSettlementRef[] = [];
      for (const txHash of hashes) {
        const view = await reader.settlementView(txHash);
        // A failed transaction's envelope still carries the M-address — the scan must skip it, or a
        // ledger full of failures enumerates as a ledger full of settlements. A hash the reader cannot
        // resolve is skipped for the same reason: a scan reports what it found, never what it could not
        // look at.
        if (
          view !== null &&
          view.muxedDestination !== null &&
          isSettledSuccessfully(view) &&
          verifyMuxedBinding({ muxedM: view.muxedDestination, atrHash })
        )
          out.push({ txHash });
      }
      return out;
    },
  };
}
