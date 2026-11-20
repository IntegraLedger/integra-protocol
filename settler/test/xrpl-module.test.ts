// The XRPL module against lcp's vectors for x402/exact/xrpl: @x402/xrpl 2.31.0's class, unchanged, for a payment signed
// with one key, and the own path for a multisigned payer, each against a local rippled JSON-RPC server, through the
// settler's HTTP surface and, for the paths' own checks, the module itself. Every expected answer is the vector's (a
// hash, a code, the payer's instrument) or the ledger's rule the case names.
import { readFileSync } from "node:fs";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { decode, encode, hashes } from "xrpl";
import { afterEach, describe, expect, it } from "vitest";
import { serveSettler } from "../src/core.js";
import type { Module, Registration, X402Payment } from "../src/module.js";
import { listed } from "../src/modules/index.js";
import { isMultisigned, starter, xrplRegistration } from "../src/modules/xrpl/index.js";
import { CREDENTIAL, serving, type Serving } from "./routes.js";
import { stub, type Stub } from "./support.js";

const V = JSON.parse(readFileSync(new URL("../../lcp/vectors/x402-exact-xrpl.json", import.meta.url), "utf8"));
const NETWORK = "xrpl:1" as const;
const PAYER = V.fixed.payer as string;
/** The multisigned rows' signers, from Ed25519 entropy 03x16, 04x16 and 05x16, as the vector file names them. */
const SIGNERS = ["rPPdduC9MRTrXZP1J7MQyEKKEYiFigWZ6Q", "rfPaNmieF15VqV752Q8qAc6ugtkKhWsA2R", "rH9ESAdrFfDAZtCZGa7JiwNJfKnC6CmGFQ"];
const PRESENTED = V.buyer.rows[1].input.presented;

let node: Stub | undefined;
let settler: Serving | undefined;
afterEach(async () => {
  await settler?.close();
  await node?.close();
  settler = node = undefined;
});

/** A validated ledger below the payments' LastLedgerSequence, 1000; the payer's next Sequence is 7, the signed one. */
function answer(method: string, p: Record<string, unknown>, quorum: number): unknown {
  switch (method) {
    case "ledger":
      return { ledger_index: 990, validated: true, status: "success" };
    case "account_info":
      return { account_data: { Account: p["account"], Sequence: 7, Flags: 0 }, ledger_index: 990, validated: true, status: "success" };
    case "account_objects":
      return {
        account_objects: [
          {
            LedgerEntryType: "SignerList",
            SignerQuorum: quorum,
            SignerEntries: SIGNERS.map((a) => ({ SignerEntry: { Account: a, SignerWeight: 1 } })),
          },
        ],
        status: "success",
      };
    case "simulate": {
      // rippled refuses to simulate a signed transaction, answering `transactionSigned` (xrpl.org, the simulate method: "The
      // simulated transaction must be unsigned"); rippled 3.4.1 on the XRPL testnet answered so to a signed blob.
      const tx = p["tx_json"] ?? (typeof p["tx_blob"] === "string" ? decode(p["tx_blob"]) : undefined);
      if (typeof tx !== "object" || tx === null || "TxnSignature" in tx || "Signers" in tx) return { error: "transactionSigned", status: "error" };
      return { engine_result: "tesSUCCESS", status: "success" };
    }
    case "submit":
      return { engine_result: "tesSUCCESS", tx_json: { hash: hashes.hashSignedTx(p["tx_blob"] as string) }, status: "success" };
    case "tx":
      return { validated: true, meta: { TransactionResult: "tesSUCCESS" }, status: "success" };
    default:
      return { error: "unknownCmd", status: "error" };
  }
}

async function nodeOn(quorum: number): Promise<Stub> {
  return stub((_path, body) => {
    const { method, params } = body as { method: string; params: Record<string, unknown>[] };
    return { result: answer(method, params[0] ?? {}, quorum) };
  });
}

async function registrationOn(quorum = 2): Promise<Registration> {
  node = await nodeOn(quorum);
  return xrplRegistration({ network: NETWORK, node: node.url, waitMs: 5_000 });
}

/** The settler with the module on the vector's network, through its core, over a fresh database. */
async function serve(quorum = 2): Promise<Serving> {
  node = await nodeOn(quorum);
  const xrpl = [{ network: NETWORK, node: node.url, waitMs: 5_000 }];
  const LIST = [listed("xrpl", async () => ({ starter }))] as const;
  settler = await serving((port, url) =>
    serveSettler({ listen: `127.0.0.1:${port}`, store: { url }, settleWaitMs: 5_000, credential: CREDENTIAL, operatorLog: () => {}, xrpl }, LIST),
  );
  return settler;
}

const body = (p: X402Payment) => ({ x402Version: 2, paymentPayload: p.payload, paymentRequirements: p.requirements });
const submitted = () =>
  node!.calls.filter((c) => (c.body as { method: string }).method === "submit").map((c) => (c.body as { params: { tx_blob: string }[] }).params[0]!.tx_blob);

const methods = () => node!.calls.map((c) => (c.body as { method: string }).method);

function payment(blob: string, accepted: PaymentRequirements = PRESENTED.accepted): X402Payment {
  const payload: PaymentPayload = { x402Version: 2, accepted, payload: { signedTxBlob: blob } };
  return { payload, requirements: accepted };
}

/** The module the wrapper hands a payment to: the first own module that claims it, else the registration's. */
function routed(r: Registration, p: X402Payment): Module {
  const own = r.own.find((h) =>
    h.claim.by === "option" ? h.claim.claims(p.requirements) : h.claim.claims(p.payload, p.requirements),
  );
  return own?.module ?? r.module;
}

describe("the XRPL module through the settler's HTTP surface", () => {
  it("states the pairing it submits, no key, no signer, and that it takes no zero", async () => {
    const s = await serve();
    const kinds = ((await s.supported()) as { kinds: { scheme: string }[] }).kinds;
    expect(kinds.find((k) => k.scheme === "exact")).toMatchObject({
      x402Version: 2,
      network: NETWORK,
      extra: { key: "none", acceptsZero: [], pairings: ["x402/exact/xrpl"] },
    });
  });

  it("verifies V2's payment and settles it under V2's transaction hash, submitting V2's blob once", async () => {
    const s = await serve();
    const p = payment(V.V2.blob, V.V2.accepted);
    expect(await s.verify(body(p))).toEqual({ isValid: true, payer: PAYER });
    expect(await s.settle(body(p))).toMatchObject({ success: true, transaction: V.V2.expectReference.transaction, network: NETWORK, payer: PAYER });
    expect(submitted()).toEqual([V.V2.blob]);
  });

  it("settles one of two quorum copies of one payment, and answers the other by that row: one submission", async () => {
    const [three, two] = V.multisigned.rows as { case: string; blob: string; hash: string }[];
    expect(three!.hash).not.toBe(two!.hash);
    const s = await serve(2);
    expect(await s.settle(body(payment(three!.blob, V.V2.accepted)))).toEqual({ success: true, transaction: three!.hash, network: NETWORK, payer: PAYER });
    expect(await s.settle(body(payment(two!.blob, V.V2.accepted)))).toEqual({
      success: false,
      errorReason: "invalid_transaction_state",
      transaction: three!.hash,
      network: NETWORK,
    });
    expect(await s.verify(body(payment(two!.blob, V.V2.accepted)))).toMatchObject({ isValid: false, invalidReason: "invalid_transaction_state" });
    expect(submitted()).toEqual([three!.blob]);
  });
});

describe("a payment signed with one key, through the published class", () => {
  it("refuses each refusal vector of the pairing with lcp's code before the class, reading no node", async () => {
    const r = await registrationOn();
    const rows = V.boundAccepted.rows.map((x: { case: string; accepted: PaymentRequirements; expect: string }) => ({
      case: x.case,
      p: { payload: { ...PRESENTED, accepted: x.accepted }, requirements: x.accepted } as X402Payment,
      code: x.expect,
    }));
    rows.push({ case: "V3: the InvoiceID is H itself, not its digest", p: payment(V.V3.blob, V.V2.accepted), code: "xrpl/carrier-mismatch" });
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) {
      const verify = await r.module.facilitator.verify(row.p.payload, row.p.requirements);
      expect([row.case, verify.isValid]).toEqual([row.case, false]);
      if (row.case.startsWith("V3")) {
        expect(verify).toMatchObject({ invalidReason: "invalid_payload" });
        continue;
      }
      const reason = row.code.startsWith("x402/option") ? "invalid_payment_requirements" : "invalid_payload";
      expect([row.case, verify]).toEqual([row.case, { isValid: false, invalidReason: reason, invalidMessage: row.code }]);
    }
    expect(node!.calls).toEqual([]);
  });

  it("refuses a payment carrying Memos, and one naming a Delegate, before anything is read or moves", async () => {
    const r = await registrationOn();
    const memo = payment(V.plant.blob, V.V2.accepted);
    expect(await r.module.facilitator.verify(memo.payload, memo.requirements)).toEqual({
      isValid: false,
      invalidReason: "invalid_exact_xrpl_payload_memos_not_allowed",
    });
    const delegated = encode({ ...decode(V.V2.blob), Delegate: SIGNERS[0]! } as never);
    const d = payment(delegated, V.V2.accepted);
    expect(await r.module.facilitator.settle(d.payload, d.requirements)).toMatchObject({
      success: false,
      errorReason: "invalid_exact_xrpl_payload_delegate_not_allowed",
      transaction: "",
    });
    expect(await r.module.record.instrument(d)).toEqual({ refused: "invalid_exact_xrpl_payload_delegate_not_allowed" });
    expect(node!.calls).toEqual([]);
  });
});

describe("a multisigned payment, through the own path", () => {
  const [three, two] = V.multisigned.rows as { case: string; blob: string; hash: string; expect: string }[];

  it("claims both quorum copies by their Signers, and leaves a payment signed with one key to the class", async () => {
    const r = await registrationOn();
    const [a, b] = [payment(three!.blob, V.V2.accepted), payment(two!.blob, V.V2.accepted)];
    expect([isMultisigned(a.payload), isMultisigned(b.payload), isMultisigned(payment(V.V2.blob).payload)]).toEqual([true, true, false]);
    expect([routed(r, a), routed(r, b), routed(r, payment(V.V2.blob))]).toEqual([r.own[0]!.module, r.own[0]!.module, r.module]);
  });

  it("verifies each copy whose signers' weights reach the quorum, and settles one under its own hash", async () => {
    const r = await registrationOn(2);
    for (const row of [three!, two!]) {
      const p = payment(row.blob, V.V2.accepted);
      expect([row.case, await routed(r, p).facilitator.verify(p.payload, p.requirements)]).toEqual([row.case, { isValid: true, payer: PAYER }]);
    }
    const p = payment(two!.blob, V.V2.accepted);
    expect(await routed(r, p).facilitator.settle(p.payload, p.requirements)).toEqual({
      success: true,
      transaction: two!.hash,
      network: NETWORK,
      payer: PAYER,
    });
  });

  it("refuses a copy whose signers' weights fall short of the quorum, and a signature over other bytes, submitting nothing", async () => {
    const r = await registrationOn(3);
    const p = payment(two!.blob, V.V2.accepted);
    expect(await routed(r, p).facilitator.verify(p.payload, p.requirements)).toEqual({
      isValid: false,
      invalidReason: "invalid_exact_xrpl_payload_signer_not_authorized",
    });
    const tx = decode(three!.blob) as { Signers: { Signer: { TxnSignature: string } }[] };
    const sig = tx.Signers[0]!.Signer.TxnSignature;
    tx.Signers[0]!.Signer.TxnSignature = (sig.slice(0, -2) + (sig.endsWith("00") ? "01" : "00")).toUpperCase();
    const forged = payment(encode(tx as never), V.V2.accepted);
    expect(await routed(r, forged).facilitator.settle(forged.payload, forged.requirements)).toMatchObject({
      success: false,
      errorReason: "invalid_exact_xrpl_payload_signature",
    });
    expect(methods()).not.toContain("submit");
  });
});
