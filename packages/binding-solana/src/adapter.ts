/**
 * The Solana SPL-Memo WeldAdapter — thin I/O with @solana/web3.js isolated here. It intentionally
 * does NOT implement binding-core's `WeldAdapter`: that port is EVM-shaped (`SettlementRef.txHash` is a
 * `0x`-hex value, `ChainReader` speaks `eth_getLogs`), and Solana speaks base58 signatures + parsed
 * transactions. Rather than lie through those types, this exposes a Solana-native surface (signature refs,
 * a `SolanaReader` port) alongside the shared, chain-agnostic `BindingManifest`. Unifying the port shape
 * across EVM and non-EVM rails is future work; forcing it here would misrepresent the rail.
 *
 * `propose` builds the Memo instruction the buyer attaches to their `transferChecked`; `recover` reads the
 * atrHash back from a successful confirmed transaction's memo; `observe` reports the settled transition;
 * `enumerate` is the best-effort account scan the manifest declares (`forwardIndexable: false`).
 */
import type { BindingManifest, Outcome } from "@integraledger/lcp-binding-core";
import { atrHashEquals, isAtrHash } from "@integraledger/lcp-kernel";
import {
  type Connection,
  type ParsedTransactionWithMeta,
  PublicKey,
  type TransactionError,
  TransactionInstruction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { MEMO_PROGRAM_ID } from "./constants.js";
import { decodeSplMemo, encodeSplMemo, type MemoEncoding } from "./memo.js";

/** A Solana settlement reference — a transaction signature (base58). */
export interface SolanaSettlementRef {
  signature: string;
}

/** The minimal, decoded view of one instruction this binding cares about (a memo instruction). */
export interface MemoView {
  programId: string;
  /** The parsed memo text (getParsedTransaction's `jsonParsed` form for the Memo program), if present. */
  memoUtf8?: string;
  /** Raw instruction data bytes, if the caller supplied a non-parsed view. */
  data?: Uint8Array;
}

/** Build the SPL Memo instruction carrying `atrHash` (attach it to the same tx as `transferChecked`). */
export function buildAtrMemoInstruction(
  atrHash: string,
  encoding: MemoEncoding = "hex",
): TransactionInstruction {
  return new TransactionInstruction({
    keys: [],
    programId: new PublicKey(MEMO_PROGRAM_ID),
    data: Buffer.from(encodeSplMemo(atrHash, encoding)),
  });
}

/**
 * The minimal view of one confirmed transaction this binding cares about. `err` mirrors the transaction
 * meta's `err`: `null` is the ONLY success — a non-null value is a runtime failure that charged the fee
 * but moved no funds, so its memo (if any) is not a weld, and an ABSENT value means the reader saw no
 * meta at all, which is not evidence of success either. Recovery is fail-closed on anything but `null`
 * (mirrors binding-xrpl's validated/tesSUCCESS gate and binding-hedera's result === "SUCCESS" gate).
 */
export interface SolanaTxView {
  memos: MemoView[];
  err?: TransactionError | null;
}

/** Recover the atrHash from a set of instruction views (the first memo that decodes wins). Pure. */
export function recoverAtrHashFromMemoViews(
  views: MemoView[],
): `0x${string}` | null {
  for (const v of views) {
    if (v.programId !== MEMO_PROGRAM_ID) continue;
    const bytes =
      v.memoUtf8 !== undefined ? new TextEncoder().encode(v.memoUtf8) : v.data;
    if (bytes === undefined) continue;
    const atr = decodeSplMemo(bytes, "hex") ?? decodeSplMemo(bytes, "raw");
    if (atr !== null) return atr;
  }
  return null;
}

/** Map a parsed transaction's top-level instructions into memo views (the SDK→pure boundary). */
export function parseMemoViews(tx: ParsedTransactionWithMeta): MemoView[] {
  const out: MemoView[] = [];
  for (const ins of tx.transaction.message.instructions) {
    const programId = ins.programId.toBase58();
    if ("parsed" in ins) {
      // ParsedInstruction — the Memo program parses to a plain string (its `parsed` value).
      out.push({
        programId,
        ...(typeof ins.parsed === "string" ? { memoUtf8: ins.parsed } : {}),
      });
    } else {
      // PartiallyDecodedInstruction — the RPC did not parse this program (provider/version-dependent for
      // the Memo program). Keep the raw bytes (base58-decoded) so `recover` still finds the atrHash rather
      // than false-refusing a genuinely welded settlement (the manifest's zeroPartyRecoverable claim).
      out.push({ programId, data: bs58.decode(ins.data) });
    }
  }
  return out;
}

/** Why a tx view yielded no settled weld — distinguished so `recover`/`observe` report WHY (mirrors
 *  binding-stellar): a transaction the RPC does not have is not a failed one, and a failed one is not a
 *  missing memo. One reading shared by every surface, so they cannot disagree about what a view means. */
export type SolanaSettlementReading =
  | { settled: true; atrHash: `0x${string}` }
  | {
      settled: false;
      reason:
        | "no-such-transaction"
        | "unsuccessful-transaction"
        | "no-atr-memo";
    };

/**
 * Read a confirmed-transaction view as a settlement. Pure. Fail-closed: a transaction with a non-null
 * `err` executed and charged its fee but moved no funds — its memo is not a weld — and a view with NO
 * `err` field gave no evidence of success at all (mirrors binding-xrpl's validated/tesSUCCESS gate);
 * both read `unsuccessful-transaction`.
 */
export function readTxView(view: SolanaTxView | null): SolanaSettlementReading {
  if (view === null) return { settled: false, reason: "no-such-transaction" };
  if (view.err !== null)
    return { settled: false, reason: "unsuccessful-transaction" };
  const atrHash = recoverAtrHashFromMemoViews(view.memos);
  if (atrHash === null) return { settled: false, reason: "no-atr-memo" };
  return { settled: true, atrHash };
}

/** Recover the atrHash from a confirmed-transaction view, or `null` if it is not a successful settlement
 *  whose memo carries one. The null-collapsing convenience over `readTxView` — the reasons live there. */
export function recoverAtrHashFromTxView(
  view: SolanaTxView | null,
): `0x${string}` | null {
  const reading = readTxView(view);
  return reading.settled ? reading.atrHash : null;
}

/** Map a parsed transaction into its tx view — memo instructions plus the success field. */
export function parseTxView(tx: ParsedTransactionWithMeta): SolanaTxView {
  return {
    memos: parseMemoViews(tx),
    ...(tx.meta === null ? {} : { err: tx.meta.err }),
  };
}

/** Reads confirmed transactions / account signatures — wraps a @solana/web3.js `Connection`. */
export interface SolanaReader {
  /** Fetch one confirmed transaction's view by signature, or `null` if the RPC has no such transaction. */
  txView(signature: string): Promise<SolanaTxView | null>;
  signaturesFor(address: string, limit?: number): Promise<string[]>;
}

/** Wrap a `@solana/web3.js` `Connection` as a {@link SolanaReader} — the one place a chain SDK reaches
 *  this package's public surface. `@solana/web3.js` is a direct dependency, so installing this package
 *  installs it; you still construct the `Connection` yourself, because the RPC endpoint is a deployment
 *  choice. Read-only: nothing here submits a transaction. */
export function makeSolanaReader(connection: Connection): SolanaReader {
  return {
    async txView(signature: string): Promise<SolanaTxView | null> {
      const tx = await connection.getParsedTransaction(signature, {
        maxSupportedTransactionVersion: 0,
      });
      return tx === null ? null : parseTxView(tx);
    },
    async signaturesFor(address: string, limit?: number): Promise<string[]> {
      const infos = await connection.getSignaturesForAddress(
        new PublicKey(address),
        limit !== undefined ? { limit } : {},
      );
      return infos.map((i) => i.signature);
    },
  };
}

/** The Solana rail's surface. It is a NARROWING of the generic `WeldAdapter` port, not an implementation
 *  of it: `propose` is synchronous and returns a `TransactionInstruction` for the caller to add to its own
 *  transaction, and every read takes a {@link SolanaReader} rather than the generic `VerifierPorts`.
 *  `enumerate` is present but scans an account's signatures — best effort, not a native index. */
export interface SolanaAdapter {
  manifest: BindingManifest;
  /** The Memo instruction to attach to the settlement transaction. */
  propose(atrHash: string, encoding?: MemoEncoding): TransactionInstruction;
  /** Recover the atrHash from a successful settlement, or a `verification-failure` Refusal if none binds. */
  recover(
    ref: SolanaSettlementRef,
    reader: SolanaReader,
  ): Promise<Outcome<`0x${string}`>>;
  /** Report the settled transition (the tx is confirmed, succeeded, and carries a valid atr memo). */
  observe(
    ref: SolanaSettlementRef,
    reader: SolanaReader,
  ): Promise<Outcome<{ state: "settled"; atrHash: `0x${string}` }>>;
  /** Best-effort account scan for settlements bearing `atrHash` (NOT a native index — see the manifest). */
  enumerate(
    atrHash: string,
    address: string,
    reader: SolanaReader,
    limit?: number,
  ): Promise<SolanaSettlementRef[]>;
}

/** Construct the Solana adapter. **The manifest is injected, not baked in** — pass this package's own
 *  `SOLANA_MANIFEST`; a manifest whose `rail` is not `"solana"` throws, because an adapter over another
 *  rail's manifest would publish that rail's claims as its own. This is the package's entry point. */
export function createSolanaAdapter(manifest: BindingManifest): SolanaAdapter {
  // Fail-fast: an adapter constructed over another rail's manifest would report that rail's claims as
  // this one's. The EVM adapters bake their module const in; the injectable factories refuse instead.
  // Stryker disable next-line all: the guard runs during test-module load (the repository's
  // test suite constructs the adapter at describe scope), so its mutants are 'static' — outside the vitest
  // runner's per-test attribution and unkillable by any test that in fact kills them behaviorally
  // (each rail pins both arms: valid manifest constructs, wrong rail throws by message).
  if (manifest.rail !== "solana")
    throw new Error(
      `createSolanaAdapter: manifest.rail "${manifest.rail}" is not "solana"`,
    );
  // Closure helper (not `this`) so the returned methods stay destructure-safe.
  /** Every refusal on this rail is a verification failure, namespaced `solana/…` (mirrors binding-stellar,
   *  whose granularity is the model: `recover` and `observe` report WHY, because a failed transaction is
   *  not a missing memo and a transaction the RPC does not have is neither). */
  const refuse = (code: string, detail: string): Outcome<never> => ({
    refused: true,
    haltClass: "verification-failure",
    code: `solana/${code}`,
    detail,
  });

  async function doRecover(
    ref: SolanaSettlementRef,
    reader: SolanaReader,
  ): Promise<Outcome<`0x${string}`>> {
    const reading = readTxView(await reader.txView(ref.signature));
    if (reading.settled) return { ok: true, value: reading.atrHash };
    switch (reading.reason) {
      case "no-such-transaction":
        return refuse(
          "no-such-transaction",
          `the RPC has no confirmed transaction ${ref.signature} — nothing settled there`,
        );
      case "unsuccessful-transaction":
        return refuse(
          "unsuccessful-transaction",
          `transaction ${ref.signature} did not succeed (err present, or no meta at all) — its memo is not a weld`,
        );
      case "no-atr-memo":
        return refuse(
          "no-atr-memo",
          `no atrHash memo on successful transaction ${ref.signature}`,
        );
    }
  }

  return {
    manifest,

    propose(
      atrHash: string,
      encoding: MemoEncoding = "hex",
    ): TransactionInstruction {
      return buildAtrMemoInstruction(atrHash, encoding);
    },

    recover(
      ref: SolanaSettlementRef,
      reader: SolanaReader,
    ): Promise<Outcome<`0x${string}`>> {
      return doRecover(ref, reader);
    },

    async observe(
      ref: SolanaSettlementRef,
      reader: SolanaReader,
    ): Promise<Outcome<{ state: "settled"; atrHash: `0x${string}` }>> {
      const rec = await doRecover(ref, reader);
      if ("refused" in rec) return rec;
      return { ok: true, value: { state: "settled", atrHash: rec.value } };
    },

    async enumerate(
      atrHash: string,
      address: string,
      reader: SolanaReader,
      limit?: number,
    ): Promise<SolanaSettlementRef[]> {
      // Fail-fast, like propose: a malformed atrHash can never match a decoded memo, and the silent []
      // it would produce is indistinguishable from "no settlements" (mirrors encodeSplMemo's loud refusal).
      if (!isAtrHash(atrHash))
        throw new Error(
          `enumerate: atrHash must be a 0x-prefixed 32-byte value, got "${atrHash}"`,
        );
      const sigs = await reader.signaturesFor(address, limit);
      const out: SolanaSettlementRef[] = [];
      for (const signature of sigs) {
        const atr = recoverAtrHashFromTxView(await reader.txView(signature));
        if (atr !== null && atrHashEquals(atr, atrHash))
          out.push({ signature });
      }
      return out;
    },
  };
}
