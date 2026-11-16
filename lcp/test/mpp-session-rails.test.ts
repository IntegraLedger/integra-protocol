// Runs mpp-session-hedera-solana-xrpl.json through the mpp, hedera, svm and xrpl entry points. Every expected value is
// the file's.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { address, getAddressEncoder, getI64Encoder, getProgramDerivedAddress, getU64Decoder, getU64Encoder } from "@solana/kit";
import { ed25519 } from "@noble/curves/ed25519.js";
import { base58 } from "@scure/base";
import canonicalize from "canonicalize";
import { coreTypes, decode as decodeXrpl, encode as encodeXrpl, encodeForSigning } from "ripple-binary-codec";
import { encodeAbiParameters, keccak256, parseAbiParameters, type Hex as ViemHex } from "viem";
import { canonicalJson, toLcpString, type AtrHash, type Json } from "../src/index.js";
import { ReaderError } from "../src/evm.js";
import { hederaChannelId } from "../src/hedera.js";
import {
  issuedDigest,
  pairingsOf,
  sessionXrpl,
  type MppChallenge,
  type MppCredential,
  type SessionWithin,
} from "../src/mpp.js";
import { decodeSvmTx, openOf, sessionProof, solanaVoucher, svmLocate, type SvmReader } from "../src/svm.js";
import { decodeBlob, xrplChannelId, xrplClaim, type XrplLanded, type XrplReader } from "../src/xrpl.js";
import { counting } from "./fixtures/counting-reader.js";
import { resigned } from "./fixtures/xrpl-resign.js";
import { rowsOf } from "./rows.js";

const V = JSON.parse(readFileSync(new URL("../vectors/mpp-session-hedera-solana-xrpl.json", import.meta.url), "utf8"));
const H: AtrHash = V.fixed.H;
const refused = (code: string) => ({ refused: true, code });
const b64u = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const roundTrip = (v: unknown) => JSON.parse(JSON.stringify(v));
const C_X: MppChallenge & { id: string } = V.SS1.xrpl.placed;
const cred = (challenge: MppChallenge & { id: string }, payload: MppCredential["payload"]): MppCredential => ({ challenge, payload });

describe("SS1: the opening challenges", () => {
  it("pairingsOf, place and issuedDigest", async () => {
    const pairings = { xrpl: sessionXrpl } as const;
    for (const m of ["xrpl"] as const) {
      const row = V.SS1[m];
      expect(pairingsOf(row.challenge)).toEqual([`mpp/session/${m}`]);
      expect(pairings[m].advertise([row.challenge], H, V.fixed.link, row.challenge, 0)).toEqual([row.placed]);
      expect(await issuedDigest(row.challenge)).toBe(row.expectIssuedDigest);
      expect(await issuedDigest(row.placed)).toBe(row.expectIssuedDigest);
    }
    for (const row of rowsOf(V.SS1refusals, "mpp-session-hedera-solana-xrpl.json SS1refusals")) {
      const c: MppChallenge = { ...V.SS1[row.method].challenge, request: b64u(canonicalJson(row.request) as string) };
      if (row.expires !== undefined) c.expires = row.expires;
      expect(pairingsOf(c), row.case).toEqual(refused(row.expect));
    }
  });

  // The core draft makes `expires` a SHOULD for servers (draft-httpauth-payment-01 L324), and none of these sessions'
  // builds writes it into what the payer signs, so a challenge without it names the pairing; one that is not an RFC
  // 3339 date-time is mpp/expires-required.
  it("a challenge without expires names its pairing", () => {
    for (const m of ["xrpl"] as const) {
      const { expires: _expires, ...unexpiring } = V.SS1[m].challenge as MppChallenge;
      expect(pairingsOf(unexpiring)).toEqual([`mpp/session/${m}`]);
      expect(pairingsOf({ ...V.SS1[m].challenge, expires: "tomorrow" })).toEqual(refused("mpp/expires-required"));
    }
  });
});

describe("hederaChannelId: the Hedera session escrow's channel id", () => {
  // HS1's ids are eth-abi 6.0.0's encoding and eth-utils 6.0.0's keccak of the escrow's computeChannelId
  // (draft-hedera-session-00 L351-371; HederaStreamChannel.sol L307-314 at tomrowbo/mppx-hedera b5193b42). viem 2.57.4
  // re-derives both here, and hederaChannelId is held to them whole.
  it("HS1: the channel id, and with salt H2, byte for byte as viem encodes the escrow's computeChannelId", () => {
    const base = { payer: V.fixed.payer, payee: V.fixed.payee, token: V.fixed.token, authorizedSigner: "0x0000000000000000000000000000000000000000" as const, escrow: V.fixed.escrow, chainId: 296 as const };
    const computeChannelId = (salt: ViemHex) =>
      keccak256(
        encodeAbiParameters(parseAbiParameters("address, address, address, bytes32, address, address, uint256"), [
          base.payer.toLowerCase(),
          base.payee,
          base.token,
          salt,
          base.authorizedSigner,
          base.escrow.toLowerCase(),
          BigInt(base.chainId),
        ]),
      );
    expect([computeChannelId(H), computeChannelId(V.fixed.H2)]).toEqual([V.HS1.expectChannelId, V.HS1.expectChannelIdH2]);
    expect([V.HS1.expectChannelIdH2.slice(0, 10), V.HS1.expectChannelIdH2.slice(-4)]).toEqual([V.HS1.expectChannelIdH2Prefix, V.HS1.expectChannelIdH2Suffix]);
    expect(hederaChannelId({ ...base, salt: H })).toBe(V.HS1.expectChannelId);
    expect(hederaChannelId({ ...base, salt: V.fixed.H2 })).toBe(V.HS1.expectChannelIdH2);
  });
});

describe("the svm entry point's payment-channel pieces", () => {
  const wire = Uint8Array.from(Buffer.from(V.SV2.wireBase64, "base64"));

  // SV1's salt is @solana/kit 8.4.0's u64 little-endian decoding of H's first 8 bytes, the open's u64 salt
  // (draft-solana-session-00 L447 and L455-459); openOf's salt below is held to it.
  it("SV1: the salt, as @solana/kit decodes H's first 8 bytes as a little-endian u64", () => {
    const salt = getU64Decoder().decode(Buffer.from(H.slice(2, 18), "hex"));
    expect([salt.toString(), `0x${salt.toString(16)}`]).toEqual([V.SV1.expectSalt, V.SV1.expectSaltHex]);
  });

  it("SV2: the open's data and channel", () => {
    expect(wire.length).toBe(V.SV2.wireLength);
    const tx = decodeSvmTx(wire);
    if ("refused" in tx) throw new Error(tx.code);
    expect(`0x${sha256(tx.message)}`).toBe(V.SV2.expectMessageSha256);
    const o = openOf(tx, "CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX");
    expect(o).toEqual({ salt: BigInt(V.SV1.expectSalt), channel: V.SV2.channel });
    const ix = tx.instructions.find((i) => i.data[0] === 1)!;
    expect(hex(ix.data)).toBe(V.SV2.expectOpenData);
  });

  // The opening carries no memo, so it is found among the signatures of the channel account it creates (the PDA whose
  // seeds include the salt, H's first 8 bytes), never the fee payer's; the search is complete only when the node still
  // holds every block from the claim slot.
  it("SV2b: a search for the opening pages the channel account, and is complete only from the first available block", async () => {
    const ref = { ...V.SV2.expectReference, fromSlot: "100" };
    const paged: string[] = [];
    const readerOf = (first: bigint): SvmReader => ({
      network: ref.network,
      transaction: async () => ({ notFound: true as const, slot: null }),
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
      blockhashValid: async () => ({ valid: true, slot: 0n }),
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

  // SV3's voucher is the draft's 50 bytes (draft-solana-session-00 L1419-1429) as @solana/kit 8.4.0's codecs write
  // them; solanaVoucher is held to them byte for byte.
  it("SV3: the voucher bytes, as @solana/kit's codecs write the draft's voucher, and the session proof", () => {
    const parts = [Uint8Array.of(0x56, 0x01), getAddressEncoder().encode(address(V.SV2.channel)), getU64Encoder().encode(100n), getI64Encoder().encode(0n)];
    expect(hex(Uint8Array.from(parts.flatMap((p) => Array.from(p))))).toBe(V.SV3.expectVoucher);
    expect(hex(solanaVoucher(V.SV2.channel, 100n) as Uint8Array)).toBe(V.SV3.expectVoucher);
    // expectProofText is the draft's JCS object (draft-solana-session-00 L1131-1142, RFC 8785) as canonicalize 5.1.0 writes it.
    expect(canonicalize({ channelId: V.SV2.channel, domain: "mpp-session-auth-v1", payer: V.SV3.payer, sessionChallengeId: V.fixed.MV1 })).toBe(
      V.SV3.expectProofText,
    );
    const proof = sessionProof({ channelId: V.SV2.channel, payer: V.SV3.payer, challengeId: V.fixed.MV1 });
    expect(new TextDecoder().decode(proof)).toBe(V.SV3.expectProofText);
    const d = sha256(proof);
    expect(d.startsWith(V.SV3.expectProofSha256Prefix) && d.endsWith(V.SV3.expectProofSha256Suffix)).toBe(true);
  });

  // SV5.opening is written by hand from the Solana v0 message format (its case): SV2's message with the open's account 4
  // the operator and the channel and escrow derived for that signer. They are derived again here with @solana/kit 8.4.0's
  // getProgramDerivedAddress, over the seeds SV2's channel derives from with the payer as account 4.
  it("SV5.opening: an operator-mode open, account 4 the challenge's operator, written by hand", async () => {
    const program = "CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX";
    const w = Uint8Array.from(Buffer.from(V.SV5.opening.wireBase64, "base64"));
    expect(w.length).toBe(V.SV5.opening.wireLength);
    const [tx, sv2] = [decodeSvmTx(w), decodeSvmTx(wire)];
    if ("refused" in tx || "refused" in sv2) throw new Error("not decoded");
    expect(`0x${sha256(tx.message)}`).toBe(V.SV5.opening.expectMessageSha256);
    const keyOf = (t: typeof tx, i: number) => base58.encode(t.keys[i]!);
    const openIx = (t: typeof tx) => t.instructions.find((i) => keyOf(t, i.program) === program)!;
    const [ix, ix2] = [openIx(tx), openIx(sv2)];
    expect(hex(ix.data)).toBe(V.SV2.expectOpenData);
    expect([keyOf(tx, ix.accounts[4]!), keyOf(sv2, ix2.accounts[4]!)]).toEqual([V.SV5.methodDetails.operator, V.SV3.payer]);
    expect(ix.accounts.filter((_, i) => i !== 4)).toEqual(ix2.accounts.filter((_, i) => i !== 4));
    expect(tx.keys.filter((_, i) => i !== 2 && i !== 3)).toEqual(sv2.keys.filter((_, i) => i !== 2 && i !== 3));
    expect(openOf(tx, program)).toEqual({ salt: BigInt(V.SV1.expectSalt), channel: V.SV5.opening.channel });
    const enc = getAddressEncoder();
    const at = (n: number) => enc.encode(address(keyOf(tx, ix.accounts[n]!)));
    const channelOf = async (signer: string) =>
      (await getProgramDerivedAddress({
        programAddress: address(program),
        seeds: ["channel", at(0), at(2), at(3), enc.encode(address(signer)), ix.data.subarray(1, 9), ix.data.subarray(21, 29)],
      }))[0];
    expect([await channelOf(V.SV3.payer), await channelOf(V.SV5.methodDetails.operator)]).toEqual([V.SV2.channel, V.SV5.opening.channel]);
    expect(keyOf(tx, ix.accounts[5]!)).toBe(V.SV5.opening.channel);
    const [escrow] = await getProgramDerivedAddress({
      programAddress: address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
      seeds: [enc.encode(address(V.SV5.opening.channel)), at(8), at(3)],
    });
    expect([escrow, keyOf(tx, ix.accounts[7]!)]).toEqual([V.SV5.opening.escrow, V.SV5.opening.escrow]);
  });
});

/** The PayChannel ledger entry's ID, by hand: SHA-512Half of 0x0078 ‖ AccountID ‖ AccountID ‖ the sequence, big-endian. */
function payChannelId(account: string, destination: string, sequence: number): string {
  const accountId = (a: string) => Uint8Array.from(coreTypes.AccountID!.from(a).toBytes());
  const seq = new Uint8Array(4);
  new DataView(seq.buffer).setUint32(0, sequence, false);
  const space = Uint8Array.of(0x00, 0x78);
  return createHash("sha512").update(Buffer.concat([space, accountId(account), accountId(destination), seq])).digest().subarray(0, 32).toString("hex").toUpperCase();
}

describe("mpp/session/xrpl", () => {
  const open = (transaction: string) => cred(C_X, { action: "open", transaction, amount: "100", signature: "00" });
  /** An XRPL status read's query: the act payment at the mark validated. */
  const VALIDATED = { act: "payment", finality: "validated" } as const;
  const unreadable = (reason: string) => ({ state: "unreadable", reason, foreign: [] });
  /** What recover takes for the transaction `tx`: xrpl:1 and the challenge the opening answers. */
  const recoverOf = (tx: unknown) => ({ network: "xrpl:1" as const, tx: tx as string, option: C_X });
  const reader = (landed: XrplLanded | { notFound: true; searchedAll: boolean }, blob: string | null = null): XrplReader => ({
    network: "xrpl:1",
    tx: async () => landed,
    txBlob: async () => blob,
    validatedLedger: async () => 1000,
  });

  // XS1's id is computed by hand from the XRPL specification: SHA-512Half of the PayChannel space key 0x0078, the two
  // AccountIDs and the sequence as a big-endian UInt32 (xrpl.org, "PayChannel ID Format"; rippled Indexes.cpp L437-441
  // at 791c96fa), with node:crypto and ripple-binary-codec's AccountID; xrplChannelId is held to it.
  it("XS1: the channel id, as the PayChannel ID format computes it by hand", () => {
    expect(payChannelId(V.XS1.account, V.XS1.destination, V.XS1.sequence)).toBe(V.XS1.expect);
    expect(xrplChannelId(V.XS1.account, V.XS1.destination, V.XS1.sequence)).toBe(V.XS1.expect);
  });

  // The codes are the file's agreedRefusals rows, one for the two helpers and one for build's inputs, and for a challenge
  // whose recipient is not a classic address whose checksum holds, the code docs/reference/refusals.md gives it,
  // mpp/request-malformed. A classic address ends in a four-byte double-SHA-256 checksum (xrpl.org, "Addresses"), so
  // XS1's account with its last character changed is not one; a transaction's Sequence is a UInt32 (xrpl.org,
  // "Transaction Common Fields"); a channel id is a Hash256, 64 hex digits (xrpl.org, "Basic Data Types"); a claim signs
  // its drops as a 64-bit unsigned integer (xrpl.org, "PaymentChannelClaim").
  it("xrplChannelId, xrplClaim and build refuse malformed input: the agreedRefusals rows' codes, and mpp/request-malformed for a recipient whose checksum fails", async () => {
    const row = (head: string) => V.agreedRefusals.rows.find((r: { case: string }) => r.case.startsWith(head)).expect as string;
    const helpers = row("xrplChannelId with a malformed");
    const notAddress = "rf1BiGeXwwQoi8Z2ueFYTEXSwuJYfV2Jpm";
    expect(V.XS1.account).toBe("rf1BiGeXwwQoi8Z2ueFYTEXSwuJYfV2Jpn");
    const ids: [unknown, unknown, unknown][] = [
      [notAddress, V.XS1.destination, V.XS1.sequence],
      [V.XS1.account, notAddress, V.XS1.sequence],
      [7, V.XS1.destination, V.XS1.sequence],
      [V.XS1.account, V.XS1.destination, -1],
      [V.XS1.account, V.XS1.destination, 2 ** 32],
      [V.XS1.account, V.XS1.destination, 1.5],
    ];
    for (const [account, destination, sequence] of ids) {
      expect(xrplChannelId(account as string, destination as string, sequence as number), String([account, destination, sequence])).toEqual(
        refused(helpers),
      );
    }
    const claims: [unknown, unknown][] = [
      ["zz", 100n],
      [V.XS2.expectChannel.slice(2), 100n],
      [V.XS2.expectChannel, 100],
      [V.XS2.expectChannel, -1n],
      [V.XS2.expectChannel, 1n << 64n],
    ];
    for (const [channelId, drops] of claims) {
      expect(xrplClaim(channelId as string, drops as bigint), String([channelId, drops])).toEqual(refused(helpers));
    }
    const choice = {
      challenge: C_X,
      from: V.XS2.account,
      now: 1790000000,
      deposit: BigInt(V.XS2.deposit),
      xrpl: { publicKey: `ED${"11".repeat(32)}`, settleDelay: 3600, fee: "12", sequence: 7, lastLedgerSequence: 1000 },
    };
    expect(await sessionXrpl.build({ ...choice, from: notAddress }, H)).toEqual(refused(row("build with a malformed from")));
    // SS1's placed challenge with only its request's recipient changed: the recipient holds the shape the challenge check
    // reads, and only its checksum fails. The same challenge with XS1's account, whose checksum holds, as its recipient
    // builds.
    expect(typeof C_X.id).toBe("string");
    const request = JSON.parse(Buffer.from(C_X.request, "base64url").toString("utf8"));
    const withRecipient = (recipient: string): MppChallenge & { id: string } => ({
      ...C_X,
      request: b64u(canonicalJson({ ...request, recipient }) as string),
    });
    expect(await sessionXrpl.build({ ...choice, challenge: withRecipient(V.XS1.account) }, H)).not.toHaveProperty("refused");
    expect(await sessionXrpl.build({ ...choice, challenge: withRecipient(notAddress) }, H)).toEqual(refused("mpp/request-malformed"));
  });

  // A PaymentChannelCreate names its Destination (xrpl.org, "PaymentChannelCreate"), and a Sequence of 0 leaves the
  // sequence to TicketSequence (xrpl.org, "Transaction Common Fields"). An opening that lacks either derives no channel
  // id: channel.ref and buildWithin answer the code docs/reference/refusals.md gives it.
  it("channel.ref and buildWithin refuse an opening that lacks its destination or sequence", async () => {
    const tx = decodeXrpl(V.XS2.blob) as Record<string, unknown>;
    const { Destination: _, ...noDestination } = tx;
    const within = { ...V.SS1.xrpl.challenge, id: "seller-own-id" };
    for (const blob of [encodeXrpl(noDestination as never), encodeXrpl({ ...tx, Sequence: 0 } as never)]) {
      expect(await sessionXrpl.channel.ref(open(blob))).toEqual(refused("xrpl/not-channel-create"));
      const w = { challenge: within, opening: open(blob), cumulativeAmount: 100n, action: "voucher" } as SessionWithin;
      expect(await sessionXrpl.buildWithin(w, H)).toEqual(refused("xrpl/not-channel-create"));
    }
  });

  it("XS2: bound, reference, channel ref and until", async () => {
    expect(V.XS2.blob.length / 2).toBe(V.XS2.expectLength);
    expect(await sessionXrpl.bound(open(V.XS2.blob))).toBe(V.XS2.expectBound);
    const ref = await sessionXrpl.reference(open(V.XS2.blob), C_X);
    expect(ref).toEqual({
      network: "xrpl:1",
      transaction: V.XS2.expectHash,
      lastLedgerSequence: V.XS2.lastLedgerSequence,
      payee: V.XS2.expectTxJson.Destination,
    });
    expect(roundTrip(ref)).toEqual(ref);
    expect(await sessionXrpl.channel.ref(open(V.XS2.blob))).toEqual({ network: "xrpl:1", channel: V.XS2.expectChannel });
    expect(sessionXrpl.channel.until(open(V.XS2.blob))).toBeUndefined();
    const withCancel = encodeXrpl({ ...(decodeXrpl(V.XS2.blob) as object), CancelAfter: V.XS2.cancelAfter });
    expect(sessionXrpl.channel.until(open(withCancel))).toBe(V.XS2.expectUntil);
    expect(await sessionXrpl.recover(recoverOf(V.XS2.expectHash), reader(V.XS4.rows[0].landed, V.XS2.blob))).toBe(H);
  });

  // until reads the channel's end from the opening as channel.ref holds it (as bound holds it): an opening whose echoed
  // challenge bound refuses gives no end, as a payment that is not an opening gives none. An XRPL session request's
  // recipient is a classic address (the filter's), and a challenge of another method is not the pairing's.
  it("XS2: until reads the opening as channel.ref holds it", async () => {
    const withCancel = open(encodeXrpl({ ...(decodeXrpl(V.XS2.blob) as object), CancelAfter: V.XS2.cancelAfter }));
    expect(sessionXrpl.channel.until(withCancel)).toBe(V.XS2.expectUntil);
    const request = JSON.parse(Buffer.from(C_X.request, "base64url").toString("utf8"));
    const cases: [string, MppChallenge, string][] = [
      ["a recipient that is not a classic address", { ...C_X, request: b64u(canonicalJson({ ...request, recipient: "r1" }) as string) }, "mpp/request-malformed"],
      ["the method lightning", { ...C_X, method: "lightning" }, "mpp/not-this-pairing"],
    ];
    for (const [name, challenge, code] of cases) {
      const c = { ...withCancel, challenge } as MppCredential;
      expect(await sessionXrpl.bound(c), name).toEqual(refused(code));
      expect(await sessionXrpl.channel.ref(c), name).toEqual(refused(code));
      expect(sessionXrpl.channel.until(c), name).toBeUndefined();
    }
    expect(sessionXrpl.channel.until({ ...withCancel, payload: { ...withCancel.payload, action: "topUp" } })).toBeUndefined();
  });

  // XS4's rows are the file's landed shapes and their status; a tec result is a final failure that claimed the fee
  // (xrpl.org, "tec Codes"), and only a validated ledger's result is final (xrpl.org, "Finality of Results").
  it("XS4: recover gives XS2's memo only for the opening status reads settled, and reads its blob only then", async () => {
    const ref = await sessionXrpl.reference(open(V.XS2.blob), C_X);
    if ("refused" in ref) throw new Error(ref.code);
    const counted = (landed: XrplLanded) => {
      const calls = { n: 0 };
      const r = reader(landed, V.XS2.blob);
      const each: XrplReader = {
        ...r,
        tx: async (h, range) => (calls.n++, r.tx(h, range)),
        txBlob: async (h) => (calls.n++, r.txBlob(h)),
      };
      return { calls, r: each };
    };
    const recoverWhen: Record<string, string> = { tecNO_DST: "xrpl/not-success", "type Payment": "xrpl/not-channel-create" };
    for (const row of rowsOf(V.XS4.rows, "mpp-session-hedera-solana-xrpl.json XS4.rows")) {
      const { calls, r } = counted(row.landed);
      const status = await sessionXrpl.status({ ...ref, fromLedger: 900 }, r, row.query);
      expect(status, row.case).toEqual(row.expect);
      calls.n = 0;
      const recovered = await sessionXrpl.recover(recoverOf(ref.transaction), r);
      expect(recovered, row.case).toEqual(row.expect.state === "settled" ? V.XS2.expectBound : refused(recoverWhen[row.case]!));
      expect(calls.n, row.case).toBe(row.expect.state === "settled" ? 2 : 1);
    }
    const unvalidated = { ...V.XS4.rows[0].landed, validated: false };
    const incomplete = { state: "pending", reason: "search-incomplete", foreign: [] };
    expect(await sessionXrpl.status({ ...ref, fromLedger: 900 }, reader(unvalidated, V.XS2.blob), VALIDATED)).toEqual(incomplete);
    expect(await sessionXrpl.recover(recoverOf(ref.transaction), reader(unvalidated, V.XS2.blob))).toEqual(refused("xrpl/not-validated"));
    expect(await sessionXrpl.recover(recoverOf(ref.transaction), reader({ notFound: true, searchedAll: true }, V.XS2.blob))).toEqual(
      refused("xrpl/not-found"),
    );
    const failing: XrplReader = { ...reader(V.XS4.rows[0].landed, V.XS2.blob), tx: async () => { throw new ReaderError("transport"); } };
    expect(await sessionXrpl.recover(recoverOf(ref.transaction), failing)).toEqual(refused("xrpl/unreadable"));
  });

  // A transaction's identifying hash is 64 hex digits (xrpl.org, Basic Data Types, "Hashes"), hex digits name the
  // same bytes in either case, and decodeBlob writes the hash in upper case. This reader holds XS2's opening and its
  // blob under the vector file's XS2 hash, which is in upper case, and no other key, so recover settles on the
  // transaction status settles on.
  it("XS4: recover looks the opening up in upper case, as status does, and reads nothing for a malformed transaction", async () => {
    const ref = { network: "xrpl:1" as const, transaction: V.XS2.expectHash as string, lastLedgerSequence: V.XS2.lastLedgerSequence as number };
    const opened = V.XS4.rows[0];
    const holding: XrplReader = {
      network: "xrpl:1",
      tx: async (hash) => (hash === V.XS2.expectHash ? opened.landed : { notFound: true, searchedAll: true }),
      txBlob: async (hash) => (hash === V.XS2.expectHash ? V.XS2.blob : null),
      validatedLedger: async () => V.XS2.lastLedgerSequence + 1,
    };
    const lower = ref.transaction.toLowerCase();
    expect(await sessionXrpl.status({ ...ref, fromLedger: 900, transaction: lower, payee: V.XS2.expectTxJson.Destination }, holding, VALIDATED)).toEqual(opened.expect);
    expect(await sessionXrpl.recover(recoverOf(lower), holding)).toBe(V.XS2.expectBound);
    for (const transaction of [undefined, 7, `0x${ref.transaction}`, ref.transaction.slice(2)]) {
      const { reader: r, calls } = counting(holding);
      expect([transaction, await sessionXrpl.recover(recoverOf(transaction), r)]).toEqual([transaction, refused("xrpl/wrong-reader")]);
      expect(calls).toEqual([]);
    }
  });

  // A transaction's identifying hash is SHA-512Half of the prefix 54584E00 ("TXN\0") and its signed binary (xrpl.org,
  // "Transaction Common Fields": hash; "Basic Data Types": Hashes), computed here with node:crypto; the `tx` method with
  // `binary: true` answers the signed blob of the transaction it names (xrpl.org, "tx"). A blob that does not decode,
  // that hashes to another transaction, or whose TransactionType is not the validated answer's, is not that
  // transaction's blob: an answer out of the reader's documented form, a read to repeat.
  it("XS4: recover refuses a blob that is not the validated transaction's as xrpl/unreadable", async () => {
    const C = JSON.parse(readFileSync(new URL("../vectors/mpp-charge-xrpl.json", import.meta.url), "utf8"));
    const txHash = (blob: string) =>
      createHash("sha512").update(Buffer.from(`54584E00${blob}`, "hex")).digest().subarray(0, 32).toString("hex").toUpperCase();
    expect(txHash(V.XS2.blob)).toBe(V.XS2.expectHash);
    const opened = V.XS4.rows[0].landed;
    const ref = recoverOf(V.XS2.expectHash);
    const unreadable = refused("xrpl/unreadable");
    // XS2's blob one byte short does not decode.
    expect(await sessionXrpl.recover(ref, reader(opened, V.XS2.blob.slice(0, -2)))).toEqual(unreadable);
    // XS2's opening with a CancelAfter added is a PaymentChannelCreate carrying the same memo, under another hash.
    const withCancel = encodeXrpl({ ...(decodeXrpl(V.XS2.blob) as object), CancelAfter: V.XS2.cancelAfter });
    expect(txHash(withCancel)).not.toBe(V.XS2.expectHash);
    expect(await sessionXrpl.recover(ref, reader(opened, withCancel))).toEqual(unreadable);
    // The charge file's V3 blob is a Payment under its own hash, which the validated answer names a PaymentChannelCreate.
    expect(txHash(C.V3.blob)).toBe(C.V3.expectReference.transaction);
    expect(await sessionXrpl.recover({ ...ref, tx: C.V3.expectReference.transaction }, reader(opened, C.V3.blob))).toEqual(
      unreadable,
    );
  });

  // XS2's expectTxJson is written by hand from xrpl.org's PaymentChannelCreate and common fields. The blob is reproduced
  // here from it: the payer's key from entropy 01x16 by xrpl.org's Ed25519 Key Derivation (node:crypto's SHA-512Half),
  // @noble/curves' signature over ripple-binary-codec's encodeForSigning, and ripple-binary-codec's encode.
  it("build's txJson is XS2's fields as written by hand, which reproduce the blob, and its channel is the PayChannel ID by hand; the first claim is XS3's", async () => {
    const secret = createHash("sha512").update(new Uint8Array(16).fill(1)).digest().subarray(0, 32);
    const signing = { ...V.XS2.expectTxJson, SigningPubKey: `ED${hex(ed25519.getPublicKey(secret)).toUpperCase()}` };
    const signature = hex(ed25519.sign(Buffer.from(encodeForSigning(signing), "hex"), secret)).toUpperCase();
    expect(encodeXrpl({ ...signing, TxnSignature: signature })).toBe(V.XS2.blob);
    const recipient = JSON.parse(Buffer.from(V.SS1.xrpl.challenge.request, "base64url").toString("utf8")).recipient;
    expect(payChannelId(V.XS2.account, recipient, V.XS2.sequence)).toBe(V.XS2.expectChannel);
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
    expect(decoded).toEqual(V.XS2.expectTxJson);
    expect(u.request.txJson).toEqual(V.XS2.expectTxJson);
    expect(u.request.claim.channelId).toBe(V.XS2.expectChannel);
    expect(hex(u.request.claim.bytes).toUpperCase()).toBe(V.XS3.expect);
    expect(hex(xrplClaim(V.XS2.expectChannel, BigInt(V.XS3.drops)) as Uint8Array).toUpperCase()).toBe(V.XS3.expect);
    const c = await u.complete({ signedBlob: V.XS2.blob, claimSignature: "C042FD" });
    if ("refused" in c) throw new Error(c.code);
    expect(c.source).toBe(`did:pkh:xrpl:1:${V.XS2.account}`);
    // The opening credential is held whole, as JSON text, to the draft's open credential written by hand (XS2's case).
    const amount = JSON.parse(Buffer.from(V.SS1.xrpl.challenge.request, "base64url").toString("utf8")).amount;
    const byHand = { action: "open", transaction: V.XS2.blob, amount, signature: "C042FD" };
    expect(JSON.stringify(V.XS2.expectOpenPayload)).toBe(JSON.stringify(byHand));
    expect(JSON.stringify(c)).toBe(JSON.stringify({ challenge: C_X, source: `did:pkh:xrpl:1:${V.XS2.account}`, payload: V.XS2.expectOpenPayload }));
  });

  // XS2.withCancelAfter: build given xrpl.cancelAfter writes CancelAfter beside XS2's fields. Its expectTxJson is written by
  // hand from xrpl.org's PaymentChannelCreate (its case), and build's txJson is held to it.
  it("XS2.withCancelAfter: build with cancelAfter writes the channel's CancelAfter, as written by hand", async () => {
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
          cancelAfter: V.XS2.cancelAfter,
        },
      },
      H,
    );
    if ("refused" in u) throw new Error(u.code);
    expect(u.request.txJson).toStrictEqual(V.XS2.withCancelAfter.expectTxJson);
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
      return (sessionXrpl.advertise([c], H, V.fixed.link, c, 0) as (MppChallenge & { id: string })[])[0]!;
    };
    const amountRows = rowsOf<any>(V.SS1refusals, "mpp-session-hedera-solana-xrpl.json SS1refusals", {
      keep: ["the xrpl rows whose request is malformed", (r: { method: string; expect: string }) => r.method === "xrpl" && r.expect === "mpp/request-malformed"],
      leave: [
        "the row that names a channel, which the opening challenges' pairingsOf test above runs",
        (r: { expect: string; expires?: string }) => r.expect === "mpp/channel-named" || r.expires !== undefined,
      ],
    });
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
    const ref = await sessionXrpl.reference(open(V.XS2.blob), C_X);
    if ("refused" in ref) throw new Error(ref.code);
    for (const row of rowsOf(V.XS4.rows, "mpp-session-hedera-solana-xrpl.json XS4.rows")) {
      expect(await sessionXrpl.status({ ...ref, fromLedger: 900 }, reader(row.landed), row.query), row.case).toEqual(row.expect);
    }
    const close = sessionXrpl.closeRef(C_X, V.XS2.expectChannel.toLowerCase());
    if ("refused" in close) throw new Error(close.code);
    expect(close.payee).toBe(V.XS2.expectTxJson.Destination);
    const closeHash: string = V.XS4.closeTransaction;
    for (const row of rowsOf(V.XS4.closeRows, "mpp-session-hedera-solana-xrpl.json XS4.closeRows")) {
      expect(await sessionXrpl.status({ ...close, transaction: closeHash }, reader(row.landed), row.query), row.case).toEqual(row.expect);
    }
    const failing: XrplReader = { ...reader({ notFound: true, searchedAll: false }), tx: async () => { throw new ReaderError("transport"); } };
    expect(await sessionXrpl.status({ ...close, transaction: closeHash }, failing, VALIDATED)).toEqual(unreadable("transport"));
    // An opening transaction that is not 64 hex digits (xrpl.org, Basic Data Types, "Hashes") cannot name the
    // opening: the ref is not one reference writes, so the read is unreadable, unparseable, never expired, even from a
    // reader that answers any other hash as not found with the whole range searched and LastLedgerSequence passed; the
    // lookup asks for the hash in the upper case decodeBlob writes.
    const opened = V.XS4.rows[0];
    const holding: XrplReader = {
      ...reader({ notFound: true, searchedAll: true }),
      tx: async (hash) => (hash === ref.transaction ? opened.landed : { notFound: true, searchedAll: true }),
      validatedLedger: async () => V.XS2.lastLedgerSequence + 1,
    };
    for (const transaction of [undefined, `0x${ref.transaction}`, ref.transaction.slice(2)]) {
      const { reader: r, calls } = counting(holding);
      const malformed = { ...ref, fromLedger: 900, transaction } as typeof ref & { fromLedger: number };
      expect([transaction, await sessionXrpl.status(malformed, r, VALIDATED)]).toEqual([transaction, unreadable("unparseable")]);
      expect(calls).toEqual([]);
    }
    expect(await sessionXrpl.status({ ...ref, fromLedger: 900, transaction: ref.transaction.toLowerCase() }, holding, VALIDATED)).toEqual(
      opened.expect,
    );
    // A channel that is not 64 hex digits cannot name the close, so the read is unreadable, unparseable, never
    // failed, with nothing read; hex digits read the same in either case.
    const closed = V.XS4.closeRows[0];
    for (const channel of [`0x${close.channel}`, undefined, close.channel.slice(2)]) {
      const { reader: r, calls } = counting(reader(closed.landed));
      const malformed = { ...close, channel, transaction: closeHash } as typeof close & { transaction: string };
      expect(await sessionXrpl.status(malformed, r, VALIDATED)).toEqual(unreadable("unparseable"));
      expect(calls).toEqual([]);
    }
    const lower = { ...close, channel: close.channel.toLowerCase(), transaction: closeHash };
    expect(await sessionXrpl.status(lower, reader(closed.landed), VALIDATED)).toEqual(closed.expect);
    // The close's transaction, a Hash256 like the opening's, is read by the same rule: one that is not 64 hex digits
    // cannot name the close, so the read is unreadable with nothing read, and the lookup asks for the hash in upper
    // case, from a reader that holds the close under its upper-case hash alone.
    const holdingClose: XrplReader = {
      ...reader(closed.landed),
      tx: async (hash) => (hash === closeHash ? closed.landed : { notFound: true, searchedAll: false }),
    };
    for (const transaction of [undefined, `0x${closeHash}`, closeHash.slice(2)]) {
      const { reader: r, calls } = counting(holdingClose);
      const malformed = { ...close, transaction } as typeof close & { transaction: string };
      expect([transaction, await sessionXrpl.status(malformed, r, VALIDATED)]).toEqual([transaction, unreadable("unparseable")]);
      expect(calls).toEqual([]);
    }
    expect(await sessionXrpl.status({ ...close, transaction: closeHash.toLowerCase() }, holdingClose, VALIDATED)).toEqual(closed.expect);
  });

  // The opening and the close each read a ledger index: given that index as the position to come after, the transaction
  // is at the position given, failed before-position (read-status.md rule 16).
  it("XS4: an opening or a close at the position the query gives is before-position", async () => {
    const ref = await sessionXrpl.reference(open(V.XS2.blob), C_X);
    if ("refused" in ref) throw new Error(ref.code);
    const [opened] = V.XS4.rows;
    expect(await sessionXrpl.status({ ...ref, fromLedger: 900 }, reader(opened.landed), { ...VALIDATED, after: 990 })).toEqual({
      ...opened.expect,
      state: "failed",
      reason: "before-position",
    });
    expect(await sessionXrpl.status({ ...ref, fromLedger: 900 }, reader(opened.landed), { ...VALIDATED, after: 989 })).toEqual(opened.expect);
    const close = sessionXrpl.closeRef(C_X, V.XS2.expectChannel);
    if ("refused" in close) throw new Error(close.code);
    const [closed] = V.XS4.closeRows;
    const named = { ...close, transaction: V.XS4.closeTransaction as string };
    expect(await sessionXrpl.status(named, reader(closed.landed), { ...VALIDATED, after: 995 })).toEqual({
      ...closed.expect,
      state: "failed",
      reason: "before-position",
    });
  });

  it("XS5: a multi-signed opening is refused by bound, reference and the channel ref", async () => {
    const d = await decodeBlob(V.XS5.blob);
    if ("refused" in d) throw new Error(d.code);
    expect(d.hash).toBe(V.XS5.hash);
    expect((d.tx["Signers"] as unknown[]).length).toBe(3);
    expect(d.tx.Memos).toEqual((decodeXrpl(V.XS2.blob) as { Memos: unknown }).Memos);
    const presented = open(V.XS5.blob);
    expect(await sessionXrpl.bound(presented)).toEqual(refused(V.XS5.expect));
    expect(await sessionXrpl.reference(presented, C_X)).toEqual(refused(V.XS5.expect));
    expect(await sessionXrpl.channel.ref(presented)).toEqual(refused(V.XS5.expect));
  });

  it("plant 3: an opening whose memo carries another hash, or no memo, is refused, never H", async () => {
    const tx = decodeXrpl(V.XS2.blob) as Record<string, unknown>;
    const memoOf = (h: string) => [{ Memo: { MemoData: Buffer.from(toLcpString(h as AtrHash)).toString("hex").toUpperCase() } }];
    expect(await sessionXrpl.bound(open(encodeXrpl({ ...tx, Memos: memoOf(V.fixed.H2) })))).toEqual(refused(V.plants.xrpl.expectH2));
    const { Memos: _m, ...bare } = tx;
    expect(await sessionXrpl.bound(open(encodeXrpl(bare)))).toEqual(refused(V.plants.xrpl.expectNoMemo));
  });
});

// The channel of a within or close payment is read from the payment itself, "read from any of its payments": on XRPL
// the payload's `channelId` in upper case ("MUST be canonicalised before use as a key"). The seller issues within
// challenges itself, never with the opening's id, so the echoed challenge here carries the seller's own id and names the
// channel. The channel is XS2's; the network is the one the opening challenge names.
describe("channel.ref of a within or close payment, on the seller's own challenge", () => {
  const requestOf = (c: MppChallenge) => JSON.parse(Buffer.from(c.request, "base64url").toString("utf8"));
  function own(opening: MppChallenge, name: (r: Record<string, unknown>) => void): MppChallenge & { id: string } {
    const r = requestOf(opening);
    name(r);
    return { realm: opening.realm, method: opening.method, intent: opening.intent, expires: opening.expires!, request: b64u(canonicalJson(r) as string), id: "seller-own-id" };
  }

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

describe("the XRPL session pairing's record", () => {
  // The record reads the opening, never a later voucher, so its proves states what the opening shows and does not say
  // that later requests in the channel were paid under this ATR.
  it("coverage is full, claims is true, and its proves does not speak of later requests", () => {
    for (const b of [sessionXrpl]) {
      expect(b.data.coverage).toBe("full");
      expect(b.claims).toBe(true);
      expect(b.data.proves).not.toMatch(/later requests|paid under this ATR|did not meter/i);
    }
  });
});

// Each agreedRefusals row, run through the calls its case names: one call for each condition the case lists, on the
// file's XRPL opening challenge, XS1's and XS2's XRPL values and SV2's channel.
describe("mpp-session-hedera-solana-xrpl.json agreedRefusals: every row runs", () => {
  type Row = { case: string; expect: string };
  /** The method's opening challenge, as issued, with its decoded request changed by `change`. */
  const requestOf = (m: "xrpl", change: (r: Record<string, any>) => void): MppChallenge => {
    const r = JSON.parse(Buffer.from(V.SS1[m].challenge.request, "base64url").toString("utf8"));
    change(r);
    return { ...V.SS1[m].challenge, request: b64u(canonicalJson(r) as string) };
  };
  const xrplOpen = (transaction: string) => cred(C_X, { action: "open", transaction, amount: "100", signature: "00" });
  /** XS2's opening with `n` memos: its LCP memo, then memos of one zero byte. */
  const withMemos = (n: number) => {
    const tx = decodeXrpl(V.XS2.blob) as { Memos: unknown[] };
    const other = { Memo: { MemoData: "00" } };
    return encodeXrpl({ ...tx, Memos: [...tx.Memos, ...Array.from({ length: n - tx.Memos.length }, () => other)] } as never);
  };
  /** XS1's account with its last character changed: the classic address's checksum fails. */
  const notAddress = `${V.XS1.account.slice(0, -1)}m`;
  const xrplChoice = {
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
  };

  /** channel.kind and channel.ref of an XRPL payment under `action`, and buildWithin of `action` on XS2's opening. */
  const xrplActionCalls = async (action: string) => {
    const paid = cred(C_X, { action, channelId: V.XS2.expectChannel, amount: "100", signature: "00" });
    const within = await sessionXrpl.buildWithin({ challenge: C_X, opening: xrplOpen(V.XS2.blob), cumulativeAmount: 100n, action } as SessionWithin, H);
    return [sessionXrpl.channel.kind(paid), await sessionXrpl.channel.ref(paid), within];
  };
  // Each input a row changes is accepted as given, so each refusal below is the change's.
  it("the inputs the rows change, as given, are accepted", async () => {
    for (const m of ["xrpl"] as const) expect(pairingsOf(requestOf(m, () => undefined))).toEqual([`mpp/session/${m}`]);
    expect(await sessionXrpl.bound(xrplOpen(withMemos(8)))).toBe(H);
    expect(xrplChannelId(V.XS1.account, V.XS1.destination, V.XS1.sequence)).toBe(V.XS1.expect);
    expect(solanaVoucher(V.SV2.channel, 100n)).toBeInstanceOf(Uint8Array);
    expect(await sessionXrpl.build(xrplChoice, H)).not.toHaveProperty("refused");
    for (const calls of [await xrplActionCalls("voucher")]) {
      expect(calls[0]).toBe("within");
      for (const answer of calls.slice(1)) expect(answer).not.toHaveProperty("refused");
    }
  });

  const cases: Record<string, () => Promise<unknown[]>> = {
    "an xrpl session request whose recipient is not shaped as a classic address (r and 24 to 34 base58 characters)": async () => [
      pairingsOf(requestOf("xrpl", (r) => (r["recipient"] = `x${r["recipient"].slice(1)}`))),
      pairingsOf(requestOf("xrpl", (r) => (r["recipient"] = r["recipient"].slice(0, 24)))),
      pairingsOf(requestOf("xrpl", (r) => (r["recipient"] = `${r["recipient"]}aa`))),
      pairingsOf(requestOf("xrpl", (r) => (r["recipient"] = `${r["recipient"].slice(0, -1)}0`))),
    ],
    "an xrpl opening with more than 8 memos": async () => [
      await sessionXrpl.bound(xrplOpen(withMemos(9))),
      await sessionXrpl.reference(xrplOpen(withMemos(9)), C_X),
    ],
    "xrplChannelId with a malformed address or sequence, or xrplClaim with a malformed id or drops": async () => [
      xrplChannelId(notAddress, V.XS1.destination, V.XS1.sequence),
      xrplChannelId(V.XS1.account, notAddress, V.XS1.sequence),
      xrplChannelId(V.XS1.account, V.XS1.destination, -1),
      xrplChannelId(V.XS1.account, V.XS1.destination, 2 ** 32),
      xrplClaim(V.XS2.expectChannel.slice(2), BigInt(V.XS3.drops)),
      xrplClaim(V.XS2.expectChannel, -1n),
      xrplClaim(V.XS2.expectChannel, 1n << 64n),
    ],
    "solanaVoucher with a malformed channel id or an out-of-range number": async () => [
      solanaVoucher(V.SV2.channel.slice(0, 32), 100n),
      solanaVoucher(V.SV2.channel, -1n),
      solanaVoucher(V.SV2.channel, 1n << 64n),
      solanaVoucher(V.SV2.channel, 100n, 1n << 63n),
    ],
    "bound of a credential whose action is not open": async () => [
      await sessionXrpl.bound(cred(C_X, { action: "voucher", channelId: V.XS2.expectChannel, amount: "200", signature: "00" })),
    ],
    "build with a malformed from, deposit or XRPL channel terms": async () => {
      const x = xrplChoice.xrpl;
      return [
        await sessionXrpl.build({ ...xrplChoice, from: notAddress }, H),
        await sessionXrpl.build({ ...xrplChoice, deposit: 0n }, H),
        await sessionXrpl.build({ ...xrplChoice, deposit: 1n << 64n }, H),
        await sessionXrpl.build({ ...xrplChoice, xrpl: { ...x, publicKey: "not hex" } }, H),
        await sessionXrpl.build({ ...xrplChoice, xrpl: { ...x, fee: "1.5" } }, H),
        await sessionXrpl.build({ ...xrplChoice, xrpl: { ...x, settleDelay: -1 } }, H),
        await sessionXrpl.build({ ...xrplChoice, xrpl: { ...x, sequence: 2 ** 32 } }, H),
        await sessionXrpl.build({ ...xrplChoice, xrpl: { ...x, lastLedgerSequence: 1.5 } }, H),
        await sessionXrpl.build({ ...xrplChoice, xrpl: { ...x, cancelAfter: -1 } }, H),
      ];
    },
    "an xrpl topUp, use or bearer (draft-xrpl-session-00 L334-377 at tempoxyz/mpp-specs 08e7dd87: the payload's action is open, voucher or close)":
      async () => [...(await xrplActionCalls("topUp")), ...(await xrplActionCalls("use")), ...(await xrplActionCalls("bearer"))],
  };

  // The row whose blobs carry NetworkID: XS2's opening re-signed with each of its networkIds, and the same steps without
  // one give XS2's blob. build's complete and buildWithin read the opening as bound does, so each call is refused.
  const networkRow = (V.agreedRefusals.rows as (Row & { networkIds?: number[]; blobs?: string[] })[]).find((r) => r.networkIds !== undefined)!;
  cases[networkRow.case] = async () => {
    expect(resigned(V.XS2.blob)).toBe(V.XS2.blob);
    expect(networkRow.networkIds!.map((n) => resigned(V.XS2.blob, n))).toEqual(networkRow.blobs);
    const u = await sessionXrpl.build(xrplChoice, H);
    if ("refused" in u) throw new Error(u.code);
    const out: unknown[] = [];
    for (const blob of networkRow.blobs!) {
      const opening = xrplOpen(blob);
      out.push(
        await sessionXrpl.bound(opening),
        await sessionXrpl.reference(opening, opening.challenge),
        await u.complete({ signedBlob: blob, claimSignature: "00" }),
        await sessionXrpl.buildWithin({ challenge: C_X, opening, cumulativeAmount: 100n, action: "voucher" } as SessionWithin, H),
      );
    }
    return out;
  };

  // Rows 8 to 11: channel.ref of an xrpl opening reads it as bound does, the memo and NetworkID, with bound's codes.
  const lcpMemo = (tx: { Memos: { Memo: { MemoData: string } }[] }) =>
    tx.Memos.findIndex((m) => Buffer.from(m.Memo.MemoData, "hex").toString("utf8").includes(H.slice(2)));
  const xs2 = decodeXrpl(V.XS2.blob) as { Memos: { Memo: { MemoData: string } }[] };
  const otherH = (() => {
    const at = lcpMemo(xs2);
    if (at === -1) throw new Error("XS2 carries no memo naming H");
    const text = Buffer.from(xs2.Memos[at]!.Memo.MemoData, "hex").toString("utf8").replace(H.slice(2), "11".repeat(32));
    const memos = xs2.Memos.map((m, k) => (k === at ? { Memo: { ...m.Memo, MemoData: Buffer.from(text, "utf8").toString("hex").toUpperCase() } } : m));
    return encodeXrpl({ ...xs2, Memos: memos } as never);
  })();
  const { Memos: _memos, ...noMemos } = xs2;
  const refOf = async (blobs: string[]) => {
    const out: unknown[] = [];
    for (const blob of blobs) out.push(await sessionXrpl.bound(xrplOpen(blob)), await sessionXrpl.channel.ref(xrplOpen(blob)));
    return out;
  };
  const refRows = (V.agreedRefusals.rows as Row[]).slice(8, 12);
  it("channel.ref of XS2's opening, which bound takes, gives its channel", async () => {
    expect(await sessionXrpl.bound(xrplOpen(V.XS2.blob))).toBe(H);
    expect(await sessionXrpl.channel.ref(xrplOpen(V.XS2.blob))).toMatchObject({ channel: V.XS2.expectChannel });
  });
  cases[refRows[0]!.case] = () => refOf(networkRow.blobs!);
  cases[refRows[1]!.case] = () => refOf([encodeXrpl(noMemos as never), encodeXrpl({ ...xs2, Memos: [{ Memo: { MemoData: "00" } }] } as never)]);
  cases[refRows[2]!.case] = () => refOf([otherH]);
  cases[refRows[3]!.case] = () => refOf([withMemos(9)]);

  const rows = rowsOf(V.agreedRefusals.rows as Row[], "mpp-session-hedera-solana-xrpl.json agreedRefusals.rows", { exact: Object.keys(cases).length });

  it("names a case for every row, and no other", () => {
    expect(Object.keys(cases).sort()).toEqual(rows.map((r) => r.case).sort());
  });

  for (const row of rows) {
    it(row.case, async () => {
      const results = await cases[row.case]!();
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) expect(r).toEqual(refused(row.expect));
    });
  }
});
