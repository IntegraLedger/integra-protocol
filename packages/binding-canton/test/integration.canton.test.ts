/**
 * Live Canton (Daml) integration for the `LcpAnchor` overlay-contract binding. OPT-IN — it runs ONLY when
 * a Canton participant is supplied via env (the DO Canton sandbox, `https://164.92.95.184.nip.io`, per
 * project_canton_sandbox_on_do); otherwise it is skipped LOUD (never faked). It welds a real atrHash by
 * creating an `LcpAnchor` contract on the participant (`POST /v1/create`, buyer=signatory) and recovers it
 * through the live `makeCantonParticipantReader` — proving propose → real create → participant query →
 * recover end-to-end.
 *
 * Required env (all must be set for the suite to run — any absent ⇒ skip loud):
 *   CANTON_JSON_API_URL          the Daml JSON Ledger API base URL (e.g. https://164.92.95.184.nip.io)
 *   CANTON_LCP_ANCHOR_PACKAGE_ID the deployed lcp-anchor DAR package id
 *   CANTON_BUYER_JWT             a participant JWT whose actAs includes the buyer party
 *   CANTON_BUYER_PARTY           the buyer Daml party id (the contract signatory)
 *   CANTON_SELLER_PARTY          the seller Daml party id (the contract observer)
 */
import { hashAtr } from "@integraledger/lcp-kernel";
import { describe, expect, it } from "vitest";
import {
  createCantonAdapter,
  makeCantonParticipantReader,
} from "../src/adapter.js";
import { CANTON_MANIFEST } from "../src/manifest.js";

const URL_ = process.env["CANTON_JSON_API_URL"];
const PKG = process.env["CANTON_LCP_ANCHOR_PACKAGE_ID"];
const JWT = process.env["CANTON_BUYER_JWT"];
const BUYER = process.env["CANTON_BUYER_PARTY"];
const SELLER = process.env["CANTON_SELLER_PARTY"];

const ready =
  URL_ !== undefined &&
  PKG !== undefined &&
  JWT !== undefined &&
  BUYER !== undefined &&
  SELLER !== undefined;
const suite = ready ? describe : describe.skip;

suite("binding-canton — live participant (CANTON_JSON_API_URL set)", () => {
  it("anchors an atrHash in an LcpAnchor contract and recovers it", async () => {
    // Non-null: `ready` above narrowed these, but env reads are `string | undefined` in a closure.
    const jsonLedgerUrl = URL_ as string;
    const lcpAnchorPackageId = PKG as string;
    const bearerJwt = JWT as string;
    const buyer = BUYER as string;
    const seller = SELLER as string;

    const atrHash = await hashAtr(
      new TextEncoder().encode(`# Terms\nid: 0xcanton-sandbox-${Date.now()}\n`),
    );

    const adapter = createCantonAdapter(CANTON_MANIFEST);
    const cmd = adapter.propose({
      packageId: lcpAnchorPackageId,
      buyer,
      seller,
      atrHash,
      createdAt: new Date().toISOString(),
    });

    // Create the LcpAnchor contract (buyer=signatory) via the Daml JSON Ledger API.
    const res = await fetch(`${jsonLedgerUrl}/v1/create`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${bearerJwt}`,
      },
      body: JSON.stringify({
        templateId: cmd.templateId,
        // The command is submitted AS BUILT. Until 2026-09-03 this line read
        // `{ ...cmd.payload, createdAt: … }`, patching in a field the template requires and the codec
        // never sent — so the only create that ever worked was this harness's, and every consumer's
        // `propose()` would have been rejected by the participant.
        payload: cmd.payload,
      }),
    });
    expect(res.ok).toBe(true);
    const envelope = (await res.json()) as {
      result?: { contractId: string };
      errors?: string[];
    };
    expect(envelope.errors ?? []).toEqual([]);
    const contractId = envelope.result?.contractId;
    expect(typeof contractId).toBe("string");

    const reader = makeCantonParticipantReader({
      jsonLedgerUrl,
      lcpAnchorPackageId,
      bearerJwt,
    });
    const recovered = await adapter.recover(
      { contractId: contractId as string },
      reader,
    );
    expect("refused" in recovered).toBe(false);
    if (!("refused" in recovered)) expect(recovered.value).toBe(atrHash);
  }, 60_000);
});
