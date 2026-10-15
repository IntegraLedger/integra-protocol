// Inputs a function answers before it needs its rail's optional peer, so it gives each the same code with the peer
// (peer-free-inputs.test.ts, failures-are-values.test.ts for muxedFor, and build-choices.test.ts for every x402 build)
// and without it (the rail's peer-missing test):
// - TON's and Sui's `recover`: a reader for another network or a ref recover cannot read, with nothing read; a read
//   that fails, finds nothing or answers out of the reader's form; the rail's own refusal of a transaction it finds;
//   and a body or bytes whose size, form, or tags read at fixed places refuse it before it decodes them with the peer.
//   The vector files' recover rows are decoded: each gets the vectors' answer with the peer and `<rail>/peer-missing`
//   without it.
// - The decoders and carriers: `tvmCarrier`, `decodeSuiTx`, `nearCarrier`, `decodeStellarTx`, `transferEventTopics`
//   and `transferEventOf` on input whose network, size, base64 or union tags they refuse; `avmCarrier` on every input,
//   as it needs no peer.
// - `mpp/charge/stellar`'s `build`: a choice, challenge, H, current ledger, clock, expiration ledger or simulated
//   transaction form it refuses. `x402/exact/near`'s `build`: a payer, key, nonce or height it refuses.
// - Every x402 `build`: a malformed H, which each checks first, before the choice and its document.
// - x402 XRPL's `bound` and `reference`: an option whose `invoiceId` is not an LCP string, read before the blob.
// - `mpp/session/xrpl`'s `buildWithin`: an H, cumulative amount or action it refuses, before it decodes the opening.
// - `muxedFor`: a base that is not a string, and an H that is not a 32-byte hash.
import { readFileSync } from "node:fs";
import { blake2b } from "@noble/hashes/blake2.js";
import { base58 } from "@scure/base";

const vector = (name: string) => JSON.parse(readFileSync(new URL(`../vectors/${name}`, import.meta.url), "utf8"));
const TVM = vector("x402-exact-tvm.json");
const SUI = vector("x402-exact-sui.json");
const STELLAR = vector("x402-exact-stellar.json");
const CHARGE = vector("mpp-charge-stellar.json");
const NEAR = vector("x402-exact-near.json");
const AVM = vector("x402-exact-algorand.json");
const XRPL = vector("x402-exact-xrpl.json");
const SESSION = vector("mpp-session-hedera-solana-xrpl.json");
const EVM = vector("x402-exact-eip155-eip3009.json");

const bytes = (b64: string) => Uint8Array.from(Buffer.from(b64, "base64"));
const b64 = (b: ArrayLike<number>) => Buffer.from(Uint8Array.from(b)).toString("base64");
/** An XDR union tag or enum: a big-endian uint32. */
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const zeros = (n: number) => new Array<number>(n).fill(0);

/** A reader for `network` whose `method` answers `answer` (and throws for "error"); every read is counted. */
export interface Counted {
  reader: unknown;
  reads(): number;
}

function counted(network: string, method: string, answer: unknown): Counted {
  let reads = 0;
  const reader = new Proxy({}, {
    get: (_, k) => {
      if (k === "network") return network;
      if (k === "then") return undefined;
      return async () => {
        reads++;
        if (k === method && answer === "error") throw new Error("transport");
        return k === method ? answer : null;
      };
    },
  });
  return { reader, reads: () => reads };
}

/** A case `recover` answers before it decodes: the code, and the reads it makes first. */
export interface RecoverRead {
  case: string;
  ref: unknown;
  reader: () => Counted;
  expect: string;
  reads: number;
}

/** A vector row `recover` decodes: its answer with the peer, a hash or a refusal. */
export interface RecoverDecode {
  case: string;
  ref: unknown;
  reader: () => Counted;
  expect: unknown;
}

const answerOf = (e: string) => (e.startsWith("0x") ? e : { refused: true, code: e });

const TON_NETWORK: string = TVM.V4.ref.network;
const TON_REF = { network: TON_NETWORK, transaction: TVM.V4.recover[0].transaction as string };
const tonTx = (inBody: Uint8Array | null) => ({
  hash: TON_REF.transaction,
  account: TVM.fixed.jettonWallet,
  aborted: false,
  finality: 2,
  outMsgs: [],
  inBody,
});

export function tvmRecoverReads(): RecoverRead[] {
  const read = (answer: unknown) => () => counted(TON_NETWORK, "byHash", answer);
  return [
    { case: "a reader for another network", ref: TON_REF, reader: () => counted("tvm:-3", "byHash", null), expect: "tvm/wrong-reader", reads: 0 },
    { case: "a ref whose transaction is empty", ref: { ...TON_REF, transaction: "" }, reader: read(null), expect: "tvm/wrong-reader", reads: 0 },
    { case: "a read that fails", ref: TON_REF, reader: read("error"), expect: "tvm/unreadable", reads: 1 },
    { case: "no transaction", ref: TON_REF, reader: read(null), expect: "tvm/not-found", reads: 1 },
    { case: "an answer that is not a transaction", ref: TON_REF, reader: read({ hash: TON_REF.transaction }), expect: "tvm/unreadable", reads: 1 },
    { case: "a transaction with no inbound message body", ref: TON_REF, reader: read(tonTx(null)), expect: "tvm/not-jetton-transfer", reads: 1 },
    { case: "an empty inbound message body", ref: TON_REF, reader: read(tonTx(new Uint8Array(0))), expect: "tvm/unreadable", reads: 1 },
    { case: "an inbound message body over 8 KiB", ref: TON_REF, reader: read(tonTx(new Uint8Array(8193))), expect: "tvm/boc-too-large", reads: 1 },
    { case: "a body whose bag-of-cells magic TON does not know", ref: TON_REF, reader: read(tonTx(Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8))), expect: "tvm/unreadable", reads: 1 },
  ];
}

/** A settlement BoC and network `tvmCarrier` refuses before it needs @ton/core. */
export function tvmCarrierInputs(): { case: string; boc: unknown; network: unknown; expect: string }[] {
  // The generic magic, flags with 1-byte references and no index, 1-byte offsets, then 1 cell and 2 roots.
  const twoRoots = [0xb5, 0xee, 0x9c, 0x72, 0x01, 0x01, 0x01, 0x02, 0x00, 0x02, 0x00, 0x00, 0x00];
  return [
    { case: "a network the pairing does not serve", boc: "te6ccgEBAQEAAgAAAA==", network: "tvm:1", expect: "tvm/network-malformed" },
    { case: "an empty BoC", boc: "", network: TON_NETWORK, expect: "tvm/boc-malformed" },
    { case: "text that is not base64", boc: "AA=A", network: TON_NETWORK, expect: "tvm/boc-malformed" },
    { case: "a BoC over 8 KiB", boc: b64(new Uint8Array(8193)), network: TON_NETWORK, expect: "tvm/boc-too-large" },
    { case: "a magic TON does not know", boc: b64([1, 2, 3, 4, 5, 6, 7, 8]), network: TON_NETWORK, expect: "tvm/boc-malformed" },
    { case: "a header naming two roots", boc: b64(twoRoots), network: TON_NETWORK, expect: "tvm/boc-malformed" },
  ];
}

export function tvmRecoverDecodes(): RecoverDecode[] {
  return (TVM.V4.recover as { case: string; transaction: string; inBodyHex: string; expect: string }[]).map((row) => ({
    case: row.case,
    ref: { network: TON_NETWORK, transaction: row.transaction },
    reader: () => counted(TON_NETWORK, "byHash", tonTx(Uint8Array.from(Buffer.from(row.inBodyHex, "hex")))),
    expect: answerOf(row.expect),
  }));
}

const SUI_NETWORK: string = SUI.V4.ref.network;
const SUI_TX: Record<string, Uint8Array> = { V1: bytes(SUI.V1.tx.transactionBase64), V2: bytes(SUI.V2.tx.transactionBase64) };
const SUI_REF = { network: SUI_NETWORK, digest: SUI.V2.tx.digest as string };
/** Sui's digest of transaction bytes: base58 of BLAKE2b-256 over "TransactionData::" and the bytes. */
const suiDigestOf = (b: Uint8Array) => base58.encode(blake2b(Uint8Array.from([...Buffer.from("TransactionData::"), ...b]), { dkLen: 32 }));
/** V2's bytes with the version tag (byte 0) or the kind tag (byte 1) replaced. */
const suiTagged = (at: 0 | 1, tag: number) => Uint8Array.from(SUI_TX.V2!, (x, i) => (i === at ? tag : x));
const suiAnswer = (tx: { bcs: Uint8Array; status: string } | null) => ({
  tx: tx === null ? null : { transactionBcs: tx.bcs, status: tx.status, checkpoint: 7n },
  epoch: 1234n,
  firstCheckpoint: null,
});

export function suiRecoverReads(): RecoverRead[] {
  const read = (answer: unknown) => () => counted(SUI_NETWORK, "read", answer);
  return [
    { case: "a reader for another network", ref: SUI_REF, reader: () => counted("sui:mainnet", "read", null), expect: "sui/wrong-reader", reads: 0 },
    { case: "a digest of one byte", ref: { ...SUI_REF, digest: "x" }, reader: read(null), expect: "sui/wrong-reader", reads: 0 },
    { case: "a digest outside base58", ref: { ...SUI_REF, digest: "0".repeat(44) }, reader: read(null), expect: "sui/wrong-reader", reads: 0 },
    { case: "a digest of 45 characters", ref: { ...SUI_REF, digest: `1${SUI_REF.digest}` }, reader: read(null), expect: "sui/wrong-reader", reads: 0 },
    { case: "a read that fails", ref: SUI_REF, reader: read("error"), expect: "sui/unreadable", reads: 1 },
    { case: "no transaction", ref: SUI_REF, reader: read(suiAnswer(null)), expect: "sui/not-found", reads: 1 },
    { case: "an answer out of the reader's form", ref: SUI_REF, reader: read({ epoch: "1234" }), expect: "sui/unreadable", reads: 1 },
    { case: "bytes that do not hash to the digest", ref: SUI_REF, reader: read(suiAnswer({ bcs: SUI_TX.V1!, status: "SUCCESS" })), expect: "sui/unreadable", reads: 1 },
    { case: "a transaction that aborted", ref: SUI_REF, reader: read(suiAnswer({ bcs: SUI_TX.V2!, status: "FAILURE" })), expect: "sui/aborted", reads: 1 },
    ...[
      { case: "bytes whose version tag is not V1's", tx: suiTagged(0, 1), expect: "sui/tx-malformed" },
      { case: "a transaction whose kind is not programmable", tx: suiTagged(1, 1), expect: "sui/not-programmable" },
    ].map((r) => ({
      case: r.case,
      ref: { network: SUI_NETWORK, digest: suiDigestOf(r.tx) },
      reader: () => counted(SUI_NETWORK, "read", suiAnswer({ bcs: r.tx, status: "SUCCESS" })),
      expect: r.expect,
      reads: 1,
    })),
  ];
}

/** Base64 `decodeSuiTx` refuses before it needs @mysten/sui: its form and size, and the two tags at bytes 0 and 1. */
export function suiDecodeInputs(): { case: string; base64: unknown; expect: string }[] {
  const v2 = SUI_TX.V2!;
  return [
    { case: "a value that is not a string", base64: 7, expect: "sui/tx-malformed" },
    { case: "text that is not base64", base64: "AA=A", expect: "sui/tx-malformed" },
    { case: "bytes over 128 KiB", base64: b64(new Uint8Array(128 * 1024 + 1)), expect: "sui/tx-too-large" },
    { case: "no bytes", base64: "", expect: "sui/tx-malformed" },
    { case: "one byte", base64: b64([0]), expect: "sui/tx-malformed" },
    { case: "a version tag that is not V1's", base64: b64(suiTagged(0, 1)), expect: "sui/tx-malformed" },
    { case: "V1's tag in two bytes", base64: b64([0x80, ...v2]), expect: "sui/tx-malformed" },
    { case: "a kind that is not programmable", base64: b64(suiTagged(1, 2)), expect: "sui/not-programmable" },
  ];
}

export function suiRecoverDecodes(): RecoverDecode[] {
  return (SUI.V4.recover as { case: string; digest: string; answer: { tx: string; status: string }; expect: string }[]).map((row) => ({
    case: row.case,
    ref: { network: SUI_NETWORK, digest: row.digest },
    reader: () => counted(SUI_NETWORK, "read", suiAnswer({ bcs: SUI_TX[row.answer.tx]!, status: row.answer.status })),
    expect: answerOf(row.expect),
  }));
}

/**
 * The vectors' placed challenge with x402-exact-stellar.json's V2 simulated transaction and ledger, at a clock 60
 * seconds before the challenge expires: with the SDK, `mpp/charge/stellar` builds it, its entry expiring at V3's ledger
 * 1000 (mpp-charges.test.ts).
 */
export function stellarChargeChoice() {
  const now = Date.parse(CHARGE.fixed.expires) / 1000 - 60;
  return {
    choice: { challenge: CHARGE.place.expect, simulatedXdr: STELLAR.V2.simulatedXdr, currentLedger: STELLAR.V2.currentLedger, now, payer: STELLAR.fixed.payer },
    h: CHARGE.fixed.H as `0x${string}`,
  };
}

/**
 * A choice and H `mpp/charge/stellar`'s `build` refuses with the code given, before it reads the recipient: the
 * expiration ledger and the simulated transaction's form (`signingInput`) among them. The fee bump wraps V2's simulated
 * envelope whole.
 */
export function stellarChargeChoices(): { case: string; choice: unknown; h: unknown; expect: string }[] {
  const { choice, h } = stellarChargeChoice();
  const v1 = bytes(choice.simulatedXdr);
  const feeBump = b64([...u32(5), ...u32(0), ...zeros(32 + 8), ...v1, ...u32(0), ...u32(0)]);
  return [
    { case: "a choice that is not an object", choice: null, h, expect: "stellar/tx-malformed" },
    { case: "a challenge that is not one", choice: { ...choice, challenge: {} }, h, expect: "mpp/credential-malformed" },
    { case: "an H the challenge does not carry", choice, h: CHARGE.fixed.H2, expect: "mpp/id-not-ours" },
    { case: "a current ledger below 0", choice: { ...choice, currentLedger: -1 }, h, expect: "stellar/tx-malformed" },
    { case: "a clock that is not an integer", choice: { ...choice, now: choice.now + 0.5 }, h, expect: "stellar/tx-malformed" },
    { case: "a current ledger whose entry would expire past 2^32 - 1", choice: { ...choice, currentLedger: 2 ** 32 }, h, expect: "stellar/tx-malformed" },
    { case: "a simulated transaction that is not base64", choice: { ...choice, simulatedXdr: "AA=A" }, h, expect: "stellar/tx-malformed" },
    { case: "a simulated transaction over 8,192 characters", choice: { ...choice, simulatedXdr: "A".repeat(8196) }, h, expect: "stellar/tx-too-large" },
    { case: "a simulated fee bump", choice: { ...choice, simulatedXdr: feeBump }, h, expect: "stellar/tx-malformed" },
  ];
}

/** A base and H `muxedFor` refuses with the code given, before it reads the base's strkey. */
export function muxedForArgs(): { case: string; base: unknown; h: unknown; expect: string }[] {
  const { seller, H } = STELLAR.fixed;
  return [
    { case: "a base that is null", base: null, h: H, expect: "stellar/option-malformed" },
    { case: "a base that is a number", base: 7, h: H, expect: "stellar/option-malformed" },
    { case: "an H of one byte", base: seller, h: "0x12", expect: "x402/payload-malformed" },
    { case: "an H that is not a string", base: seller, h: undefined, expect: "x402/payload-malformed" },
  ];
}

/** A signed delegate action `nearCarrier` refuses before it needs borsh. */
export function nearCarrierInputs(): { case: string; sda: unknown; expect: string }[] {
  return [
    { case: "a value that is not a string", sda: 7, expect: "near/sda-malformed" },
    { case: "an empty text", sda: "", expect: "near/sda-malformed" },
    { case: "text over 8,192 characters", sda: "A".repeat(8196), expect: "near/sda-too-large" },
    { case: "text that is not base64", sda: "AA=A", expect: "near/sda-malformed" },
  ];
}

/** x402-exact-near.json's choice, which `build` builds with borsh (near.test.ts). */
export function nearChoice() {
  const O = NEAR.fixed.O;
  return {
    choice: {
      required: { x402Version: 2, resource: NEAR.fixed.resource, accepts: [O] },
      accepted: O,
      payer: NEAR.fixed.payer as string,
      publicKey: NEAR.fixed.publicKey as string,
      accessKeyNonce: BigInt(NEAR.fixed.accessKeyNonce),
      finalHeight: BigInt(NEAR.fixed.finalHeight),
    },
    h: NEAR.fixed.H as `0x${string}`,
  };
}

/** A NEAR choice `build` refuses before it needs borsh, which writes the delegate action. */
export function nearBuildChoices(): { case: string; choice: unknown; expect: string }[] {
  const { choice } = nearChoice();
  return [
    { case: "a payer that is not an account id", choice: { ...choice, payer: "A" }, expect: "x402/option-malformed" },
    { case: "a public key that is not one", choice: { ...choice, publicKey: "ed25519:0" }, expect: "x402/option-malformed" },
    { case: "an access key nonce below 0", choice: { ...choice, accessKeyNonce: -1n }, expect: "x402/option-malformed" },
    { case: "a final height below 0", choice: { ...choice, finalHeight: -1n }, expect: "x402/option-malformed" },
  ];
}

/**
 * x402-exact-algorand.json's payment entries and `avmCarrier`'s answer to each: V2's payment, which it reads, and each
 * V3.refusals row. It needs no algosdk, so it gives each the same answer without it.
 */
export function avmCarrierRows(): { case: string; presented: unknown; expect: unknown }[] {
  return [
    {
      case: "V2's payment",
      presented: { paymentIndex: AVM.V2.expectPaymentIndex, paymentGroup: AVM.V2.expectPaymentGroup },
      expect: { h: AVM.V3.expectBound, txid: AVM.V3.expectReference.txid, lastValid: BigInt(AVM.V3.expectReference.lastValid) },
    },
    ...(AVM.V3.refusals as { case: string; paymentGroup: unknown; paymentIndex: unknown; expect: string }[]).map((r) => ({
      case: r.case,
      presented: { paymentIndex: r.paymentIndex, paymentGroup: r.paymentGroup },
      expect: { refused: true, code: r.expect },
    })),
  ];
}

/**
 * A transaction envelope and network `decodeStellarTx` refuses before it needs @stellar/stellar-sdk: the network, the
 * text's size and base64, and the XDR union tags read at fixed places (the envelope's; a fee bump's fee source and
 * inner envelope).
 */
export function stellarEnvelopeInputs(): { case: string; xdr: unknown; network: unknown; expect: string }[] {
  const net = STELLAR.fixed.network;
  const feeBump = (feeSource: number, sourceBytes: number, inner: number[]) => b64([...u32(5), ...u32(feeSource), ...zeros(sourceBytes + 8), ...inner]);
  return [
    { case: "a network that is not Stellar's", xdr: STELLAR.V2.simulatedXdr, network: "stellar:mainnet", expect: "stellar/network-malformed" },
    { case: "a value that is not a string", xdr: 7, network: net, expect: "stellar/tx-malformed" },
    { case: "an empty text", xdr: "", network: net, expect: "stellar/tx-malformed" },
    { case: "text over 8,192 characters", xdr: "A".repeat(8196), network: net, expect: "stellar/tx-too-large" },
    { case: "text that is not base64", xdr: "AA=A", network: net, expect: "stellar/tx-malformed" },
    { case: "fewer than four bytes", xdr: b64([0, 0, 2]), network: net, expect: "stellar/tx-malformed" },
    { case: "a v0 envelope", xdr: b64([...u32(0), ...zeros(60)]), network: net, expect: "stellar/tx-malformed" },
    { case: "an envelope tag the XDR does not define", xdr: b64([...u32(7), ...zeros(60)]), network: net, expect: "stellar/tx-malformed" },
    { case: "a fee bump whose fee source is not an account", xdr: feeBump(1, 32, [...u32(2), ...zeros(60)]), network: net, expect: "stellar/tx-malformed" },
    { case: "a fee bump whose inner envelope is a v0 envelope", xdr: feeBump(0, 32, [...u32(0), ...zeros(60)]), network: net, expect: "stellar/tx-malformed" },
    { case: "a fee bump cut before its inner envelope's tag", xdr: feeBump(0x100, 40, [0, 0]), network: net, expect: "stellar/tx-malformed" },
  ];
}

/** Topics and a value `transferEventOf` refuses before it needs @stellar/stellar-sdk: every refusal is one code. */
export function stellarEventInputs(): { case: string; topic: unknown; value: unknown }[] {
  return [
    { case: "two topics", topic: ["AAAA", "AAAA"], value: "AAAA" },
    { case: "a topic that is not a string", topic: ["AAAA", 7, "AAAA"], value: "AAAA" },
    { case: "a topic that is not base64", topic: ["AAAA", "AA=A", "AAAA"], value: "AAAA" },
    { case: "a topic over 1,024 characters", topic: ["AAAA", "AAAA", "A".repeat(1028)], value: "AAAA" },
    { case: "a value that is not base64", topic: ["AAAA", "AAAA", "AAAA"], value: "AA=A" },
  ];
}

/** A malformed H, which every x402 `build` checks first. */
export const BAD_H = "0x12";

/**
 * The code each x402 pairing's `build` gives an H that is not a valid ATR hash (refusals.md, `x402/payload-malformed`):
 * that one, except where the pairing documents its own.
 */
export function hCodeOf(id: string): string {
  const own: Record<string, string> = {
    "x402/batch-settlement/eip155": "x402/option-malformed",
    "x402/batch-settlement/cloudflare": "x402/legal-context-conflict",
    "x402/exact/ccd": "ccd/memo-not-lcp",
    "x402/exact/casper": "casper/payload-malformed",
    "x402/exact/lnbtc": "ln/no-metadata",
  };
  return own[id] ?? "x402/payload-malformed";
}

/**
 * Choices whose other fault each x402 `build` reaches only after H: no choice, a choice of another pairing's option
 * (Sui's, or the EIP-3009 vectors' for Sui), and one whose document is not x402 v2; with `own`, the pairing's own
 * option in a v2 document. With `BAD_H` each is `hCodeOf(id)`.
 */
export function hFirstChoices(id: string, own?: unknown): { case: string; choice: unknown }[] {
  const other = id === "x402/exact/sui" ? EVM.fixed.O : SUI.fixed.O;
  const resource = EVM.fixed.resource;
  return [
    { case: "no choice", choice: null },
    { case: "a choice of another pairing's option", choice: { required: { x402Version: 2, resource, accepts: [other] }, accepted: other } },
    { case: "a document that is not x402 v2", choice: { required: { x402Version: 1, resource, accepts: [other] }, accepted: other } },
    ...(own === undefined ? [] : [{ case: "the pairing's own option", choice: { required: { x402Version: 2, resource, accepts: [own] }, accepted: own } }]),
  ];
}

/** x402-exact-xrpl.json's V2 payment under `accepted`, its own option when none is given: bound gives V2's H. */
export function xrplPayment(accepted: unknown = XRPL.V2.accepted) {
  return { x402Version: 2, accepted, payload: { signedTxBlob: XRPL.V2.blob } };
}

/** x402-exact-xrpl.json's V2 payment under an option whose `invoiceId` is not an LCP string: `xrpl/carrier-not-lcp`. */
export function xrplPayments(): { case: string; payment: unknown }[] {
  const { invoiceId: _id, ...extra } = XRPL.V2.accepted.extra;
  const under = xrplPayment;
  return [
    { case: "an invoiceId that is not an LCP string", payment: under({ ...XRPL.V2.accepted, extra: { ...extra, invoiceId: "invoice-7" } }) },
    { case: "no invoiceId", payment: under({ ...XRPL.V2.accepted, extra }) },
  ];
}

/** The XRPL session's opening (XS2's blob) and its within challenge, as mpp-session-within.test.ts builds them. */
function xrplWithin(cumulativeAmount: unknown, action: unknown, blob: string = SESSION.XS2.blob) {
  const opening = { challenge: SESSION.SS1.xrpl.placed, payload: { action: "open", transaction: blob, amount: "100", signature: "00" } };
  return { challenge: { ...SESSION.SS1.xrpl.challenge, id: "seller-own-id" }, opening, cumulativeAmount, action };
}

/** A within input and H `mpp/session/xrpl`'s `buildWithin` builds a voucher from with the codec. */
export function xrplWithinValid() {
  return { within: xrplWithin(100n, "voucher"), h: SESSION.fixed.H as `0x${string}` };
}

/** A within input and H `mpp/session/xrpl`'s `buildWithin` refuses before it decodes the opening, which needs the codec. */
export function xrplWithinInputs(): { case: string; within: unknown; h: unknown; expect: string }[] {
  const H = SESSION.fixed.H;
  return [
    { case: "an H that is not a hash", within: xrplWithin(100n, "voucher"), h: BAD_H, expect: "mpp/id-not-ours" },
    { case: "an H that is not a string", within: xrplWithin(100n, "voucher"), h: undefined, expect: "mpp/id-not-ours" },
    { case: "a cumulative amount of 2^64", within: xrplWithin(2n ** 64n, "voucher"), h: H, expect: "mpp/input-malformed" },
    { case: "a cumulative amount below 0", within: xrplWithin(-1n, "voucher"), h: H, expect: "mpp/input-malformed" },
    { case: "a cumulative amount that is not a bigint", within: xrplWithin(100, "voucher"), h: H, expect: "mpp/input-malformed" },
    { case: "a topUp, which the XRPL draft does not define", within: xrplWithin(1n, "topUp"), h: H, expect: "mpp/session-action" },
  ];
}

/**
 * Inputs with two faults whose answer the order of `buildWithin`'s checks decides: H, the amount and the action are
 * checked before the opening is decoded, and the opening's binding to H after it.
 */
export function xrplWithinTwoFaults(): { case: string; within: unknown; h: unknown; expect: string }[] {
  const { H, H2 } = SESSION.fixed;
  return [
    { case: "an opening blob that is not hex, and an H that is not a hash", within: xrplWithin(100n, "voucher", "ZZ"), h: BAD_H, expect: "mpp/id-not-ours" },
    { case: "an opening blob that is not hex, and an amount of 2^64", within: xrplWithin(2n ** 64n, "voucher", "ZZ"), h: H, expect: "mpp/input-malformed" },
    { case: "an opening blob that is not hex, and a topUp", within: xrplWithin(1n, "topUp", "ZZ"), h: H, expect: "mpp/session-action" },
    { case: "an H the opening is not bound to, and an amount of 2^64", within: xrplWithin(2n ** 64n, "voucher"), h: H2, expect: "mpp/input-malformed" },
  ];
}
