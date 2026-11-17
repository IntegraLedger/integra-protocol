// Runs x402-exact-solana.json through the svm and x402/exact/solana entry points. Every expected value is the file's,
// except where a block names another source.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, expectTypeOf, it } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  compileTransactionMessage,
  decompileTransactionMessage,
  getCompiledTransactionMessageDecoder,
  getCompiledTransactionMessageEncoder,
  getTransactionDecoder,
  isSignerRole,
  isWritableRole,
} from "@solana/kit";
import { ReaderError } from "../src/evm.js";
import { pairingOf, type AtrHash, type Refusal } from "../src/index.js";
import {
  MEMO_V3,
  buildSvmMessage,
  decodeSvmTx,
  isKey,
  svmCarrier,
  svmRecover,
  svmStatus,
  type SolanaNetwork,
  type SvmLanded,
  type SvmReader,
  type SvmRef,
} from "../src/svm.js";
import { exactSvm, type SvmUnsigned } from "../src/x402-exact-solana.js";
import type { PaymentRequired, PaymentRequirements } from "../src/x402.js";
import { rowsOf } from "./rows.js";

const V = JSON.parse(readFileSync(new URL("../vectors/x402-exact-solana.json", import.meta.url), "utf8"));
const b64 = (s: string): Uint8Array => Uint8Array.from(Buffer.from(s, "base64"));
const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");
const fromHex = (s: string): Uint8Array => Uint8Array.from(Buffer.from(s, "hex"));
const H: AtrHash = V.fixed.H;
const O: PaymentRequirements = V.fixed.option;
const refused = (code: string) => ({ refused: true, code });
/** A status read's query for `act` at `finality`. */
const at = (finality: "confirmed" | "finalized", act: "payment" | "agreement" = "payment") => ({ act, finality }) as const;
const FINAL = at("finalized");
const INCOMPLETE = { state: "pending", reason: "search-incomplete", foreign: [] };
const unreadable = (reason: string) => ({ state: "unreadable", reason, foreign: [] });
/** What `recover` takes for the transaction `tx`: V4's network and the option V2 answers. */
const recoverOf = (tx: string, network: SolanaNetwork = V.V4.network) => ({ network, tx, option: V.V2.accepted as PaymentRequirements });
type Payment = Exclude<ReturnType<SvmUnsigned["complete"]>, Refusal>;

const landed = (wire: Uint8Array, err: unknown = null): SvmLanded => ({
  wire,
  err,
  loaded: { writable: [], readonly: [] },
  inner: [],
});

/** A reader that holds one transaction at one commitment. */
function readerFor(
  at: "finalized" | "confirmed" | null | "reader-error",
  l: SvmLanded,
  txid: string = V.V4.txid,
): SvmReader {
  return {
    network: V.V4.network,
    transaction: async (sig, commitment) => {
      if (at === "reader-error") throw new ReaderError("transport");
      if (sig !== txid || at === null) return { notFound: true, slot: null };
      if (at === "confirmed" && commitment === "finalized") return { notFound: true, slot: null };
      return l;
    },
    signatures: async () => [],
    blockhashValid: async () => ({ valid: true, slot: 0n }),
    slot: async () => 0n,
    firstAvailableBlock: async () => 0n,
    account: async () => {
      throw new Error("this reference names no nonce account");
    },
  };
}

describe("x402-exact-solana.json", () => {
  const advertised = (): PaymentRequired => {
    const doc = exactSvm.advertise({ x402Version: 2, resource: V.fixed.resource, accepts: [O] }, H, V.fixed.link, O);
    if ("refused" in doc) throw new Error(doc.code);
    return doc;
  };

  it("advertise places L in extra.memo, read gives H, and unplaced gives the option as issued", () => {
    const doc = advertised();
    expect(doc.accepts[0]).toEqual(V.V2.accepted);
    const r = exactSvm.read(doc);
    if ("refused" in r) throw new Error(r.code);
    expect(r.h).toBe(H);
    expect(r.link).toBe(V.fixed.link);
    expect(exactSvm.unplaced(doc.accepts[0]!)).toEqual(O);
    expect(pairingOf(O)).toBe("x402/exact/solana");
  });

  it("build refuses an H that is not a 32-byte hash as x402/payload-malformed (docs/reference/refusals.md)", async () => {
    const doc = advertised();
    const choice = {
      required: doc,
      accepted: doc.accepts[0]!,
      payer: V.fixed.payer,
      decimals: V.fixed.decimals,
      tokenProgram: V.fixed.tokenProgram,
      recentBlockhash: V.fixed.blockhash,
    };
    for (const bad of [null, "0x12", H.slice(2), `lcp:sha256:${H}`]) {
      expect(await exactSvm.build(choice, bad as AtrHash), String(bad)).toEqual({ refused: true, code: "x402/payload-malformed" });
    }
  });

  it("agreedRefusals: build refuses a choice that is not an object, and V1's choice with an h that is not a hash", async () => {
    type Row = { case: string; choice?: unknown; h?: unknown; expect: string };
    const rows = rowsOf(V.agreedRefusals.rows as Row[], "x402-exact-solana.json agreedRefusals.rows", {
      exact: 5,
      keep: ["the rows that give build a choice or an h", (r) => "choice" in r || "h" in r],
      leave: [
        "the rows that carry only case and expect, which the agreedRefusals runner below runs by their case",
        (r) => Object.keys(r).every((k) => k === "case" || k === "expect"),
      ],
    });
    expect(rows.map((r) => ("choice" in r ? ["choice", r.choice] : ["h", r.h]))).toEqual([
      ["choice", null], ["choice", "x"], ["h", "abc"], ["h", `0X${H.slice(2)}`], ["h", null],
    ]);
    const doc = advertised();
    const choice = {
      required: doc,
      accepted: doc.accepts[0]!,
      payer: V.fixed.payer,
      decimals: V.fixed.decimals,
      tokenProgram: V.fixed.tokenProgram,
      recentBlockhash: V.fixed.blockhash,
    };
    expect("refused" in (await exactSvm.build(choice, H))).toBe(false);
    for (const r of rows) {
      const out = "choice" in r ? await exactSvm.build(r.choice as never, H) : await exactSvm.build(choice, r.h as AtrHash);
      expect(out, r.case).toEqual({ refused: true, code: r.expect });
    }
  });

  it("defaultComputeBudget: build without a compute unit limit or price writes the default prefix, the message byte for byte as @solana/kit compiles it", async () => {
    const doc = advertised();
    const u = await exactSvm.build(
      {
        required: doc,
        accepted: doc.accepts[0]!,
        payer: V.fixed.payer,
        decimals: V.fixed.decimals,
        tokenProgram: V.fixed.tokenProgram,
        recentBlockhash: V.fixed.blockhash,
      },
      H,
    );
    if ("refused" in u) throw new Error(u.code);
    const m = decompileTransactionMessage(getCompiledTransactionMessageDecoder().decode(u.request.message));
    type Ix = { programAddress: string; accounts?: readonly unknown[]; data?: Uint8Array };
    const got = (m.instructions as readonly Ix[]).slice(0, 2).map((ix) => ({
      program: ix.programAddress,
      accounts: ix.accounts ?? [],
      data: hex(ix.data ?? new Uint8Array()),
    }));
    expect(got).toEqual(V.defaultComputeBudget.instructions);
    // The whole message is held byte for byte to buildMessageSha256: @solana/kit's compilation of V2's wire message with
    // the default prefix's data in place of its own.
    const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
    const wire = b64(V.V2.wireBase64);
    const v2 = decompileTransactionMessage(getCompiledTransactionMessageDecoder().decode(wire.subarray(1 + 64 * wire[0]!)));
    const prefix = V.defaultComputeBudget.instructions as { data: string }[];
    type V2Ix = (typeof v2.instructions)[number];
    const withDefault = {
      ...v2,
      instructions: (v2.instructions as readonly V2Ix[]).map((ix, i) => (i < 2 ? { ...ix, data: fromHex(prefix[i]!.data) } : ix)),
    } as typeof v2;
    expect(sha256(Uint8Array.from(getCompiledTransactionMessageEncoder().encode(compileTransactionMessage(withDefault))))).toBe(
      V.defaultComputeBudget.buildMessageSha256,
    );
    expect(sha256(u.request.message)).toBe(V.defaultComputeBudget.buildMessageSha256);
  });

  // V1's messageSha256 and payer's signature are of solders' compilation, the message in V2's wire, the account keys of
  // each class in byte order. build's message is held byte for byte to buildMessageSha256: @solana/kit's compilation of
  // the same message, the steward SDK's order (typescript/packages/mechanisms/svm/src/exact/client/scheme.ts L136-150 at
  // x402 751590a2).
  it("V1: the message build compiles, byte for byte as @solana/kit compiles it, decompiled, and the payer's signature over it", async () => {
    const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
    const wire = b64(V.V2.wireBase64);
    const wireMessage = wire.subarray(1 + 64 * wire[0]!);
    const wireSignature = wire.subarray(1 + 64, 1 + 128);
    expect([wireMessage.length, wireMessage[0], sha256(wireMessage)]).toEqual([
      V.V1.messageLength,
      V.V1.messageFirstByte,
      V.V1.messageSha256,
    ]);
    expect(hex(ed25519.sign(wireMessage, fromHex(V.fixed.payerSeed)))).toBe(hex(wireSignature));
    expect([hex(wireSignature).slice(0, 8), hex(wireSignature).slice(-6)]).toEqual([
      V.V1.payerSignaturePrefix,
      V.V1.payerSignatureSuffix,
    ]);
    const kitMessage = decompileTransactionMessage(getCompiledTransactionMessageDecoder().decode(wireMessage));
    const byKit = Uint8Array.from(getCompiledTransactionMessageEncoder().encode(compileTransactionMessage(kitMessage)));
    expect(sha256(byKit)).toBe(V.V1.buildMessageSha256);
    const doc = advertised();
    const u = await exactSvm.build(
      {
        required: doc,
        accepted: doc.accepts[0]!,
        payer: V.fixed.payer,
        decimals: V.fixed.decimals,
        tokenProgram: V.fixed.tokenProgram,
        recentBlockhash: V.fixed.blockhash,
        computeUnitLimit: V.fixed.computeUnitLimit,
        computeUnitPrice: BigInt(V.fixed.computeUnitPrice),
      },
      H,
    );
    if ("refused" in u) throw new Error(u.code);
    expect(u.request.kind).toBe("solana-message");
    const message = u.request.message;
    expect(message.length).toBe(V.V1.messageLength);
    expect(message[0]).toBe(V.V1.messageFirstByte);
    expect(sha256(message)).toBe(V.V1.buildMessageSha256);
    const compiled = getCompiledTransactionMessageDecoder().decode(message);
    const m = decompileTransactionMessage(compiled);
    expect(m.feePayer.address).toBe(V.V1.feePayer);
    expect((m.lifetimeConstraint as { blockhash: string }).blockhash).toBe(V.V1.blockhash);
    type Ix = { programAddress: string; accounts?: readonly { address: string; role: number }[]; data?: Uint8Array };
    const got = (m.instructions as readonly Ix[]).map((ix) => ({
      program: ix.programAddress,
      accounts: (ix.accounts ?? []).map((a) => ({
        address: a.address,
        signer: isSignerRole(a.role as Parameters<typeof isSignerRole>[0]),
        writable: isWritableRole(a.role as Parameters<typeof isWritableRole>[0]),
      })),
      data: hex(ix.data ?? new Uint8Array()),
    }));
    expect(got).toEqual(V.V1.instructions);
    const sig = ed25519.sign(message, fromHex(V.fixed.payerSeed));
    expect(ed25519.verify(sig, message, ed25519.getPublicKey(fromHex(V.fixed.payerSeed)))).toBe(true);
    const payment = u.complete(sig);
    if ("refused" in payment) throw new Error(payment.code);
    expect(await exactSvm.bound(payment)).toBe(H);
    // The wire complete writes is held byte for byte to buildWireSha256, the Solana transaction format written by hand
    // in Python; here it is written again from @solana/kit's message: the count 2, the fee payer's empty slot, the
    // payer's signature, then the message.
    const byHand = Uint8Array.from([2, ...new Uint8Array(64), ...ed25519.sign(byKit, fromHex(V.fixed.payerSeed)), ...byKit]);
    expect(sha256(byHand)).toBe(V.V1.buildWireSha256);
    expect(sha256(b64(payment.payload.transaction))).toBe(V.V1.buildWireSha256);
  });

  it("V1: L is 77 bytes and its hex is the vector's", () => {
    expect(new TextEncoder().encode(V.fixed.L).length).toBe(V.V1.Lbytes);
    expect(hex(new TextEncoder().encode(V.fixed.L))).toBe(V.fixed.Lhex);
  });

  it("V2: bound and reference of the partially signed wire", async () => {
    const wire = b64(V.V2.wireBase64);
    expect(wire.length).toBe(V.V2.wireLength);
    const p: Payment = { x402Version: 2, accepted: V.V2.accepted, payload: { transaction: V.V2.wireBase64 } };
    expect(await exactSvm.bound(p)).toBe(V.V2.expectBound);
    expect(await exactSvm.reference(p, V.V2.accepted)).toEqual(V.V2.expectReference);
    const ref = await exactSvm.reference(p, V.V2.accepted);
    expect(JSON.parse(JSON.stringify(ref))).toEqual(ref);
    const tx = decodeSvmTx(wire);
    if ("refused" in tx) throw new Error(tx.code);
    expect(hex(tx.signatures[1]!).slice(0, 8)).toBe(V.V1.payerSignaturePrefix);
    expect(svmCarrier(tx)).toEqual({ h: H, memo: V.fixed.L });
  });

  it("V3: refusals", async () => {
    for (const row of rowsOf(V.V3, "x402-exact-solana.json V3")) {
      if (row.advertiseOption !== undefined) {
        const o: PaymentRequirements = row.advertiseOption;
        expect(exactSvm.advertise({ x402Version: 2, resource: V.fixed.resource, accepts: [o] }, H, V.fixed.link, o)).toEqual(
          refused(row.expect),
        );
        continue;
      }
      const p: Payment = { x402Version: 2, accepted: row.accepted, payload: { transaction: row.wireBase64 } };
      expect(await exactSvm.bound(p), row.case).toEqual(refused(row.expect));
    }
  });
});

describe("x402-exact-solana.json carrierSpelling", () => {
  const C = V.carrierSpelling;

  it("bound refuses the hash in upper-case hex, though the echoed extra.memo carries that spelling", async () => {
    const p: Payment = {
      x402Version: 2,
      accepted: C.bound.accepted,
      payload: { transaction: C.bound.wireBase64 },
    };
    expect(await exactSvm.bound(p)).toEqual(refused(C.bound.expect));
    expect(await exactSvm.reference(p, C.bound.accepted)).toEqual(refused(C.bound.expect));
    const tx = decodeSvmTx(b64(C.bound.wireBase64));
    if ("refused" in tx) throw new Error(tx.code);
    expect(svmCarrier(tx)).toEqual(refused(C.bound.expect));
  });

  it("recover refuses the landed upper-case memo", async () => {
    const reader = readerFor("finalized", landed(b64(C.recover.landedWireBase64)), C.recover.txid);
    expect(await svmRecover(recoverOf(C.recover.txid), reader)).toEqual(refused(C.recover.expect));
  });

});

describe("x402-exact-solana.json durableNonce", () => {
  const D = V.durableNonce;
  const accountOf = (name: string | null): { owner: string; data: Uint8Array } | null =>
    name === null ? null : { owner: D.accounts[name].owner, data: b64(D.accounts[name].dataBase64) };

  it("reference records the nonce only for AdvanceNonceAccount naming the nonce accounts", async () => {
    for (const row of rowsOf(D.reference, "x402-exact-solana.json durableNonce.reference")) {
      const p: Payment = {
        x402Version: 2,
        accepted: V.V2.accepted,
        payload: { transaction: row.wireBase64 },
      };
      expect(await exactSvm.bound(p), row.case).toBe(H);
      const ref = await exactSvm.reference(p, V.V2.accepted);
      expect(ref, row.case).toEqual(row.expect);
      expect(JSON.parse(JSON.stringify(ref))).toEqual(ref);
    }
  });

  it("a message naming its nonce account through a lookup table is refused", async () => {
    const rows = rowsOf<any>(D.lookupTable.rows, "x402-exact-solana.json durableNonce.lookupTable.rows", {
      exact: 1,
      keep: ["the row with the refusal it expects", (r: { expect?: string }) => r.expect !== undefined],
      leave: ["the row with expectReference, which the next test runs", (r: { expectReference?: unknown }) => r.expectReference !== undefined],
    });
    expect(rows.length).toBe(1);
    for (const row of rows) {
      expect(row.instruction0Accounts[0], row.case).toBeGreaterThanOrEqual(row.staticKeys);
      const p: Payment = {
        x402Version: 2,
        accepted: V.V2.accepted,
        payload: { transaction: row.wireBase64 },
      };
      expect(await exactSvm.bound(p), row.case).toEqual(refused(row.expect));
      expect(await exactSvm.reference(p, V.V2.accepted), row.case).toEqual(refused(row.expect));
    }
  });

  it("a static nonce account with its sysvar from a lookup table is durable: bound gives H, reference records the nonce", async () => {
    const rows = rowsOf<any>(D.lookupTable.rows, "x402-exact-solana.json durableNonce.lookupTable.rows", {
      exact: 1,
      keep: ["the row with expectReference", (r: { expectReference?: unknown }) => r.expectReference !== undefined],
      leave: ["the row with the refusal it expects, which the test above runs", (r: { expect?: string }) => r.expect !== undefined],
    });
    expect(rows.length).toBe(1);
    for (const row of rows) {
      expect(row.liteSvm, row.case).toBe("landed");
      expect(row.nonceMoved, row.case).toBe(true);
      expect(row.instruction0Accounts[0], row.case).toBeLessThan(row.staticKeys);
      expect(row.instruction0Accounts[1], row.case).toBeGreaterThanOrEqual(row.staticKeys);
      // @solana/kit decodes the same wire: the fee payer, the nonce account the instruction names, the nonce value in
      // the blockhash field and the message bytes whose SHA-256 the row records.
      const wire = b64(row.wireBase64);
      const signed = getTransactionDecoder().decode(wire);
      const m = getCompiledTransactionMessageDecoder().decode(signed.messageBytes);
      if (m.version !== 0) throw new Error("the row's wire is a v0 message");
      const ix0 = m.instructions[0]!;
      expect(m.staticAccounts.length).toBe(row.staticKeys);
      expect(ix0.accountIndices).toEqual(row.instruction0Accounts);
      expect(row.expectReference.feePayer).toBe(m.staticAccounts[0]);
      expect(row.expectReference.nonce.account).toBe(m.staticAccounts[ix0.accountIndices![0]!]);
      expect(row.expectReference.nonce.account).toBe(D.nonceAccount);
      expect(row.expectReference.nonce.value).toBe(m.lifetimeToken);
      expect(row.expectReference.nonce.value).toBe(D.movedValue);
      expect(row.expectReference.digest).toBe(`0x${row.messageSha256}`);
      expect(row.expectReference.digest).toBe(`0x${createHash("sha256").update(Uint8Array.from(signed.messageBytes)).digest("hex")}`);
      const p: Payment = {
        x402Version: 2,
        accepted: V.V2.accepted,
        payload: { transaction: row.wireBase64 },
      };
      expect(await exactSvm.bound(p), row.case).toBe(row.expectBound);
      const ref = await exactSvm.reference(p, V.V2.accepted);
      expect(ref, row.case).toEqual(row.expectReference);
      expect(JSON.parse(JSON.stringify(ref))).toEqual(ref);
    }
  });


  it("LiteSVM landed only the durable message", () => {
    expect(D.liteSvm.results.durable).toBe("landed");
    for (const k of ["nonceReadonly", "shapeOnlyNonceValue", "noSigner", "noSysvar"]) {
      expect(D.liteSvm.results[k], k).not.toBe("landed");
    }
    expect(Buffer.from(D.accounts.held.dataBase64, "base64").length).toBe(80);
  });


  // A lookup that finds nothing shows the transaction absent only up to the slot its node had reached: Solana's
  // getTransaction answers null for a transaction the node does not hold at that commitment, and getSlot names the
  // node's slot at a commitment. The nonce account read shows the nonce moved on as of its response's context slot
  // (getAccountInfo's context.slot). So the last read shows the message never landed only from a node at or past that
  // slot; one behind it, or one naming no slot, leaves the payment pending.

  // getSignaturesForAddress takes minContextSlot, "The minimum slot that the request can be evaluated at"
  // (solana.com/docs/rpc/http/getsignaturesforaddress), and a node whose slot is below it fails the call (Agave v3.1.8,
  // rpc/src/rpc.rs get_signatures_for_address: MinContextSlotNotReached, JSON-RPC error -32016, "Minimum context slot
  // has not been reached"). The nonce account read shows the nonce moved on as of its context slot, 1150 here as in
  // the status rows, so only a search from a node at or past that slot shows the durable message never landed.

});

// isBlockhashValid answers an RpcResponse: its context is the "Slot and API version the node used to answer this
// request", and its value "Whether the blockhash is still valid at the evaluated slot"; the method's example result is
// { context: { slot: 2483 }, value: false } (solana.com/docs/rpc/http/isblockhashvalid). Agave v3.1.8 answers it with
// new_response(&bank, is_valid), whose context slot is bank.slot() (rpc/src/rpc.rs is_blockhash_valid, new_response),
// and a bank finds a blockhash only among the hashes it holds (accounts-db/src/blockhash_queue.rs
// get_hash_info_if_valid, self.hashes.get(hash)), so a node behind the blockhash's block also answers false.

// The agreedRefusals rows that carry only case and expect: each case names its calls, and each call here is one of
// them, made with the file's fixed data, V2's and V4's wires and V3's two-memo wire.
describe("x402-exact-solana.json agreedRefusals: the rows that carry only case and expect", () => {
  type Row = { case: string; choice?: unknown; h?: unknown; expect: string };
  const rows = rowsOf(V.agreedRefusals.rows as Row[], "x402-exact-solana.json agreedRefusals.rows", {
    keep: ["the rows that carry only case and expect", (r) => Object.keys(r).every((k) => k === "case" || k === "expect")],
    leave: ["the rows that give build a choice or an h, which the agreedRefusals build test above runs", (r) => "choice" in r || "h" in r],
  });
  const advertised = (o: PaymentRequirements = O): PaymentRequired => {
    const doc = exactSvm.advertise({ x402Version: 2, resource: V.fixed.resource, accepts: [o] }, H, V.fixed.link, o);
    if ("refused" in doc) throw new Error(doc.code);
    return doc;
  };
  /** V1's choice: the advertised option with fixed's payer, decimals, tokenProgram and blockhash as recentBlockhash. */
  const v1Choice = (doc: PaymentRequired = advertised()) => ({
    required: doc,
    accepted: doc.accepts[0]!,
    payer: V.fixed.payer as string,
    decimals: V.fixed.decimals as number,
    tokenProgram: V.fixed.tokenProgram as string,
    recentBlockhash: V.fixed.blockhash as string,
  });
  /** buildSvmMessage's input for V1's message: fixed's keys, amount, decimals and compute budget, with L as the memo. */
  const v1Message = {
    feePayer: V.fixed.feePayer as string,
    payer: V.fixed.payer as string,
    mint: V.fixed.mint as string,
    tokenProgram: V.fixed.tokenProgram as string,
    decimals: V.fixed.decimals as number,
    payTo: V.fixed.payTo as string,
    amount: BigInt(V.fixed.amount),
    recentBlockhash: V.fixed.blockhash as string,
    memo: V.fixed.L as string,
    computeUnitLimit: V.fixed.computeUnitLimit as number,
    computeUnitPrice: BigInt(V.fixed.computeUnitPrice),
  };
  const payment = (wire: Uint8Array | string, accepted: PaymentRequirements = V.V2.accepted): Payment => ({
    x402Version: 2,
    accepted,
    payload: { transaction: typeof wire === "string" ? wire : Buffer.from(wire).toString("base64") },
  });
  const decoded = (wire: Uint8Array) => {
    const tx = decodeSvmTx(wire);
    if ("refused" in tx) throw new Error(tx.code);
    return tx;
  };
  const wireV2 = b64(V.V2.wireBase64);
  const wireV4 = b64(V.V4.landedWireBase64);
  const twoMemos = (V.V3 as { case: string; wireBase64: string; accepted: PaymentRequirements }[]).find((r) => r.case === "two L memos")!;
  const named = recoverOf(V.V4.txid);
  /** V2's message with its Memo instruction taken out, compiled again by @solana/kit, with every signature slot zero. */
  const noMemo = (): Uint8Array => {
    const signed = getTransactionDecoder().decode(wireV2);
    const m = decompileTransactionMessage(getCompiledTransactionMessageDecoder().decode(signed.messageBytes));
    const compiled = compileTransactionMessage({ ...m, instructions: m.instructions.filter((ix) => ix.programAddress !== MEMO_V3) });
    const message = new Uint8Array(getCompiledTransactionMessageEncoder().encode(compiled));
    const signers = compiled.header.numSignerAccounts;
    const wire = new Uint8Array(1 + 64 * signers + message.length);
    wire[0] = signers;
    wire.set(message, 1 + 64 * signers);
    return wire;
  };

  const cases: Record<string, () => Promise<unknown[]>> = {
    "svmCarrier (and so bound and recover) on a transaction with no top-level Memo instruction, or with two or more": async () => {
      const none = noMemo();
      const two = b64(twoMemos.wireBase64);
      return [
        svmCarrier(decoded(none)),
        svmCarrier(decoded(two)),
        await exactSvm.bound(payment(none)),
        await exactSvm.bound(payment(two, twoMemos.accepted)),
        await svmRecover(named, readerFor("finalized", landed(none))),
        await svmRecover(named, readerFor("finalized", landed(two))),
      ];
    },
    // x402's Solana mainnet network, beside the vectors' devnet.
    "recover with a reader for another network": async () => [
      await svmRecover(named, { ...readerFor("finalized", landed(wireV4)), network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" }),
    ],
    "recover when the transaction is found at neither finalized nor confirmed": async () => [
      await svmRecover(named, readerFor(null, landed(wireV4))),
    ],
    "recover when the landed transaction's err is not null at finalized": async () => {
      return [await svmRecover(named, readerFor("finalized", landed(wireV4, V.V4.landedErr)))];
    },
    // Solana's commitment levels: a block at `confirmed` has a supermajority's votes but is not finalized, and a block
    // that is not finalized can be replaced, so an error read there alone is a read to repeat.
    "recover when the landed transaction's err is not null at confirmed and the transaction is not found at finalized": async () => {
      return [await svmRecover(named, readerFor("confirmed", landed(wireV4, V.V4.landedErr)))];
    },
    // `recover` reads the landed transaction's carrier at `finalized`: one found at `confirmed` alone can still be
    // replaced, so its answer there is a read to repeat.
    "recover when the transaction landed with no error is found at confirmed alone, not at finalized: the carrier is read at finalized only":
      async () => [await svmRecover(named, readerFor("confirmed", landed(wireV4)))],
    // A transaction answer whose wire is the base64 text, not its bytes, is not a landed transaction's shape; nor is a
    // wire one byte short of V4's, which does not decode: a transaction the chain executed is a well-formed one within
    // Solana's 1232-byte packet (PACKET_DATA_SIZE), so a landed wire that does not decode is the reader's.
    "recover when the reader fails or returns a malformed transaction": async () => [
      await svmRecover(named, readerFor("reader-error", landed(wireV4))),
      await svmRecover(named, readerFor("finalized", { ...landed(wireV4), wire: V.V4.landedWireBase64 })),
      await svmRecover(named, readerFor("finalized", landed(wireV4.subarray(0, wireV4.length - 1)))),
    ],
    "build or buildSvmMessage with a malformed key, token program, decimals, amount, compute budget or signature": async () => {
      const c = v1Choice();
      const u = await exactSvm.build(c, H);
      if ("refused" in u) throw new Error(u.code);
      return [
        await exactSvm.build({ ...c, payer: "x" }, H),
        await exactSvm.build({ ...c, tokenProgram: V.fixed.mint }, H),
        await exactSvm.build({ ...c, decimals: 256 }, H),
        await exactSvm.build({ ...c, computeUnitLimit: 2 ** 32 }, H),
        await exactSvm.build({ ...c, computeUnitPrice: 2n ** 64n }, H),
        u.complete(new Uint8Array(63)),
        await buildSvmMessage({ ...v1Message, payTo: "x" }),
        await buildSvmMessage({ ...v1Message, tokenProgram: V.fixed.mint }),
        await buildSvmMessage({ ...v1Message, decimals: -1 }),
        await buildSvmMessage({ ...v1Message, amount: 2n ** 64n }),
        await buildSvmMessage({ ...v1Message, computeUnitLimit: -1 }),
        await buildSvmMessage({ ...v1Message, computeUnitPrice: -1n }),
      ];
    },
    "advertise or build with an amount that is not a u64 in decimal": async () => {
      const doc = advertised();
      const placed = (amount: string) => ({ ...doc.accepts[0]!, amount });
      const build = (o: PaymentRequirements) => exactSvm.build({ ...v1Choice(doc), required: { ...doc, accepts: [o] }, accepted: o }, H);
      return [
        exactSvm.advertise({ x402Version: 2, resource: V.fixed.resource, accepts: [{ ...O, amount: "1.5" }] }, H, V.fixed.link, { ...O, amount: "1.5" }),
        exactSvm.advertise({ x402Version: 2, resource: V.fixed.resource, accepts: [{ ...O, amount: "18446744073709551616" }] }, H, V.fixed.link, { ...O, amount: "18446744073709551616" }),
        await build(placed("1.5")),
        await build(placed("18446744073709551616")),
      ];
    },
    "a payload whose transaction is not base64, or whose wire does not decode exactly, or whose signature count differs from the header's":
      async () => [
        await exactSvm.bound(payment(`*${V.V2.wireBase64.slice(1)}`)),
        await exactSvm.bound(payment(Uint8Array.of(...wireV2, 0))),
        await exactSvm.bound(payment(Uint8Array.of(1, ...wireV2.subarray(1 + 64)))),
      ],
    "a wire over 1232 bytes": async () => {
      const over = new Uint8Array(1233);
      over.set(wireV2);
      return [decodeSvmTx(over), await exactSvm.bound(payment(over))];
    },
    "a payment whose option fails the pairing's filter": async () => {
      const accepted = V.V2.accepted as PaymentRequirements;
      const { feePayer: _feePayer, ...noFeePayer } = accepted.extra!;
      return [
        await exactSvm.bound(payment(wireV2, { ...accepted, scheme: "upto" })),
        await exactSvm.bound(payment(wireV2, { ...accepted, extra: noFeePayer })),
        await exactSvm.bound(payment(wireV2, { ...accepted, extra: { ...accepted.extra, memo: "m".repeat(257) } })),
        await exactSvm.reference(payment(wireV2, { ...accepted, scheme: "upto" }), accepted),
      ];
    },
  };

  it("names a case for every row that carries only case and expect, and no other", () => {
    expect(Object.keys(cases).sort()).toEqual(rows.map((r) => r.case).sort());
  });

  for (const row of rows) {
    it(row.case, async () => {
      expect(row.expect, "one refusal code").toMatch(/^[a-z0-9]+\/[a-z0-9-]+$/);
      const results = await cases[row.case]!();
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) expect(r).toEqual(refused(row.expect));
    });
  }
});

// isKey is the 32-byte base58 key rule every Solana read applies to an address, a program id and a blockhash. The
// expected lengths come from a base58 decoder written here from the alphabet, not from the package's.
describe("the svm entry point's reads", () => {
  // A read of Solana is `status` (svmStatus and each pairing's `status`), which takes no absence as shown until a run
  // shows the search whole; the entry point exports no other locate or nonce read whose answer a caller would take as
  // complete or final.
  it("exports neither svmLocate nor svmNonceMoved", async () => {
    const svm: Record<string, unknown> = await import("../src/svm.js");
    expect(["svmLocate", "svmNonceMoved"].filter((name) => name in svm)).toEqual([]);
  });
});

describe("isKey", () => {
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const decodedLength = (s: string): number | null => {
    let n = 0n;
    for (const c of s) {
      const d = ALPHABET.indexOf(c);
      if (d < 0) return null;
      n = n * 58n + BigInt(d);
    }
    let zeros = 0;
    while (zeros < s.length && s[zeros] === "1") zeros++;
    let bytes = 0;
    for (let m = n; m > 0n; m >>= 8n) bytes++;
    return zeros + bytes;
  };

  it("is true exactly for base58 strings of 32 to 44 characters that decode to 32 bytes", () => {
    const strings = [
      "1".repeat(32),
      "1".repeat(31),
      "1".repeat(33),
      "2".repeat(43),
      "2".repeat(44),
      "z".repeat(44),
      "11111111111111111111111111111111",
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM",
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1",
      "0PjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v ",
      "",
    ];
    let keys = 0;
    for (const s of strings) {
      const want = s.length >= 32 && s.length <= 44 && decodedLength(s) === 32;
      if (want) keys++;
      expect(isKey(s), JSON.stringify(s)).toBe(want);
    }
    expect(keys).toBe(7);
    for (const v of [undefined, null, 32, new Uint8Array(32), ["1".repeat(32)], { key: "1".repeat(32) }]) {
      expect(isKey(v)).toBe(false);
    }
  });
});
