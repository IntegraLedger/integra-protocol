/**
 * The Canton adapter — thin I/O over an injected participant-reader port. It is a **Canton-native
 * surface**, NOT binding-core's `WeldAdapter`: that port is EVM-shaped (`SettlementRef` is a `0x`-hex tx
 * hash, `ChainReader` speaks `eth_getLogs`), whereas a Canton settlement is a ledger update read via the
 * Daml JSON Ledger API over HTTP.
 *
 * **THE CARRIER.** x402's `exact` scheme for Canton: the seller advertises `PaymentRequirements.extra.memo`,
 * the payer MUST echo it into the transfer's metadata under `x402.memo`, and the facilitator MUST reject
 * `invalid_exact_canton_memo_mismatch` if the two disagree. One transaction settles each payment (scheme
 * §Protocol Flow): the payer signs a `TransferFactory_Transfer` naming the merchant as receiver and does
 * NOT submit it; the facilitator relays the signed submission and pays the traffic fee; the merchant's
 * standing `TransferPreapproval` resolves it `direct`.
 *
 * So the weld, the value and the settlement are one on-ledger event, and `recover` reads all three off a
 * single update. The `LcpAnchor` overlay this replaced pointed at a SEPARATE contract — which is exactly
 * why it could bind no asset: the thing it referenced was not the thing that moved the money.
 *
 * `recover` refuses rather than throwing: an update under audit may be any transaction on the party's
 * stream, and "this is not an LCP settlement" is an answer, not an error. `propose` throws, because a
 * seller advertising a malformed memo is a wiring defect and the facilitator would reject the payment.
 */
import type { BindingManifest, Outcome } from "@integraledger/lcp-binding-core";
import { atrHashEquals, isAtrHash } from "@integraledger/lcp-kernel";
import { readTransferMemoAtrHash, x402MemoRequirement } from "./memo.js";

/**
 * A Canton settlement reference — the ledger update id of the transfer the facilitator relayed.
 *
 * One id, because one transaction settles each payment.
 */
export interface CantonX402SettlementRef {
  updateId: string;
}

/**
 * A settled `TransferFactory_Transfer` as one participant sees it.
 *
 * The asset fields are carried rather than decoded and discarded, and that is what lets the manifest
 * declare `assetBinding: "carried"` honestly: the axis asks whether a CONSUMER can reach the asset the
 * weld is attached to, not merely whether the chain recorded it.
 */
export interface CantonX402TransferView {
  /** The transfer's on-ledger metadata map. The memo rides `x402.memo` (scheme safety check 12). */
  meta: Readonly<Record<string, string>>;
  /** Receiving party id — the merchant's `payTo` in the scheme's `PaymentRequirements`. */
  receiver: string;
  /** Atomic units as an integer string (1 CC = 1e10 units), exactly as the ledger records it. */
  amount: string;
  /** The Canton Coin instrument identifier `{ admin, id }`. */
  instrumentId: { admin: string; id: string };
}

/** What a settled LCP transfer yields: the weld, and the asset it is welded to. */
export interface CantonX402Settlement {
  state: "settled";
  atrHash: `0x${string}`;
  receiver: string;
  amount: string;
  instrumentId: { admin: string; id: string };
}

/**
 * Reads the participant's update stream over the Daml JSON Ledger API. Injected so the adapter is pure
 * and testable; a live implementation wraps a participant URL and a party bearer JWT.
 */
export interface CantonX402Reader {
  /** One settled transfer by ledger update id, or `null` if the participant has no such update. */
  transferView(updateId: string): Promise<CantonX402TransferView | null>;
  /** Update ids of transfers visible to `party`, most recent first. A participant view, not an index. */
  transfersFor(party: string, limit?: number): Promise<string[]>;
}

/** The Canton x402 rail's surface. `propose` returns an `extra` fragment for the SELLER to merge into its
 *  `PaymentRequirements` — this rail's weld is committed by the seller and echoed by the payer, unlike the
 *  memo rails where the payer chooses the value. Its reach is exactly x402's `exact` Canton scheme, which
 *  settles Canton Coin only; anything else on Canton needs `@integraledger/lcp-binding-canton`'s overlay. */
export interface CantonX402Adapter {
  manifest: BindingManifest;
  /**
   * The `extra` fragment the seller merges into its x402 `PaymentRequirements`, committing it to the memo
   * the payer must echo. Throws on a malformed atrHash.
   */
  propose(atrHash: string): { readonly memo: string };
  /** Recover the atrHash from a settled transfer, or a `verification-failure` Refusal if none binds. */
  recover(
    ref: CantonX402SettlementRef,
    reader: CantonX402Reader,
  ): Promise<Outcome<`0x${string}`>>;
  /** Report the `settled` transition, with the asset the weld is attached to. */
  observe(
    ref: CantonX402SettlementRef,
    reader: CantonX402Reader,
  ): Promise<Outcome<CantonX402Settlement>>;
  /** Scan one party's visible transfers for `atrHash` — a participant view, never a global index. */
  enumerate(
    atrHash: string,
    party: string,
    reader: CantonX402Reader,
    limit?: number,
  ): Promise<CantonX402SettlementRef[]>;
}

/** Config for a live participant reader over a deployment's HTTP ledger surface. */
export interface CantonX402ReaderConfig {
  /** Ledger API base URL — e.g. `https://participant.example`. */
  jsonLedgerUrl: string;
  /** Bearer JWT authenticating the reading party on the participant. */
  bearerJwt: string;
  /**
   * The path, relative to `jsonLedgerUrl`, that answers ONE update id with its transfer view. POSTed a
   * `{ updateId }` body; answers a Daml `{ result, errors }` envelope.
   *
   * ⛔ **REQUIRED, and deliberately not defaulted.** This package shipped `/v1/updates/transfer` as a
   * constant, and that is not an endpoint of any published Daml JSON API version: v1 defines
   * `/v1/create`, `/v1/exercise`, `/v1/query` and `/v1/fetch` and no `updates` family at all, and the
   * update endpoints that do exist live under `/v2/`. Nothing in this repository could have caught it —
   * the only assertion over it is a stubbed `fetch` compared against the URL the code itself builds, so
   * the test and the code restate one guess.
   *
   * The honest shape is configuration rather than a better guess. A Canton Coin
   * `TransferFactory_Transfer` is a token-standard object, and how a given deployment exposes one over
   * HTTP — stock JSON Ledger API version, scan proxy, or a facilitator's own service — is a property of
   * that deployment. This package will not invent it: supply the path your participant answers on.
   */
  transferPath: string;
  /**
   * The path, relative to `jsonLedgerUrl`, that answers one party's visible transfer update ids. POSTed a
   * `{ party, limit? }` body. REQUIRED for the same reason as {@link CantonX402ReaderConfig.transferPath};
   * it shipped as `/v1/updates/transfers`.
   */
  transfersPath: string;
}

/**
 * A live `CantonX402Reader` over a participant's HTTP ledger surface, PURE `fetch` — no Daml SDK.
 *
 * Fails LOUD on a non-2xx response or a Daml `errors[]` envelope; an absent update surfaces as `null`,
 * because a reference the participant cannot see is a value the caller must classify, not a transport
 * failure. No package id is required — the memo rides the CIP-56 token-standard transfer, so unlike the
 * overlay this replaced there is no deployment-specific DAR to deploy or configure.
 *
 * ⛔ **The two endpoint paths are yours to supply, and are refused when empty.** See
 * {@link CantonX402ReaderConfig.transferPath}: the constants this once shipped named no endpoint of any
 * published Daml JSON API version, and the only thing asserting them was a stubbed `fetch` compared with
 * the URL this function builds — a test and a code path restating one guess to each other.
 */
export function makeCantonX402Reader(
  cfg: CantonX402ReaderConfig,
): CantonX402Reader {
  if (cfg.jsonLedgerUrl.length === 0)
    throw new Error("makeCantonX402Reader: jsonLedgerUrl is empty");
  if (cfg.bearerJwt.length === 0)
    throw new Error("makeCantonX402Reader: bearerJwt is empty");
  // Fail at CONSTRUCTION, not at the first read: an empty path would POST to the base URL, and a
  // participant answering something at `/` would be read as a transfer view.
  if (cfg.transferPath.length === 0)
    throw new Error(
      "makeCantonX402Reader: transferPath is empty — this package does not guess your participant's update endpoint",
    );
  if (cfg.transfersPath.length === 0)
    throw new Error(
      "makeCantonX402Reader: transfersPath is empty — this package does not guess your participant's update endpoint",
    );

  async function ledgerCall<T>(path: string, body: unknown): Promise<T> {
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
    const envelope = (await res.json()) as { result?: T; errors?: string[] };
    if (envelope.errors !== undefined && envelope.errors.length > 0)
      throw new Error(`Daml ${path} errors: ${envelope.errors.join("; ")}`);
    if (envelope.result === undefined)
      throw new Error(`Daml ${path} returned no result`);
    return envelope.result;
  }

  return {
    async transferView(
      updateId: string,
    ): Promise<CantonX402TransferView | null> {
      const result = await ledgerCall<CantonX402TransferView | null>(
        cfg.transferPath,
        { updateId },
      );
      return result ?? null;
    },
    async transfersFor(party: string, limit?: number): Promise<string[]> {
      return ledgerCall<string[]>(cfg.transfersPath, {
        party,
        ...(limit !== undefined ? { limit } : {}),
      });
    },
  };
}

/** Construct the Canton x402 adapter. **The manifest is injected, not baked in** — pass this package's own
 *  `CANTON_X402_MANIFEST`; a manifest whose `rail` is not `"canton:x402"` throws, because an adapter over
 *  another rail's manifest would publish that rail's claims as its own. Nothing has to be deployed first:
 *  the memo rides the token-standard transfer, so there is no DAR here. This is the package's entry point. */
export function createCantonX402Adapter(
  manifest: BindingManifest,
): CantonX402Adapter {
  // Fail-fast: an adapter constructed over another rail's manifest would report that rail's claims as
  // this one's. The EVM adapters bake their module const in; the injectable factories refuse instead.
  // Stryker disable next-line all: the guard runs during test-module load (the repository's
  // test suite constructs the adapter at describe scope), so its mutants are 'static' — outside the vitest
  // runner's per-test attribution and unkillable by any test that in fact kills them behaviorally
  // (each rail pins both arms: valid manifest constructs, wrong rail throws by message).
  if (manifest.rail !== "canton:x402")
    throw new Error(
      `createCantonX402Adapter: manifest.rail "${manifest.rail}" is not "canton:x402"`,
    );

  // Closure helper (not `this`) so the returned methods stay destructure-safe.
  async function readSettlement(
    ref: CantonX402SettlementRef,
    reader: CantonX402Reader,
  ): Promise<Outcome<CantonX402Settlement>> {
    const view = await reader.transferView(ref.updateId);
    if (view === null)
      return {
        refused: true,
        haltClass: "verification-failure",
        code: "canton/no-such-update",
        detail: `the participant has no transfer at updateId ${ref.updateId}`,
      };
    const atrHash = readTransferMemoAtrHash(view.meta);
    if (atrHash === null)
      return {
        refused: true,
        haltClass: "verification-failure",
        code: "canton/no-lcp-memo",
        detail: `the transfer at updateId ${ref.updateId} carries no well-formed atrHash under x402.memo`,
      };
    return {
      ok: true,
      value: {
        state: "settled",
        atrHash,
        receiver: view.receiver,
        amount: view.amount,
        instrumentId: view.instrumentId,
      },
    };
  }

  return {
    manifest,

    propose(atrHash: string): { readonly memo: string } {
      return x402MemoRequirement(atrHash);
    },

    async recover(
      ref: CantonX402SettlementRef,
      reader: CantonX402Reader,
    ): Promise<Outcome<`0x${string}`>> {
      const settlement = await readSettlement(ref, reader);
      return "refused" in settlement
        ? settlement
        : { ok: true, value: settlement.value.atrHash };
    },

    observe(
      ref: CantonX402SettlementRef,
      reader: CantonX402Reader,
    ): Promise<Outcome<CantonX402Settlement>> {
      return readSettlement(ref, reader);
    },

    async enumerate(
      atrHash: string,
      party: string,
      reader: CantonX402Reader,
      limit?: number,
    ): Promise<CantonX402SettlementRef[]> {
      // Fail-fast, like propose: a malformed atrHash can never match a decoded memo, and the silent []
      // it would produce is indistinguishable from "this party has no settlements".
      if (!isAtrHash(atrHash))
        throw new Error(
          `enumerate: atrHash must be a 0x-prefixed 32-byte value, got "${atrHash}"`,
        );
      const updateIds = await reader.transfersFor(party, limit);
      const out: CantonX402SettlementRef[] = [];
      for (const updateId of updateIds) {
        const view = await reader.transferView(updateId);
        const found = view === null ? null : readTransferMemoAtrHash(view.meta);
        if (found !== null && atrHashEquals(found, atrHash))
          out.push({ updateId });
      }
      return out;
    },
  };
}
