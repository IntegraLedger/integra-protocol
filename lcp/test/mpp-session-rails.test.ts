// Runs mpp-session-hedera-solana-xrpl.json through the mpp, hedera, svm and xrpl entry points. Every expected value is
// the file's. A durable opening is the file's wire rewritten by @solana/kit (fixtures/svm-durable-nonce.ts), with
// x402-exact-solana.json's nonce; its digest is node:crypto's SHA-256 of kit's message.
// A close or an opening with an account from an address lookup table is @solana/kit's (fixtures/svm-lookup-table.ts).
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
  decompileTransactionMessage,
  getAddressEncoder,
  getCompiledTransactionMessageDecoder,
  getCompiledTransactionMessageEncoder,
  getI64Encoder,
  getProgramDerivedAddress,
  getU64Decoder,
  getU64Encoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import { ed25519 } from "@noble/curves/ed25519.js";
import { base58 } from "@scure/base";
import canonicalize from "canonicalize";
import { coreTypes, decode as decodeXrpl, encode as encodeXrpl, encodeForSigning } from "ripple-binary-codec";
import { encodeAbiParameters, encodeFunctionData, hashTypedData, keccak256, parseAbi, parseAbiParameters, type Hex as ViemHex } from "viem";
import { canonicalJson, toLcpString, type AtrHash, type Json } from "../src/index.js";
import type { EvmReceipt } from "../src/evm.js";
import { ReaderError } from "../src/evm.js";
import { hederaChannelId, type HederaEvmReader } from "../src/hedera.js";
import {
  issuedDigest,
  pairingsOf,
  sessionHedera,
  sessionSolana,
  sessionXrpl,
  type MppChallenge,
  type MppCredential,
  type SessionWithin,
} from "../src/mpp.js";
import { decodeSvmTx, openOf, sessionProof, sessionSalt, solanaVoucher, svmLocate, type SvmLanded, type SvmReader } from "../src/svm.js";
import { decodeBlob, xrplChannelId, xrplClaim, type XrplLanded, type XrplReader } from "../src/xrpl.js";
import { counting } from "./fixtures/counting-reader.js";
import { DURABLE, durableWire } from "./fixtures/svm-durable-nonce.js";
import { TABLE, tableClose, tableOpening } from "./fixtures/svm-lookup-table.js";
import { rowsOf } from "./rows.js";

const V = JSON.parse(readFileSync(new URL("../vectors/mpp-session-hedera-solana-xrpl.json", import.meta.url), "utf8"));
const VS = JSON.parse(readFileSync(new URL("../vectors/x402-exact-solana.json", import.meta.url), "utf8"));
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
/** SS1's Solana challenge with its methodDetails changed by `change`, placed as C_S is. */
const solanaPlaced = (change: (details: Record<string, unknown>) => void): MppChallenge & { id: string } => {
  const r = JSON.parse(Buffer.from(V.SS1.solana.challenge.request, "base64url").toString("utf8"));
  change(r.methodDetails);
  const c: MppChallenge = { ...V.SS1.solana.challenge, request: b64u(canonicalJson(r) as string) };
  const placed = sessionSolana.advertise([c], H, V.fixed.link, c);
  if (!Array.isArray(placed)) throw new Error("not placed");
  return placed[0] as MppChallenge & { id: string };
};

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
    for (const m of ["hedera", "solana", "xrpl"] as const) {
      const { expires: _expires, ...unexpiring } = V.SS1[m].challenge as MppChallenge;
      expect(pairingsOf(unexpiring)).toEqual([`mpp/session/${m}`]);
      expect(pairingsOf({ ...V.SS1[m].challenge, expires: "tomorrow" })).toEqual(refused("mpp/expires-required"));
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

  // HS2's calldata are eth-abi 6.0.0's encodings of ERC-20 approve and the escrow's open (draft-hedera-session-00
  // L417-445), and its digest is eth-account 0.14.0's of the draft's Voucher (L1068-1142). viem 2.57.4 re-derives each
  // here, and build's two calls and its voucher are held to them whole.
  it("HS2: build's approve and open calldata, byte for byte as viem encodes them, and the zero voucher's digest", async () => {
    const escrow = V.fixed.escrow.toLowerCase() as ViemHex;
    const deposit = BigInt(V.HS2.deposit);
    const approveData = encodeFunctionData({
      abi: parseAbi(["function approve(address spender, uint256 amount)"]),
      functionName: "approve",
      args: [escrow, deposit],
    });
    const openData = encodeFunctionData({
      abi: parseAbi(["function open(address payee, address token, uint128 deposit, bytes32 salt, address authorizedSigner)"]),
      functionName: "open",
      args: [V.fixed.payee, V.fixed.token, deposit, H, "0x0000000000000000000000000000000000000000"],
    });
    expect([approveData, openData]).toEqual([V.HS2.expectApproveCalldata, V.HS2.expectOpenCalldata]);
    const zeroVoucher = hashTypedData({
      domain: { name: "Hedera Stream Channel", version: "1", chainId: 296, verifyingContract: escrow },
      primaryType: "Voucher",
      types: { Voucher: [{ name: "channelId", type: "bytes32" }, { name: "cumulativeAmount", type: "uint128" }] },
      message: { channelId: V.HS1.expectChannelId, cumulativeAmount: 0n },
    });
    expect(zeroVoucher).toBe(V.HS2.expectVoucherDigest);
    const u = await sessionHedera.build({ challenge: C_H, from: V.fixed.payer, now: 1790000000, deposit }, H);
    if ("refused" in u) throw new Error(u.code);
    const [approve, open] = u.request.calls;
    expect([approve!.data, open!.data]).toEqual([V.HS2.expectApproveCalldata, V.HS2.expectOpenCalldata]);
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
    // The opening credential is held whole, as JSON text, to the draft's open credential written by hand (HS2's case).
    const byHand = { action: "open", channelId: V.HS1.expectChannelId, txHash: V.HS3.txHash, cumulativeAmount: "0", signature: `0x${"22".repeat(65)}` };
    expect(JSON.stringify(V.HS2.expectOpenPayload)).toBe(JSON.stringify(byHand));
    expect(JSON.stringify(c)).toBe(JSON.stringify({ challenge: C_H, payload: V.HS2.expectOpenPayload }));
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

  // recover answers a reader as exactHedera.recover does (x402-exact-hedera.json, failures-are-values): one missing or
  // for another network than the ref's is hedera/wrong-reader, and one for the network whose read fails is
  // hedera/unreadable.
  it("recover: a reader missing or of another network is hedera/wrong-reader", async () => {
    const receipt: EvmReceipt = { status: 1, blockNumber: 40_000_000n, logs: [V.HS3.log] };
    const c = cred(C_H, { action: "open", channelId: V.HS1.expectChannelId, txHash: V.HS3.txHash, cumulativeAmount: "0", signature: "0x00" });
    const ref = await sessionHedera.reference(c);
    if ("refused" in ref) throw new Error(ref.code);
    for (const reader of [hederaReader({ [V.HS3.txHash]: receipt }, "hedera:mainnet"), undefined, null]) {
      expect(await sessionHedera.recover(ref, reader as never), String(reader?.network)).toEqual(refused("hedera/wrong-reader"));
    }
    const failing = { ...hederaReader({}), receipt: async () => Promise.reject(new ReaderError("transport")) };
    expect(await sessionHedera.recover(ref, failing)).toEqual(refused("hedera/unreadable"));
    expect(await sessionHedera.recover(ref, hederaReader({ [V.HS3.txHash]: receipt }))).toBe(H);
  });

  // A receipt status of 0 is a transaction that failed (EIP-658, the JSON-RPC receipt's 0x0), whose logs the chain
  // reverted: refusals.md gives `hedera/reverted` for a session opening that reverted. HS3's and HS4's openings with
  // status 1 give H and HS4's salt; with status 0 each is a revert, whatever logs the reader gives with it, and a ref
  // naming the escrow alone reads the revert first, and with status 1 the salt of the escrow's one ChannelOpened. A ref
  // naming neither the escrow nor a binding log is `hedera/wrong-reader`. A log of another shape is read first of all:
  // `hedera/unreadable`.
  it("recover: a reverted opening is hedera/reverted, as the EVM and Tempo recovers answer a revert", async () => {
    const r4 = V.HS4;
    const opaque = b64u(canonicalJson({ legalContext: toLcpString(r4.salt), legalContextUrl: V.fixed.link }) as string);
    const hs3 = cred(C_H, { action: "open", channelId: V.HS1.expectChannelId, txHash: V.HS3.txHash, cumulativeAmount: "0", signature: "0x00" });
    const hs4 = cred({ ...C_H, id: r4.challengeId, opaque }, { action: "open", channelId: r4.channel, txHash: r4.openTx, cumulativeAmount: "0", signature: "0x00" });
    const openings: [MppCredential, EvmReceipt, string][] = [
      [hs3, { status: 1, blockNumber: 40_000_000n, logs: [V.HS3.log] }, H],
      [hs4, asReceipt(r4.openReceipt), r4.salt],
    ];
    for (const [c, receipt, salt] of openings) {
      const ref = await sessionHedera.reference(c);
      if ("refused" in ref) throw new Error(ref.code);
      const at = (r: unknown) => hederaReader({ [ref.transaction]: r as EvmReceipt });
      expect(await sessionHedera.recover(ref, at(receipt))).toBe(salt);
      expect(await sessionHedera.recover(ref, at({ ...receipt, status: 0 }))).toEqual(refused("hedera/reverted"));
      expect(await sessionHedera.recover(ref, at({ ...receipt, status: 0, logs: [] }))).toEqual(refused("hedera/reverted"));
      if (ref.bindingLog === undefined) throw new Error("no binding log");
      const { bindingLog, ...unbound } = ref;
      const escrowOnly = { ...unbound, escrow: bindingLog.address };
      expect(await sessionHedera.recover(escrowOnly, at({ ...receipt, status: 0 }))).toEqual(refused("hedera/reverted"));
      expect(await sessionHedera.recover(escrowOnly, at(receipt))).toBe(salt);
      expect(await sessionHedera.recover(unbound as never, at(receipt))).toEqual(refused("hedera/wrong-reader"));
      const misshapen = { ...receipt, status: 0, logs: [...receipt.logs, { ...receipt.logs[0], data: undefined }] };
      expect(await sessionHedera.recover(ref, at(misshapen))).toEqual(refused("hedera/unreadable"));
    }
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
        rowsOf(close.search.topics, "the close ref's search topics").every((t, i) => t === null || l.topics[i]?.toLowerCase() === t.toLowerCase()),
    );
    expect(matches).toHaveLength(1);
    expect(await sessionHedera.status({ ...close, transaction: r4.closeTx }, reader)).toMatchObject({ state: "settled" });
    expect(await sessionHedera.status({ ...close, channel: V.HS1.expectChannelId, transaction: r4.closeTx }, reader)).toEqual({
      state: "failed",
      why: "binding-log-not-found",
    });
  });

  // HS6 (mpp-session-hedera-solana-xrpl.json): an opening reported as its transaction and its challenge, without the
  // credential, names no channel. reference writes the transaction and the challenge's escrow, and recover reads the
  // escrow's one ChannelOpened log in the receipt: HS4's live opening gives HS4's salt, and two such logs, none, a
  // binding log naming a channel no log names, or a revert are refused. Each refusal is given at or below the reader's
  // finalized mark (50,000,000 here, above HS4's block), and is hedera/not-final above it. status reads the same ref as
  // recover does, and each row's expectStatus is its answer at the mark: settled where recover gives the salt, and
  // failed where recover refuses; above the mark (both marks below the block here) the settlement is at `latest` and
  // each failed answer pending.
  it("HS6: recover and status from the escrow where the opening names no channel", async () => {
    const r4 = V.HS4;
    const opaque = b64u(canonicalJson({ legalContext: toLcpString(r4.salt), legalContextUrl: V.fixed.link }) as string);
    const reported = cred({ ...C_H, id: r4.challengeId, opaque }, { action: "open", txHash: r4.openTx, cumulativeAmount: "0", signature: "0x00" });
    const rows = rowsOf(V.HS6.rows, "mpp-session-hedera-solana-xrpl.json HS6.rows", { exact: 5 });
    expect(await sessionHedera.reference(reported)).toEqual(rows[0].ref);
    const below = (r: EvmReceipt) => ({ ...hederaReader({}), receipt: async () => r, blockNumber: async () => r.blockNumber - 1n });
    for (const row of rows) {
      const receipt = asReceipt(row.receipt);
      const reader = hederaReader({ [row.ref.transaction]: receipt });
      if (row.expectSalt !== undefined) {
        expect(await sessionHedera.recover(row.ref, reader), row.case).toBe(row.expectSalt);
        expect(await sessionHedera.recover(row.ref, below(receipt)), row.case).toBe(row.expectSalt);
      } else {
        expect(await sessionHedera.recover(row.ref, reader), row.case).toEqual(refused(row.expect));
        expect(await sessionHedera.recover(row.ref, below(receipt)), row.case).toEqual(refused("hedera/not-final"));
      }
      const { state, why, finality, blockNumber } = row.expectStatus;
      if (state === "settled") {
        expect(row.expectSalt, row.case).toBeDefined();
        expect(await sessionHedera.status(row.ref, reader), row.case).toEqual({ state, finality, blockNumber: BigInt(blockNumber) });
        expect(await sessionHedera.status(row.ref, below(receipt)), row.case).toEqual({ state, finality: "latest", blockNumber: BigInt(blockNumber) });
      } else {
        expect([state, row.expectSalt], row.case).toEqual(["failed", undefined]);
        expect(await sessionHedera.status(row.ref, reader), row.case).toEqual({ state, why });
        expect(await sessionHedera.status(row.ref, below(receipt)), row.case).toEqual({ state: "pending", why });
      }
    }
    // One receipt read for the escrow alone; a reader that finds none, or whose read fails, is pending.
    let reads = 0;
    const counted = { ...hederaReader({}), receipt: async () => (reads++, null) };
    expect(await sessionHedera.status(rows[0].ref, counted)).toEqual({ state: "pending", why: "not-found" });
    expect(reads).toBe(1);
    const failing = { ...hederaReader({}), receipt: async () => Promise.reject(new ReaderError("transport")) };
    expect(await sessionHedera.status(rows[0].ref, failing)).toEqual({ state: "pending", why: "unreadable" });
    // A ref status cannot read, or a reader for another network, is pending unreadable, with nothing read.
    const { escrow, ...neither } = rows[0].ref;
    const unreadable: [string, unknown, HederaEvmReader][] = [
      ["neither a binding log nor an escrow", neither, counted],
      ["both a binding log and an escrow", { ...rows[3].ref, escrow }, counted],
      ["an escrow that is not an address", { ...rows[0].ref, escrow: `${escrow}00` }, counted],
      ["a transaction that is not a 32-byte hash", { ...rows[0].ref, transaction: rows[0].ref.transaction.slice(0, 64) }, counted],
      ["a reader for another network", rows[0].ref, { ...counted, network: "hedera:mainnet" }],
    ];
    for (const [label, ref, reader] of unreadable) {
      reads = 0;
      expect(await sessionHedera.status(ref as never, reader), label).toEqual({ state: "pending", why: "unreadable" });
      expect(reads, label).toBe(0);
    }
  });

  it("HS5: channel kinds, boundWithin and until", async () => {
    for (const [action, kind] of rowsOf(V.HS5.kinds, "mpp-session-hedera-solana-xrpl.json HS5.kinds")) expect(sessionHedera.channel.kind(cred(C_H, { action }))).toBe(kind);
    expect(sessionHedera.channel.kind(cred(C_H, { action: V.HS5.badAction }))).toEqual(refused(V.HS5.expectBad));
    expect(await sessionHedera.channel.boundWithin(cred(C_H, { action: "voucher" }))).toEqual(refused("mpp/not-bound-within"));
    expect(sessionHedera.channel.until(cred(C_H, { action: "open" }))).toBeUndefined();
  });

  // draft-hedera-session-00 L840-845 at tempoxyz/mpp-specs 08e7dd87: the payload's `action` is one of `open`, `topUp`,
  // `voucher` and `close`. A `use`, which the draft does not define, is refused by each function that reads an action;
  // the same payment as a voucher is within, names its channel and is built, and a `topUp` is not built.
  it("a use, which the Hedera draft does not define, is mpp/session-action from channel.kind, channel.ref and buildWithin", async () => {
    const opened = cred(C_H, { action: "open", channelId: V.HS1.expectChannelId, txHash: V.HS3.txHash, cumulativeAmount: "0", signature: "0x00" });
    const paid = (action: string) => cred(C_H, { action, channelId: V.HS1.expectChannelId, cumulativeAmount: "100", signature: `0x${"22".repeat(65)}` });
    const within = (action: string) => sessionHedera.buildWithin({ challenge: C_H, opening: opened, cumulativeAmount: 100n, action } as SessionWithin, H);
    expect(sessionHedera.channel.kind(paid("voucher"))).toBe("within");
    expect(await sessionHedera.channel.ref(paid("voucher"))).toEqual({ network: "hedera:testnet", channel: V.HS1.expectChannelId });
    expect(await within("voucher")).not.toHaveProperty("refused");
    expect(sessionHedera.channel.kind(paid("use"))).toEqual(refused("mpp/session-action"));
    expect(await sessionHedera.channel.ref(paid("use"))).toEqual(refused("mpp/session-action"));
    expect(await within("use")).toEqual(refused("mpp/session-action"));
    expect(await within("topUp")).toEqual(refused("mpp/within-action-not-built"));
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

  // SV1's salt is @solana/kit 8.4.0's u64 little-endian decoding of H's first 8 bytes, the open's u64 salt
  // (draft-solana-session-00 L447 and L455-459); sessionSalt, and build's request.salt below, are held to it.
  it("SV1: the salt, as @solana/kit decodes H's first 8 bytes as a little-endian u64", () => {
    const salt = getU64Decoder().decode(Buffer.from(H.slice(2, 18), "hex"));
    expect([salt.toString(), `0x${salt.toString(16)}`]).toEqual([V.SV1.expectSalt, V.SV1.expectSaltHex]);
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

  it("SV2's opening made durable: a sysvar from a lookup table is bound and recorded; a nonce account from one is refused", async () => {
    const sysvar = durableWire(V.SV2.wireBase64, [DURABLE.sysvar]);
    expect(sysvar.instruction0Accounts[0]).toBeLessThan(sysvar.staticKeys);
    expect(sysvar.instruction0Accounts[1]).toBeGreaterThanOrEqual(sysvar.staticKeys);
    expect(await sessionSolana.bound(open(sysvar.wireBase64))).toBe(V.SV2.expectBound);
    expect(await sessionSolana.reference(open(sysvar.wireBase64))).toEqual({
      ...V.SV2.expectReference,
      digest: sysvar.digest,
      blockhash: "",
      nonce: { account: DURABLE.nonceAccount, value: DURABLE.value },
    });
    const both = durableWire(V.SV2.wireBase64, [DURABLE.nonceAccount, DURABLE.sysvar]);
    expect(both.instruction0Accounts[0]).toBeGreaterThanOrEqual(both.staticKeys);
    expect(await sessionSolana.bound(open(both.wireBase64))).toEqual(refused("svm/nonce-account-not-static"));
    expect(await sessionSolana.reference(open(both.wireBase64))).toEqual(refused("svm/nonce-account-not-static"));
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
          ? { notFound: true as const, slot: null }
          : { wire: Uint8Array.from(Buffer.from(wires[sig]!, "base64")), err: null, loaded: { writable: [], readonly: [] }, inner: [deposit] },
      signatures: async (address) =>
        address === V.SV2.channel ? signatures.map((signature, i) => ({ signature, slot: 130n - BigInt(i), memo: null })) : [],
      blockhashValid: async () => ({ valid: true, slot: 0n }),
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

  // SV3's voucher is the draft's 50 bytes (draft-solana-session-00 L1419-1429) as @solana/kit 8.4.0's codecs write
  // them; solanaVoucher is held to them byte for byte, as buildWithin's message is in mpp-session-within.test.ts.
  it("SV3: the voucher bytes, as @solana/kit's codecs write the draft's voucher, the session proof, and boundWithin of use and voucher", async () => {
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
    const operator = solanaPlaced((d) => Object.assign(d, V.SV5.methodDetails));
    const use = cred(operator, { action: "use", channelId: V.SV2.channel, authentication: { type: "proof", challengeId: V.fixed.MV1, payer: V.SV3.payer, signature: "x" } });
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
      blockhashValid: async () => ({ valid: true, slot: 0n }),
      firstAvailableBlock: async () => 0n,
      account: async () => {
        throw new Error("this reference names no nonce account");
      },
    });
    expect(await sessionSolana.status(ref, readerOf(await closeWire(4)))).toEqual({ state: "settled", commitment: "finalized" });
    expect(await sessionSolana.status(ref, readerOf(await closeWire(2)))).toEqual({ state: "failed", why: "not-a-close" });
    // A program or channel that is not the base58 of a 32-byte key cannot name the close, so the read is pending, never
    // failed, with nothing read (docs/guides/rails.md, "Reading settlement"). "0" is outside the base58 alphabet.
    const sealed = await closeWire(4);
    for (const change of [{ channel: V.SV2.channel.slice(0, 32) }, { channel: undefined }, { program: `0${ref.program.slice(1)}` }, { program: undefined }]) {
      const { reader, calls } = counting(readerOf(sealed));
      expect(await sessionSolana.status({ ...ref, ...change } as typeof ref, reader)).toEqual({ state: "pending", why: "unreadable" });
      expect(calls).toEqual([]);
    }
    // A close the node holds at neither commitment is pending not-found; SvmReader.transaction answers a landed
    // transaction or notFound, and any other answer, such as a bare null, is pending unreadable.
    const answering = (a: unknown): SvmReader => ({ ...readerOf(sealed), transaction: async () => a as never });
    expect(await sessionSolana.status(ref, answering({ notFound: true, slot: 1150n }))).toEqual({ state: "pending", why: "not-found" });
    expect(await sessionSolana.status(ref, answering(null))).toEqual({ state: "pending", why: "unreadable" });
    // Solana's commitment levels (solana.com/docs/rpc, "Configuring State Commitment"): a block at `confirmed` has been
    // voted on by a supermajority of the cluster, and one at `finalized` has reached maximum lockout. A block that is not
    // finalized can be replaced, and the close can land in another block and execute otherwise, so an error is a
    // failure only from the read at `finalized`. The signature fixes the instructions, so a transaction that does not
    // close the channel is not a close at either commitment. The error is the vector file's (x402-exact-solana.json V4).
    const err = (VS.V4.rows as { err?: unknown }[]).find((r) => r.err !== undefined && r.err !== null)!.err;
    const at = (commitment: "finalized" | "confirmed", w: Uint8Array): SvmReader => ({
      ...readerOf(w),
      transaction: async (_sig, c) => (commitment === "confirmed" && c === "finalized" ? { notFound: true, slot: null } : landedSvm(w, err)),
    });
    expect(await sessionSolana.status(ref, at("finalized", sealed))).toEqual({ state: "failed", why: "err" });
    expect(await sessionSolana.status(ref, at("confirmed", sealed))).toEqual({ state: "pending", why: "not-final" });
    const notClose = await closeWire(2);
    for (const commitment of ["finalized", "confirmed"] as const) {
      expect(await sessionSolana.status(ref, at(commitment, notClose)), commitment).toEqual({ state: "failed", why: "not-a-close" });
    }
  });

  // SV4.tableClose's wire is @solana/kit 8.4.0's close with its channel from an address lookup table, held byte for
  // byte; kit's decompile of that message, given the table's addresses, names the channel at the close's account 1 as
  // the table's entry. getTransaction lists the addresses a transaction's lookup tables loaded as
  // meta.loadedAddresses ("Transaction addresses loaded from address lookup tables", the RPC documentation as
  // @solana/rpc-types quotes it), writable then read-only after the static keys, the order kit's decompile gives.
  it("SV4.tableClose: a close whose channel comes from an address lookup table is read through the loaded addresses", async () => {
    const t = V.SV4.tableClose;
    expect(tableClose("2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4", V.SV2.channel, "EZ3rST5dvHmbanh75jc4PuLfV96vp9fEYBVeNk4FfM1k")).toBe(t.wireBase64);
    const w = Uint8Array.from(Buffer.from(t.wireBase64, "base64"));
    const compiled = getCompiledTransactionMessageDecoder().decode(w.subarray(65));
    if (compiled.version !== 0) throw new Error("the close is a v0 message");
    const ix = decompileTransactionMessage(compiled, { addressesByLookupTableAddress: { [address(TABLE)]: [address(V.SV2.channel)] } }).instructions[0]!;
    expect(ix.accounts![1]).toEqual({ address: V.SV2.channel, addressIndex: 0, lookupTableAddress: TABLE, role: AccountRole.WRITABLE });
    expect(compiled.instructions[0]!.accountIndices![1]).toBe(compiled.staticAccounts.length);
    const close = sessionSolana.closeRef(C_S, V.SV2.channel);
    if ("refused" in close) throw new Error(close.code);
    const ref = { ...close, transaction: "sig" };
    type Row = { case: string; loaded: { writable: string[]; readonly: string[] }; expect: unknown };
    for (const row of rowsOf(t.rows as Row[], "mpp-session-hedera-solana-xrpl.json SV4.tableClose.rows", { exact: 5 })) {
      const loaded = { writable: row.loaded.writable.map((k) => base58.decode(k)), readonly: row.loaded.readonly.map((k) => base58.decode(k)) };
      const reader: SvmReader = {
        network: close.network,
        transaction: async () => ({ wire: w, err: null, loaded, inner: [] }),
        signatures: async () => [],
        blockhashValid: async () => ({ valid: true, slot: 0n }),
        firstAvailableBlock: async () => 0n,
        account: async () => {
          throw new Error("a close read reads no account");
        },
      };
      expect(await sessionSolana.status(ref, reader), row.case).toEqual(row.expect);
    }
  });

  // An opening's status reads its transfer among the instructions over the static keys and the loaded addresses; SV2's
  // message loads none, so a landed answer listing one is out of getTransaction's documented form.
  it("SV2c: a landed opening whose loaded addresses are not the ones its message's lookups name is pending unreadable", async () => {
    const reference = await sessionSolana.reference(open(V.SV2.wireBase64));
    if ("refused" in reference) throw new Error(reference.code);
    const deposit = { program: 8, data: Uint8Array.of(0x0c, 0x40, 0x42, 0x0f, 0, 0, 0, 0, 0, 6) };
    const readerOf = (loaded: SvmLanded["loaded"]): SvmReader => ({
      network: reference.network,
      transaction: async () => ({ wire, err: null, loaded, inner: [deposit] }),
      signatures: async () => [],
      blockhashValid: async () => ({ valid: true, slot: 0n }),
      firstAvailableBlock: async () => 0n,
      account: async () => {
        throw new Error("this reference names no nonce account");
      },
    });
    const ref = { ...reference, fromSlot: "100", transaction: "opening" };
    expect(await sessionSolana.status(ref, readerOf({ writable: [], readonly: [] }))).toEqual({ state: "settled", commitment: "finalized" });
    for (const loaded of [{ writable: [base58.decode(V.SV2.channel)], readonly: [] }, { writable: [], readonly: [base58.decode(V.SV2.channel)] }]) {
      expect(await sessionSolana.status(ref, readerOf(loaded))).toEqual({ state: "pending", why: "unreadable" });
    }
  });

  // agreedRefusals.rows 21 and 22 hold openings @solana/kit 8.4.0 writes with the open's account 4 or account 5 from an
  // address lookup table (each row's composed); they are held byte for byte, each named account past the static keys.
  it("the lookup-table openings of agreedRefusals.rows 21 and 22 are @solana/kit's, byte for byte", async () => {
    const [signer, channel] = [V.agreedRefusals.rows[21], V.agreedRefusals.rows[22]];
    const seed = new Uint8Array(32).fill(1);
    expect(base58.encode(ed25519.getPublicKey(new Uint8Array(32).fill(3)))).toBe(signer.operator);
    const made = [await tableOpening(V.SV5.opening.wireBase64, signer.operator, "signer", seed), await tableOpening(V.SV5.opening.wireBase64, V.SV3.payer, "channel", seed)];
    expect(made.map((m) => [m.wireBase64, m.channel])).toEqual([
      [signer.wireBase64, signer.channel],
      [channel.wireBase64, channel.channel],
    ]);
    expect(channel.channel).toBe(V.SV2.channel);
    for (const [m, at] of [[made[0]!, 4], [made[1]!, 5]] as const) {
      const tx = decodeSvmTx(Uint8Array.from(Buffer.from(m.wireBase64, "base64")));
      if ("refused" in tx) throw new Error(tx.code);
      const ix = tx.instructions.find((i) => base58.encode(tx.keys[i.program]!) === "CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX")!;
      expect([tx.keys.length, ix.accounts[at]]).toEqual([m.staticKeys, m.staticKeys]);
    }
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
    expect(getU64Decoder().decode(Buffer.from(V.fixed.H2.slice(2, 18), "hex")).toString()).toBe(V.plants.solana.expectSaltH2);
    expect(sessionSalt(V.fixed.H2).toString()).toBe(V.plants.solana.expectSaltH2);
    expect(await sessionSolana.bound(open(V.plants.solana.wireBase64, V.plants.solana.channel))).toEqual(refused(V.plants.solana.expect));
    const operator = solanaPlaced((d) => Object.assign(d, V.SV5.methodDetails));
    const use = cred(operator, { action: "use", channelId: V.SV2.channel, authentication: { type: "proof", challengeId: V.plants.solana.useWrongChallengeId, payer: V.SV3.payer, signature: "x" } });
    expect(await sessionSolana.channel.boundWithin(use)).toEqual(refused(V.plants.solana.expectUse));
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

  // SV5's challenge is C_S with SV5's methodDetails. The open action's authentication is REQUIRED for an operator voucher
  // signer and MUST be absent for client, the default (draft-solana-session-00 L1197 at tempoxyz/mpp-specs 08e7dd87). For
  // operator, the open's authorizedSigner MUST equal the challenged operator (L1252-1254, L1982-1985), so the operator
  // opening is SV5.opening, and its proof is SV5.opening's proof text signed with the payer's seed 01, in base58. For
  // client, the client controls authorizedSigner: SV2's open, and SV5.opening too, are client openings.
  it("SV5: an operator opening carries authentication and a client opening none; bound, reference and complete refuse the other", async () => {
    const operator = solanaPlaced((d) => Object.assign(d, V.SV5.methodDetails));
    const client = solanaPlaced((d) => (d["voucherSigner"] = "client"));
    expect([operator.id, client.id]).toEqual([V.fixed.MV1, V.fixed.MV1]);
    const proof = sessionProof({ channelId: V.SV5.opening.channel, payer: V.SV3.payer, challengeId: operator.id });
    expect(new TextDecoder().decode(proof)).toBe(V.SV5.opening.expectProofText);
    const signature = ed25519.sign(proof, new Uint8Array(32).fill(1));
    expect(hex(signature)).toBe(V.SV5.opening.expectProofSignature);
    const authentication = { ...V.SV5.expectAuthentication, signature: base58.encode(signature) };
    expect(Object.keys(authentication)).toEqual(V.SV5.expectAuthenticationKeys);
    const payload = { action: "open", channelId: V.SV2.channel, transaction: V.SV2.wireBase64 };
    const opened = { action: "open", channelId: V.SV5.opening.channel, transaction: V.SV5.opening.wireBase64 };
    const held = [
      [cred(operator, { ...opened, authentication }), V.SV5.opening.expectReference],
      [cred(client, payload), V.SV2.expectReference],
      [cred(C_S, payload), V.SV2.expectReference],
      [cred(client, opened), V.SV5.opening.expectReference],
    ] as const;
    for (const [c, reference] of held) {
      expect(await sessionSolana.bound(c)).toBe(H);
      expect(await sessionSolana.reference(c)).toEqual(reference);
    }
    const other = [cred(operator, opened), cred(client, { ...payload, authentication }), cred(C_S, { ...payload, authentication })];
    for (const c of other) {
      expect(await sessionSolana.bound(c)).toEqual(refused("mpp/credential-malformed"));
      expect(await sessionSolana.reference(c)).toEqual(refused("mpp/credential-malformed"));
    }
    for (const [c, open, expected] of [
      [operator, { ...opened, authentication }, { challenge: operator, payload: { ...opened, authentication } }],
      [operator, opened, refused("mpp/credential-malformed")],
      [client, payload, { challenge: client, payload }],
      [client, { ...payload, authentication }, refused("mpp/credential-malformed")],
    ] as const) {
      const u = await sessionSolana.build({ challenge: c, from: V.SV3.payer, now: 1790000000, deposit: 10_000_000n }, H);
      if ("refused" in u) throw new Error(u.code);
      expect(u.complete(open)).toEqual(expected);
    }
  });

  // draft-solana-session-00 L1338 at tempoxyz/mpp-specs 08e7dd87: the `use` action "is valid only when `voucherSigner`
  // is `operator`"; `client` is the default when the challenge omits it (L258). A `use` echoing SV5's operator challenge
  // is within and gives H; one echoing a client challenge, or C_S with no voucherSigner, is refused by each function
  // that reads it. A voucher under either challenge stays within, and only `use` gives H.
  it("SV5: a use is within only on an operator channel; channel.kind, channel.ref and channel.boundWithin refuse it on a client channel", async () => {
    const operator = solanaPlaced((d) => Object.assign(d, V.SV5.methodDetails));
    const client = solanaPlaced((d) => (d["voucherSigner"] = "client"));
    const use = (c: MppChallenge & { id: string }) =>
      cred(c, { action: "use", channelId: V.SV2.channel, authentication: { type: "proof", challengeId: c.id, payer: V.SV3.payer, signature: "x" } });
    expect(sessionSolana.channel.kind(use(operator))).toBe("within");
    expect(await sessionSolana.channel.ref(use(operator))).toEqual({ network: V.SV2.expectReference.network, channel: V.SV2.channel });
    expect(await sessionSolana.channel.boundWithin(use(operator))).toBe(H);
    for (const c of [client, C_S]) {
      expect(sessionSolana.channel.kind(use(c))).toEqual(refused("mpp/session-action"));
      expect(await sessionSolana.channel.ref(use(c))).toEqual(refused("mpp/session-action"));
      expect(await sessionSolana.channel.boundWithin(use(c))).toEqual(refused("mpp/session-action"));
    }
  });

  // draft-solana-session-00 L1324-1326 at tempoxyz/mpp-specs 08e7dd87: a `voucher` action "directly authorizes service
  // only for `client`. In `operator` mode, vouchers are operator-generated settlement artifacts and MUST NOT authenticate
  // the caller"; `client` is the default when the challenge omits `voucherSigner` (L258). A voucher echoing a client
  // challenge, or C_S with no voucherSigner, is within and names its channel; one echoing SV5's operator challenge is
  // refused by each function that reads it. No voucher gives H.
  it("SV5: a voucher is within only on a client channel; channel.kind, channel.ref and channel.boundWithin refuse it on an operator channel", async () => {
    const operator = solanaPlaced((d) => Object.assign(d, V.SV5.methodDetails));
    const client = solanaPlaced((d) => (d["voucherSigner"] = "client"));
    const voucher = (c: MppChallenge & { id: string }) => cred(c, { action: "voucher", channelId: V.SV2.channel });
    for (const c of [client, C_S]) {
      expect(sessionSolana.channel.kind(voucher(c))).toBe("within");
      expect(await sessionSolana.channel.ref(voucher(c))).toEqual({ network: V.SV2.expectReference.network, channel: V.SV2.channel });
      expect(await sessionSolana.channel.boundWithin(voucher(c))).toEqual(refused("mpp/not-bound-within"));
    }
    expect(sessionSolana.channel.kind(voucher(operator))).toEqual(refused("mpp/session-action"));
    expect(await sessionSolana.channel.ref(voucher(operator))).toEqual(refused("mpp/session-action"));
    expect(await sessionSolana.channel.boundWithin(voucher(operator))).toEqual(refused("mpp/session-action"));
  });

  // draft-solana-session-00 L1361-1362 at tempoxyz/mpp-specs 08e7dd87: a close's `voucher` is "REQUIRED for `client` and
  // MUST be absent for `operator`", and its `authentication` is "REQUIRED for `operator` and MUST be absent for
  // `client`"; `client` is the default when the challenge omits `voucherSigner` (L258). A close carrying its mode's
  // member alone is the close and names its channel; any other is refused by each function that reads it. The close
  // buildWithin builds on a client channel carries its voucher alone, and is the close.
  it("SV5: a close carries voucher on a client channel and authentication on an operator channel; channel.kind, channel.ref and channel.boundWithin refuse any other", async () => {
    const operator = solanaPlaced((d) => Object.assign(d, V.SV5.methodDetails));
    const client = solanaPlaced((d) => (d["voucherSigner"] = "client"));
    const voucher = { voucher: { channelId: V.SV2.channel, cumulativeAmount: "100" }, signer: V.SV3.payer, signature: "x", signatureType: "ed25519" };
    const authentication = (c: MppChallenge & { id: string }) => ({ type: "proof", challengeId: c.id, payer: V.SV3.payer, signature: "x" });
    const close = (c: MppChallenge & { id: string }, members: Record<string, unknown>) => cred(c, { action: "close", channelId: V.SV2.channel, ...members } as MppCredential["payload"]);
    const calls = async (p: MppCredential) => [sessionSolana.channel.kind(p), await sessionSolana.channel.ref(p), await sessionSolana.channel.boundWithin(p)];
    const closed = ["close", { network: V.SV2.expectReference.network, channel: V.SV2.channel }, refused("mpp/not-bound-within")];
    const malformed = Array(3).fill(refused("mpp/credential-malformed"));
    for (const c of [client, C_S]) {
      expect(await calls(close(c, { voucher }))).toEqual(closed);
      for (const members of [{}, { authentication: authentication(c) }, { voucher, authentication: authentication(c) }]) {
        expect(await calls(close(c, members))).toEqual(malformed);
      }
    }
    expect(await calls(close(operator, { authentication: authentication(operator) }))).toEqual(closed);
    for (const members of [{}, { voucher }, { voucher, authentication: authentication(operator) }]) {
      expect(await calls(close(operator, members))).toEqual(malformed);
    }
    const opening = cred(C_S, { action: "open", channelId: V.SV2.channel, transaction: V.SV2.wireBase64 });
    const u = await sessionSolana.buildWithin({ challenge: C_S, opening, cumulativeAmount: 100n, action: "close" }, H);
    if ("refused" in u) throw new Error(u.code);
    const built = u.complete([base58.encode(new Uint8Array(64).fill(1))]);
    if ("refused" in built) throw new Error(built.code);
    expect(Object.keys(built.payload)).toEqual(["action", "channelId", "voucher"]);
    expect(await calls(built)).toEqual(closed);
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
    const ref = await sessionXrpl.reference(open(V.XS2.blob));
    expect(ref).toEqual({ network: "xrpl:1", transaction: V.XS2.expectHash, lastLedgerSequence: V.XS2.lastLedgerSequence });
    expect(roundTrip(ref)).toEqual(ref);
    expect(await sessionXrpl.channel.ref(open(V.XS2.blob))).toEqual({ network: "xrpl:1", channel: V.XS2.expectChannel });
    expect(sessionXrpl.channel.until(open(V.XS2.blob))).toBeUndefined();
    const withCancel = encodeXrpl({ ...(decodeXrpl(V.XS2.blob) as object), CancelAfter: V.XS2.cancelAfter });
    expect(sessionXrpl.channel.until(open(withCancel))).toBe(V.XS2.expectUntil);
    expect(await sessionXrpl.recover({ network: "xrpl:1", transaction: V.XS2.expectHash }, reader(V.XS4.rows[0].landed, V.XS2.blob))).toBe(H);
  });

  // XS4's rows are the file's landed shapes and their status; a tec result is a final failure that claimed the fee
  // (xrpl.org, "tec Codes"), and only a validated ledger's result is final (xrpl.org, "Finality of Results").
  it("XS4: recover gives XS2's memo only for the opening status reads settled, and reads its blob only then", async () => {
    const ref = await sessionXrpl.reference(open(V.XS2.blob));
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
    const recoverWhen: Record<string, string> = { "claimed-fee": "xrpl/not-success", "not-this-instrument": "xrpl/not-channel-create" };
    for (const row of rowsOf(V.XS4.rows, "mpp-session-hedera-solana-xrpl.json XS4.rows")) {
      const { calls, r } = counted(row.landed);
      const status = await sessionXrpl.status({ ...ref, fromLedger: 900 }, r);
      expect(status, row.case).toEqual(row.expect);
      calls.n = 0;
      const recovered = await sessionXrpl.recover({ network: ref.network, transaction: ref.transaction }, r);
      expect(recovered, row.case).toEqual(row.expect.state === "settled" ? V.XS2.expectBound : refused(recoverWhen[row.expect.why]!));
      expect(calls.n, row.case).toBe(row.expect.state === "settled" ? 2 : 1);
    }
    const unvalidated = { ...V.XS4.rows[0].landed, validated: false };
    expect(await sessionXrpl.status({ ...ref, fromLedger: 900 }, reader(unvalidated, V.XS2.blob))).toEqual({ state: "pending", why: "not-validated" });
    expect(await sessionXrpl.recover(ref, reader(unvalidated, V.XS2.blob))).toEqual(refused("xrpl/not-validated"));
    expect(await sessionXrpl.recover(ref, reader({ notFound: true, searchedAll: true }, V.XS2.blob))).toEqual(refused("xrpl/not-found"));
    const failing: XrplReader = { ...reader(V.XS4.rows[0].landed, V.XS2.blob), tx: async () => { throw new ReaderError("transport"); } };
    expect(await sessionXrpl.recover(ref, failing)).toEqual(refused("xrpl/unreadable"));
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
    expect(await sessionXrpl.status({ ...ref, fromLedger: 900, transaction: lower }, holding)).toEqual(opened.expect);
    expect(await sessionXrpl.recover({ network: ref.network, transaction: lower }, holding)).toBe(V.XS2.expectBound);
    for (const transaction of [undefined, 7, `0x${ref.transaction}`, ref.transaction.slice(2)]) {
      const { reader: r, calls } = counting(holding);
      const malformed = { network: ref.network, transaction } as typeof ref;
      expect([transaction, await sessionXrpl.recover(malformed, r)]).toEqual([transaction, refused("xrpl/wrong-reader")]);
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
    const ref = { network: "xrpl:1" as const, transaction: V.XS2.expectHash as string };
    const unreadable = refused("xrpl/unreadable");
    // XS2's blob one byte short does not decode.
    expect(await sessionXrpl.recover(ref, reader(opened, V.XS2.blob.slice(0, -2)))).toEqual(unreadable);
    // XS2's opening with a CancelAfter added is a PaymentChannelCreate carrying the same memo, under another hash.
    const withCancel = encodeXrpl({ ...(decodeXrpl(V.XS2.blob) as object), CancelAfter: V.XS2.cancelAfter });
    expect(txHash(withCancel)).not.toBe(V.XS2.expectHash);
    expect(await sessionXrpl.recover(ref, reader(opened, withCancel))).toEqual(unreadable);
    // The charge file's V3 blob is a Payment under its own hash, which the validated answer names a PaymentChannelCreate.
    expect(txHash(C.V3.blob)).toBe(C.V3.expectReference.transaction);
    expect(await sessionXrpl.recover({ ...ref, transaction: C.V3.expectReference.transaction }, reader(opened, C.V3.blob))).toEqual(
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
      return (sessionXrpl.advertise([c], H, V.fixed.link, c) as (MppChallenge & { id: string })[])[0]!;
    };
    const amountRows = rowsOf<any>(V.SS1refusals, "mpp-session-hedera-solana-xrpl.json SS1refusals", {
      keep: ["the xrpl rows whose request is malformed", (r: { method: string; expect: string }) => r.method === "xrpl" && r.expect === "mpp/request-malformed"],
      leave: [
        "the rows that name a channel or carry a malformed expires, which the opening challenges' pairingsOf test above runs",
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
    const ref = await sessionXrpl.reference(open(V.XS2.blob));
    if ("refused" in ref) throw new Error(ref.code);
    for (const row of rowsOf(V.XS4.rows, "mpp-session-hedera-solana-xrpl.json XS4.rows")) {
      expect(await sessionXrpl.status({ ...ref, fromLedger: 900 }, reader(row.landed)), row.case).toEqual(row.expect);
    }
    const close = sessionXrpl.closeRef(C_X, V.XS2.expectChannel.toLowerCase());
    if ("refused" in close) throw new Error(close.code);
    for (const row of rowsOf(V.XS4.closeRows, "mpp-session-hedera-solana-xrpl.json XS4.closeRows")) {
      expect(await sessionXrpl.status({ ...close, transaction: "AB".repeat(32) }, reader(row.landed)), row.case).toEqual(row.expect);
    }
    const failing: XrplReader = { ...reader({ notFound: true, searchedAll: false }), tx: async () => { throw new ReaderError("transport"); } };
    expect(await sessionXrpl.status({ ...close, transaction: "AB".repeat(32) }, failing)).toEqual({ state: "pending", why: "unreadable" });
    // An opening transaction that is not 64 hex digits (xrpl.org, Basic Data Types, "Hashes") cannot name the
    // opening, so the read is pending, never expired (docs/guides/rails.md, "Reading settlement"), even from a reader
    // that answers any other hash as not found with the whole range searched and LastLedgerSequence passed; the lookup
    // asks for the hash in the upper case decodeBlob writes.
    const opened = V.XS4.rows[0];
    const holding: XrplReader = {
      ...reader({ notFound: true, searchedAll: true }),
      tx: async (hash) => (hash === ref.transaction ? opened.landed : { notFound: true, searchedAll: true }),
      validatedLedger: async () => V.XS2.lastLedgerSequence + 1,
    };
    for (const transaction of [undefined, `0x${ref.transaction}`, ref.transaction.slice(2)]) {
      const { reader: r, calls } = counting(holding);
      const malformed = { ...ref, fromLedger: 900, transaction } as typeof ref & { fromLedger: number };
      expect([transaction, await sessionXrpl.status(malformed, r)]).toEqual([transaction, { state: "pending", why: "unreadable" }]);
      expect(calls).toEqual([]);
    }
    expect(await sessionXrpl.status({ ...ref, fromLedger: 900, transaction: ref.transaction.toLowerCase() }, holding)).toEqual(opened.expect);
    // A channel that is not 64 hex digits cannot name the close, so the read is pending, never failed, with nothing read
    // (docs/guides/rails.md, "Reading settlement"); hex digits read the same in either case.
    const closed = V.XS4.closeRows[0];
    for (const channel of [`0x${close.channel}`, undefined, close.channel.slice(2)]) {
      const { reader: r, calls } = counting(reader(closed.landed));
      const malformed = { ...close, channel, transaction: "AB".repeat(32) } as typeof close & { transaction: string };
      expect(await sessionXrpl.status(malformed, r)).toEqual({ state: "pending", why: "unreadable" });
      expect(calls).toEqual([]);
    }
    const lower = { ...close, channel: close.channel.toLowerCase(), transaction: "AB".repeat(32) };
    expect(await sessionXrpl.status(lower, reader(closed.landed))).toEqual(closed.expect);
    // The close's transaction, a Hash256 like the opening's, is read by the same rule: one that is not 64 hex digits
    // cannot name the close, so the read is pending with nothing read, and the lookup asks for the hash in upper case,
    // from a reader that holds the close under its upper-case hash alone.
    const closeHash = "AB".repeat(32);
    const holdingClose: XrplReader = {
      ...reader(closed.landed),
      tx: async (hash) => (hash === closeHash ? closed.landed : { notFound: true, searchedAll: false }),
    };
    for (const transaction of [undefined, `0x${closeHash}`, closeHash.slice(2)]) {
      const { reader: r, calls } = counting(holdingClose);
      const malformed = { ...close, transaction } as typeof close & { transaction: string };
      expect([transaction, await sessionXrpl.status(malformed, r)]).toEqual([transaction, { state: "pending", why: "unreadable" }]);
      expect(calls).toEqual([]);
    }
    expect(await sessionXrpl.status({ ...close, transaction: closeHash.toLowerCase() }, holdingClose)).toEqual(closed.expect);
  });

  it("XS5: a multi-signed opening is refused by bound, reference and the channel ref", async () => {
    const d = await decodeBlob(V.XS5.blob);
    if ("refused" in d) throw new Error(d.code);
    expect(d.hash).toBe(V.XS5.hash);
    expect((d.tx["Signers"] as unknown[]).length).toBe(3);
    expect(d.tx.Memos).toEqual((decodeXrpl(V.XS2.blob) as { Memos: unknown }).Memos);
    const presented = open(V.XS5.blob);
    expect(await sessionXrpl.bound(presented)).toEqual(refused(V.XS5.expect));
    expect(await sessionXrpl.reference(presented)).toEqual(refused(V.XS5.expect));
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
    const voucher = { voucher: { channelId: channel, cumulativeAmount: "100" }, signer: V.SV3.payer, signature: "x", signatureType: "ed25519" };
    for (const payload of [
      { action: "voucher", channelId: channel, voucher },
      { action: "topUp", channelId: channel, additionalAmount: "100", transaction: "x" },
      { action: "close", channelId: channel, voucher },
    ]) {
      expect(await sessionSolana.channel.ref(cred(c, payload))).toEqual({ network: V.SV2.expectReference.network, channel });
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
  // The record reads the opening, never a later voucher, so each proves states what the opening shows and none says
  // that later requests in the channel were paid under this ATR.
  it("publicProof and claims are true on all three, and no proves speaks of later requests", () => {
    for (const b of [sessionHedera, sessionSolana, sessionXrpl]) {
      expect(b.pattern.publicProof).toBe(true);
      expect(b.claims).toBe(true);
      expect(b.pattern.proves).not.toMatch(/later requests|paid under this ATR|did not meter/i);
    }
  });
});

// Each agreedRefusals row, run through the calls its case names: one call for each condition the case lists, on the
// file's opening challenges, HS3's opening, XS1's and XS2's XRPL values and SV2's channel.
describe("mpp-session-hedera-solana-xrpl.json agreedRefusals: every row runs", () => {
  type Row = { case: string; expect: string };
  /** The method's opening challenge, as issued, with its decoded request changed by `change`. */
  const requestOf = (m: "hedera" | "solana" | "xrpl", change: (r: Record<string, any>) => void): MppChallenge => {
    const r = JSON.parse(Buffer.from(V.SS1[m].challenge.request, "base64url").toString("utf8"));
    change(r);
    return { ...V.SS1[m].challenge, request: b64u(canonicalJson(r) as string) };
  };
  const hs3 = cred(C_H, { action: "open", channelId: V.HS1.expectChannelId, txHash: V.HS3.txHash, cumulativeAmount: "0", signature: "0x00" });
  const receipt: EvmReceipt = { status: 1, blockNumber: 40_000_000n, logs: [V.HS3.log] };
  const reverted = hederaReader({ [V.HS3.txHash]: { ...receipt, status: 0 } });
  const xrplOpen = (transaction: string) => cred(C_X, { action: "open", transaction, amount: "100", signature: "00" });
  /** XS2's opening with `n` memos: its LCP memo, then memos of one zero byte. */
  const withMemos = (n: number) => {
    const tx = decodeXrpl(V.XS2.blob) as { Memos: unknown[] };
    const other = { Memo: { MemoData: "00" } };
    return encodeXrpl({ ...tx, Memos: [...tx.Memos, ...Array.from({ length: n - tx.Memos.length }, () => other)] } as never);
  };
  /** XS1's account with its last character changed: the classic address's checksum fails. */
  const notAddress = `${V.XS1.account.slice(0, -1)}m`;
  const hederaChoice = { challenge: C_H, from: V.fixed.payer, now: 1790000000, deposit: BigInt(V.HS2.deposit) };
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

  const solanaOpen = { action: "open", channelId: V.SV2.channel, transaction: V.SV2.wireBase64 };
  /** SV5's operator-mode open, whose account 4 is the challenge's operator. */
  const operatorOpen = { action: "open", channelId: V.SV5.opening.channel, transaction: V.SV5.opening.wireBase64 };
  const operator = solanaPlaced((d) => Object.assign(d, V.SV5.methodDetails));
  const client = solanaPlaced((d) => (d["voucherSigner"] = "client"));
  const proofFor = (c: MppChallenge & { id: string }) => ({ type: "proof", challengeId: c.id, payer: V.SV3.payer, signature: "x" });
  /** The opening a lookup-table row holds, and the operator challenge naming that row's operator. */
  const tableOpen = (row: { channel: string; wireBase64: string }) => ({ action: "open", channelId: row.channel, transaction: row.wireBase64 });
  const tableOperator = solanaPlaced((d) => Object.assign(d, { voucherSigner: "operator", operator: V.agreedRefusals.rows[21].operator }));
  /** bound, reference and build's complete of the opening `payload` answering challenge `c`. */
  const solanaCalls = async (c: MppChallenge & { id: string }, payload: MppCredential["payload"]) => {
    const u = await sessionSolana.build({ challenge: c, from: V.SV3.payer, now: 1790000000, deposit: 10_000_000n }, H);
    if ("refused" in u) throw new Error(u.code);
    return [await sessionSolana.bound(cred(c, payload)), await sessionSolana.reference(cred(c, payload)), u.complete(payload)];
  };
  /** channel.kind, channel.ref and channel.boundWithin of a `use` echoing challenge `c`, its proof naming `c`'s id. */
  const solanaUseCalls = async (c: MppChallenge & { id: string }) => {
    const use = cred(c, { action: "use", channelId: V.SV2.channel, authentication: proofFor(c) });
    return [sessionSolana.channel.kind(use), await sessionSolana.channel.ref(use), await sessionSolana.channel.boundWithin(use)];
  };
  /** channel.kind, channel.ref and channel.boundWithin of a `voucher` echoing challenge `c`. */
  const solanaVoucherCalls = async (c: MppChallenge & { id: string }) => {
    const voucher = cred(c, { action: "voucher", channelId: V.SV2.channel });
    return [sessionSolana.channel.kind(voucher), await sessionSolana.channel.ref(voucher), await sessionSolana.channel.boundWithin(voucher)];
  };
  /** channel.kind, channel.ref and channel.boundWithin of a `close` echoing challenge `c`, with `members` beside its channel. */
  const solanaCloseCalls = async (c: MppChallenge & { id: string }, members: Record<string, unknown>) => {
    const close = cred(c, { action: "close", channelId: V.SV2.channel, ...members } as MppCredential["payload"]);
    return [sessionSolana.channel.kind(close), await sessionSolana.channel.ref(close), await sessionSolana.channel.boundWithin(close)];
  };
  const closeVoucher = { voucher: { channelId: V.SV2.channel, cumulativeAmount: "100" }, signer: V.SV3.payer, signature: "x", signatureType: "ed25519" };
  /** channel.kind and channel.ref of a Hedera payment under `action`, and buildWithin of `action` on HS3's opening. */
  const hederaActionCalls = async (action: string) => {
    const paid = cred(C_H, { action, channelId: V.HS1.expectChannelId, cumulativeAmount: "100", signature: `0x${"22".repeat(65)}` });
    const within = await sessionHedera.buildWithin({ challenge: C_H, opening: hs3, cumulativeAmount: 100n, action } as SessionWithin, H);
    return [sessionHedera.channel.kind(paid), await sessionHedera.channel.ref(paid), within];
  };
  /** channel.kind and channel.ref of an XRPL payment under `action`, and buildWithin of `action` on XS2's opening. */
  const xrplActionCalls = async (action: string) => {
    const paid = cred(C_X, { action, channelId: V.XS2.expectChannel, amount: "100", signature: "00" });
    const within = await sessionXrpl.buildWithin({ challenge: C_X, opening: xrplOpen(V.XS2.blob), cumulativeAmount: 100n, action } as SessionWithin, H);
    return [sessionXrpl.channel.kind(paid), await sessionXrpl.channel.ref(paid), within];
  };
  /** channel.kind and channel.ref of a Solana payment under `action`, and buildWithin of `action` on SV2's opening. */
  const solanaActionCalls = async (action: string) => {
    const paid = cred(C_S, { action, channelId: V.SV2.channel });
    const within = await sessionSolana.buildWithin({ challenge: C_S, opening: cred(C_S, solanaOpen), cumulativeAmount: 100n, action } as SessionWithin, H);
    return [sessionSolana.channel.kind(paid), await sessionSolana.channel.ref(paid), within];
  };

  // Each input a row changes is accepted as given, so each refusal below is the change's.
  it("the inputs the rows change, as given, are accepted", async () => {
    for (const m of ["hedera", "solana", "xrpl"] as const) expect(pairingsOf(requestOf(m, () => undefined))).toEqual([`mpp/session/${m}`]);
    expect(await sessionHedera.fetchPresented(hs3, reverted)).toEqual(refused("hedera/reverted"));
    expect(await sessionXrpl.bound(xrplOpen(withMemos(8)))).toBe(H);
    expect(xrplChannelId(V.XS1.account, V.XS1.destination, V.XS1.sequence)).toBe(V.XS1.expect);
    expect(solanaVoucher(V.SV2.channel, 100n)).toBeInstanceOf(Uint8Array);
    expect(await sessionHedera.build(hederaChoice, H)).not.toHaveProperty("refused");
    expect(await sessionXrpl.build(xrplChoice, H)).not.toHaveProperty("refused");
    for (const [c, payload, reference] of [
      [operator, { ...operatorOpen, authentication: proofFor(operator) }, V.SV5.opening.expectReference],
      [client, solanaOpen, V.SV2.expectReference],
      [C_S, solanaOpen, V.SV2.expectReference],
    ] as const) {
      const [bound, referenced, completed] = await solanaCalls(c, payload);
      expect([bound, referenced, completed]).toEqual([H, reference, { challenge: c, payload }]);
    }
    expect(await solanaUseCalls(operator)).toEqual(["within", { network: V.SV2.expectReference.network, channel: V.SV2.channel }, H]);
    for (const c of [client, C_S]) {
      expect(await solanaVoucherCalls(c)).toEqual(["within", { network: V.SV2.expectReference.network, channel: V.SV2.channel }, refused("mpp/not-bound-within")]);
    }
    const closed = ["close", { network: V.SV2.expectReference.network, channel: V.SV2.channel }, refused("mpp/not-bound-within")];
    for (const c of [client, C_S]) expect(await solanaCloseCalls(c, { voucher: closeVoucher })).toEqual(closed);
    expect(await solanaCloseCalls(operator, { authentication: proofFor(operator) })).toEqual(closed);
    const [kind, ref, within] = await hederaActionCalls("voucher");
    expect([kind, ref]).toEqual(["within", { network: "hedera:testnet", channel: V.HS1.expectChannelId }]);
    expect(within).not.toHaveProperty("refused");
    for (const calls of [await xrplActionCalls("voucher"), await solanaActionCalls("voucher")]) {
      expect(calls[0]).toBe("within");
      for (const answer of calls.slice(1)) expect(answer).not.toHaveProperty("refused");
    }
    // The lookup-table rows' openings composed without the table, every account a static key: rows 21 and 23's is bound
    // under its operator challenge and gives a client voucher its signer; row 22's is bound under C_S.
    const seed = new Uint8Array(32).fill(1);
    const signerStatic = await tableOpening(V.SV5.opening.wireBase64, V.agreedRefusals.rows[21].operator, null, seed);
    const channelStatic = await tableOpening(V.SV5.opening.wireBase64, V.SV3.payer, null, seed);
    expect([signerStatic.channel, channelStatic.channel]).toEqual([V.agreedRefusals.rows[21].channel, V.agreedRefusals.rows[22].channel]);
    for (const [c, payload, channel] of [
      [tableOperator, { ...tableOpen(signerStatic), authentication: proofFor(tableOperator) }, signerStatic.channel],
      [C_S, tableOpen(channelStatic), channelStatic.channel],
    ] as const) {
      const [bound, referenced, completed] = await solanaCalls(c, payload);
      expect([bound, (referenced as { channel?: string }).channel, completed]).toEqual([H, channel, { challenge: c, payload }]);
    }
    for (const c of [client, C_S]) {
      const built = await sessionSolana.buildWithin({ challenge: c, opening: cred(c, tableOpen(signerStatic)), cumulativeAmount: 100n, action: "voucher" } as SessionWithin, H);
      expect(built).toMatchObject({ requests: [{ kind: "ed25519-raw", signer: V.agreedRefusals.rows[21].operator }] });
    }
  });

  const cases: Record<string, () => Promise<unknown[]>> = {
    "a hedera session request whose currency, recipient or escrowContract is not an address": async () => [
      pairingsOf(requestOf("hedera", (r) => (r["currency"] = r["currency"].slice(0, -1)))),
      pairingsOf(requestOf("hedera", (r) => (r["recipient"] = r["recipient"].slice(0, -1)))),
      pairingsOf(requestOf("hedera", (r) => (r["methodDetails"].escrowContract = r["methodDetails"].escrowContract.slice(0, -1)))),
    ],
    "a solana session request whose network is absent or not one of MPP's three names": async () => [
      pairingsOf(requestOf("solana", (r) => delete r["methodDetails"].network)),
      pairingsOf(requestOf("solana", (r) => (r["methodDetails"].network = "testnet"))),
    ],
    "an xrpl session request whose recipient is not shaped as a classic address (r and 24 to 34 base58 characters)": async () => [
      pairingsOf(requestOf("xrpl", (r) => (r["recipient"] = `x${r["recipient"].slice(1)}`))),
      pairingsOf(requestOf("xrpl", (r) => (r["recipient"] = r["recipient"].slice(0, 24)))),
      pairingsOf(requestOf("xrpl", (r) => (r["recipient"] = `${r["recipient"]}aa`))),
      pairingsOf(requestOf("xrpl", (r) => (r["recipient"] = `${r["recipient"].slice(0, -1)}0`))),
    ],
    "bound of a hedera opening before fetchPresented added the landed logs": async () => [await sessionHedera.bound(hs3)],
    "fetchPresented or recover with a reader for another hedera network": async () => {
      const ref = await sessionHedera.reference(hs3);
      if ("refused" in ref) throw new Error(ref.code);
      const mainnet = hederaReader({ [V.HS3.txHash]: receipt }, "hedera:mainnet");
      return [await sessionHedera.fetchPresented(hs3, mainnet), await sessionHedera.recover(ref, mainnet)];
    },
    "fetchPresented of a hedera opening whose transaction reverted, in a block above the reader's finalized mark or with a reader that cannot give that mark":
      async () => [
        await sessionHedera.fetchPresented(hs3, { ...reverted, blockNumber: async () => receipt.blockNumber - 1n }),
        await sessionHedera.fetchPresented(hs3, { ...reverted, blockNumber: async () => Promise.reject(new ReaderError("transport")) }),
      ],
    "an xrpl opening with more than 8 memos": async () => [
      await sessionXrpl.bound(xrplOpen(withMemos(9))),
      await sessionXrpl.reference(xrplOpen(withMemos(9))),
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
      await sessionHedera.bound(cred(C_H, { action: "voucher", channelId: V.HS1.expectChannelId, cumulativeAmount: "100", signature: `0x${"22".repeat(65)}` })),
      await sessionSolana.bound(cred(C_S, { action: "close", channelId: V.SV2.channel, cumulativeAmount: "100", signature: "x" })),
      await sessionXrpl.bound(cred(C_X, { action: "voucher", channelId: V.XS2.expectChannel, amount: "200", signature: "00" })),
    ],
    "build with a malformed from, deposit or XRPL channel terms": async () => {
      const x = xrplChoice.xrpl;
      return [
        await sessionHedera.build({ ...hederaChoice, from: V.fixed.payer.slice(0, -1) }, H),
        await sessionHedera.build({ ...hederaChoice, deposit: 0n }, H),
        await sessionHedera.build({ ...hederaChoice, deposit: 1n << 128n }, H),
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
    "a solana opening without authentication, its challenge's voucherSigner operator (draft-solana-session-00 L1197 at tempoxyz/mpp-specs 08e7dd87: REQUIRED for operator)":
      async () => solanaCalls(operator, operatorOpen),
    "a solana opening with authentication, its challenge's voucherSigner client or absent (draft-solana-session-00 L1197 at tempoxyz/mpp-specs 08e7dd87: MUST be absent for client)":
      async () => [
        ...(await solanaCalls(client, { ...solanaOpen, authentication: proofFor(client) })),
        ...(await solanaCalls(C_S, { ...solanaOpen, authentication: proofFor(C_S) })),
      ],
    "a solana use, its challenge's voucherSigner client or absent (draft-solana-session-00 L1338 at tempoxyz/mpp-specs 08e7dd87: valid only when voucherSigner is operator)":
      async () => [
        ...(await solanaUseCalls(client)),
        ...(await solanaUseCalls(C_S)),
      ],
    "a solana voucher, its challenge's voucherSigner operator (draft-solana-session-00 L1324-1326 at tempoxyz/mpp-specs 08e7dd87: in operator mode MUST NOT authenticate the caller)":
      async () => solanaVoucherCalls(operator),
    "a hedera use (draft-hedera-session-00 L840-845 at tempoxyz/mpp-specs 08e7dd87: the payload's action is one of open, topUp, voucher and close)":
      async () => hederaActionCalls("use"),
    "a solana close without voucher or with authentication, its challenge's voucherSigner client or absent (draft-solana-session-00 L1361-1362 at tempoxyz/mpp-specs 08e7dd87: voucher REQUIRED for client, authentication MUST be absent for client)":
      async () => {
        const out: unknown[] = [];
        for (const c of [client, C_S]) {
          out.push(...(await solanaCloseCalls(c, {})), ...(await solanaCloseCalls(c, { voucher: closeVoucher, authentication: proofFor(c) })));
        }
        return out;
      },
    "a solana close with voucher or without authentication, its challenge's voucherSigner operator (draft-solana-session-00 L1361-1362 at tempoxyz/mpp-specs 08e7dd87: voucher MUST be absent for operator, authentication REQUIRED for operator)":
      async () => [
        ...(await solanaCloseCalls(operator, { voucher: closeVoucher, authentication: proofFor(operator) })),
        ...(await solanaCloseCalls(operator, {})),
      ],
    "an xrpl topUp, use or bearer (draft-xrpl-session-00 L334-377 at tempoxyz/mpp-specs 08e7dd87: the payload's action is open, voucher or close)":
      async () => [...(await xrplActionCalls("topUp")), ...(await xrplActionCalls("use")), ...(await xrplActionCalls("bearer"))],
    "a solana bearer (draft-solana-session-00 L1178-1353 at tempoxyz/mpp-specs 08e7dd87: the actions are open, voucher, use, topUp and close)":
      async () => solanaActionCalls("bearer"),
    "a solana opening whose open instruction's authorizedSigner (account 4) is not the challenge's operator, its challenge's voucherSigner operator (draft-solana-session-00 L1252-1254 and L1982-1985 at tempoxyz/mpp-specs 08e7dd87: authorizedSigner MUST equal the challenged operator)":
      async () => {
        const opening = { ...solanaOpen, authentication: proofFor(operator) };
        const within = await sessionSolana.buildWithin({ challenge: operator, opening: cred(operator, opening), cumulativeAmount: 100n, action: "voucher" } as SessionWithin, H);
        return [...(await solanaCalls(operator, opening)), within];
      },
    "a solana opening whose open instruction names its authorizedSigner (account 4) through an address lookup table, that key its challenge's operator and its challenge's voucherSigner operator (draft-solana-session-00 L465-472 and L1962-1964 at tempoxyz/mpp-specs 08e7dd87: authorizedSigner and channel are non-signer accounts, and the server validates the compiled message resolving any version-0 address-lookup-table entries; bound, reference and build's complete take no reader and read no table)":
      async () => solanaCalls(tableOperator, { ...tableOpen(V.agreedRefusals.rows[21]), authentication: proofFor(tableOperator) }),
    "a solana opening whose open instruction names its channel (account 5) through an address lookup table (draft-solana-session-00 L465-472 and L1962-1964 at tempoxyz/mpp-specs 08e7dd87: authorizedSigner and channel are non-signer accounts, and the server validates the compiled message resolving any version-0 address-lookup-table entries; bound, reference and build's complete take no reader and read no table)":
      async () => [...(await solanaCalls(client, tableOpen(V.agreedRefusals.rows[22]))), ...(await solanaCalls(C_S, tableOpen(V.agreedRefusals.rows[22])))],
    "a solana voucher built on a client opening whose open instruction names its authorizedSigner (account 4) through an address lookup table (draft-solana-session-00 L465-472 and L1962-1964 at tempoxyz/mpp-specs 08e7dd87: authorizedSigner and channel are non-signer accounts, and the server validates the compiled message resolving any version-0 address-lookup-table entries; buildWithin takes no reader and reads no table, so it has no signer to name)":
      async () => [
        await sessionSolana.buildWithin({ challenge: client, opening: cred(client, tableOpen(V.agreedRefusals.rows[23])), cumulativeAmount: 100n, action: "voucher" } as SessionWithin, H),
        await sessionSolana.buildWithin({ challenge: C_S, opening: cred(C_S, tableOpen(V.agreedRefusals.rows[23])), cumulativeAmount: 100n, action: "close" } as SessionWithin, H),
      ],
  };

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
