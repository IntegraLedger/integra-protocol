// x402/upto/xrpl through the settler's HTTP surface, against lcp's vectors (x402-upto-xrpl.json): the payer's channel,
// made by the vector's create, and its claim, which the module checks against the channel at the validated ledger; and
// the PaymentChannelClaim the resource server signs at settlement, made and signed by xrpl.js with the key the vector's
// `other` entropy derives, which the stub's ledger names as payTo's regular key. The rippled stub answers every call as
// the ledger the vector's create makes would: the channel's fields are the create's, its balance 0.
import { readFileSync } from "node:fs";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { ECDSA, encodeForSigningClaim, hashes, Wallet } from "xrpl";
import { afterEach, describe, expect, it } from "vitest";
import { serveSettler } from "../src/core.js";
import { listed } from "../src/modules/index.js";
import { starter } from "../src/modules/xrpl/index.js";
import { CREDENTIAL, serving, type Serving } from "./routes.js";
import { stub, type Stub } from "./support.js";

const V = JSON.parse(readFileSync(new URL("../../lcp/vectors/x402-upto-xrpl.json", import.meta.url), "utf8"));
const NETWORK = V.fixed.O.network as "xrpl:1";
const O: PaymentRequirements = V.fixed.O;
const P: PaymentPayload = V.fixed.P;
const CREATE = V.create.txJson;
/** The validated ledger: one minute after the option's validAfter, in seconds since the Ripple epoch. */
const CLOSE_TIME = O.extra["validAfter"] as number - 946_684_800 + 60;
const VALIDATED = 990;

/** The resource server's key: the vector's `other` entropy, under XRPL's Ed25519 derivation, payTo's regular key here. */
const SERVER = Wallet.fromEntropy(Buffer.alloc(16, 3), { algorithm: ECDSA.ed25519 });
/** A key payTo does not answer to: the vector's `elsewhere` entropy. */
const STRANGER = Wallet.fromEntropy(Buffer.alloc(16, 4), { algorithm: ECDSA.ed25519 });

function answer(method: string, p: Record<string, unknown>): unknown {
  switch (method) {
    case "ledger_entry":
      return p["payment_channel"] === V.create.channel
        ? {
            node: {
              LedgerEntryType: "PayChannel",
              Account: CREATE.Account,
              Destination: CREATE.Destination,
              Amount: CREATE.Amount,
              Balance: "0",
              PublicKey: CREATE.PublicKey,
              SettleDelay: CREATE.SettleDelay,
              CancelAfter: CREATE.CancelAfter,
            },
            validated: true,
            status: "success",
          }
        : { error: "entryNotFound", status: "error" };
    case "ledger":
      return { ledger_index: VALIDATED, ledger: { close_time: CLOSE_TIME }, validated: true, status: "success" };
    case "account_info":
      return { account_data: { Account: p["account"], Flags: 0, RegularKey: SERVER.classicAddress, Sequence: 1 }, validated: true, status: "success" };
    case "submit":
      return { engine_result: "tesSUCCESS", tx_json: { hash: hashes.hashSignedTx(p["tx_blob"] as string) }, status: "success" };
    case "tx":
      return { validated: true, meta: { TransactionResult: "tesSUCCESS" }, status: "success" };
    default:
      return { error: "unknownCmd", status: "error" };
  }
}

let node: Stub | undefined;
let settler: Serving | undefined;
afterEach(async () => {
  await settler?.close();
  await node?.close();
  settler = node = undefined;
});

async function serve(): Promise<Serving> {
  node = await stub((_path, body) => {
    const { method, params } = body as { method: string; params: Record<string, unknown>[] };
    return { result: answer(method, params[0] ?? {}) };
  });
  const xrpl = [{ network: NETWORK, node: node.url, waitMs: 3_000 }];
  const LIST = [listed("xrpl", async () => ({ starter }))] as const;
  settler = await serving((port, url) =>
    serveSettler({ listen: `127.0.0.1:${port}`, store: { url }, settleWaitMs: 5_000, credential: CREDENTIAL, operatorLog: () => {}, xrpl }, LIST),
  );
  return settler;
}

const body = (payload: PaymentPayload, requirements: PaymentRequirements = O) => ({ x402Version: 2, paymentPayload: payload, paymentRequirements: requirements });
const methods = () => node!.calls.map((c) => (c.body as { method: string }).method);

/** The PaymentChannelClaim the resource server signs for the settle-time charge, closing the channel, by xrpl.js. */
function settlement(by: Wallet, charge: string): string {
  return by.sign({
    TransactionType: "PaymentChannelClaim",
    Account: O.payTo,
    Channel: P.payload["channelId"] as string,
    Balance: charge,
    Amount: P.payload["maxAmount"] as string,
    Signature: P.payload["signature"] as string,
    PublicKey: P.payload["publicKey"] as string,
    Flags: 0x00020000,
    Fee: "12",
    Sequence: 1,
    LastLedgerSequence: VALIDATED + 20,
  }).tx_blob;
}

describe("x402/upto/xrpl through the XRPL module", () => {
  it("states the upto kind: its pairing, no key, and that it takes no zero", async () => {
    const s = await serve();
    const kinds = ((await s.supported()) as { kinds: { scheme: string; extra: unknown }[] }).kinds;
    expect(kinds.find((k) => k.scheme === "upto")).toEqual({
      x402Version: 2,
      scheme: "upto",
      network: NETWORK,
      extra: { key: "none", acceptsZero: [], pairings: ["x402/upto/xrpl"] },
    });
  });

  it("verifies the vector's payment against the channel its create makes, its claim over lcp's claim bytes", async () => {
    expect(encodeForSigningClaim({ channel: V.claim.channel, amount: V.claim.drops } as never)).toBe(V.claim.expect);
    const s = await serve();
    expect(await s.verify(body(P))).toEqual({ isValid: true, payer: CREATE.Account });
    const forged = { ...P, payload: { ...P.payload, signature: (P.payload["signature"] as string).replace(/.$/, (c) => (c === "7" ? "8" : "7")) } };
    expect(await s.verify(body(forged))).toMatchObject({ isValid: false, invalidReason: "invalid_upto_xrpl_payload_signature" });
  });

  it("refuses lcp's refusal vectors for the payment and its option before any node call", async () => {
    const s = await serve();
    const changed = (path: string, row: { value?: unknown; remove?: unknown }): PaymentPayload => {
      const copy = JSON.parse(JSON.stringify(P));
      const keys = path.split("/").slice(1);
      const last = keys.pop()!;
      const at = keys.reduce((o, k) => o[k], copy);
      if (row.remove !== undefined) delete at[last];
      else at[last] = row.value;
      return copy;
    };
    const rows = [
      ...V.bound.rows.map((r: { case: string; path: string; value?: unknown; remove?: unknown; expect: string }) => ({ case: r.case, payload: changed(r.path, r), code: r.expect })),
      ...V.boundAccepted.rows.map((r: { case: string; accepted: PaymentRequirements; expect: string }) => ({ case: r.case, payload: { ...P, accepted: r.accepted }, code: r.expect })),
    ];
    expect(rows.length).toBeGreaterThan(1);
    const reasonOf = (code: string) =>
      code === "x402/not-v2" ? "invalid_x402_version" : code.startsWith("x402/option") || code === "xrpl/currency-not-xrp" ? "invalid_payment_requirements" : "invalid_payload";
    for (const r of rows) {
      expect([r.case, await s.verify(body(r.payload))]).toEqual([r.case, { isValid: false, invalidReason: reasonOf(r.code) }]);
    }
    expect(node!.calls).toEqual([]);
  });

  it("settles the server's claim for the actual charge once, under its hash, and answers a repeat by that row", async () => {
    const s = await serve();
    const settleTerms = V.fixed.OSettle as PaymentRequirements;
    const blob = settlement(SERVER, settleTerms.amount);
    const paid = { ...P, payload: { ...P.payload, settlementTransaction: blob } };
    const hash = hashes.hashSignedTx(blob);
    expect(await s.settle(body(paid, settleTerms))).toEqual({ success: true, transaction: hash, network: NETWORK, payer: CREATE.Account, amount: settleTerms.amount });
    expect(await s.settle(body(paid, settleTerms))).toEqual({ success: false, errorReason: "invalid_transaction_state", transaction: hash, network: NETWORK });
    expect(methods().filter((m) => m === "submit")).toHaveLength(1);
  });

  it("refuses at /verify a payment carrying the settlement transaction, which the resource server adds at /settle alone", async () => {
    const s = await serve();
    const paid = { ...P, payload: { ...P.payload, settlementTransaction: settlement(SERVER, O.amount) } };
    expect(await s.verify(body(paid))).toEqual({
      isValid: false,
      invalidReason: "invalid_upto_xrpl_payload_unexpected_settlement_transaction",
      payer: CREATE.Account,
    });
  });

  it("settles a charge of zero as the scheme's bare close, which carries no claim", async () => {
    const s = await serve();
    const zero = { ...(V.fixed.OSettle as PaymentRequirements), amount: "0" };
    const close = SERVER.sign({
      TransactionType: "PaymentChannelClaim",
      Account: O.payTo,
      Channel: P.payload["channelId"] as string,
      Flags: 0x00020000,
      Fee: "12",
      Sequence: 1,
      LastLedgerSequence: VALIDATED + 20,
    }).tx_blob;
    const paid = { ...P, payload: { ...P.payload, settlementTransaction: close } };
    expect(await s.settle(body(paid, zero))).toEqual({ success: true, transaction: hashes.hashSignedTx(close), network: NETWORK, payer: CREATE.Account, amount: "0" });
  });

  it("refuses a claim signed by a key payTo does not answer to, submitting nothing", async () => {
    const s = await serve();
    const settleTerms = V.fixed.OSettle as PaymentRequirements;
    const paid = { ...P, payload: { ...P.payload, settlementTransaction: settlement(STRANGER, settleTerms.amount) } };
    expect(await s.settle(body(paid, settleTerms))).toMatchObject({ success: false, errorReason: "invalid_upto_xrpl_settlement_signer_not_authorized" });
    expect(methods()).not.toContain("submit");
  });
});
