/**
 * Live Canton (Daml) integration for the x402 transfer-memo binding. OPT-IN — it runs ONLY when a Canton
 * participant is supplied via env; otherwise it is skipped LOUD (never faked).
 *
 * **What this can and cannot prove, stated because the carrier move changed it.** The overlay binding this
 * replaced could weld end-to-end from a test: it CREATED an `LcpAnchor` contract itself, so propose → real
 * create → query → recover ran in one process. The memo cannot be welded that way, and that is a property
 * of the carrier rather than a gap in the test — the memo rides a `TransferFactory_Transfer` that a PAYER
 * signs and a FACILITATOR relays, so producing one requires funded Canton Coin, a payer key and a
 * facilitator. Fabricating it here would be a mock of the exact step the binding exists to verify.
 *
 * So this suite reads: given a real settled transfer that a real facilitator relayed, does the binding
 * recover the weld the seller advertised? The transfer's update id is supplied, not created.
 *
 * Required env (all must be set for the suite to run — any absent ⇒ skip loud):
 *   CANTON_JSON_API_URL   the Daml JSON Ledger API base URL (e.g. https://164.92.95.184.nip.io)
 *   CANTON_READER_JWT     a participant JWT whose readAs includes a stakeholder of the transfer
 *   CANTON_UPDATE_ID      the ledger update id of a settled x402 transfer carrying an LCP memo
 *   CANTON_EXPECTED_ATR   the atrHash the seller advertised in that payment's extra.memo
 */
import { describe, expect, it } from "vitest";
import {
  createCantonX402Adapter,
  makeCantonX402Reader,
} from "../src/adapter.js";
import { CANTON_X402_MANIFEST } from "../src/manifest.js";

const URL_ = process.env["CANTON_JSON_API_URL"];
const JWT = process.env["CANTON_READER_JWT"];
const UPDATE_ID = process.env["CANTON_UPDATE_ID"];
const EXPECTED_ATR = process.env["CANTON_EXPECTED_ATR"];

const ready =
  URL_ !== undefined &&
  JWT !== undefined &&
  UPDATE_ID !== undefined &&
  EXPECTED_ATR !== undefined;
const suite = ready ? describe : describe.skip;

suite("binding-canton — live participant (CANTON_JSON_API_URL set)", () => {
  it("recovers the advertised atrHash from a settled x402 transfer", async () => {
    // Non-null: `ready` above narrowed these, but env reads are `string | undefined` in a closure.
    const jsonLedgerUrl = URL_ as string;
    const bearerJwt = JWT as string;
    const updateId = UPDATE_ID as string;
    const expected = EXPECTED_ATR as string;

    const reader = makeCantonX402Reader({ jsonLedgerUrl, bearerJwt });
    const adapter = createCantonX402Adapter(CANTON_X402_MANIFEST);

    const recovered = await adapter.recover({ updateId }, reader);
    expect("ok" in recovered && recovered.ok).toBe(true);
    if ("ok" in recovered) expect(recovered.value).toBe(expected.toLowerCase());

    // …and the asset the weld is attached to, which is the whole point of `assetBinding: "carried"`.
    const observed = await adapter.observe({ updateId }, reader);
    expect("ok" in observed && observed.ok).toBe(true);
    if ("ok" in observed) {
      expect(observed.value.state).toBe("settled");
      expect(observed.value.receiver.length).toBeGreaterThan(0);
      expect(observed.value.amount).toMatch(/^\d+$/);
      expect(observed.value.instrumentId.id.length).toBeGreaterThan(0);
    }
  });
});
