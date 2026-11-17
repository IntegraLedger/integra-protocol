// mpp/charge/lcp/hedera, through the mpp entry point (mpp-method-lcp-hedera.json). Every expected value is the file's;
// hiero-sdk-python 0.2.10 wrote its bytes and the Mirror Node its recorded entry.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import canonicalize from "canonicalize";
import { ed25519 } from "@noble/curves/ed25519.js";
import { describe, expect, it } from "vitest";
import type { HederaReader, MirrorEntry } from "../src/hedera.js";
import { chargeLcpHedera, challengeBound, FETCHED, type MppChallenge, type MppCredential } from "../src/mpp.js";
import { rowsOf } from "./rows.js";

const V = JSON.parse(readFileSync(new URL("../vectors/mpp-method-lcp-hedera.json", import.meta.url), "utf8"));
const C = JSON.parse(readFileSync(new URL("../vectors/mpp-method-lcp.json", import.meta.url), "utf8"));
const H = V.fixed.H as `0x${string}`;
const OPAQUE = C.challenges.hedera.wire.opaque as string;

/** The challenge as placed for a request: the file's id, realm, expires and opaque, the request in its RFC 8785 form. */
function challengeFor(request: unknown): MppChallenge & { id: string } {
  const text = canonicalize(request) as string;
  return { id: C.fixed.id, realm: C.fixed.realm, method: "lcp", intent: "charge", request: Buffer.from(text, "utf8").toString("base64url"), expires: C.fixed.expires, opaque: OPAQUE };
}
const requestOf = (name: string) => V.fixed.requests[name];
const credential = (request: unknown, transaction: string): MppCredential => ({ challenge: challengeFor(request), payload: { type: "transaction", transaction } });
const code = (v: unknown): unknown => (typeof v === "object" && v !== null && "refused" in v ? (v as unknown as { code: string }).code : v);

describe("mpp-method-lcp-hedera.json: build", () => {
  const rows = rowsOf(V.build as { case: string; request: string; payer: string; decimals?: number; expectBodyBytes: string; expectTransactionBase64: string }[], "build", { exact: 4 });
  it.each(rows.map((r) => [r.case, r] as const))("%s: the body the SDK froze, and the transaction it signed", async (_, r) => {
    const u = await chargeLcpHedera.build(
      {
        challenge: challengeFor(requestOf(r.request)),
        payer: r.payer,
        node: V.fixed.node,
        validStart: { seconds: BigInt(V.fixed.validStart.seconds), nanos: V.fixed.validStart.nanos },
        maxFee: BigInt(V.fixed.maxFee),
        ...(r.decimals === undefined ? {} : { decimals: r.decimals }),
      },
      H,
    );
    if ("refused" in u) throw new Error(u.code);
    expect(Buffer.from(u.request.bodyBytes).toString("hex")).toBe(r.expectBodyBytes);
    const seed = Buffer.from(V.fixed.seed, "hex");
    const signature = ed25519.sign(u.request.bodyBytes, seed);
    const c = u.complete({ publicKey: ed25519.getPublicKey(seed), signature, type: "ed25519" });
    if ("refused" in c) throw new Error(c.code);
    expect(Buffer.from(ed25519.getPublicKey(seed)).toString("hex")).toBe(V.fixed.publicKey);
    expect(c.payload).toEqual({ type: "transaction", transaction: r.expectTransactionBase64 });
    expect(c.challenge).toEqual(challengeFor(requestOf(r.request)));
    expect(await chargeLcpHedera.bound(c)).toBe(H);
  });

  it("refuses an id of another H, a malformed input, a payer that is the fee payer or the recipient, and a challenge the filter refuses", async () => {
    const base = {
      challenge: challengeFor(requestOf("settlerPays")),
      payer: "0.0.5555",
      node: "0.0.3",
      validStart: { seconds: 1700000000n, nanos: 0 },
      maxFee: 100000000n,
    };
    const other = "0x" + "ab".repeat(32);
    expect(code(await chargeLcpHedera.build(base, other as `0x${string}`))).toBe("mpp/id-not-ours");
    expect(code(await chargeLcpHedera.build({ ...base, node: "3" }, H))).toBe("mpp/input-malformed");
    expect(code(await chargeLcpHedera.build({ ...base, maxFee: 1 as unknown as bigint }, H))).toBe("mpp/input-malformed");
    expect(code(await chargeLcpHedera.build({ ...base, payer: "0.0.1235" }, H))).toBe("hedera/payer-not-buyer");
    expect(code(await chargeLcpHedera.build({ ...base, payer: "0.0.1234" }, H))).toBe("hedera/transfer-mismatch");
    const noExpires = { ...base.challenge };
    delete (noExpires as { expires?: string }).expires;
    expect(code(await chargeLcpHedera.build({ ...base, challenge: noExpires }, H))).toBe("mpp/expires-required");
  });
});

describe("mpp-method-lcp-hedera.json: bound and validate", () => {
  type Row = { case: string; request: string; transactionBase64: string; fn: "bound" | "validate"; now: number; expect: unknown };
  const run = async (r: Row): Promise<unknown> => {
    const c = credential(requestOf(r.request), r.transactionBase64);
    return code(r.fn === "bound" ? await chargeLcpHedera.bound(c) : await chargeLcpHedera.validate(c, r.now));
  };
  it.each(rowsOf(V.accepted as Row[], "accepted", { exact: 6 }).map((r) => [r.case, r] as const))("accepted: %s", async (_, r) => {
    expect(await run(r)).toEqual(r.expect);
    expect(await chargeLcpHedera.bound(credential(requestOf(r.request), r.transactionBase64))).toBe(H);
  });
  it.each(rowsOf(V.refusals as Row[], "refusals", { exact: 19 }).map((r) => [r.case, r] as const))("refused: %s", async (_, r) => {
    expect(await run(r)).toBe(r.expect);
  });
  it("a clock reading that is not a non-negative safe integer is mpp/input-malformed", async () => {
    const c = credential(requestOf("settlerPays"), V.accepted[0].transactionBase64);
    expect(code(await chargeLcpHedera.validate(c, -1))).toBe("mpp/input-malformed");
    expect(code(await chargeLcpHedera.validate(c, 1.5))).toBe("mpp/input-malformed");
  });
});

describe("mpp-method-lcp-hedera.json: reference", () => {
  const c = credential(requestOf("settlerPays"), V.accepted[0].transactionBase64);
  it("names the network, the mirror-form id, the valid start, the memo, the buyer, the payee, the payment presented and the body's digest", async () => {
    const ref = await chargeLcpHedera.reference(c, challengeFor(requestOf("settlerPays")));
    expect(ref).toEqual({
      network: "hedera:testnet",
      transactionId: "0.0.1235-1700000000-000000000",
      validStart: "1700000000.000000000",
      validDuration: V.fixed.validDuration,
      expectMemo: V.fixed.L,
      payer: V.fixed.payer,
      payee: V.fixed.payee,
      presented: {
        nodes: [V.fixed.node],
        maxFee: V.fixed.maxFee,
        transfer: { hbar: [{ account: "0.0.5555", amount: "-1000", isApproval: false }, { account: "0.0.1234", amount: "1000", isApproval: false }], tokens: [] },
      },
      bodyDigest: `0x${createHash("sha256").update(Buffer.from(V.build[0].expectBodyBytes, "hex")).digest("hex")}`,
    });
  });
  it("refuses another challenge, mpp/challenge-not-option, and a body validate refuses with its code", async () => {
    const other = { ...challengeFor(requestOf("settlerPays")), id: `${C.fixed.id.slice(0, -2)}.1` };
    expect(code(await chargeLcpHedera.reference(c, other))).toBe("mpp/challenge-not-option");
    const debits = V.refusals.find((r: { case: string }) => r.case.startsWith("rule 15: the submitter pays"));
    expect(code(await chargeLcpHedera.reference(credential(requestOf("settlerPays"), debits.transactionBase64), challengeFor(requestOf("settlerPays"))))).toBe("hedera/payer-not-buyer");
  });
});

describe("mpp-method-lcp-hedera.json: a payment its payer broadcast", () => {
  const L = V.landed;
  const reader = (byId: readonly MirrorEntry[] | null | "throw", net = "hedera:testnet"): HederaReader => ({
    network: net as HederaReader["network"],
    transactions: async () => {
      if (byId === "throw") throw new Error("transport");
      return byId;
    },
    latest: async () => "1791145300.000000000",
    oldest: async () => "archival",
    accountTransactions: async () => {
      throw new Error("refused");
    },
  });
  const hashCredential = (request: unknown): MppCredential => ({ challenge: challengeFor(request), payload: { type: "hash", transactionId: L.transactionId } });
  type Row = { case: string; entry: "recorded" | "edited"; fn: "bound" | "validate"; feePayerAccountId?: string; amount?: string; expect: unknown };
  it.each(rowsOf(L.rows as Row[], "landed rows", { exact: 4 }).map((r) => [r.case, r] as const))("%s", async (_, r) => {
    const request = JSON.parse(JSON.stringify(L.request));
    if (r.feePayerAccountId !== undefined) Object.assign(request.methodDetails, { feePayer: true, feePayerAccountId: r.feePayerAccountId });
    if (r.amount !== undefined) request.amount = r.amount;
    const fetched = await chargeLcpHedera.fetchPresented(hashCredential(request), reader([L[r.entry]]));
    if ("refused" in fetched) throw new Error((fetched as { code: string }).code);
    expect((fetched as unknown as { [FETCHED]: { entry: unknown } })[FETCHED].entry).toEqual(L[r.entry]);
    const got = r.fn === "bound" ? await chargeLcpHedera.bound(fetched) : await chargeLcpHedera.validate(fetched, 0);
    expect(code(got)).toEqual(r.expect);
  });

  it("the edited entry: reference names the transaction, and status settles on it, the payment presented", async () => {
    const cred = hashCredential(L.request);
    const fetched = (await chargeLcpHedera.fetchPresented(cred, reader([L.edited]))) as MppCredential;
    const ref = await chargeLcpHedera.reference(fetched, challengeFor(L.request));
    if ("refused" in ref) throw new Error(ref.code);
    expect(ref).toMatchObject({ transactionId: L.mirrorId, payer: "0.0.3229", payee: "0.0.3230", validStart: "1791145265.469000038", named: true });
    const answer = await chargeLcpHedera.status(ref, reader([L.edited]), { act: "payment", finality: "consensus" });
    expect(answer).toMatchObject({ state: "settled", transaction: L.mirrorId, presented: "yes", signer: "0.0.3229" });
  });

  it("fetchPresented refuses a reader for another network, an id the mirror has not, a failed result, a failed read and an id in another spelling", async () => {
    const cred = hashCredential(L.request);
    expect(code(await chargeLcpHedera.fetchPresented(cred, reader([L.edited], "hedera:mainnet")))).toBe("hedera/wrong-reader");
    expect(code(await chargeLcpHedera.fetchPresented(cred, reader(null)))).toBe("hedera/not-found");
    expect(code(await chargeLcpHedera.fetchPresented(cred, reader([{ ...L.edited, result: "INSUFFICIENT_PAYER_BALANCE" }])))).toBe("hedera/not-success");
    expect(code(await chargeLcpHedera.fetchPresented(cred, reader("throw")))).toBe("hedera/unreadable");
    const unpadded = { ...cred, payload: { type: "hash", transactionId: "0.0.3229@1791145265.46900003" } };
    expect(code(await chargeLcpHedera.fetchPresented(unpadded, reader([L.edited])))).toBe("hedera/tx-malformed");
    const tx = credential(requestOf("settlerPays"), V.accepted[0].transactionBase64);
    expect(await chargeLcpHedera.fetchPresented(tx, reader("throw"))).toBe(tx);
  });

  it("the receipt mppx wrote names the build rows' transaction id as the SDK spells it", () => {
    expect(V.receipt.decoded).toMatchObject({ method: "lcp", reference: "0.0.1235@1700000000.000000000", status: "success" });
  });
});

/** A row's value with each {"$repeat": [s, n]} replaced by s repeated n times. */
function expand(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(expand);
  if (typeof v !== "object" || v === null) return v;
  const r = (v as Record<string, unknown>)["$repeat"];
  if (Array.isArray(r)) return (r[0] as string).repeat(r[1] as number);
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, expand(x)]));
}

describe("mpp-method-lcp-hedera.json: the credential's own refusals", () => {
  type Row = { case: string; presented: unknown; fn: "bound" | "fetchPresented"; reader?: string; expect: string };
  const reader = (network: string): HederaReader => ({
    network: network as HederaReader["network"],
    transactions: async () => null,
    latest: async () => "1700000100.000000000",
    oldest: async () => "archival",
    accountTransactions: async () => ({ transactions: [], next: null }),
  });
  it.each(rowsOf(V.credentialRefusals.rows as Row[], "credentialRefusals", { exact: 12 }).map((r) => [r.case, r] as const))("%s", async (_, r) => {
    const presented = expand(r.presented) as MppCredential;
    const got = r.fn === "bound" ? await chargeLcpHedera.bound(presented) : await chargeLcpHedera.fetchPresented(presented, reader(r.reader!));
    expect(code(got)).toBe(r.expect);
  });
});

describe("mpp-method-lcp-hedera.json: the order of the server's checks", () => {
  type Row = { case: string; request: string; transactionBase64: string; recorded?: string; opaque?: string; step: string | null; expect?: string };
  it.each(rowsOf(V.order.rows as Row[], "order", { exact: 6 }).map((r) => [r.case, r] as const))("%s", async (_, r) => {
    const c = credential(requestOf(r.request), r.transactionBase64);
    if (r.opaque !== undefined) c.challenge = { ...c.challenge, opaque: r.opaque };
    const steps: [string, () => Promise<unknown>][] = [
      ["challengeBound", async () => challengeBound(c, r.recorded ?? V.order.recorded)],
      ["bound", () => chargeLcpHedera.bound(c)],
      ["validate", () => chargeLcpHedera.validate(c, V.fixed.now)],
    ];
    let refused: [string, unknown] | null = null;
    for (const [step, run] of steps) {
      const got = await run();
      if (typeof got === "object" && got !== null && "refused" in got) {
        refused = [step, code(got)];
        break;
      }
    }
    expect(refused).toEqual(r.step === null ? null : [r.step, r.expect]);
  });
});
