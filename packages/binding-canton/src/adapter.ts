/**
 * The Canton `LcpAnchor` adapter — thin I/O over an injected participant-reader/writer port. It is a
 * **Canton-native surface**, NOT binding-core's `WeldAdapter`: that port is EVM-shaped (`SettlementRef`
 * is a `0x`-hex tx hash, `ChainReader` speaks `eth_getLogs`), whereas Canton settlements are `LcpAnchor`
 * contract instances addressed by a Daml `contractId` and read via the Daml JSON Ledger API (HTTP). The
 * SDK here is PURE TypeScript — a `fetch`-based Daml JSON API client, injected as a port so this package
 * stays runtime-agnostic and testable without a live participant (no chain SDK → no dependency-cruiser
 * isolation rule needed). Unifying the port shape across EVM and non-EVM rails is future work; forcing the
 * EVM port shape onto Canton would misrepresent the rail.
 *
 * `propose` builds the `create-LcpAnchor` command (atrHash as a `Text` field) the buyer submits;
 * `recover` reads the atrHash back from a confirmed anchor; `observe` reports the `anchored` transition;
 * `enumerate` queries the participant for the anchors bearing a given atrHash. The participant round-trips
 * live behind the `CantonParticipantReader` port.
 *
 * ★ WHY THERE IS NO EXPLICIT SUCCESS GATE HERE — the rail supplies one STRUCTURALLY, and that reliance is
 * recorded so a future reader change cannot silently break it. A Daml command either COMMITS or leaves
 * nothing behind: there is no failed-but-recorded transaction on the ledger the way a reverted Solana or
 * phase-2-failed Cardano transaction is recorded. An `LcpAnchor` contract therefore exists if and only if
 * its create committed, and both port methods (`/v1/query`, `/v1/fetch`) return ACTIVE contracts only.
 * Note also that this binding reports `anchored`, never `settled` (`lifecycleStates: ["proposed",
 * "anchored"]`) — it does not claim a payment occurred at all. **If the reader is ever pointed at a source
 * that surfaces non-active contracts — an archived-contract query, the transaction/completion stream, a
 * ledger-offset replay — this reliance breaks and an explicit active/committed gate becomes mandatory.**
 */

import type { BindingManifest, Outcome } from "@integraledger/lcp-binding-core";
import { atrHashEquals, canonicalAtrHash } from "@integraledger/lcp-kernel";
import {
  buildAnchorPayload,
  type LcpAnchorPayload,
  readAnchorAtrHash,
} from "./anchor.js";
import { lcpAnchorTemplateId } from "./constants.js";

/** A Canton settlement reference — a Daml `contractId` for the `LcpAnchor` contract. */
export interface CantonSettlementRef {
  contractId: string;
}

/** An active `LcpAnchor` contract as returned by a participant query. */
export interface LcpAnchorContract {
  contractId: string;
  templateId: string;
  payload: LcpAnchorPayload;
}

/** The Daml `create-LcpAnchor` command a buyer submits (`POST /v1/create` body shape). */
export interface CreateAnchorCommand {
  templateId: string;
  payload: LcpAnchorPayload;
}

/**
 * Reads/writes the participant over the Daml JSON Ledger API (HTTP, `fetch`-based). Injected so the
 * adapter is pure and testable; a live implementation wraps a participant URL + a party bearer JWT.
 */
export interface CantonParticipantReader {
  /** Query active `LcpAnchor` contracts whose `atrHash` `Text` field matches (64-char lowercase hex). */
  queryByAtrHash(atrHashText: string): Promise<LcpAnchorContract[]>;
  /** Fetch one `LcpAnchor` contract by its `contractId`, or `null` if it is not active. */
  fetchByContractId(contractId: string): Promise<LcpAnchorContract | null>;
}

/** Recover the atrHash from a set of queried anchors (the first that carries a well-formed atrHash). Pure. */
export function recoverAtrHashFromAnchors(
  anchors: LcpAnchorContract[],
): `0x${string}` | null {
  for (const a of anchors) {
    const atr = readAnchorAtrHash(a.payload);
    if (atr !== null) return atr;
  }
  return null;
}

/** The Canton overlay rail's surface. It anchors BESIDE the payment rather than inside it: `propose`
 *  returns a create-command for an `LcpAnchor` contract, so the atrHash lives on its own contract instance
 *  and `observe` reports `anchored`, not `settled`. That is the honest word — this rail records the weld,
 *  it does not witness the transfer. Use `@integraledger/lcp-binding-canton-x402` when the payment is an
 *  x402 Canton-Coin transfer, whose memo rides the transfer itself. */
export interface CantonAdapter {
  manifest: BindingManifest;
  /** Build the `create-LcpAnchor` command the buyer submits to anchor `atrHash` (buyer=signatory).
   *  `createdAt` is ISO-8601 UTC and is REQUIRED: the template declares it, and a command missing it is
   *  one the participant rejects. It is the caller's to supply — this builder does not read the clock. */
  propose(inputs: {
    packageId: string;
    buyer: string;
    seller: string;
    atrHash: string;
    paymentRef?: string;
    createdAt: string;
  }): CreateAnchorCommand;
  /** Recover the atrHash from a confirmed anchor, or a `verification-failure` Refusal if none binds. */
  recover(
    ref: CantonSettlementRef,
    reader: CantonParticipantReader,
  ): Promise<Outcome<`0x${string}`>>;
  /** Report the `anchored` transition (the contract is active and carries a valid atrHash). */
  observe(
    ref: CantonSettlementRef,
    reader: CantonParticipantReader,
  ): Promise<Outcome<{ state: "anchored"; atrHash: `0x${string}` }>>;
  /** Query the participant for the anchors bearing `atrHash` (a participant lookup — not a global index). */
  enumerate(
    atrHash: string,
    reader: CantonParticipantReader,
  ): Promise<CantonSettlementRef[]>;
}

/** Config for a live Daml JSON Ledger API participant reader. */
export interface CantonParticipantConfig {
  /** JSON Ledger API base URL — e.g. `https://164.92.95.184.nip.io`. */
  jsonLedgerUrl: string;
  /** Daml package id of the deployed lcp-anchor DAR (the DAR hash — set after `daml deploy`). */
  lcpAnchorPackageId: string;
  /** Bearer JWT authenticating the acting/reading party on the participant. */
  bearerJwt: string;
}

/**
 * A live `CantonParticipantReader` over the Daml JSON Ledger API v1 (`POST /v1/query`, `/v1/fetch`),
 * PURE `fetch` — no Daml SDK. Fails LOUD on a non-2xx response or a Daml `errors[]` envelope; a missing
 * contract surfaces as `null`/`[]` (an inactive-or-absent anchor is a value a query skips, not an error).
 */
export function makeCantonParticipantReader(
  cfg: CantonParticipantConfig,
): CantonParticipantReader {
  if (cfg.jsonLedgerUrl.length === 0)
    throw new Error("makeCantonParticipantReader: jsonLedgerUrl is empty");
  if (cfg.lcpAnchorPackageId.length === 0)
    throw new Error("makeCantonParticipantReader: lcpAnchorPackageId is empty");
  if (cfg.bearerJwt.length === 0)
    throw new Error("makeCantonParticipantReader: bearerJwt is empty");
  const templateId = lcpAnchorTemplateId(cfg.lcpAnchorPackageId);

  async function ledgerCall<T>(
    path: "/v1/query" | "/v1/fetch",
    body: unknown,
  ): Promise<T> {
    const res = await fetch(`${cfg.jsonLedgerUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${cfg.bearerJwt}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Daml ${path} HTTP ${res.status}: ${text}`);
    }
    const envelope = (await res.json()) as {
      result?: T;
      errors?: string[];
    };
    if (envelope.errors !== undefined && envelope.errors.length > 0)
      throw new Error(`Daml ${path} errors: ${envelope.errors.join("; ")}`);
    if (envelope.result === undefined)
      throw new Error(`Daml ${path} returned no result`);
    return envelope.result;
  }

  return {
    async queryByAtrHash(atrHashText: string): Promise<LcpAnchorContract[]> {
      const result = await ledgerCall<LcpAnchorContract[]>("/v1/query", {
        templateIds: [templateId],
        query: { atrHash: atrHashText },
      });
      return result;
    },
    async fetchByContractId(
      contractId: string,
    ): Promise<LcpAnchorContract | null> {
      const result = await ledgerCall<LcpAnchorContract | null>("/v1/fetch", {
        templateId,
        contractId,
      });
      return result ?? null;
    },
  };
}

/** Construct the Canton overlay adapter. **The manifest is injected, not baked in** — pass this package's
 *  own `CANTON_MANIFEST`; a manifest whose `rail` is not `"canton"` throws, because an adapter over another
 *  rail's manifest would publish that rail's claims as its own. This is the package's entry point, and it
 *  is useless without the `lcp-anchor` DAR deployed — the package id is the DAR's own hash. */
export function createCantonAdapter(manifest: BindingManifest): CantonAdapter {
  // Fail-fast: an adapter constructed over another rail's manifest would report that rail's claims as
  // this one's. The EVM adapters bake their module const in; the injectable factories refuse instead.
  // Stryker disable next-line all: the guard runs during test-module load (the repository's
  // test suite constructs the adapter at describe scope), so its mutants are 'static' — outside the vitest
  // runner's per-test attribution and unkillable by any test that in fact kills them behaviorally
  // (each rail pins both arms: valid manifest constructs, wrong rail throws by message).
  if (manifest.rail !== "canton")
    throw new Error(
      `createCantonAdapter: manifest.rail "${manifest.rail}" is not "canton"`,
    );
  // Closure helper (not `this`) so the returned methods stay destructure-safe.
  async function doRecover(
    ref: CantonSettlementRef,
    reader: CantonParticipantReader,
  ): Promise<Outcome<`0x${string}`>> {
    const contract = await reader.fetchByContractId(ref.contractId);
    const atr = contract === null ? null : readAnchorAtrHash(contract.payload);
    if (atr === null)
      return {
        refused: true,
        haltClass: "verification-failure",
        code: "canton/no-lcp-anchor",
        detail: `no active LcpAnchor carrying an atrHash at contractId ${ref.contractId}`,
      };
    return { ok: true, value: atr };
  }

  return {
    manifest,

    propose(inputs: {
      packageId: string;
      buyer: string;
      seller: string;
      atrHash: string;
      paymentRef?: string;
      createdAt: string;
    }): CreateAnchorCommand {
      return {
        templateId: lcpAnchorTemplateId(inputs.packageId),
        payload: buildAnchorPayload({
          buyer: inputs.buyer,
          seller: inputs.seller,
          atrHash: inputs.atrHash,
          createdAt: inputs.createdAt,
          // Spread conditionally: exactOptionalPropertyTypes forbids passing `paymentRef: undefined`
          // to an optional field (buildAnchorPayload defaults an ABSENT paymentRef to "").
          ...(inputs.paymentRef !== undefined
            ? { paymentRef: inputs.paymentRef }
            : {}),
        }),
      };
    },

    recover(
      ref: CantonSettlementRef,
      reader: CantonParticipantReader,
    ): Promise<Outcome<`0x${string}`>> {
      return doRecover(ref, reader);
    },

    async observe(
      ref: CantonSettlementRef,
      reader: CantonParticipantReader,
    ): Promise<Outcome<{ state: "anchored"; atrHash: `0x${string}` }>> {
      const rec = await doRecover(ref, reader);
      if ("refused" in rec) return rec;
      return { ok: true, value: { state: "anchored", atrHash: rec.value } };
    },

    async enumerate(
      atrHash: string,
      reader: CantonParticipantReader,
    ): Promise<CantonSettlementRef[]> {
      // Bare hex, because that is the participant index's key shape — this value is a QUERY argument,
      // never a comparison side. The comparison below is over decoded bytes (LCP §2.5).
      const queryKey = canonicalAtrHash(atrHash, "enumerate").slice(2);
      const anchors = await reader.queryByAtrHash(queryKey);
      const out: CantonSettlementRef[] = [];
      for (const a of anchors) {
        const atr = readAnchorAtrHash(a.payload);
        if (atr !== null && atrHashEquals(atr, atrHash))
          out.push({ contractId: a.contractId });
      }
      return out;
    },
  };
}
