// Runs mpp-session-hedera-solana-xrpl.json through the mpp, hedera, svm and xrpl entry points. Every expected value is
// the file's.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  blockhash,
  compileTransactionMessage,
  createTransactionMessage,
  getCompiledTransactionMessageEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import { decode as decodeXrpl, encode as encodeXrpl } from "ripple-binary-codec";
import { hashTypedData } from "viem";
import { canonicalJson, toLcpString, type AtrHash, type Json } from "../src/index.js";
import type { EvmReceipt } from "../src/evm.js";
import { ReaderError } from "../src/evm.js";
import { hederaChannelId, type HederaEvmReader } from "../src/hedera.js";
import { issuedDigest, pairingsOf, sessionHedera, sessionSolana, sessionXrpl, type MppChallenge, type MppCredential } from "../src/mpp.js";
import { decodeSvmTx, openOf, sessionProof, sessionSalt, solanaVoucher, svmLocate, type SvmLanded, type SvmReader } from "../src/svm.js";
import { cancelAfterOf, xrplChannelId, xrplClaim, type XrplLanded, type XrplReader } from "../src/xrpl.js";

const V = JSON.parse(readFileSync(new URL("../vectors/mpp-session-hedera-solana-xrpl.json", import.meta.url), "utf8"));
const H: AtrHash = V.fixed.H;
const refused = (code: string) => ({ refused: true, code });
const b64u = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const roundTrip = (v: unknown) => JSON.parse(JSON.stringify(v));
const C_H: MppChallenge & { id: string } = V.SS1.hedera.placed;
const C_S: MppChallenge & { id: string } = V.SS1.solana.placed;
const C_X: MppChallenge & { id: string } = V.SS1.xrpl.placed;
const cred = (challenge: MppChallenge & { id: string }, payload: MppCredential["payload"]): MppCredential => ({ challenge, payload });

describe("SS1: the opening challenges", () => {
  it("pairingsOf, place and issuedDigest", async () => {
    const pairings = { hedera: sessionHedera, solana: sessionSolana, xrpl: sessionXrpl } as const;
    for (const m of ["hedera", "solana", "xrpl"] as const) {
      const row = V.SS1[m];
      expect(pairingsOf(row.challenge)).toEqual([`mpp/session/${m}`]);
      expect(pairings[m].advertise([row.challenge], H, V.fixed.link, row.challenge)).toEqual([row.placed]);
      expect(await issuedDigest(row.challenge)).toBe(row.expectIssuedDigest);
      expect(await issuedDigest(row.placed)).toBe(row.expectIssuedDigest);
    }
    for (const row of V.SS1refusals) {
      const c: MppChallenge = { ...V.SS1[row.method].challenge, request: b64u(canonicalJson(row.request) as string) };
      if (row.noExpires) delete c.expires;
      expect(pairingsOf(c), row.case).toEqual(refused(row.expect));
    }
  });
});

function hederaReader(receipts: Record<string, EvmReceipt>, network = "hedera:testnet"): HederaEvmReader {
  return {
    network: network as HederaEvmReader["network"],
    receipt: async (tx) => receipts[tx.toLowerCase()] ?? null,
    blockNumber: async () => 50_000_000n,
    transaction: async () => null,
    call: async () => {
      throw new ReaderError("transport");
    },
  };
}
const asReceipt = (r: { status: number; blockNumber: string; logs: EvmReceipt["logs"] }): EvmReceipt => ({
  status: r.status as 0 | 1,
  blockNumber: BigInt(r.blockNumber),
  logs: r.logs,
});

describe("mpp/session/hedera", () => {
  it("HS1: the channel id, and with salt H2", () => {
    const base = { payer: V.fixed.payer, payee: V.fixed.payee, token: V.fixed.token, authorizedSigner: "0x0000000000000000000000000000000000000000" as const, escrow: V.fixed.escrow, chainId: 296 as const };
    expect(hederaChannelId({ ...base, salt: H })).toBe(V.HS1.expectChannelId);
    const other = hederaChannelId({ ...base, salt: V.fixed.H2 });
    expect(other.startsWith(V.HS1.expectChannelIdH2Prefix) && other.endsWith(V.HS1.expectChannelIdH2Suffix)).toBe(true);
  });

  it("HS2: build's calls and the zero voucher's digest", async () => {
    const u = await sessionHedera.build({ challenge: C_H, from: V.fixed.payer, now: 1790000000, deposit: BigInt(V.HS2.deposit) }, H);
    if ("refused" in u) throw new Error(u.code);
    const [approve, open] = u.request.calls;
    expect((approve!.data.length - 2) / 2).toBe(V.HS2.expectApproveLength);
    expect(approve!.data.startsWith(V.HS2.expectApprovePrefix) && approve!.data.endsWith(V.HS2.expectApproveSuffix)).toBe(true);
    expect(approve!.data).toContain(V.HS2.expectApproveContains);
    expect((open!.data.length - 2) / 2).toBe(V.HS2.expectOpenLength);
    expect(open!.data.startsWith(V.HS2.expectOpenSelector)).toBe(true);
    const [from, to] = V.HS2.expectOpenSaltBytes;
    expect(`0x${open!.data.slice(2 + 2 * from, 2 + 2 * to)}`).toBe(H);
    expect(hashTypedData(u.request.voucher as never)).toBe(V.HS2.expectVoucherDigest);
    const c = u.complete({ openTx: V.HS3.txHash, signature: `0x${"22".repeat(65)}` });
    if ("refused" in c) throw new Error(c.code);
    expect(c.payload["channelId"]).toBe(V.HS1.expectChannelId);
  });

  it("HS3: fetchPresented, bound, channel ref and status of the opening", async () => {
    const receipt: EvmReceipt = { status: 1, blockNumber: 40_000_000n, logs: [V.HS3.log] };
    const reader = hederaReader({ [V.HS3.txHash]: receipt });
    const c = cred(C_H, { action: "open", channelId: V.HS1.expectChannelId, txHash: V.HS3.txHash, cumulativeAmount: "0", signature: "0x00" });
    expect(await sessionHedera.bound(c)).toEqual(refused("hedera/read-first"));
    const landed = await sessionHedera.fetchPresented(c, reader);
    if ("refused" in landed) throw new Error(landed.code);
    expect(await sessionHedera.bound(landed)).toBe(V.HS3.expectBound);
    expect(await sessionHedera.channel.ref(c)).toEqual(V.HS3.expectRef);
    const ref = await sessionHedera.reference(c);
    if ("refused" in ref) throw new Error(ref.code);
    expect(roundTrip(ref)).toEqual(ref);
    expect(await sessionHedera.status(ref, reader)).toEqual({ state: "settled", finality: "finalized", blockNumber: 40_000_000n });
    expect(await sessionHedera.recover(ref, reader)).toBe(H);
  });

  it("HS4: a real testnet opening and close", async () => {
    const r4 = V.HS4;
    expect(r4.salt.startsWith(r4.expectSaltPrefix) && r4.salt.endsWith(r4.expectSaltSuffix)).toBe(true);
    expect(r4.channel.startsWith(r4.expectChannelPrefix) && r4.channel.endsWith(r4.expectChannelSuffix)).toBe(true);
    expect(r4.openReceipt.blockNumber).toBe(r4.expectBlock);
    const opaque = b64u(canonicalJson({ legalContext: toLcpString(r4.salt), legalContextUrl: V.fixed.link }) as string);
    const challenge = { ...C_H, id: r4.challengeId, opaque };
    const reader = hederaReader({ [r4.openTx]: asReceipt(r4.openReceipt), [r4.closeTx]: asReceipt(r4.closeReceipt) });
    const c = cred(challenge, { action: "open", channelId: r4.channel, txHash: r4.openTx, cumulativeAmount: "0", signature: "0x00" });
    const landed = await sessionHedera.fetchPresented(c, reader);
    if ("refused" in landed) throw new Error(landed.code);
    expect(await sessionHedera.bound(landed)).toBe(r4.salt);
    const close = sessionHedera.closeRef(C_H, r4.channel);
    if ("refused" in close) throw new Error(close.code);
    expect(close).toEqual(r4.expectCloseRef);
    // The live close receipt holds a log that the search filter selects: the escrow's, with each non-null topic equal.
    const matches = (r4.closeReceipt.logs as { address: string; topics: string[] }[]).filter(
      (l) =>
        l.address.toLowerCase() === close.search.address.toLowerCase() &&
        close.search.topics.every((t, i) => t === null || l.topics[i]?.toLowerCase() === t.toLowerCase()),
    );
    expect(matches).toHaveLength(1);
    expect(await sessionHedera.status({ ...close, transaction: r4.closeTx }, reader)).toMatchObject({ state: "settled" });
    expect(await sessionHedera.status({ ...close, channel: V.HS1.expectChannelId, transaction: r4.closeTx }, reader)).toEqual({
      state: "failed",
      why: "binding-log-not-found",
    });
  });

  it("HS5: channel kinds, boundWithin and until", async () => {
    for (const [action, kind] of V.HS5.kinds) expect(sessionHedera.channel.kind(cred(C_H, { action }))).toBe(kind);
    expect(sessionHedera.channel.kind(cred(C_H, { action: V.HS5.badAction }))).toEqual(refused(V.HS5.expectBad));
    expect(await sessionHedera.channel.boundWithin(cred(C_H, { action: "voucher" }))).toEqual(refused("mpp/not-bound-within"));
    expect(sessionHedera.channel.until(cred(C_H, { action: "open" }))).toBeUndefined();
  });

  it("plant 1: another agreement's channel, and a log from another emitter, are refused, never H", async () => {
    const r4 = V.HS4;
    const reader = hederaReader({ [r4.openTx]: asReceipt(r4.openReceipt) });
    const c = cred(C_H, { action: "open", channelId: r4.channel, txHash: r4.openTx, cumulativeAmount: "0", signature: "0x00" });
    const landed = await sessionHedera.fetchPresented(c, reader);
    if ("refused" in landed) throw new Error(landed.code);
    expect(await sessionHedera.bound(landed)).toEqual(refused(V.plants.hedera.expect));
    const moved = cred(C_H, { action: "open", channelId: V.HS1.expectChannelId, txHash: V.HS3.txHash, cumulativeAmount: "0", signature: "0x00" });
    const forged = { ...moved, landed: { transaction: V.HS3.txHash, blockNumber: 1n, logs: [{ ...V.HS3.log, address: V.plants.hedera.otherEmitter }] } };
    expect(await sessionHedera.bound(forged)).toEqual(refused(V.plants.hedera.expectOtherEmitter));
  });

  // A `ChannelOpened` whose payer or payee topic is not a 32-byte word is not the log the opening needs; the answer is
  // `hedera/channel-log-not-found`, as for any other log that does not match, never a throw.
  it("a matching log whose payer or payee topic is not hex is refused, never thrown", async () => {
    const c = cred(C_H, { action: "open", channelId: V.HS1.expectChannelId, txHash: V.HS3.txHash, cumulativeAmount: "0", signature: "0x00" });
    for (const at of [2, 3]) {
      const topics = [...V.HS3.log.topics];
      topics[at] = "not-hex";
      const landed = { ...c, landed: { transaction: V.HS3.txHash, blockNumber: 1n, logs: [{ ...V.HS3.log, topics }] } };
      await expect(sessionHedera.bound(landed)).resolves.toEqual(refused("hedera/channel-log-not-found"));
    }
  });
});

const landedSvm = (wire: Uint8Array, err: unknown = null): SvmLanded => ({ wire, err, loaded: { writable: [], readonly: [] }, inner: [] });

describe("mpp/session/solana", () => {
  const wire = Uint8Array.from(Buffer.from(V.SV2.wireBase64, "base64"));
  const open = (transaction: string, channelId = V.SV2.channel) => cred(C_S, { action: "open", channelId, transaction });

  it("SV1: the salt", () => {
    expect(sessionSalt(H).toString()).toBe(V.SV1.expectSalt);
    expect(`0x${sessionSalt(H).toString(16)}`).toBe(V.SV1.expectSaltHex);
  });

  it("SV2: the open's data and channel, bound and reference", async () => {
    expect(wire.length).toBe(V.SV2.wireLength);
    const tx = decodeSvmTx(wire);
    if ("refused" in tx) throw new Error(tx.code);
    expect(`0x${sha256(tx.message)}`).toBe(V.SV2.expectMessageSha256);
    const o = openOf(tx, "CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX");
    expect(o).toEqual({ salt: BigInt(V.SV1.expectSalt), channel: V.SV2.channel });
    const ix = tx.instructions.find((i) => i.data[0] === 1)!;
    expect(hex(ix.data)).toBe(V.SV2.expectOpenData);
    expect(await sessionSolana.bound(open(V.SV2.wireBase64))).toBe(V.SV2.expectBound);
    const ref = await sessionSolana.reference(open(V.SV2.wireBase64));
    expect(ref).toEqual(V.SV2.expectReference);
    expect(roundTrip(ref)).toEqual(ref);
    expect(await sessionSolana.channel.ref(open(V.SV2.wireBase64))).toEqual({ network: V.SV2.expectReference.network, channel: V.SV2.channel });
  });

  // The opening carries no memo, so it is found among the signatures of the channel account it creates (the PDA whose
  // seeds include the salt, H's first 8 bytes), never the fee payer's; the search is complete only when the node still
  // holds every block from the claim slot.
  it("SV2b: a search for the opening pages the channel account, and is complete only from the first available block", async () => {
    const reference = await sessionSolana.reference(open(V.SV2.wireBase64));
    if ("refused" in reference) throw new Error(reference.code);
    const ref = { ...reference, fromSlot: "100" };
    const paged: string[] = [];
    const readerOf = (first: bigint): SvmReader => ({
      network: ref.network,
      transaction: async () => null,
      signatures: async (address) => {
        paged.push(address);
        return address === V.SV2.channel
          ? [
              { signature: "close", slot: 130n, memo: null },
              { signature: "opening", slot: 120n, memo: null },
              { signature: "older", slot: 90n, memo: null },
            ]
          : [];
      },
      blockhashValid: async () => true,
      firstAvailableBlock: async () => first,
      account: async () => {
        throw new Error("this reference names no nonce account");
      },
    });
    const read: string[] = [];
    const status = async (r: { transaction: string }) => {
      read.push(r.transaction);
      return r.transaction === "opening" ? { state: "settled" } : { state: "failed" };
    };
    expect(await svmLocate(ref, readerOf(100n), H, status)).toEqual({ found: "opening", complete: true });
    expect(paged).toEqual([V.SV2.channel]);
    expect(read).toEqual(["close", "opening"]);
    expect(await svmLocate(ref, readerOf(101n), H, status)).toEqual({ complete: false });
    const none = async () => ({ state: "failed" });
    expect(await svmLocate(ref, readerOf(100n), H, none)).toEqual({ complete: true });
  });

  it("SV2c: with the pairing's own status, another signature on the channel account is not the opening", async () => {
    const reference = await sessionSolana.reference(open(V.SV2.wireBase64));
    if ("refused" in reference) throw new Error(reference.code);
    const ref = { ...reference, fromSlot: "100" };
    const wires: Record<string, string> = { opening: V.SV2.wireBase64, other: V.plants.solana.wireBase64 };
    // The deposit's CPI as the RPC lists it in innerInstructions: the SPL Token program (SV2's static key 8) running
    // transferChecked (instruction 12).
    const deposit = { program: 8, data: Uint8Array.of(0x0c, 0x40, 0x42, 0x0f, 0, 0, 0, 0, 0, 6) };
    const readerOf = (signatures: string[], first: bigint): SvmReader => ({
      network: ref.network,
      transaction: async (sig) =>
        wires[sig] === undefined
          ? null
          : { wire: Uint8Array.from(Buffer.from(wires[sig]!, "base64")), err: null, loaded: { writable: [], readonly: [] }, inner: [deposit] },
      signatures: async (address) =>
        address === V.SV2.channel ? signatures.map((signature, i) => ({ signature, slot: 130n - BigInt(i), memo: null })) : [],
      blockhashValid: async () => true,
      firstAvailableBlock: async () => first,
      account: async () => {
        throw new Error("this reference names no nonce account");
      },
    });
    const status = sessionSolana.status as (r: typeof ref & { transaction: string }, reader: SvmReader) => Promise<{ state: string }>;
    expect(await status({ ...ref, transaction: "opening" }, readerOf([], 100n))).toMatchObject({ state: "settled" });
    expect(await status({ ...ref, transaction: "other" }, readerOf([], 100n))).toMatchObject({
      state: "failed",
      why: "not-this-instrument",
    });
    expect(await svmLocate(ref, readerOf(["other"], 100n), H, status)).toEqual({ complete: true });
    expect(await svmLocate(ref, readerOf(["other", "opening"], 100n), H, status)).toEqual({ found: "opening", complete: true });
    expect(await svmLocate(ref, readerOf(["other", "opening"], 101n), H, status)).toEqual({ complete: false });
  });

  it("SV3: the voucher bytes, the session proof, and boundWithin of use and voucher", async () => {
    expect(hex(solanaVoucher(V.SV2.channel, 100n) as Uint8Array)).toBe(V.SV3.expectVoucher);
    const proof = sessionProof({ channelId: V.SV2.channel, payer: V.SV3.payer, challengeId: V.fixed.MV1 });
    expect(new TextDecoder().decode(proof)).toBe(V.SV3.expectProofText);
    const d = sha256(proof);
    expect(d.startsWith(V.SV3.expectProofSha256Prefix) && d.endsWith(V.SV3.expectProofSha256Suffix)).toBe(true);
    const use = cred(C_S, { action: "use", channelId: V.SV2.channel, authentication: { type: "proof", challengeId: V.fixed.MV1, payer: V.SV3.payer, signature: "x" } });
    expect(await sessionSolana.channel.boundWithin(use)).toBe(H);
    expect(await sessionSolana.channel.boundWithin(cred(C_S, { action: "voucher", channelId: V.SV2.channel }))).toEqual(refused("mpp/not-bound-within"));
  });

  it("SV4: a reported close", async () => {
    const closeWire = async (discriminator: number) => {
      const message = pipe(
        createTransactionMessage({ version: 0 }),
        (m) => setTransactionMessageFeePayer(address("2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4"), m),
        (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: blockhash("EZ3rST5dvHmbanh75jc4PuLfV96vp9fEYBVeNk4FfM1k"), lastValidBlockHeight: 0n }, m),
        (m) =>
          appendTransactionMessageInstructions(
            [
              {
                programAddress: address("CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX"),
                accounts: [
                  { address: address("2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4"), role: AccountRole.WRITABLE_SIGNER },
                  { address: address(V.SV2.channel), role: AccountRole.WRITABLE },
                  { address: address("SysvarRent111111111111111111111111111111111"), role: AccountRole.READONLY },
                ],
                data: Uint8Array.of(discriminator),
              },
            ],
            m,
          ),
      );
      const bytes = new Uint8Array(getCompiledTransactionMessageEncoder().encode(compileTransactionMessage(message)));
      const w = new Uint8Array(1 + 64 + bytes.length);
      w[0] = 1;
      w.set(bytes, 65);
      return w;
    };
    const close = sessionSolana.closeRef(C_S, V.SV2.channel);
    if ("refused" in close) throw new Error(close.code);
    const ref = { ...close, transaction: "sig" };
    const readerOf = (w: Uint8Array): SvmReader => ({
      network: close.network,
      transaction: async () => landedSvm(w),
      signatures: async () => [],
      blockhashValid: async () => true,
      firstAvailableBlock: async () => 0n,
      account: async () => {
        throw new Error("this reference names no nonce account");
      },
    });
    expect(await sessionSolana.status(ref, readerOf(await closeWire(4)))).toEqual({ state: "settled", commitment: "finalized" });
    expect(await sessionSolana.status(ref, readerOf(await closeWire(2)))).toEqual({ state: "failed", why: "not-a-close" });
  });

  it("build returns the salt and the request's values; complete checks the composed open", async () => {
    const u = await sessionSolana.build({ challenge: C_S, from: V.SV3.payer, now: 1790000000, deposit: 10_000_000n }, H);
    if ("refused" in u) throw new Error(u.code);
    expect(u.request.salt).toBe(BigInt(V.SV1.expectSalt));
    expect(u.complete({ action: "open", channelId: V.SV2.channel, transaction: V.SV2.wireBase64 })).toMatchObject({ challenge: C_S });
    expect(u.complete({ action: "open", channelId: V.plants.solana.channel, transaction: V.plants.solana.wireBase64 })).toEqual(
      refused(V.plants.solana.expect),
    );
  });

  it("plant 2: an opening under another hash's salt, and a use proof for another challenge, are refused, never H", async () => {
    const w = Uint8Array.from(Buffer.from(V.plants.solana.wireBase64, "base64"));
    const d = sha256(w);
    expect(d.startsWith(V.plants.solana.expectWireSha256Prefix) && d.endsWith(V.plants.solana.expectWireSha256Suffix)).toBe(true);
    expect(sessionSalt(V.fixed.H2).toString()).toBe(V.plants.solana.expectSaltH2);
    expect(await sessionSolana.bound(open(V.plants.solana.wireBase64, V.plants.solana.channel))).toEqual(refused(V.plants.solana.expect));
    const use = cred(C_S, { action: "use", channelId: V.SV2.channel, authentication: { type: "proof", challengeId: V.plants.solana.useWrongChallengeId, payer: V.SV3.payer, signature: "x" } });
    expect(await sessionSolana.channel.boundWithin(use)).toEqual(refused(V.plants.solana.expectUse));
  });
});

describe("mpp/session/xrpl", () => {
  const open = (transaction: string) => cred(C_X, { action: "open", transaction, amount: "100", signature: "00" });
  const reader = (landed: XrplLanded | { notFound: true; searchedAll: boolean }, blob: string | null = null): XrplReader => ({
    network: "xrpl:1",
    tx: async () => landed,
    txBlob: async () => blob,
    validatedLedger: async () => 1000,
  });

  it("XS1: the channel id", () => {
    expect(xrplChannelId(V.XS1.account, V.XS1.destination, V.XS1.sequence)).toBe(V.XS1.expect);
  });

  it("XS2: bound, reference, channel ref and until", async () => {
    expect(V.XS2.blob.length / 2).toBe(V.XS2.expectLength);
    expect(await sessionXrpl.bound(open(V.XS2.blob))).toBe(V.XS2.expectBound);
    const ref = await sessionXrpl.reference(open(V.XS2.blob));
    expect(ref).toEqual({ network: "xrpl:1", transaction: V.XS2.expectHash, lastLedgerSequence: V.XS2.lastLedgerSequence });
    expect(roundTrip(ref)).toEqual(ref);
    expect(await sessionXrpl.channel.ref(open(V.XS2.blob))).toEqual({ network: "xrpl:1", channel: V.XS2.expectChannel });
    expect(sessionXrpl.channel.until(open(V.XS2.blob))).toBeUndefined();
    const withCancel = encodeXrpl({ ...(decodeXrpl(V.XS2.blob) as object), CancelAfter: V.XS2.cancelAfter });
    expect(cancelAfterOf(withCancel)).toBe(V.XS2.cancelAfter);
    expect(sessionXrpl.channel.until(open(withCancel))).toBe(V.XS2.expectUntil);
    expect(await sessionXrpl.recover({ network: "xrpl:1", transaction: V.XS2.expectHash }, reader({ notFound: true, searchedAll: true }, V.XS2.blob))).toBe(H);
  });

  it("build gives XS2's decoded fields other than the signature; the first claim is XS3's", async () => {
    const u = await sessionXrpl.build(
      {
        challenge: C_X,
        from: V.XS2.account,
        now: 1790000000,
        deposit: BigInt(V.XS2.deposit),
        xrpl: {
          publicKey: (decodeXrpl(V.XS2.blob) as { PublicKey: string }).PublicKey,
          settleDelay: V.XS2.settleDelay,
          fee: V.XS2.fee,
          sequence: V.XS2.sequence,
          lastLedgerSequence: V.XS2.lastLedgerSequence,
        },
      },
      H,
    );
    if ("refused" in u) throw new Error(u.code);
    const decoded = decodeXrpl(V.XS2.blob) as Record<string, unknown>;
    delete decoded["SigningPubKey"];
    delete decoded["TxnSignature"];
    expect(u.request.txJson).toEqual(decoded);
    expect(u.request.claim.channelId).toBe(V.XS2.expectChannel);
    expect(hex(u.request.claim.bytes).toUpperCase()).toBe(V.XS3.expect);
    expect(hex(xrplClaim(V.XS2.expectChannel, BigInt(V.XS3.drops)) as Uint8Array).toUpperCase()).toBe(V.XS3.expect);
    const c = await u.complete({ signedBlob: V.XS2.blob, claimSignature: "C042FD" });
    if ("refused" in c) throw new Error(c.code);
    expect(c.source).toBe(`did:pkh:xrpl:1:${V.XS2.account}`);
  });

  it("build refuses a request whose amount is not a u64 of drops, and builds the largest u64", async () => {
    const choice = (challenge: MppChallenge & { id: string }) => ({
      challenge,
      from: V.XS2.account,
      now: 1790000000,
      deposit: BigInt(V.XS2.deposit),
      xrpl: { publicKey: `ED${"11".repeat(32)}`, settleDelay: 3600, fee: "12", sequence: 7, lastLedgerSequence: 1000 },
    });
    const placedWith = (request: Json) => {
      const c: MppChallenge = { ...V.SS1.xrpl.challenge, request: b64u(canonicalJson(request) as string) };
      return (sessionXrpl.advertise([c], H, V.fixed.link, c) as (MppChallenge & { id: string })[])[0]!;
    };
    const amountRows = V.SS1refusals.filter((r: { method: string; expect: string }) => r.method === "xrpl" && r.expect === "mpp/request-malformed");
    for (const row of amountRows) {
      const c: MppChallenge & { id: string } = { ...C_X, request: b64u(canonicalJson(row.request) as string) };
      expect(await sessionXrpl.build(choice(c), H), row.case).toEqual(refused("mpp/request-malformed"));
    }
    // 2^64 - 1, the largest value the claim's big-endian u64 holds.
    const max = placedWith({ ...V.SS1refusals.at(-1).request, amount: "18446744073709551615" });
    const u = await sessionXrpl.build(choice(max), H);
    if ("refused" in u) throw new Error(u.code);
    expect(hex(u.request.claim.bytes).toUpperCase().endsWith("FFFFFFFFFFFFFFFF")).toBe(true);
  });

  it("XS4: the opening's status and a reported close", async () => {
    const ref = await sessionXrpl.reference(open(V.XS2.blob));
    if ("refused" in ref) throw new Error(ref.code);
    for (const row of V.XS4.rows) {
      expect(await sessionXrpl.status({ ...ref, fromLedger: 900 }, reader(row.landed)), row.case).toEqual(row.expect);
    }
    const close = sessionXrpl.closeRef(C_X, V.XS2.expectChannel.toLowerCase());
    if ("refused" in close) throw new Error(close.code);
    for (const row of V.XS4.closeRows) {
      expect(await sessionXrpl.status({ ...close, transaction: "AB".repeat(32) }, reader(row.landed)), row.case).toEqual(row.expect);
    }
    const failing: XrplReader = { ...reader({ notFound: true, searchedAll: false }), tx: async () => { throw new ReaderError("transport"); } };
    expect(await sessionXrpl.status({ ...close, transaction: "AB".repeat(32) }, failing)).toEqual({ state: "pending", why: "unreadable" });
  });

  it("plant 3: an opening whose memo carries another hash, or no memo, is refused, never H", async () => {
    const tx = decodeXrpl(V.XS2.blob) as Record<string, unknown>;
    const memoOf = (h: string) => [{ Memo: { MemoData: Buffer.from(toLcpString(h as AtrHash)).toString("hex").toUpperCase() } }];
    expect(await sessionXrpl.bound(open(encodeXrpl({ ...tx, Memos: memoOf(V.fixed.H2) })))).toEqual(refused(V.plants.xrpl.expectH2));
    const { Memos: _m, ...bare } = tx;
    expect(await sessionXrpl.bound(open(encodeXrpl(bare)))).toEqual(refused(V.plants.xrpl.expectNoMemo));
  });
});

// The channel of a within or close payment is read from the payment itself, "read from any of its payments": on Hedera
// `{network, channel: payload.channelId}` in lower case ("Implementations MUST use lowercase hex"), on Solana the
// payload's `channelId` re-encoded from its 32 bytes, on XRPL the payload's `channelId` in upper case ("MUST be
// canonicalised before use as a key"). The seller issues within challenges itself, never with the opening's id, so the
// echoed challenge here carries the seller's own id and names the channel. The channels are HS1's, SV2's and XS2's;
// the networks are those the opening challenges name.
describe("channel.ref of a within or close payment, on the seller's own challenge", () => {
  const requestOf = (c: MppChallenge) => JSON.parse(Buffer.from(c.request, "base64url").toString("utf8"));
  function own(opening: MppChallenge, name: (r: Record<string, unknown>) => void): MppChallenge & { id: string } {
    const r = requestOf(opening);
    name(r);
    return { realm: opening.realm, method: opening.method, intent: opening.intent, expires: opening.expires!, request: b64u(canonicalJson(r) as string), id: "seller-own-id" };
  }

  it("hedera: a voucher's and a close's ref is {hedera:testnet, payload.channelId}", async () => {
    const channel = V.HS1.expectChannelId as string;
    const c = own(C_H, (r) => ((r["methodDetails"] as Record<string, unknown>)["channelId"] = channel));
    for (const action of ["voucher", "topUp", "close"]) {
      const p = cred(c, { action, channelId: channel.toUpperCase().replace("0X", "0x"), cumulativeAmount: "100", signature: `0x${"22".repeat(65)}` });
      expect(await sessionHedera.channel.ref(p)).toEqual({ network: "hedera:testnet", channel });
    }
    expect(sessionHedera.channel.kind(cred(c, { action: "voucher", channelId: channel }))).toBe("within");
    expect(await sessionHedera.channel.ref(cred({ ...c, method: "solana" }, { action: "voucher", channelId: channel }))).toEqual(refused("mpp/not-this-pairing"));
  });

  it("solana: a voucher's and a close's ref is {the request's network, payload.channelId}", async () => {
    const channel = V.SV2.channel as string;
    const c = own(C_S, (r) => ((r["methodDetails"] as Record<string, unknown>)["channelId"] = channel));
    for (const action of ["voucher", "topUp", "close"]) {
      const p = cred(c, { action, channelId: channel, cumulativeAmount: "100", signature: "x" });
      expect(await sessionSolana.channel.ref(p)).toEqual({ network: V.SV2.expectReference.network, channel });
    }
    expect(sessionSolana.channel.kind(cred(c, { action: "voucher", channelId: channel }))).toBe("within");
  });

  it("xrpl: a voucher's and a close's ref is {xrpl:1, payload.channelId in upper case}", async () => {
    const channel = V.XS2.expectChannel as string;
    const c = own(C_X, (r) => (r["channelId"] = channel));
    for (const action of ["voucher", "close"]) {
      const p = cred(c, { action, channelId: channel.toLowerCase(), amount: "200", signature: "00" });
      expect(await sessionXrpl.channel.ref(p)).toEqual({ network: "xrpl:1", channel });
    }
    expect(sessionXrpl.channel.kind(cred(c, { action: "voucher", channelId: channel }))).toBe("within");
  });
});

describe("the three session pairings' records", () => {
  it("publicProof is true and claims is true on all three", () => {
    for (const b of [sessionHedera, sessionSolana, sessionXrpl]) {
      expect(b.pattern.publicProof).toBe(true);
      expect(b.claims).toBe(true);
      expect(b.pattern.proves).toContain("Later requests in this channel were paid under this ATR by vouchers the seller did not meter");
    }
  });
});


