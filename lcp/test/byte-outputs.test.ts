// Every byte output the package declares as `Uint8Array<ArrayBuffer>`. `Outputs` names each one's declared type, and
// `tsc -p tsconfig.test.json` checks that each is a `BlobPart` and a `BufferSource`. `cases` makes each, under the same
// name, from the vectors' inputs, and the test checks that its bytes sit in an `ArrayBuffer`, not a
// `SharedArrayBuffer`. The decoders that read bytes the caller passes run on a Node `Buffer`, pooled and over a
// `SharedArrayBuffer`: what they give shares no memory with it.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assemble,
  base64Bytes,
  base64UrlBytes,
  fromBase64,
  fromBase64Url,
  newAtrId,
  toRawBytes,
  type AtrHash,
} from "../src/index.js";
import { exactAvm, type AvmParams, type AvmUnsigned } from "../src/avm.js";
import { auxiliaryData, exactCardano, type CardanoUnsigned } from "../src/cardano.js";
import { accountBytes, ccdMemo, exactCcd, pltMemo, type CcdUnsigned } from "../src/ccd.js";
import { emit, type LegalContextDocument } from "../src/discovery.js";
import { decodeHederaTx, exactHedera, type HederaUnsigned } from "../src/hedera.js";
import { decodeBolt11 } from "../src/lightning.js";
import {
  chargeSolana,
  chargeStellar,
  sessionSolana,
  sessionXrpl,
  type MppChallenge,
  type MppCredential,
  type RailSessionUnsigned,
  type SessionWithin,
  type WithinSigningRequest,
} from "../src/mpp.js";
import { exactNear, ftTransferArgs, type NearUnsigned } from "../src/near.js";
import {
  decodeProfileCall,
  encodeProfileCall,
  exactPolkadotRemark,
  splitSigned,
  ss58Decode,
  type PolkadotUnsigned,
} from "../src/polkadot.js";
import type { StellarUnsigned } from "../src/stellar.js";
import { decodeSuiTx, exactSui, type SuiUnsigned } from "../src/sui.js";
import {
  buildChannelMessage,
  buildSvmMessage,
  channelInstruction,
  channelVoucherMessage,
  decodeSvmTx,
  openInstructionData,
  sessionProof,
  solanaVoucher,
  type SvmTx,
} from "../src/svm.js";
import { decodeTempoTx, encodeKeyAuthorization, type TempoKeyAuthorization } from "../src/tempo.js";
import { decodeTronTx, encodeTronRaw, exactTronMemo, tronAddress, type TronUnsigned } from "../src/tron.js";
import { exactTvm, type TvmUnsigned } from "../src/tvm.js";
import { batchSvm, type SigningRequest } from "../src/x402-batch-settlement.js";
import { exactSvm, type SvmUnsigned } from "../src/x402-exact-solana.js";
import { exactStellar } from "../src/x402-exact-stellar.js";
import type { PaymentRequired, PaymentRequirements } from "../src/x402.js";
import { xrplClaim } from "../src/xrpl.js";

const load = (name: string) => JSON.parse(readFileSync(new URL(`../vectors/${name}`, import.meta.url), "utf8"));
const AV = load("x402-exact-algorand.json");
const CA = load("x402-exact-cardano.json");
const CC = load("x402-exact-ccd.json");
const DI = load("discovery.json");
const HE = load("x402-exact-hedera.json");
const LN = load("x402-exact-lnbtc.json");
const SS = load("mpp-session-hedera-solana-xrpl.json");
const SO = load("mpp-charge-solana.json");
const ST = load("mpp-charge-stellar.json");
const NE = load("x402-exact-near.json");
const PO = load("x402-exact-polkadot-lcp-assets-remark.json");
const SU = load("x402-exact-sui.json");
const TM = load("mpp-charge-tempo-memo.json");
const SUB = load("mpp-subscription-tempo.json");
const TR = load("x402-exact-tron-lcp-trc20-memo.json");
const TV = load("x402-exact-tvm.json");
const BA = load("x402-batch-settlement.json");
const SV = load("x402-exact-solana.json");
const XS = load("x402-exact-stellar.json");

/** A result past its refusal: what a call gives when it succeeds. */
type Ok<T> = Exclude<Awaited<T>, { refused: true } | string | null | undefined>;

/** Every byte output declared `Uint8Array<ArrayBuffer>`, by entry point. */
type Outputs = {
  // core
  fromBase64: Ok<ReturnType<typeof fromBase64>>;
  base64Bytes: Ok<ReturnType<typeof base64Bytes>>;
  fromBase64Url: Ok<ReturnType<typeof fromBase64Url>>;
  base64UrlBytes: Ok<ReturnType<typeof base64UrlBytes>>;
  "assemble bytes": Ok<ReturnType<typeof assemble>>["bytes"];
  toRawBytes: ReturnType<typeof toRawBytes>;
  // avm
  "AvmUnsigned request.bytes": AvmUnsigned["request"]["bytes"];
  // cardano
  auxiliaryData: Ok<ReturnType<typeof auxiliaryData>>;
  "CardanoUnsigned request.auxiliaryData": CardanoUnsigned["request"]["auxiliaryData"];
  // ccd
  ccdMemo: ReturnType<typeof ccdMemo>;
  pltMemo: ReturnType<typeof pltMemo>;
  accountBytes: Ok<ReturnType<typeof accountBytes>>;
  "CcdUnsigned request.memo": CcdUnsigned["request"]["memo"];
  // discovery
  emit: Ok<ReturnType<typeof emit>>;
  // hedera
  "decodeHederaTx bodies[].bodyBytes": Ok<ReturnType<typeof decodeHederaTx>>["bodies"][number]["bodyBytes"];
  "HederaUnsigned request.bodyBytes": HederaUnsigned["request"]["bodyBytes"];
  // lightning
  "decodeBolt11 paymentHash": Ok<ReturnType<typeof decodeBolt11>>["paymentHash"];
  "decodeBolt11 descriptionHash": NonNullable<Ok<ReturnType<typeof decodeBolt11>>["descriptionHash"]>;
  "decodeBolt11 metadata": NonNullable<Ok<ReturnType<typeof decodeBolt11>>["metadata"]>;
  // mpp
  "sessionXrpl request.claim.bytes": Extract<RailSessionUnsigned, { request: { kind: "xrpl-session-open" } }>["request"]["claim"]["bytes"];
  "WithinSigningRequest ed25519-raw message": Extract<WithinSigningRequest, { kind: "ed25519-raw" }>["message"];
  "WithinSigningRequest xrpl-claim bytes": Extract<WithinSigningRequest, { kind: "xrpl-claim" }>["bytes"];
  "chargeSolana request.message": Ok<ReturnType<typeof chargeSolana.build>>["request"]["message"];
  "chargeStellar request.preimage": Ok<ReturnType<typeof chargeStellar.build>>["request"]["preimage"];
  // near
  "NearUnsigned request.hash": NearUnsigned["request"]["hash"];
  ftTransferArgs: Ok<ReturnType<typeof ftTransferArgs>>;
  // polkadot
  "decodeProfileCall dest": Ok<ReturnType<typeof decodeProfileCall>>["dest"];
  "decodeProfileCall remark": Ok<ReturnType<typeof decodeProfileCall>>["remark"];
  "PolkadotUnsigned request.call": PolkadotUnsigned["request"]["call"];
  ss58Decode: Ok<ReturnType<typeof ss58Decode>>;
  encodeProfileCall: ReturnType<typeof encodeProfileCall>;
  "splitSigned signer": Ok<ReturnType<typeof splitSigned>>["signer"];
  // sui
  "decodeSuiTx bytes": Ok<ReturnType<typeof decodeSuiTx>>["bytes"];
  "decodeSuiTx unusedPure[]": Ok<ReturnType<typeof decodeSuiTx>>["unusedPure"][number];
  "SuiUnsigned request.pureInput": SuiUnsigned["request"]["pureInput"];
  // tempo
  "decodeTempoTx calls[].input": Ok<ReturnType<typeof decodeTempoTx>>["calls"][number]["input"];
  encodeKeyAuthorization: Ok<ReturnType<typeof encodeKeyAuthorization>>;
  // tron
  "decodeTronTx raw.refBlockBytes": Ok<ReturnType<typeof decodeTronTx>>["raw"]["refBlockBytes"];
  "decodeTronTx raw.refBlockHash": Ok<ReturnType<typeof decodeTronTx>>["raw"]["refBlockHash"];
  "decodeTronTx raw.data": Ok<ReturnType<typeof decodeTronTx>>["raw"]["data"];
  "decodeTronTx raw.owner": Ok<ReturnType<typeof decodeTronTx>>["raw"]["owner"];
  "decodeTronTx raw.contractAddress": Ok<ReturnType<typeof decodeTronTx>>["raw"]["contractAddress"];
  "decodeTronTx raw.callData": Ok<ReturnType<typeof decodeTronTx>>["raw"]["callData"];
  "decodeTronTx rawBytes": Ok<ReturnType<typeof decodeTronTx>>["rawBytes"];
  "decodeTronTx signatures[]": Ok<ReturnType<typeof decodeTronTx>>["signatures"][number];
  "TronUnsigned request.txid": TronUnsigned["request"]["txid"];
  encodeTronRaw: ReturnType<typeof encodeTronRaw>;
  tronAddress: Ok<ReturnType<typeof tronAddress>>;
  // tvm
  "TvmUnsigned request.hash": TvmUnsigned["request"]["hash"];
  // x402-batch-settlement
  "SigningRequest solana-message": Extract<SigningRequest, { kind: "solana-message" }>["message"];
  "SigningRequest ed25519-raw": Extract<SigningRequest, { kind: "ed25519-raw" }>["message"];
  // x402-exact-solana
  "SvmUnsigned request.message": SvmUnsigned["request"]["message"];
  // stellar
  "StellarUnsigned request.preimage": StellarUnsigned["request"]["preimage"];
  // svm
  "decodeSvmTx signatures[]": Ok<ReturnType<typeof decodeSvmTx>>["signatures"][number];
  "decodeSvmTx message": Ok<ReturnType<typeof decodeSvmTx>>["message"];
  "decodeSvmTx keys[]": Ok<ReturnType<typeof decodeSvmTx>>["keys"][number];
  "decodeSvmTx instructions[].data": Ok<ReturnType<typeof decodeSvmTx>>["instructions"][number]["data"];
  "decodeSvmTx blockhash": Ok<ReturnType<typeof decodeSvmTx>>["blockhash"];
  buildSvmMessage: Ok<ReturnType<typeof buildSvmMessage>>;
  buildChannelMessage: Ok<ReturnType<typeof buildChannelMessage>>;
  openInstructionData: ReturnType<typeof openInstructionData>;
  channelVoucherMessage: ReturnType<typeof channelVoucherMessage>;
  "channelInstruction data": Ok<ReturnType<typeof channelInstruction>>["data"];
  solanaVoucher: Ok<ReturnType<typeof solanaVoucher>>;
  sessionProof: ReturnType<typeof sessionProof>;
  // xrpl
  xrplClaim: Ok<ReturnType<typeof xrplClaim>>;
};

/** The names in `Outputs` whose type is not a `BlobPart`; never, when each one is. */
type NotBlobPart = { [K in keyof Outputs]: Outputs[K] extends BlobPart ? never : K }[keyof Outputs];
/** The names in `Outputs` whose type is not a `BufferSource`; never, when each one is. */
type NotBufferSource = { [K in keyof Outputs]: Outputs[K] extends BufferSource ? never : K }[keyof Outputs];

const unwrap = <T>(v: T): Ok<T> => {
  if (v === null || v === undefined || typeof v === "string" || (typeof v === "object" && "refused" in v)) {
    throw new Error(`refused: ${JSON.stringify(v)}`);
  }
  return v as Ok<T>;
};
const bytesOfHex = (h: string) => Uint8Array.from(Buffer.from(h.replace(/^0x/, ""), "hex"));
const bytesOfBase64 = (b: string) => Uint8Array.from(Buffer.from(b, "base64"));
const x402 = (resource: unknown, o: PaymentRequirements): PaymentRequired => ({ x402Version: 2, resource, accepts: [o] }) as PaymentRequired;

const SS_H: AtrHash = SS.fixed.H;
const solanaWithin = (): SessionWithin => {
  const opening: MppCredential = {
    challenge: SS.SS1.solana.placed,
    payload: { action: "open", channelId: SS.SV2.channel, transaction: SS.SV2.wireBase64 },
  };
  return { challenge: { ...SS.SS1.solana.challenge, id: "seller-own-id" }, opening, cumulativeAmount: 100n, action: "voucher" } as SessionWithin;
};
const xrplWithin = (): SessionWithin => {
  const opening: MppCredential = {
    challenge: SS.SS1.xrpl.placed,
    payload: { action: "open", transaction: SS.XS2.blob, amount: "100", signature: "00" },
  };
  return { challenge: { ...SS.SS1.xrpl.challenge, id: "seller-own-id" }, opening, cumulativeAmount: 100n, action: "voucher" } as SessionWithin;
};
const keyAuthorization = (): TempoKeyAuthorization => {
  const a = SUB.SUB1.authorization;
  return {
    chainId: BigInt(a.chainId),
    keyType: a.keyType,
    keyId: a.keyId,
    expiry: BigInt(a.expiry),
    limits: a.limits.map((l: { token: `0x${string}`; limit: string; period: string }) => ({
      token: l.token,
      limit: BigInt(l.limit),
      period: BigInt(l.period),
    })),
    allowedCalls: a.allowedCalls,
    witness: SUB.fixed.H,
  } as TempoKeyAuthorization;
};
const svmWire = () => bytesOfBase64(SS.SV2.wireBase64);
const tempoWire = () => bytesOfHex(TM.buyer.rows[1].input.presented.payload.signature);

/** A case gives the output once, or every element of an output that is an array of them. */
type Case<T> = () => T | readonly T[] | Promise<T | readonly T[]>;

const cases: { [K in keyof Outputs]: Case<Outputs[K]> } = {
  fromBase64: () => unwrap(fromBase64("AAECAw==")),
  base64Bytes: () => unwrap(base64Bytes("AAECAw==", 4)),
  fromBase64Url: () => unwrap(fromBase64Url("AAECAw")),
  base64UrlBytes: () => unwrap(base64UrlBytes("AAECAw", 4)),
  "assemble bytes": async () =>
    unwrap(await assemble(newAtrId(), ["x402", { a: 1 }], [["seller", new TextEncoder().encode('{"b":2}')]])).bytes,
  toRawBytes: () => toRawBytes(SS_H),

  "AvmUnsigned request.bytes": async () => {
    const O: PaymentRequirements = AV.fixed.O;
    const params: AvmParams = {
      firstValid: BigInt(AV.fixed.params.firstValid),
      genesisHash: AV.fixed.params.genesisHash,
      genesisId: AV.fixed.params.genesisId,
      minFee: BigInt(AV.fixed.params.minFee),
      feePerByte: BigInt(AV.fixed.params.feePerByte),
    };
    const u = await exactAvm.build({ required: x402(AV.fixed.resource, O), accepted: O, payer: AV.fixed.payer, params }, AV.fixed.H);
    return unwrap(u).request.bytes;
  },

  auxiliaryData: () => unwrap(auxiliaryData(CA.fixed.H)),
  "CardanoUnsigned request.auxiliaryData": async () => {
    const O: PaymentRequirements = CA.fixed.O;
    const required = unwrap(exactCardano.advertise(x402(CA.fixed.resource, O), CA.fixed.H, CA.fixed.link, O));
    return unwrap(await exactCardano.build({ required, accepted: O }, CA.fixed.H)).request.auxiliaryData;
  },

  ccdMemo: () => ccdMemo(CC.fixed.H),
  pltMemo: () => pltMemo(CC.fixed.H),
  accountBytes: () => unwrap(accountBytes(CC.fixed.payer)),
  "CcdUnsigned request.memo": async () => {
    const O: PaymentRequirements = CC.fixed.O;
    const u = await exactCcd.build({ required: x402(CC.fixed.resource, O), accepted: O, now: CC.fixed.now }, CC.fixed.H);
    return unwrap(u).request.memo;
  },

  emit: () => unwrap(emit(DI.emit[0].input as LegalContextDocument)),

  "decodeHederaTx bodies[].bodyBytes": () =>
    unwrap(decodeHederaTx(bytesOfBase64(HE.V2.expectTransactionBase64))).bodies.map((b) => b.bodyBytes),
  "HederaUnsigned request.bodyBytes": async () => {
    const O: PaymentRequirements = HE.fixed.O;
    const u = await exactHedera.build(
      {
        required: x402(HE.fixed.resource, O),
        accepted: O,
        payer: HE.fixed.payer,
        node: HE.fixed.node,
        validStart: { seconds: BigInt(HE.fixed.validStart.seconds), nanos: HE.fixed.validStart.nanos },
        maxFee: BigInt(HE.fixed.maxFee),
      },
      HE.fixed.H,
    );
    return unwrap(u).request.bodyBytes;
  },

  "decodeBolt11 paymentHash": async () => unwrap(await decodeBolt11(LN.L4.invoice)).paymentHash,
  "decodeBolt11 descriptionHash": async () => unwrap(unwrap(await decodeBolt11(LN.L4.invoice)).descriptionHash),
  "decodeBolt11 metadata": async () => unwrap(unwrap(await decodeBolt11(LN.L4.invoice)).metadata),

  "sessionXrpl request.claim.bytes": async () => {
    const choice = {
      challenge: SS.SS1.xrpl.placed as MppChallenge & { id: string },
      from: SS.XS2.account,
      now: 1790000000,
      deposit: BigInt(SS.XS2.deposit),
      xrpl: { publicKey: `ED${"11".repeat(32)}`, settleDelay: 3600, fee: "12", sequence: 7, lastLedgerSequence: 1000 },
    };
    const u = unwrap(await sessionXrpl.build(choice, SS_H));
    if (u.request.kind !== "xrpl-session-open") throw new Error(u.request.kind);
    return u.request.claim.bytes;
  },
  "WithinSigningRequest ed25519-raw message": async () => {
    const r = unwrap(await sessionSolana.buildWithin(solanaWithin(), SS_H)).requests[0]!;
    if (r.kind !== "ed25519-raw") throw new Error(r.kind);
    return r.message;
  },
  "WithinSigningRequest xrpl-claim bytes": async () => {
    const r = unwrap(await sessionXrpl.buildWithin(xrplWithin(), SS_H)).requests[0]!;
    if (r.kind !== "xrpl-claim") throw new Error(r.kind);
    return r.bytes;
  },
  "chargeSolana request.message": async () =>
    unwrap(await chargeSolana.build({ challenge: SO.place.expect, payer: SO.fixed.payer }, SO.fixed.H)).request.message,
  "chargeStellar request.preimage": async () => {
    const now = Date.parse(ST.fixed.expires) / 1000 - 60;
    const choice = { challenge: ST.place.expect, simulatedXdr: XS.V2.simulatedXdr, currentLedger: 988, now, payer: XS.fixed.payer };
    return unwrap(await chargeStellar.build(choice, ST.fixed.H)).request.preimage;
  },

  "NearUnsigned request.hash": async () => {
    const O: PaymentRequirements = NE.fixed.O;
    const choice = {
      required: x402(NE.fixed.resource, O),
      accepted: O,
      payer: NE.fixed.payer as string,
      publicKey: NE.fixed.publicKey as string,
      accessKeyNonce: BigInt(NE.fixed.accessKeyNonce),
      finalHeight: BigInt(NE.fixed.finalHeight),
    };
    return unwrap(await exactNear.build(choice, NE.fixed.H)).request.hash;
  },
  ftTransferArgs: () => unwrap(ftTransferArgs(NE.fixed.O.payTo, NE.fixed.O.amount, NE.fixed.H)),

  "decodeProfileCall dest": () => unwrap(decodeProfileCall(bytesOfHex(PO.V2.expectCall))).dest,
  "decodeProfileCall remark": () => unwrap(decodeProfileCall(bytesOfHex(PO.V2.expectCall))).remark,
  "PolkadotUnsigned request.call": async () => {
    const O: PaymentRequirements = PO.fixed.O;
    return unwrap(await exactPolkadotRemark.build({ required: x402(PO.fixed.resource, O), accepted: O }, PO.fixed.H)).request.call;
  },
  ss58Decode: () => unwrap(ss58Decode(PO.fixed.O.payTo)),
  encodeProfileCall: () => encodeProfileCall(unwrap(decodeProfileCall(bytesOfHex(PO.V2.expectCall)))),
  "splitSigned signer": () => unwrap(splitSigned(bytesOfHex(PO.V1.extrinsic))).signer,

  "decodeSuiTx bytes": () => unwrap(decodeSuiTx(SU.V2.tx.transactionBase64)).bytes,
  "decodeSuiTx unusedPure[]": () => unwrap(decodeSuiTx(SU.V2.tx.transactionBase64)).unusedPure,
  "SuiUnsigned request.pureInput": async () => {
    const O: PaymentRequirements = SU.fixed.O;
    const required = unwrap(exactSui.advertise(x402(SU.fixed.resource, O), SU.fixed.H, SU.fixed.link, O));
    return unwrap(await exactSui.build({ required, accepted: O }, SU.fixed.H)).request.pureInput;
  },

  "decodeTempoTx calls[].input": () => unwrap(decodeTempoTx(tempoWire())).calls.map((c) => c.input),
  encodeKeyAuthorization: () => unwrap(encodeKeyAuthorization(keyAuthorization())),

  "decodeTronTx raw.refBlockBytes": () => unwrap(decodeTronTx(TR.V2.expectPayload.payload.transaction)).raw.refBlockBytes,
  "decodeTronTx raw.refBlockHash": () => unwrap(decodeTronTx(TR.V2.expectPayload.payload.transaction)).raw.refBlockHash,
  "decodeTronTx raw.data": () => unwrap(decodeTronTx(TR.V2.expectPayload.payload.transaction)).raw.data,
  "decodeTronTx raw.owner": () => unwrap(decodeTronTx(TR.V2.expectPayload.payload.transaction)).raw.owner,
  "decodeTronTx raw.contractAddress": () =>
    unwrap(decodeTronTx(TR.V2.expectPayload.payload.transaction)).raw.contractAddress,
  "decodeTronTx raw.callData": () => unwrap(decodeTronTx(TR.V2.expectPayload.payload.transaction)).raw.callData,
  "decodeTronTx rawBytes": () => unwrap(decodeTronTx(TR.V2.expectPayload.payload.transaction)).rawBytes,
  "decodeTronTx signatures[]": () => unwrap(decodeTronTx(TR.V2.expectPayload.payload.transaction)).signatures,
  "TronUnsigned request.txid": async () => {
    const O: PaymentRequirements = TR.fixed.O;
    const choice = {
      required: x402(TR.fixed.resource, O),
      accepted: O,
      payer: TR.fixed.payer as string,
      refBlock: { number: BigInt(TR.fixed.refBlock.number), id: TR.fixed.refBlock.id },
      now: BigInt(TR.fixed.now),
      feeLimit: BigInt(TR.fixed.feeLimit),
    };
    return unwrap(await exactTronMemo.build(choice, TR.fixed.H)).request.txid;
  },
  encodeTronRaw: () => encodeTronRaw(unwrap(decodeTronTx(TR.V2.expectPayload.payload.transaction)).raw),
  tronAddress: async () => unwrap(await tronAddress(TR.V2.expectRecoversTo)),

  "TvmUnsigned request.hash": async () => {
    const placed: PaymentRequirements = TV.fixed.placed;
    const choice = {
      required: x402(TV.fixed.resource, placed),
      accepted: placed,
      wallet: TV.fixed.wallet as string,
      walletId: TV.fixed.walletId as number,
      seqno: TV.fixed.seqno as number,
      jettonWallet: TV.fixed.jettonWallet as string,
      attachNanotons: BigInt(TV.fixed.attachNanotons),
      now: TV.fixed.now as number,
    };
    return unwrap(await exactTvm.build(choice, TV.fixed.H)).request.hash;
  },

  "SigningRequest solana-message": async () => {
    const r = (await batchSvmRequests())[0]!;
    if (r.kind !== "solana-message") throw new Error(r.kind);
    return r.message;
  },
  "SigningRequest ed25519-raw": async () => {
    const r = (await batchSvmRequests())[1]!;
    if (r.kind !== "ed25519-raw") throw new Error(r.kind);
    return r.message;
  },

  "SvmUnsigned request.message": async () => {
    const O: PaymentRequirements = SV.fixed.option;
    const doc = unwrap(exactSvm.advertise(x402(SV.fixed.resource, O), SV.fixed.H, SV.fixed.link, O));
    const choice = {
      required: doc,
      accepted: doc.accepts[0]!,
      payer: SV.fixed.payer,
      decimals: SV.fixed.decimals,
      tokenProgram: SV.fixed.tokenProgram,
      recentBlockhash: SV.fixed.blockhash,
    };
    return unwrap(await exactSvm.build(choice, SV.fixed.H)).request.message;
  },

  "StellarUnsigned request.preimage": async () => {
    const accepted: PaymentRequirements = XS.V3.accepted;
    const choice = {
      required: x402(XS.fixed.resource, accepted),
      accepted,
      simulatedXdr: XS.V2.simulatedXdr,
      currentLedger: XS.V2.currentLedger,
      payer: XS.fixed.payer,
    };
    return unwrap(await exactStellar.build(choice, XS.fixed.H)).request.preimage;
  },

  "decodeSvmTx signatures[]": () => unwrap(decodeSvmTx(svmWire())).signatures,
  "decodeSvmTx message": () => unwrap(decodeSvmTx(svmWire())).message,
  "decodeSvmTx keys[]": () => unwrap(decodeSvmTx(svmWire())).keys,
  "decodeSvmTx instructions[].data": () => unwrap(decodeSvmTx(svmWire())).instructions.map((i) => i.data),
  "decodeSvmTx blockhash": () => unwrap(decodeSvmTx(svmWire())).blockhash,
  buildSvmMessage: async () => {
    const O: PaymentRequirements = SV.fixed.option;
    const input = {
      feePayer: SV.fixed.payer,
      payer: SV.fixed.payer,
      mint: O.asset,
      tokenProgram: SV.fixed.tokenProgram,
      decimals: SV.fixed.decimals,
      payTo: O.payTo,
      amount: BigInt(O.amount),
      recentBlockhash: SV.fixed.blockhash,
      memo: "lcp",
      computeUnitLimit: 40_000,
      computeUnitPrice: 1n,
    };
    return unwrap(await buildSvmMessage(input));
  },
  buildChannelMessage: async () => {
    const S = BA.fixed.svm;
    const input = {
      feePayer: S.payer,
      payer: S.payer,
      mint: S.option.asset,
      tokenProgram: S.tokenProgram,
      recentBlockhash: S.blockhash,
      computeUnitLimit: 40_000,
      computeUnitPrice: 1n,
      instruction: { kind: "top_up" as const, channel: BA.ES1.channelPda, amount: 1n },
    };
    return unwrap(await buildChannelMessage(input));
  },
  openInstructionData: () => {
    const S = BA.fixed.svm;
    return openInstructionData({ salt: 42n, deposit: 100000n, gracePeriod: 3600, openSlot: BigInt(S.openSlot), recipient: S.payTo });
  },
  channelVoucherMessage: () => channelVoucherMessage(BA.ES1.channelPda, 1000n, 0n),
  "channelInstruction data": () => unwrap(channelInstruction(unwrap(decodeSvmTx(svmWire())))).data,
  solanaVoucher: () => unwrap(solanaVoucher(SS.SV2.channel, 100n)),
  sessionProof: () => sessionProof({ channelId: SS.SV2.channel, payer: SS.SV3.payer, challengeId: SS.fixed.MV1 }),

  xrplClaim: () => unwrap(xrplClaim(SS.XS2.expectChannel, 100n)),
};

async function batchSvmRequests(): Promise<readonly SigningRequest[]> {
  const S = BA.fixed.svm;
  const o: PaymentRequirements = S.option;
  const doc = unwrap(batchSvm.advertise(x402(BA.fixed.resource, o), BA.fixed.H, BA.fixed.link, o));
  const u = await batchSvm.build(
    {
      required: doc,
      accepted: doc.accepts[0]!,
      payer: S.payer,
      payerAuthorizer: S.payer,
      deposit: BigInt(S.deposit),
      salt: 42n,
      openSlot: BigInt(S.openSlot),
      tokenProgram: S.tokenProgram,
      recentBlockhash: S.blockhash,
    },
    BA.fixed.H,
  );
  return unwrap(u).requests;
}

/** True when `b` is a `Uint8Array` whose buffer is an `ArrayBuffer` and not a `SharedArrayBuffer`. */
function inArrayBuffer(b: unknown): boolean {
  return (
    b instanceof Uint8Array &&
    b.buffer instanceof ArrayBuffer &&
    !(typeof SharedArrayBuffer === "function" && b.buffer instanceof SharedArrayBuffer)
  );
}

describe("byte outputs: each declared Uint8Array<ArrayBuffer>", () => {
  it("each is a BlobPart and a BufferSource (checked by tsc -p tsconfig.test.json)", () => {
    // When an output is not, its name is the type each constant must have, and tsc names it in the error.
    const blobParts: [NotBlobPart] extends [never] ? "each output" : { [K in NotBlobPart]: K }[NotBlobPart] = "each output";
    const bufferSources: [NotBufferSource] extends [never] ? "each output" : { [K in NotBufferSource]: K }[NotBufferSource] =
      "each output";
    expect([blobParts, bufferSources]).toEqual(["each output", "each output"]);
  });

  it("66 outputs: each one's bytes sit in an ArrayBuffer, not a SharedArrayBuffer, on the vectors' inputs", async () => {
    const names = Object.keys(cases) as (keyof Outputs)[];
    expect(names.length).toBe(66);
    const seen: string[] = [];
    const notInArrayBuffer: string[] = [];
    for (const name of names) {
      const got = await cases[name]();
      const all = Array.isArray(got) ? (got as readonly unknown[]) : [got];
      expect(all.length, name).toBeGreaterThan(0);
      for (const b of all) if (!inArrayBuffer(b)) notInArrayBuffer.push(name);
      seen.push(name);
    }
    expect(notInArrayBuffer).toEqual([]);
    expect(seen.length).toBe(66);
  });
});

/** The six decoders that give bytes read from the caller's: each output is a copy, whatever backs the input. */
const decoders: Record<string, { input: () => Uint8Array; outputs: (input: Uint8Array) => readonly Uint8Array[] }> = {
  "decodeHederaTx bodies[].bodyBytes": {
    input: () => bytesOfBase64(HE.V2.expectTransactionBase64),
    outputs: (w) => unwrap(decodeHederaTx(w)).bodies.map((b) => b.bodyBytes),
  },
  "decodeTempoTx calls[].input": {
    input: tempoWire,
    outputs: (w) => unwrap(decodeTempoTx(w)).calls.map((c) => c.input),
  },
  "decodeProfileCall dest and remark": {
    input: () => bytesOfHex(PO.V2.expectCall),
    outputs: (w) => {
      const c = unwrap(decodeProfileCall(w));
      return [c.dest, c.remark];
    },
  },
  "splitSigned signer": {
    input: () => bytesOfHex(PO.V1.extrinsic),
    outputs: (w) => [unwrap(splitSigned(w)).signer],
  },
  "decodeSvmTx every byte field": {
    input: svmWire,
    outputs: (w) => {
      const tx = unwrap(decodeSvmTx(w));
      return [...tx.signatures, tx.message, ...tx.keys, ...tx.instructions.map((i) => i.data), tx.blockhash];
    },
  },
  "channelInstruction data": {
    input: svmWire,
    outputs: (w) => {
      // The transaction channelInstruction reads holds instruction data that are views of `w`, as a caller's may.
      const decoded = unwrap(decodeSvmTx(svmWire()));
      let at = 0;
      const instructions = decoded.instructions.map((ix) => {
        const view = w.subarray(at, at + ix.data.length);
        view.set(ix.data);
        at += ix.data.length;
        return { ...ix, data: view };
      });
      const tx: SvmTx = { ...decoded, instructions };
      return [unwrap(channelInstruction(tx)).data];
    },
  },
};

/** The input's bytes in three backings: a plain `Uint8Array`, a pooled Node `Buffer`, and a `Buffer` over a `SharedArrayBuffer`. */
const backings: Record<string, (b: Uint8Array) => Uint8Array> = {
  "a Uint8Array": (b) => Uint8Array.from(b),
  "a pooled Buffer": (b) => Buffer.from(b),
  "a Buffer over a SharedArrayBuffer": (b) => {
    const shared = Buffer.from(new SharedArrayBuffer(b.length));
    shared.set(b);
    return shared;
  },
};

describe("byte outputs read from the caller's bytes are copies", () => {
  it("6 decoders × 3 backings: each output in an ArrayBuffer of its own, unchanged when the input is overwritten", () => {
    expect(Object.keys(decoders).length).toBe(6);
    expect(Object.keys(backings).length).toBe(3);
    let runs = 0;
    const faults: string[] = [];
    for (const [decoder, d] of Object.entries(decoders)) {
      for (const [backing, make] of Object.entries(backings)) {
        const input = make(d.input());
        if (backing === "a pooled Buffer") expect(Buffer.isBuffer(input) && !(input.buffer instanceof SharedArrayBuffer)).toBe(true);
        if (backing === "a Buffer over a SharedArrayBuffer") expect(Buffer.isBuffer(input) && input.buffer instanceof SharedArrayBuffer).toBe(true);
        const outputs = d.outputs(input);
        expect(outputs.length, decoder).toBeGreaterThan(0);
        const before = outputs.map((o) => Buffer.from(o).toString("hex"));
        input.fill(0xff);
        const notInArrayBuffer = outputs.filter((o) => !inArrayBuffer(o)).length;
        const buffers = outputs.filter((o) => Buffer.isBuffer(o)).length;
        const sharing = outputs.filter((o, i) => Buffer.from(o).toString("hex") !== before[i]).length;
        if (notInArrayBuffer + buffers + sharing > 0) {
          faults.push(
            `${decoder} on ${backing}, of ${outputs.length}: ${notInArrayBuffer} not in an ArrayBuffer, ` +
              `${buffers} a Buffer, ${sharing} sharing the input's memory`,
          );
        }
        runs++;
      }
    }
    expect(faults).toEqual([]);
    expect(runs).toBe(18);
  });
});
