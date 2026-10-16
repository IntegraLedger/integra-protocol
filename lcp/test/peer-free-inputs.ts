// Inputs a function answers before it needs its rail's optional peer, so it gives each the same code with the peer
// (peer-free-inputs.test.ts, failures-are-values.test.ts for muxedFor, and build-choices.test.ts for every x402 build)
// and without it (the rail's peer-missing test):
// - TON's and Sui's `recover`: a reader for another network or a ref recover cannot read, with nothing read; a read
//   that fails, finds nothing or answers out of the reader's form; the rail's own refusal of a transaction it finds;
//   and a body or bytes whose size, form, CRC32C, or tags read at fixed places refuse it before it decodes them with
//   the peer.
//   The vector files' recover rows are decoded: each gets the vectors' answer with the peer and `<rail>/peer-missing`
//   without it.
// - The decoders and carriers: `tvmCarrier`, `decodeSuiTx`, `nearCarrier`, `decodeStellarTx`, `transferEventTopics`
//   and `transferEventOf` on input whose network, size, base64, CRC32C or union tags they refuse; `avmCarrier` on every
//   input, as it needs no peer.
// - `mpp/charge/stellar`'s `build`: a choice, challenge, H, current ledger, clock, expiration ledger or simulated
//   transaction form it refuses. `x402/exact/near`'s `build`: a payer, key, nonce or height it refuses.
// - Every x402 `build`: a malformed H, which each checks first, before the choice and its document; then each choice
//   member the caller passes whose form needs neither the document nor the peer, before the document and the option.
// - x402 XRPL's `bound` and `reference`: an option whose `invoiceId` is not an LCP string, read before the blob.
// - `mpp/session/xrpl`'s `buildWithin`: an H, cumulative amount or action it refuses, before it decodes the opening.
// - x402 Algorand's `build`: a choice compared with its option (the genesis hash against the option's network, an
//   option the filter refuses), which needs no algosdk, as the option's and the payer's addresses do not.
// - `muxedFor`: every base and H, as it reads and writes a strkey without the SDK.
// - The Stellar pairings' `unplaced`, `issuedDigest` and MPP `advertise`, which read a muxed address without the SDK,
//   and the strkeys the x402 option filter, `advertise`, `read` and `build` read (`stellarStrkeyRows`).
// - `mpp/charge/stellar`'s `pairingsOf`, filter, `advertise`, `build` and `bound` of a `recipient` or `currency` strkey,
//   read whole (`stellarChargeStrkeyRows`).
// - `stellarLocate`'s search, which decodes only a candidate's transaction that succeeded (`stellarLocateRows`).
// - Each `status` of a rail with an optional peer that reads with it (`suiStatusRows`, `tvmStatusRows`,
//   `stellarStatusRows`): the same answer after the same reads, except a read that reaches a step that decodes with
//   the peer (`without`).
// - Each x402 TON function, `x402/exact/sui`'s `build` and its `complete`, `mpp/charge/solana`'s `build`, and the
//   Stellar pairings' `bound` and `reference` (`tvmPeerStepRows`, `suiPeerStepRows`, `solanaChargeBlockhashRows`,
//   `stellarCarrierRows`): the same answer, except a call that reaches the step that decodes or writes with the peer
//   (`without`).
import { readFileSync } from "node:fs";
import { blake2b } from "@noble/hashes/blake2.js";
import { base32, base58 } from "@scure/base";

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
const TRON = vector("x402-exact-tron-lcp-trc20-memo.json");
const CASPER = vector("x402-exact-casper.json");
const SOLANA = vector("x402-exact-solana.json");

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
    { case: "a body whose CRC32C does not match", ref: TON_REF, reader: read(tonTx(bytes(crcChanged(TVM.V1.expectBoc)))), expect: "tvm/unreadable", reads: 1 },
  ];
}

/** A BoC with the last byte of its CRC32C changed: its layout holds, and its checksum does not. */
function crcChanged(boc: string): string {
  const b = bytes(boc);
  b[b.length - 1] = b[b.length - 1]! ^ 1;
  return b64(b);
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
    { case: "V2's settlement BoC with its CRC32C changed", boc: crcChanged(TVM.V2.expectSettlementBoc), network: TON_NETWORK, expect: "tvm/boc-malformed" },
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
 * A choice and H `mpp/charge/stellar`'s `build` refuses with the code given, before it reads the transaction: the
 * payer's strkey, the expiration ledger and the simulated transaction's form (`signingInput`) among them, and the
 * recipient, whose strkey the pairing's filter reads whole and whose muxed id `build` reads after the simulated
 * transaction's form. The fee bump wraps V2's simulated envelope whole.
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
    { case: "a recipient that is not a muxed address", choice: { ...choice, challenge: withRecipient(choice.challenge, issuedRecipient()) }, h, expect: "stellar/carrier-mismatch" },
    { case: "a recipient whose M strkey's checksum does not match", choice: { ...choice, challenge: withRecipient(choice.challenge, badChecksum(recipientOf(choice.challenge))) }, h, expect: "stellar/option-malformed" },
    { case: "a payer of null", choice: { ...choice, payer: null }, h, expect: "stellar/payer-mismatch" },
    { case: "a payer that is not a strkey", choice: { ...choice, payer: "x" }, h, expect: "stellar/payer-mismatch" },
    { case: "a payer whose G strkey's checksum does not match", choice: { ...choice, payer: badChecksum(choice.payer) }, h, expect: "stellar/payer-mismatch" },
    {
      case: "two faults: a payer that is not a strkey, and a simulated transaction that is not base64",
      choice: { ...choice, payer: "x", simulatedXdr: "AA=A" },
      h,
      expect: "stellar/payer-mismatch",
    },
  ];
}

const requestOf = (c: { request: string }) => JSON.parse(Buffer.from(c.request, "base64url").toString("utf8"));
const recipientOf = (c: { request: string }): string => requestOf(c).recipient;
/** The issued challenge's `recipient`: the base `G…` account the vectors' placement muxes. */
const issuedRecipient = (): string => recipientOf(CHARGE.challenge);
/** The challenge with its request's `recipient` replaced, the request re-encoded as base64url of its JSON. */
function withRecipient<C extends { request: string }>(c: C, recipient: string): C {
  return { ...c, request: Buffer.from(JSON.stringify({ ...requestOf(c), recipient }), "utf8").toString("base64url") };
}
/** A strkey with one character in its payload changed, so that its checksum does not match. */
const badChecksum = (s: string) => s.slice(0, 10) + (s[10] === "A" ? "B" : "A") + s.slice(11);

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

/** A malformed value of one choice member, and the code `build` gives it. */
interface BadMember {
  case: string;
  member: string;
  value: unknown;
  expect: string;
}

/** The Token program, one of the two an x402 Solana choice may name. */
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

/**
 * Each x402 pairing whose `build` reads members of the choice beyond its document and option, with those members in
 * their own form and malformed values of each. `build` checks each member's form after H and before the document and
 * the option; the form needs neither of those nor the rail's peer, so each value gets its code whatever the document
 * holds. A member compared with the option (a timeout sum, a fee payer, a token program, a transfer method) or read
 * with the peer is checked after the option, and is not here.
 */
export function choiceMembers(): { id: string; members: Record<string, unknown>; bad: BadMember[] }[] {
  const malformed = "x402/option-malformed";
  const evm: Record<string, unknown> = { from: `0x${"11".repeat(20)}`, now: 1_790_000_000 };
  const evmBad: BadMember[] = [
    { case: "a from of one byte", member: "from", value: "0x12", expect: malformed },
    { case: "a now below 0", member: "now", value: -1, expect: malformed },
  ];
  const svm: Record<string, unknown> = { payer: SOLANA.fixed.payer, tokenProgram: TOKEN, recentBlockhash: SOLANA.fixed.blockhash };
  const svmBad = (more: BadMember[]): BadMember[] =>
    [
      { case: "a payer that is not a key", member: "payer", value: "x" },
      { case: "a token program that is neither Token's nor Token-2022's", member: "tokenProgram", value: SOLANA.fixed.payer },
      { case: "a recent blockhash that is not a string", member: "recentBlockhash", value: 7 },
      { case: "a compute unit limit of 2^32", member: "computeUnitLimit", value: 2 ** 32 },
      { case: "a compute unit price below 0", member: "computeUnitPrice", value: -1n },
    ]
      .map((b) => ({ ...b, expect: "svm/input-malformed" }))
      .concat(more);
  const params = AVM.fixed.params;
  const avmParams = {
    firstValid: BigInt(params.firstValid),
    minFee: BigInt(params.minFee),
    feePerByte: BigInt(params.feePerByte),
    genesisId: params.genesisId,
    genesisHash: params.genesisHash,
  };
  const { choice: near } = nearChoice();
  return [
    ...[
      "x402/exact/eip155/eip3009",
      "x402/exact/eip155/permit2",
      "x402/upto/eip155/permit2",
      "x402/exact/eip155/erc7710",
      "x402/exact/eip155/erc7710-salt",
      "x402/auth-capture/eip155/eip3009",
      "x402/auth-capture/eip155/permit2",
    ].map((id) => ({ id, members: evm, bad: evmBad })),
    {
      id: "x402/batch-settlement/eip155",
      members: { ...evm, payerAuthorizer: `0x${"22".repeat(20)}`, authSalt: `0x${"33".repeat(32)}`, deposit: 1n },
      bad: [
        ...evmBad,
        { case: "a payer authorizer that is not an address", member: "payerAuthorizer", value: 7, expect: malformed },
        { case: "an auth salt of one byte", member: "authSalt", value: "0x12", expect: malformed },
        { case: "a deposit of 0", member: "deposit", value: 0n, expect: malformed },
      ],
    },
    {
      id: "x402/exact/near",
      members: { payer: near.payer, publicKey: near.publicKey, accessKeyNonce: near.accessKeyNonce, finalHeight: near.finalHeight },
      bad: [
        { case: "a payer that is not an account id", member: "payer", value: "A", expect: malformed },
        { case: "a public key that is not one", member: "publicKey", value: "ed25519:0", expect: malformed },
        { case: "an access key nonce below 0", member: "accessKeyNonce", value: -1n, expect: malformed },
        { case: "a final height of 2^64", member: "finalHeight", value: 2n ** 64n, expect: malformed },
      ],
    },
    {
      id: "x402/exact/tvm",
      members: {
        wallet: TVM.fixed.wallet,
        walletId: TVM.fixed.walletId,
        seqno: TVM.fixed.seqno,
        jettonWallet: TVM.fixed.jettonWallet,
        attachNanotons: BigInt(TVM.fixed.attachNanotons),
        now: TVM.fixed.now,
      },
      bad: [
        { case: "a wallet that is not a raw address", member: "wallet", value: "0:12", expect: malformed },
        { case: "a Jetton wallet on workchain 128", member: "jettonWallet", value: `128:${"11".repeat(32)}`, expect: malformed },
        { case: "a walletId of 2^32", member: "walletId", value: 2 ** 32, expect: malformed },
        { case: "a seqno below 0", member: "seqno", value: -1, expect: malformed },
        { case: "a now that is not an integer", member: "now", value: 1.5, expect: malformed },
        { case: "an attached value of 2^120 nanotons", member: "attachNanotons", value: 2n ** 120n, expect: malformed },
        { case: "a state init that is not base64", member: "stateInit", value: "AA=A", expect: "tvm/boc-malformed" },
      ],
    },
    {
      id: "x402/exact/algorand",
      members: { payer: AVM.fixed.payer, params: avmParams },
      bad: [
        { case: "a payer of one character", member: "payer", value: "A", expect: "avm/option-malformed" },
        { case: "a payer whose checksum does not match", member: "payer", value: badChecksum(AVM.fixed.payer), expect: "avm/option-malformed" },
        { case: "a payer in lowercase", member: "payer", value: AVM.fixed.payer.toLowerCase(), expect: "avm/option-malformed" },
        { case: "no suggested parameters", member: "params", value: null, expect: "avm/option-malformed" },
        { case: "a first valid round below 0", member: "params", value: { ...avmParams, firstValid: -1n }, expect: "avm/option-malformed" },
        { case: "a genesis id holding a lone surrogate", member: "params", value: { ...avmParams, genesisId: "\uD800" }, expect: "avm/option-malformed" },
        { case: "a genesis hash of 2 bytes", member: "params", value: { ...avmParams, genesisHash: "AAA=" }, expect: "avm/network-mismatch" },
      ],
    },
    {
      id: "x402/exact/stellar",
      members: { currentLedger: STELLAR.V2.currentLedger, payer: STELLAR.fixed.payer },
      bad: [
        { case: "a current ledger below 0", member: "currentLedger", value: -1, expect: "stellar/tx-malformed" },
        { case: "a current ledger that is not an integer", member: "currentLedger", value: 1.5, expect: "stellar/tx-malformed" },
        { case: "a payer of null", member: "payer", value: null, expect: "stellar/payer-mismatch" },
        { case: "a payer that is not a strkey", member: "payer", value: "x", expect: "stellar/payer-mismatch" },
        { case: "a payer whose G strkey's checksum does not match", member: "payer", value: badChecksum(STELLAR.fixed.payer), expect: "stellar/payer-mismatch" },
      ],
    },
    {
      id: "x402/exact/starknet",
      members: { from: "0x1", now: 1_790_000_000 },
      bad: [
        { case: "a from that is not a felt", member: "from", value: "0xZZ", expect: "starknet/felt-malformed" },
        { case: "a now below 0", member: "now", value: -1, expect: "starknet/option-malformed" },
      ],
    },
    {
      id: "x402/exact/tron/lcp-trc20-memo",
      members: {
        payer: TRON.fixed.payer,
        feeLimit: BigInt(TRON.fixed.feeLimit),
        refBlock: { number: BigInt(TRON.fixed.refBlock.number), id: TRON.fixed.refBlock.id },
        now: BigInt(TRON.fixed.now),
      },
      bad: [
        { case: "a payer that is not an address", member: "payer", value: "T", expect: "tron/address-malformed" },
        { case: "a fee limit of 0", member: "feeLimit", value: 0n, expect: "tron/fee-limit" },
        { case: "no reference block", member: "refBlock", value: null, expect: "tron/tx-malformed" },
        { case: "a reference block id of one byte", member: "refBlock", value: { number: 1n, id: "0x12" }, expect: "tron/tx-malformed" },
        { case: "a now of 0", member: "now", value: 0n, expect: "tron/tx-malformed" },
      ],
    },
    {
      id: "x402/exact/hedera",
      members: { payer: "0.0.1001", node: "0.0.3", validStart: { seconds: 1_790_000_000n, nanos: 0 }, maxFee: 100_000_000n },
      bad: [
        { case: "a payer that is not an entity id", member: "payer", value: "1001", expect: "hedera/option-malformed" },
        { case: "a node that is not an entity id", member: "node", value: 3, expect: "hedera/option-malformed" },
        { case: "a valid start of 10^9 nanoseconds", member: "validStart", value: { seconds: 0n, nanos: 1_000_000_000 }, expect: "hedera/option-malformed" },
        { case: "a maximum fee below 0", member: "maxFee", value: -1n, expect: "hedera/option-malformed" },
        { case: "decimals below 0", member: "decimals", value: -1, expect: "hedera/option-malformed" },
      ],
    },
    {
      id: "x402/exact/hedera/transfer-executor",
      members: { now: 1_790_000_000 },
      bad: [{ case: "a now below 0", member: "now", value: -1, expect: "hedera/option-malformed" }],
    },
    {
      id: "x402/exact/casper",
      members: { from: CASPER.fixed.from, now: CASPER.fixed.now },
      bad: [
        { case: "a from that is not an address", member: "from", value: "00", expect: "casper/address-malformed" },
        { case: "a now below 0", member: "now", value: -1, expect: "casper/option-malformed" },
      ],
    },
    {
      id: "x402/exact/ccd",
      members: { now: 1_790_000_000 },
      bad: [{ case: "a now below 0", member: "now", value: -1, expect: "ccd/option-malformed" }],
    },
    {
      id: "x402/exact/xrpl",
      members: { account: XRPL.V2.build.account, fee: XRPL.V2.build.fee, lastLedgerSequence: XRPL.V2.build.lastLedgerSequence },
      bad: [
        { case: "an account that is not a string", member: "account", value: 7, expect: malformed },
        { case: "a fee that is not drops", member: "fee", value: "1.5", expect: malformed },
        { case: "a last ledger sequence of 2^32", member: "lastLedgerSequence", value: 2 ** 32, expect: malformed },
      ],
    },
    {
      id: "x402/exact/solana",
      members: { ...svm, decimals: SOLANA.fixed.decimals },
      bad: svmBad([{ case: "decimals of 256", member: "decimals", value: 256, expect: "svm/input-malformed" }]),
    },
    {
      id: "x402/upto/solana",
      members: { ...svm, nonce: 1n, openSlot: 1n, now: 1_790_000_000 },
      bad: svmBad([
        { case: "a nonce of 2^64", member: "nonce", value: 2n ** 64n, expect: "svm/input-malformed" },
        { case: "an openSlot of 2^53", member: "openSlot", value: 2n ** 53n, expect: "svm/input-malformed" },
        { case: "a now below 0", member: "now", value: -1, expect: "svm/input-malformed" },
      ]),
    },
    {
      id: "x402/batch-settlement/solana",
      members: { ...svm, deposit: 1n, payerAuthorizer: SOLANA.fixed.payer, salt: 1n, openSlot: 1n },
      bad: svmBad([
        { case: "a deposit of 0", member: "deposit", value: 0n, expect: "svm/input-malformed" },
        { case: "a payer authorizer that is not a key", member: "payerAuthorizer", value: "x", expect: "svm/input-malformed" },
        { case: "a salt below 0", member: "salt", value: -1n, expect: "svm/input-malformed" },
        { case: "an openSlot of 2^53", member: "openSlot", value: 2n ** 53n, expect: "svm/input-malformed" },
      ]),
    },
  ];
}

/** The choice members of x402 pairing `id` in their own form (`choiceMembers`); none for a pairing that reads none. */
export function membersOf(id: string): Record<string, unknown> {
  return choiceMembers().find((m) => m.id === id)?.members ?? {};
}

/**
 * Choices with one malformed member, which each x402 `build` reaches after H and before the document: each malformed
 * value of `choiceMembers`, under another pairing's option and under a document that is not x402 v2, and, with `own`,
 * under the pairing's own option in a v2 document. Each is the member's code, with the rail's peer and without it.
 */
export function memberFirstChoices(id: string, own?: unknown): { case: string; choice: unknown; expect: string }[] {
  const p = choiceMembers().find((m) => m.id === id);
  if (p === undefined) return [];
  const documents = hFirstChoices(id, own).filter((r) => r.choice !== null);
  return p.bad.flatMap((b) =>
    documents.map((d) => ({
      case: `${b.case}, with ${d.case}`,
      choice: { ...(d.choice as object), ...p.members, [b.member]: b.value },
      expect: b.expect,
    })),
  );
}

/**
 * Options and challenges the Stellar pairings' `unplaced` answers, and the answer: it reads a muxed `payTo` or
 * `recipient` without the SDK, so each answer is the same with it and without it.
 */
export function stellarUnplacedRows(): { case: string; pairing: "x402/exact/stellar" | "mpp/charge/stellar"; option: unknown; expect: unknown }[] {
  const placed = CHARGE.place.expect;
  const muxedPayTo = STELLAR.V3.accepted;
  return [
    { case: "an option whose payTo is muxed", pairing: "x402/exact/stellar", option: muxedPayTo, expect: { ...muxedPayTo, payTo: STELLAR.fixed.seller } },
    { case: "an option whose payTo is an account", pairing: "x402/exact/stellar", option: STELLAR.fixed.option, expect: STELLAR.fixed.option },
    { case: "an option whose payTo's checksum does not match", pairing: "x402/exact/stellar", option: { ...muxedPayTo, payTo: badChecksum(muxedPayTo.payTo) }, expect: { ...muxedPayTo, payTo: badChecksum(muxedPayTo.payTo) } },
    { case: "an option that carries a refused member", pairing: "x402/exact/stellar", option: { ...muxedPayTo, refused: true }, expect: { refused: true, code: "x402/option-malformed" } },
    { case: "a placed challenge", pairing: "mpp/charge/stellar", option: placed, expect: { ...placed, request: CHARGE.challenge.request } },
    { case: "an issued challenge", pairing: "mpp/charge/stellar", option: CHARGE.challenge, expect: CHARGE.challenge },
    { case: "a challenge that carries a refused member", pairing: "mpp/charge/stellar", option: { ...placed, refused: true }, expect: { refused: true, code: "mpp/challenge-malformed" } },
  ];
}

/**
 * Challenges whose `issuedDigest` the vectors give, muxed recipients among them: the issued challenge, the placed one,
 * and the placed one echoed with the payer's muxed account. The digest is the same with the SDK and without it.
 */
export function stellarDigestRows(): { case: string; challenge: unknown; expect: string }[] {
  const D = CHARGE.issuedDigest;
  const placed = CHARGE.place.expect;
  return [
    { case: "the issued challenge", challenge: CHARGE.challenge, expect: D.expectIssued },
    { case: "the placed challenge, whose recipient is the seller's muxed account", challenge: placed, expect: D.expectIssued },
    { case: "the placed challenge echoed with the payer's muxed account", challenge: { ...placed, request: D.echoedRequest }, expect: D.expectEchoed },
  ];
}

/** A challenge MPP Stellar's `advertise` refuses: one whose recipient is a muxed address. It needs no SDK. */
export function stellarOccupied(): { challenge: unknown; h: `0x${string}`; link: string; expect: string } {
  const challenge = withRecipient(CHARGE.challenge, recipientOf(CHARGE.place.expect));
  return { challenge, h: CHARGE.fixed.H, link: CHARGE.fixed.link, expect: CHARGE.occupied.expect };
}

/**
 * Choices of x402 Algorand's own document that `build` refuses after the document and the option, with the code given:
 * a genesis hash of another network, and each option of x402-exact-algorand.json's `options`, which the filter refuses.
 * None needs algosdk.
 */
export function avmComparedChoices(): { case: string; choice: unknown; expect: string }[] {
  const params = choiceMembers().find((m) => m.id === "x402/exact/algorand")!.members;
  const choiceOf = (o: unknown) => ({ required: { x402Version: 2, resource: AVM.fixed.resource, accepts: [o] }, accepted: o, ...params });
  return [
    {
      case: "a genesis hash of another network",
      choice: { ...choiceOf(AVM.fixed.O), params: { ...(params["params"] as object), genesisHash: b64(zeros(32)) } },
      expect: "avm/network-mismatch",
    },
    ...(AVM.options as { case: string; option: unknown; expect: string }[]).map((r) => ({ case: `an option with ${r.case}`, choice: choiceOf(r.option), expect: r.expect })),
  ];
}

/** A strkey of `version` and `payload`, its checksum's low byte XORed with `flip`: SEP-23's base32 and CRC16-XModem. */
function strkey(version: number, payload: Uint8Array, flip = 0): string {
  const body = Uint8Array.from([version, ...payload]);
  let crc = 0;
  for (const b of body) {
    for (let bit = 7; bit >= 0; bit--) {
      const top = ((crc >> 15) & 1) ^ ((b >> bit) & 1);
      crc = (crc << 1) & 0xffff;
      if (top) crc ^= 0x1021;
    }
  }
  crc ^= flip;
  return base32.encode(Uint8Array.from([...body, crc & 0xff, crc >> 8])).replace(/=+$/, "");
}

/**
 * Strkeys in the places the Stellar pairings read one, and each answer, which needs no SDK: `isAccount`, `isContract`,
 * `muxedFor` of the strkey and H, and x402's `read`, `advertise` and `build` of the fixed option with its `payTo` (or,
 * for `asset`, its asset) replaced by the strkey. `read` is "served" or a code, `advertise` the placed `payTo` or a
 * code, and `build` the code of a choice of V2's simulated transaction under that option, or null for the one row whose
 * choice reaches the transaction, which only the SDK reads. A strkey that is not an account or a muxed account in
 * `payTo`, or not a contract in `asset`, makes the option another pairing's.
 */
export function stellarStrkeyRows(): {
  case: string;
  s: unknown;
  member: "payTo" | "asset";
  isAccount: boolean;
  isContract: boolean;
  muxedFor: string;
  read: string;
  advertise: string;
  build: string | null;
}[] {
  const { seller, asset } = STELLAR.fixed;
  const key = base32.decode(seller).subarray(1, 33);
  const M = STELLAR.V1.M;
  const notThis = { muxedFor: "stellar/option-malformed", read: "x402/no-payable-option", advertise: "x402/option-not-this-pairing", build: "x402/option-not-this-pairing" };
  const neither = { isAccount: false, isContract: false, ...notThis };
  const payTo = "payTo" as const;
  const inAsset = "asset" as const;
  return [
    { case: "the seller's account", s: seller, member: payTo, isAccount: true, isContract: false, muxedFor: M, read: "served", advertise: M, build: "stellar/carrier-mismatch" },
    { case: "the seller's account muxed with H", s: M, member: payTo, isAccount: false, isContract: false, muxedFor: "stellar/option-malformed", read: "served", advertise: "stellar/carrier-occupied", build: null },
    {
      case: "the seller's account muxed with the id 0",
      s: strkey(12 << 3, Uint8Array.from([...key, ...zeros(8)])),
      member: payTo,
      isAccount: false,
      isContract: false,
      muxedFor: "stellar/option-malformed",
      read: "served",
      advertise: "stellar/carrier-occupied",
      build: "stellar/carrier-mismatch",
    },
    { case: "the asset's contract", s: asset, member: inAsset, isAccount: false, isContract: true, muxedFor: "stellar/option-malformed", read: "served", advertise: M, build: "stellar/carrier-mismatch" },
    { case: "a contract as payTo", s: asset, member: payTo, isAccount: false, isContract: true, ...notThis },
    { case: "an account as asset", s: seller, member: inAsset, isAccount: true, isContract: false, ...notThis, muxedFor: M },
    { case: "an account whose checksum does not match", s: strkey(6 << 3, key, 1), member: payTo, ...neither },
    { case: "an account whose checksum's high byte does not match", s: strkey(6 << 3, key, 0x100), member: payTo, ...neither },
    { case: "a signed payload's version byte at an account's length", s: strkey(15 << 3, key), member: payTo, ...neither },
    { case: "an account one character short", s: seller.slice(0, -1), member: payTo, ...neither },
    { case: "an account one character more", s: `${seller}A`, member: payTo, ...neither },
    { case: "an account followed by padding", s: `${seller}====`, member: payTo, ...neither },
    { case: "a padding character in place of an account's last", s: `${seller.slice(0, -1)}=`, member: payTo, ...neither },
    { case: "an account in lowercase", s: seller.toLowerCase(), member: payTo, ...neither },
    { case: "a muxed account whose checksum does not match", s: strkey(12 << 3, Uint8Array.from([...key, ...zeros(8)]), 1), member: payTo, ...neither },
    { case: "an empty text", s: "", member: payTo, ...neither },
    { case: "a contract whose checksum does not match", s: strkey(2 << 3, key, 1), member: inAsset, ...neither },
    { case: "a contract one character short", s: asset.slice(0, -1), member: inAsset, ...neither },
    { case: "a contract followed by padding", s: `${asset}====`, member: inAsset, ...neither },
    { case: "a contract in lowercase", s: asset.toLowerCase(), member: inAsset, ...neither },
  ];
}

type StrkeyRow = ReturnType<typeof stellarStrkeyRows>[number];
type Answer = unknown;

/**
 * The answers a `stellarStrkeyRows` row states, given by the functions passed: each test file passes the ones it
 * imports, with the SDK or without it. A refusal is its code; `read` is "served" when it offers the option alone, and
 * `advertise` the placed `payTo` when the placed option is the offer with only its `payTo` changed.
 */
export async function stellarStrkeyAnswers(
  row: StrkeyRow,
  f: {
    isAccount: (s: unknown) => boolean;
    isContract: (s: unknown) => boolean;
    muxedFor: (base: never, h: never) => Answer;
    read: (doc: never) => Answer;
    advertise: (doc: never, h: never, link: string, offer: never) => Answer;
    build: (choice: never, h: never) => Promise<Answer>;
  },
): Promise<Omit<StrkeyRow, "s" | "member">> {
  const { H, resource, link, option, payer } = STELLAR.fixed;
  const o = { ...option, [row.member]: row.s };
  const required = { x402Version: 2, resource, accepts: [o] };
  const code = (r: Answer) => (typeof r === "object" && r !== null && "refused" in r ? (r as unknown as { code: string }).code : r);
  const read = f.read({ ...required, extensions: STELLAR.V3.extensions } as never) as Answer;
  const offered = (r: Answer) => (r as { h: string; offer: { options: unknown[] } });
  const served = typeof code(read) === "string" ? code(read) : offered(read).h === H && JSON.stringify(offered(read).offer.options) === JSON.stringify([o]) ? "served" : read;
  const placed = f.advertise(required as never, H as never, link, o as never) as Answer;
  const placedOption = typeof code(placed) === "string" ? null : (placed as { accepts: Record<string, unknown>[] }).accepts[0]!;
  const advertise = placedOption === null ? code(placed) : JSON.stringify({ ...placedOption, payTo: o.payTo }) === JSON.stringify(o) ? placedOption["payTo"] : placed;
  const choice = { required, accepted: o, simulatedXdr: STELLAR.V2.simulatedXdr, currentLedger: STELLAR.V2.currentLedger, payer };
  return {
    case: row.case,
    isAccount: f.isAccount(row.s),
    isContract: f.isContract(row.s),
    muxedFor: code(f.muxedFor(row.s as never, H as never)) as string,
    read: served as string,
    advertise: advertise as string,
    build: row.build === null ? null : (code(await f.build(choice as never, H as never)) as string),
  };
}

/** The challenge with its request's `member` replaced, the request re-encoded as base64url of its JSON. */
function withRequestMember<C extends { request: string }>(c: C, member: string, value: unknown): C {
  return { ...c, request: Buffer.from(JSON.stringify({ ...requestOf(c), [member]: value }), "utf8").toString("base64url") };
}

/**
 * Strkeys in the two places `mpp/charge/stellar` reads one, the request's `recipient` and `currency`, and each answer,
 * which needs no SDK: `pairingsOf` of the issued challenge holding the strkey (the pairings, or a code), the filter
 * (`pairingsOfPlaced`) of the placed challenge holding it, `advertise` of the issued challenge (the placed `recipient`,
 * or a code), and `build` and `bound` under the placed challenge holding it, with x402-exact-stellar.json's V2 simulated
 * transaction and V3's envelope: a code, or null where the call reaches the transaction, which only the SDK reads
 * (without it, `stellar/peer-missing`). A strkey whose checksum does not match is refused as one of another form is.
 */
export function stellarChargeStrkeyRows(): {
  case: string;
  member: "recipient" | "currency";
  s: string;
  pairingsOf: readonly string[] | string;
  filter: readonly string[];
  advertise: string;
  build: string | null;
  bound: string | null;
}[] {
  const { recipient, currency } = CHARGE.fixed.request as { recipient: string; currency: string };
  const muxed: string = CHARGE.fixed.muxed;
  const key = base32.decode(recipient).subarray(1, 33);
  const id = base32.decode(currency).subarray(1, 33);
  const muxedRaw = base32.decode(`${muxed}===`).subarray(1, 41);
  const offered = { pairingsOf: ["mpp/charge/stellar"], filter: ["mpp/charge/stellar"] };
  const refused = { pairingsOf: "stellar/option-malformed", filter: [], advertise: "stellar/option-malformed", build: "stellar/option-malformed", bound: "stellar/option-malformed" };
  const to = "recipient" as const;
  const asset = "currency" as const;
  return [
    { case: "the seller's account", member: to, s: recipient, ...offered, advertise: muxed, build: "stellar/carrier-mismatch", bound: "stellar/carrier-mismatch" },
    { case: "the seller's account muxed with H", member: to, s: muxed, ...offered, advertise: "stellar/carrier-occupied", build: null, bound: null },
    { case: "the asset's contract", member: asset, s: currency, ...offered, advertise: muxed, build: null, bound: null },
    { case: "an account whose checksum does not match", member: to, s: strkey(6 << 3, key, 1), ...refused },
    { case: "an account whose checksum's high byte does not match", member: to, s: strkey(6 << 3, key, 0x100), ...refused },
    { case: "the seller's account with a payload character changed", member: to, s: badChecksum(recipient), ...refused },
    { case: "a muxed account whose checksum does not match", member: to, s: strkey(12 << 3, muxedRaw, 1), ...refused },
    { case: "a muxed account whose checksum's high byte does not match", member: to, s: strkey(12 << 3, muxedRaw, 0x100), ...refused },
    { case: "the seller's muxed account with a payload character changed", member: to, s: badChecksum(muxed), ...refused },
    { case: "a contract as recipient", member: to, s: currency, ...refused },
    { case: "a contract whose checksum does not match", member: asset, s: strkey(2 << 3, id, 1), ...refused },
    { case: "a contract whose checksum's high byte does not match", member: asset, s: strkey(2 << 3, id, 0x100), ...refused },
    { case: "the asset's contract with a payload character changed", member: asset, s: badChecksum(currency), ...refused },
    { case: "an account as currency", member: asset, s: recipient, ...refused },
  ];
}

type ChargeStrkeyRow = ReturnType<typeof stellarChargeStrkeyRows>[number];

/**
 * The answers a `stellarChargeStrkeyRows` row states, given by the functions passed: each test file passes the ones it
 * imports, with the SDK or without it. A refusal is its code. `build` and `bound` are called for a row that states
 * null only when `reached` is given, and then answer it (without the SDK, `stellar/peer-missing`).
 */
export async function stellarChargeStrkeyAnswers(
  row: ChargeStrkeyRow,
  f: {
    pairingsOf: (c: never) => Answer;
    pairingsOfPlaced: (c: never) => Answer;
    advertise: (doc: never, h: never, link: string, offer: never) => Answer;
    build: (choice: never, h: never) => Promise<Answer>;
    bound: (credential: never) => Promise<Answer>;
  },
  reached: string | null,
): Promise<Omit<ChargeStrkeyRow, "s" | "member">> {
  const { H, link } = CHARGE.fixed;
  const code = (r: Answer) => (typeof r === "object" && r !== null && "refused" in r ? (r as unknown as { code: string }).code : r);
  const issued = withRequestMember(CHARGE.challenge, row.member, row.s);
  const placed = withRequestMember(CHARGE.place.expect, row.member, row.s);
  const advertised = f.advertise([issued] as never, H as never, link, issued as never);
  const { choice } = stellarChargeChoice();
  const call = async (stated: string | null, answer: () => Promise<Answer>) =>
    stated === null && reached === null ? null : (code(await answer()) as string);
  return {
    case: row.case,
    pairingsOf: code(f.pairingsOf(issued as never)) as readonly string[] | string,
    filter: f.pairingsOfPlaced(placed as never) as readonly string[],
    advertise: (Array.isArray(advertised) ? recipientOf(advertised[0]) : code(advertised)) as string,
    build: await call(row.build, () => f.build({ ...choice, challenge: placed } as never, H as never)),
    bound: await call(row.bound, () => f.bound({ challenge: placed, payload: { type: "transaction", transaction: CHARGE.V3.envelope } } as never)),
  };
}

/**
 * Searches `stellarLocate` makes for x402-exact-stellar.json's V5 ref, each through a reader whose calls are counted,
 * and its answer and calls with @stellar/stellar-sdk. A search that lists a candidate the ref's `toId` names reads its
 * transaction; only one that succeeded is decoded (`decodes`), which needs the SDK: without it that search is
 * incomplete after the same calls. Every other search gives the same answer, after the same calls, without the SDK.
 */
export function stellarLocateRows(): {
  case: string;
  reader: () => { reader: unknown; calls: () => number };
  expect: { found?: string; complete: boolean };
  calls: number;
  decodes: boolean;
}[] {
  const ref = STELLAR.V5.ref as { network: string; fromLedger: number; expiration: number; toId: string };
  const candidate = "bb".repeat(32);
  type Page = { events: { txHash: string; toMuxedId: bigint }[]; complete: boolean; oldestLedger: number; latestLedger: number; cursor?: string };
  const page = (p: Partial<Page> = {}): Page => ({ events: [], complete: true, oldestLedger: ref.fromLedger, latestLedger: ref.expiration + 1, ...p });
  const listed = [{ txHash: candidate, toMuxedId: BigInt(ref.toId) }];
  /** A reader whose `transfers` answers each page in turn (a function throws) and whose `transaction` answers `tx`. */
  const readerOf = (pages: (Page | (() => never))[], tx?: () => unknown) => () => {
    let calls = 0;
    let at = 0;
    const reader = {
      network: ref.network,
      transfers: async () => {
        calls++;
        const p = pages[at++]!;
        return typeof p === "function" ? p() : p;
      },
      transaction: async () => {
        calls++;
        if (tx === undefined) throw new Error("no transaction is read");
        return tx();
      },
      latestLedger: async () => (calls++, ref.expiration + 1),
    };
    return { reader, calls: () => calls };
  };
  const fails = (): never => {
    throw new Error("transport");
  };
  const succeeded = (envelopeXdr: string) => () => ({ status: "SUCCESS", envelopeXdr, ledger: 995, oldestLedger: 1 });
  return [
    { case: "a search that lists no transfer, with every ledger held", reader: readerOf([page()]), expect: { complete: true }, calls: 1, decodes: false },
    { case: "a search through the expiration ledger itself", reader: readerOf([page({ latestLedger: ref.expiration })]), expect: { complete: true }, calls: 1, decodes: false },
    { case: "two pages that list no transfer", reader: readerOf([page({ cursor: "c1" }), page()]), expect: { complete: true }, calls: 2, decodes: false },
    { case: "a transfer whose muxed id is another", reader: readerOf([page({ events: [{ txHash: candidate, toMuxedId: BigInt(ref.toId) + 1n }] })]), expect: { complete: true }, calls: 1, decodes: false },
    { case: "events the RPC reports disabled", reader: readerOf([page({ complete: false })]), expect: { complete: false }, calls: 1, decodes: false },
    { case: "an RPC whose oldest ledger is above fromLedger", reader: readerOf([page({ oldestLedger: ref.fromLedger + 1 })]), expect: { complete: false }, calls: 1, decodes: false },
    { case: "an events index below the expiration ledger", reader: readerOf([page({ latestLedger: ref.expiration - 1 })]), expect: { complete: false }, calls: 1, decodes: false },
    { case: "an events read that fails", reader: readerOf([fails]), expect: { complete: false }, calls: 1, decodes: false },
    { case: "a candidate whose transaction is not found", reader: readerOf([page({ events: listed })], () => ({ status: "NOT_FOUND", oldestLedger: 1 })), expect: { complete: false }, calls: 2, decodes: false },
    { case: "a candidate whose transaction failed", reader: readerOf([page({ events: listed })], () => ({ status: "FAILED", ledger: 995, oldestLedger: 1 })), expect: { complete: true }, calls: 2, decodes: false },
    { case: "a candidate whose transaction read fails", reader: readerOf([page({ events: listed })], fails), expect: { complete: false }, calls: 2, decodes: false },
    { case: "a candidate that succeeded with the ref's entry", reader: readerOf([page({ events: listed })], succeeded(STELLAR.V5.rebuilt.envelope)), expect: { found: candidate, complete: true }, calls: 2, decodes: true },
    { case: "a candidate that succeeded with another entry", reader: readerOf([page({ events: listed })], succeeded(STELLAR.plant.envelope)), expect: { complete: true }, calls: 2, decodes: true },
  ];
}

/**
 * A `status` read with the rail's peer: its answer after the reads given. `without` is the answer and the reads
 * without the peer for a read that reaches a step that decodes with it; every other read gives the same answer, after
 * the same reads, without the peer.
 */
export interface StatusRow {
  case: string;
  ref: unknown;
  reader: () => Counted;
  expect: unknown;
  reads: number;
  without?: { expect: unknown; reads: number };
}

/** A reader whose calls are counted, each answering through `answer(method, ...args)`, which throws to fail the read. */
function countedBy(network: string, answer: (method: string, args: unknown[]) => unknown): Counted {
  let reads = 0;
  const reader = new Proxy({}, {
    get: (_, k) => {
      if (k === "network") return network;
      if (k === "then") return undefined;
      return async (...args: unknown[]) => {
        reads++;
        return answer(String(k), args);
      };
    },
  });
  return { reader, reads: () => reads };
}

const SUI_STATUS_REF = SUI.V4.ref as { network: string; digest: string; untilEpoch: string; h: string };
/** The position x402-exact-sui.json's V4 reads from. */
export const SUI_STATUS_POSITION = BigInt(SUI.V4.position);
const suiStatusAnswer = (tx: { bcs: Uint8Array; status: string } | null, epoch: bigint, firstCheckpoint: bigint | null) => ({
  tx: tx === null ? null : { transactionBcs: tx.bcs, status: tx.status, checkpoint: 7n },
  epoch,
  firstCheckpoint,
});

/**
 * `suiStatus` reads of x402-exact-sui.json's V4 ref from its position. Only bytes that hash to the digest and pass
 * `decodeSuiTx`'s tags are decoded with @mysten/sui: without it those are pending `unreadable` after the one read.
 */
export function suiStatusRows(): StatusRow[] {
  const ref = SUI_STATUS_REF;
  const read = (answer: unknown) => () => counted(SUI_NETWORK, "read", answer);
  const unreadable = { state: "pending", why: "unreadable" };
  const decoded = { expect: unreadable, reads: 1 };
  const tagged = (at: 0 | 1, tag: number) => ({ ref: { ...ref, digest: suiDigestOf(suiTagged(at, tag)) }, reader: read(suiStatusAnswer({ bcs: suiTagged(at, tag), status: "SUCCESS" }, 1234n, null)) });
  return [
    { case: "V2's transaction, executed at checkpoint 7", ref, reader: read(suiStatusAnswer({ bcs: SUI_TX.V2!, status: "SUCCESS" }, 1234n, null)), expect: { state: "settled", checkpoint: 7n }, reads: 1, without: decoded },
    { case: "V2's transaction, aborted", ref, reader: read(suiStatusAnswer({ bcs: SUI_TX.V2!, status: "FAILURE" }, 1234n, null)), expect: { state: "failed", why: "aborted" }, reads: 1, without: decoded },
    { case: "no transaction, at its bound", ref, reader: read(suiStatusAnswer(null, 1234n, 0n)), expect: { state: "pending", why: "not-found" }, reads: 1 },
    { case: "no transaction past its bound, the history held from the position", ref, reader: read(suiStatusAnswer(null, 1235n, SUI_STATUS_POSITION)), expect: { state: "failed", why: "expired" }, reads: 1 },
    { case: "no transaction past its bound, the history held only after the position", ref, reader: read(suiStatusAnswer(null, 1235n, SUI_STATUS_POSITION + 1n)), expect: { state: "pending", why: "not-found" }, reads: 1 },
    { case: "no transaction past its bound, no history named", ref, reader: read(suiStatusAnswer(null, 1235n, null)), expect: { state: "pending", why: "not-found" }, reads: 1 },
    { case: "a read that fails", ref, reader: read("error"), expect: unreadable, reads: 1 },
    { case: "an answer out of the reader's form", ref, reader: read({ epoch: "1234" }), expect: unreadable, reads: 1 },
    { case: "V1's bytes under V2's digest", ref, reader: read(suiStatusAnswer({ bcs: SUI_TX.V1!, status: "SUCCESS" }, 1234n, null)), expect: unreadable, reads: 1 },
    { case: "bytes whose version tag is not V1's", ...tagged(0, 1), expect: { state: "failed", why: "not-this-instrument" }, reads: 1 },
    { case: "a transaction whose kind is not programmable", ...tagged(1, 1), expect: { state: "failed", why: "not-this-instrument" }, reads: 1 },
    { case: "a reader for another network", ref, reader: () => counted("sui:mainnet", "read", null), expect: unreadable, reads: 0 },
    { case: "a ref whose h is not a hash", ref: { ...ref, h: "0x12" }, reader: read(null), expect: unreadable, reads: 0 },
  ];
}

type TonFixture = Record<string, unknown>;
type TonStatusRow = {
  case: string;
  byInBody?: TonFixture[] | "reader-error";
  byInBodyRequest?: TonFixture[] | "reader-error";
  byInMessage?: Record<string, TonFixture[] | "reader-error">;
  headUtime?: number;
  indexedUtime?: number;
  expect: unknown;
};
/** A TON reader answering a status row's fixtures as tvm.test.ts's does, its calls counted. */
function tonStatusReader(row: TonStatusRow): Counted {
  const request = TVM.V4.ref.requestBodyHash as string;
  const tx = (f: TonFixture) => ({ ...f, inBody: null });
  return countedBy(TON_NETWORK, (method, args) => {
    if (method === "byInBody") {
      const answer = args[0] === request ? row.byInBodyRequest : row.byInBody;
      if (answer === "reader-error") throw new Error("transport");
      return { transactions: (answer ?? []).map(tx), headUtime: row.indexedUtime ?? row.headUtime };
    }
    if (method === "byInMessage") {
      const answer = row.byInMessage?.[args[0] as string];
      if (answer === "reader-error") throw new Error("transport");
      return (answer ?? []).map(tx);
    }
    if (method === "headUtime") {
      if (row.headUtime === undefined) throw new Error("transport");
      return row.headUtime;
    }
    return null;
  });
}

/**
 * `tvmStatus` reads: x402-exact-tvm.json's V4 status rows and the ref with its accounts written in another raw
 * spelling. The read decodes no cell and compares raw addresses itself, so each gives its answer, after the same reads,
 * without @ton/core.
 */
export function tvmStatusRows(): StatusRow[] {
  const ref = TVM.V4.ref as { wallet: string; jettonWallet: string };
  const rows = TVM.V4.status as TonStatusRow[];
  // The head and the request's lookup, then the lookup of each message the read follows.
  const reads = [4, 4, 4, 3, 4, 2, 2, 3, 2, 2, 2, 2, 2, 3, 2, 2, 2, 2];
  const settled = rows[0]!;
  const respelled = (s: string, wc: string) => `${wc}:${s.slice(s.indexOf(":") + 1).toUpperCase()}`;
  return [
    ...rows.map((row, i) => ({ case: row.case, ref, reader: () => tonStatusReader(row), expect: row.expect, reads: reads[i]! })),
    { case: "the ref's accounts in uppercase hex, workchain 00 and -0", ref: { ...ref, wallet: respelled(ref.wallet, "00"), jettonWallet: respelled(ref.jettonWallet, "-0") }, reader: () => tonStatusReader(settled), expect: settled.expect, reads: 4 },
    { case: "a ref whose wallet is not a raw address", ref: { ...ref, wallet: "x" }, reader: () => tonStatusReader(settled), expect: { state: "pending", why: "unreadable" }, reads: 0 },
  ];
}

type StellarStatusFixture = { status: string; envelope?: string; ledger?: number };
type StellarStatusRow = StellarStatusFixture & {
  case: string;
  latestLedger?: number;
  transfers?: { events: { txHash: string }[]; complete: boolean; latestLedger?: number };
  candidate?: StellarStatusFixture;
  expect: unknown;
};
/** A Stellar reader answering a V5 row as stellar.test.ts's does, its calls counted. */
function stellarStatusReader(row: StellarStatusRow): Counted {
  const envelopeOf = (e: string | undefined) => (e === "plant" ? STELLAR.plant.envelope : e === "rebuilt" ? STELLAR.V5.rebuilt.envelope : e);
  const answer = (a: StellarStatusFixture) => {
    if (a.status === "reader-error") throw new Error("transport");
    const envelope = envelopeOf(a.envelope);
    return { status: a.status, ...(envelope !== undefined ? { envelopeXdr: envelope } : {}), ...(a.ledger !== undefined ? { ledger: a.ledger } : {}), oldestLedger: 1 };
  };
  const listed = new Set((row.transfers?.events ?? []).map((e) => e.txHash));
  return countedBy(STELLAR.V5.ref.network, (method, args) => {
    if (method === "transaction") return answer(listed.has(args[0] as string) && row.candidate !== undefined ? row.candidate : row);
    if (method === "latestLedger") return row.latestLedger ?? 2000;
    if (method === "transfers") {
      const f = args[0] as { fromLedger: number };
      return {
        events: (row.transfers?.events ?? []).map((e) => ({ txHash: e.txHash, toMuxedId: BigInt(STELLAR.V1.muxedId) })),
        complete: row.transfers?.complete ?? true,
        oldestLedger: f.fromLedger,
        latestLedger: row.transfers?.latestLedger ?? row.latestLedger ?? 2000,
      };
    }
    return null;
  });
}

/**
 * `stellarStatus` reads of x402-exact-stellar.json's V5 rows. Only a transaction that succeeded is decoded with the
 * SDK: without it a named one is pending `unreadable` after its one read, and a search's candidate leaves the search
 * incomplete, pending with the named transaction's reason, after the same reads.
 */
export function stellarStatusRows(): StatusRow[] {
  const ref = STELLAR.V5.ref;
  const rows = STELLAR.V5.rows as StellarStatusRow[];
  const reads = [1, 2, 3, 3, 4, 2, 3, 2, 3, 1, 1, 3, 4];
  const unreadable = { expect: { state: "pending", why: "unreadable" }, reads: 1 };
  const without: (StatusRow["without"] | undefined)[] = [
    unreadable,
    undefined,
    undefined,
    undefined,
    { expect: { state: "pending", why: "transaction-failed" }, reads: 4 },
    unreadable,
    unreadable,
    undefined,
    undefined,
    undefined,
    unreadable,
    undefined,
    { expect: { state: "pending", why: "not-found" }, reads: 4 },
  ];
  return rows.map((row, i) => ({
    case: row.case,
    ref,
    reader: () => stellarStatusReader(row),
    expect: row.expect,
    reads: reads[i]!,
    ...(without[i] !== undefined ? { without: without[i] } : {}),
  }));
}

// ── Every function of a pairing with an optional peer, up to the one step that decodes or writes with it.

type Fn = (...args: never[]) => unknown;

/**
 * A call and its answer with the rail's optional peer (`expect`), and without it where the call reaches the one step
 * that decodes or writes with the peer (`without`): every other row gives `expect` without the peer too. `call` takes
 * the functions a test file imports, with the peer or without it, and gives a refusal's code, or what the row states
 * of any other answer.
 */
export interface PeerStepRow<F> {
  case: string;
  call: (f: F) => Promise<unknown>;
  expect: unknown;
  without?: unknown;
}

/** A refusal's code, or `other` of any other answer. */
function codeOr(r: unknown, other: (r: Record<string, any>) => unknown): unknown {
  return typeof r === "object" && r !== null && "refused" in r ? (r as unknown as { code: string }).code : other(r as Record<string, any>);
}

export interface TvmFns {
  pairingOf: Fn;
  read: Fn;
  advertise: Fn;
  build: Fn;
  bound: Fn;
  reference: Fn;
}

type TonOption = Record<string, unknown> & { extra: Record<string, unknown> };
const TON_O = TVM.fixed.O as TonOption;
const TON_PLACED = TVM.fixed.placed as TonOption;
const TON_DOC = (TVM.buyer.rows as { name: string; input: { doc: Record<string, unknown> } }[]).find((r) => r.name === "B2")!.input.doc;
const TON_OTHER_CELL: string = (TVM.agreedRefusals.rows as { advertiseOption?: TonOption }[]).find((r) => r.advertiseOption !== undefined)!
  .advertiseOption!.extra["forwardPayload"] as string;
const TON_NOT_W5: string = (TVM.agreedRefusals.rows as { settlementBoc?: string; expect: string }[]).find((r) => r.expect === "tvm/not-w5-signed")!
  .settlementBoc!;
const TON_HEX = "92433a576cbe56c4dcc86d94b497a2cf18a9baa9c8283fea28ea43eb3c25cfed";
const tonWith = (extra: Record<string, unknown>, o: TonOption = TON_O): TonOption => ({ ...o, extra: { ...o.extra, ...extra } });
/** The comment cell's BoC with no CRC32C: the same cell in other bytes, which only a decode shows to be that cell. */
const TON_COMMENT_NO_CRC = (() => {
  const b = bytes(TVM.V1.expectBoc);
  b[4] = 0x01;
  return b64(b.subarray(0, b.length - 4));
})();
/** One cell whose one reference names the cell itself: its layout holds, and TON refuses its cells. */
const TON_SELF_REFERENCE = b64([0xb5, 0xee, 0x9c, 0x72, 0x01, 0x01, 0x01, 0x01, 0x00, 0x03, 0x00, 0x01, 0x00, 0x00]);

function tonRead(f: TvmFns, option: unknown): unknown {
  return codeOr(f.read({ ...TON_DOC, accepts: [option] } as never), (r) =>
    JSON.stringify(r["offer"].options) === JSON.stringify([option]) ? "served" : r,
  );
}

function tonAdvertise(f: TvmFns, option: unknown): unknown {
  const doc = { x402Version: 2, resource: TVM.fixed.resource, accepts: [option] };
  return codeOr(f.advertise(doc as never, TVM.fixed.H as never, TVM.fixed.link as never, option as never), (r) => r["accepts"][0].extra.forwardPayload);
}

function tonPayment(settlementBoc: unknown, accepted: unknown = TON_PLACED) {
  return { x402Version: 2, resource: TVM.fixed.resource, accepted, payload: { settlementBoc, asset: TON_O["asset"] } };
}

async function tonBuild(f: TvmFns, members: Record<string, unknown>, accepted: unknown = TON_PLACED): Promise<unknown> {
  const choice = {
    required: { x402Version: 2, resource: TVM.fixed.resource, accepts: [accepted] },
    accepted,
    wallet: TVM.fixed.wallet,
    walletId: TVM.fixed.walletId,
    seqno: TVM.fixed.seqno,
    jettonWallet: TVM.fixed.jettonWallet,
    attachNanotons: BigInt(TVM.fixed.attachNanotons),
    now: TVM.fixed.now,
    ...members,
  };
  return codeOr(await f.build(choice as never, TVM.fixed.H as never), (u) => Buffer.from(u["request"].hash).toString("hex"));
}

/**
 * The x402 TON pairing's functions, each of whose option filters reads raw addresses without @ton/core: `pairingOf`,
 * `read` and `advertise` (the placed `forwardPayload`, which `advertise` writes without the peer), `bound` and
 * `reference` (the hash and the read keys), and `build` (the request's hash, in hex). Without @ton/core a call is
 * `tvm/peer-missing` only where it decodes a BoC's cells or writes the request's: every bag's bytes (base64, size,
 * layout, CRC32C) are read without it, and so is a forward payload whose bytes are the comment's BoC as `advertise`
 * writes it. Rows that state two faults give the code of the check that needs no peer, with the peer too.
 */
export function tvmPeerStepRows(): PeerStepRow<TvmFns>[] {
  const missing = "tvm/peer-missing";
  const V2 = TVM.V2.expectSettlementBoc as string;
  const notRaw = "0:12";
  return [
    { case: "pairingOf of the vectors' option", call: async (f) => f.pairingOf(TON_O as never) ?? "none", expect: "x402/exact/tvm" },
    { case: "read of a document holding the vectors' option", call: async (f) => tonRead(f, TON_O), expect: "served" },
    { case: "read of a document holding the placed option", call: async (f) => tonRead(f, TON_PLACED), expect: "served" },
    {
      case: "read of a document holding an option whose payTo's workchain, 128, is outside int8",
      call: async (f) => tonRead(f, { ...TON_O, payTo: `128:${TON_HEX}` }),
      expect: "x402/no-payable-option",
    },
    { case: "advertise of the vectors' option", call: async (f) => tonAdvertise(f, TON_O), expect: TVM.V1.expectBoc },
    { case: "advertise of an option whose asset is not a raw address", call: async (f) => tonAdvertise(f, { ...TON_O, asset: notRaw }), expect: "tvm/option-malformed" },
    {
      case: "advertise of an option whose responseDestination is a raw address on workchain -1 in uppercase hex",
      call: async (f) => tonAdvertise(f, tonWith({ responseDestination: `-1:${TON_HEX.toUpperCase()}` })),
      expect: TVM.V1.expectBoc,
    },
    {
      case: "advertise of an option whose responseDestination is not a raw address",
      call: async (f) => tonAdvertise(f, tonWith({ responseDestination: notRaw })),
      expect: "tvm/option-malformed",
    },
    { case: "advertise of the placed option, whose forwardPayload is the comment's BoC", call: async (f) => tonAdvertise(f, TON_PLACED), expect: TVM.V1.expectBoc },
    {
      case: "advertise of an option whose forwardPayload is the comment's cell in a BoC with no CRC32C",
      call: async (f) => tonAdvertise(f, tonWith({ forwardPayload: TON_COMMENT_NO_CRC })),
      expect: TVM.V1.expectBoc,
      without: missing,
    },
    {
      case: "advertise of an option whose forwardPayload is another cell",
      call: async (f) => tonAdvertise(f, tonWith({ forwardPayload: TON_OTHER_CELL })),
      expect: "tvm/carrier-occupied",
      without: missing,
    },
    {
      case: "advertise of an option whose forwardPayload's CRC32C does not match",
      call: async (f) => tonAdvertise(f, tonWith({ forwardPayload: crcChanged(TVM.V1.expectBoc) })),
      expect: "tvm/carrier-occupied",
    },
    { case: "advertise of an option whose forwardPayload is not base64", call: async (f) => tonAdvertise(f, tonWith({ forwardPayload: "AA=A" })), expect: "tvm/carrier-occupied" },
    { case: "bound of V2's payment", call: async (f) => codeOr(await f.bound(tonPayment(V2) as never), (h) => h), expect: TVM.V3.expectBound, without: missing },
    { case: "reference of V2's payment", call: async (f) => codeOr(await f.reference(tonPayment(V2) as never), (r) => r), expect: TVM.V3.expectReference, without: missing },
    { case: "bound of V2's payment with its CRC32C changed", call: async (f) => codeOr(await f.bound(tonPayment(crcChanged(V2)) as never), (h) => h), expect: "tvm/boc-malformed" },
    { case: "reference of a settlementBoc that is not base64", call: async (f) => codeOr(await f.reference(tonPayment("AA=A") as never), (r) => r), expect: "tvm/boc-malformed" },
    {
      case: "bound of V2's payment under the vectors' option, which carries no forwardPayload",
      call: async (f) => codeOr(await f.bound(tonPayment(V2, TON_O) as never), (h) => h),
      expect: "tvm/carrier-mismatch",
    },
    {
      case: "bound of V2's payment under an option whose forwardPayload's CRC32C does not match",
      call: async (f) => codeOr(await f.bound(tonPayment(V2, tonWith({ forwardPayload: crcChanged(TVM.V1.expectBoc) })) as never), (h) => h),
      expect: "tvm/carrier-mismatch",
    },
    {
      case: "bound of V2's payment under an option whose forwardPayload is another cell",
      call: async (f) => codeOr(await f.bound(tonPayment(V2, tonWith({ forwardPayload: TON_OTHER_CELL })) as never), (h) => h),
      expect: "tvm/carrier-mismatch",
      without: missing,
    },
    {
      case: "bound of V2's payment under an option whose payTo is not a raw address",
      call: async (f) => codeOr(await f.bound(tonPayment(V2, { ...TON_PLACED, payTo: notRaw }) as never), (h) => h),
      expect: "tvm/option-malformed",
    },
    {
      case: "two faults: bound of a settlement that is not W5-signed, under the vectors' option, which carries no forwardPayload",
      call: async (f) => codeOr(await f.bound(tonPayment(TON_NOT_W5, TON_O) as never), (h) => h),
      expect: "tvm/carrier-mismatch",
    },
    { case: "build of V2's choice", call: async (f) => tonBuild(f, {}), expect: TVM.V2.expectRequestHash, without: missing },
    {
      case: "build of a choice whose wallet's workchain, 1, is not one the network holds",
      call: async (f) => tonBuild(f, { wallet: `1:${TON_HEX}` }),
      expect: "x402/option-malformed",
    },
    {
      case: "build of a choice whose now plus the option's timeout is 2^32",
      call: async (f) => tonBuild(f, { now: 2 ** 32 - (TON_PLACED["maxTimeoutSeconds"] as number) }),
      expect: "x402/option-malformed",
    },
    { case: "build of a choice of the vectors' option, which carries no forwardPayload", call: async (f) => tonBuild(f, {}, TON_O), expect: "tvm/carrier-mismatch" },
    {
      case: "build of a choice whose attachNanotons is not above the option's forwardTonAmount",
      call: async (f) => tonBuild(f, {}, tonWith({ forwardTonAmount: TVM.fixed.attachNanotons }, TON_PLACED)),
      expect: "tvm/value-too-low",
    },
    { case: "build of a choice whose state init is not base64", call: async (f) => tonBuild(f, { stateInit: "AA=A" }), expect: "tvm/boc-malformed" },
    { case: "build of a choice whose state init is over 8 KiB", call: async (f) => tonBuild(f, { stateInit: b64(new Uint8Array(8193)) }), expect: "tvm/boc-too-large" },
    {
      case: "build of a choice whose state init's CRC32C does not match",
      call: async (f) => tonBuild(f, { stateInit: crcChanged(TVM.V2b.stateInit) }),
      expect: "tvm/boc-malformed",
    },
    {
      case: "build of a choice whose state init's one cell names itself",
      call: async (f) => tonBuild(f, { stateInit: TON_SELF_REFERENCE }),
      expect: "tvm/boc-malformed",
      without: missing,
    },
    {
      case: "two faults: build of a choice of an option whose forwardPayload is another cell, with a wallet on workchain 1",
      call: async (f) => tonBuild(f, { wallet: `1:${TON_HEX}` }, tonWith({ forwardPayload: TON_OTHER_CELL }, TON_PLACED)),
      expect: "x402/option-malformed",
    },
    {
      case: "two faults: build of a choice of an option whose forwardPayload is another cell, with a state init that is not base64",
      call: async (f) => tonBuild(f, { stateInit: "AA=A" }, tonWith({ forwardPayload: TON_OTHER_CELL }, TON_PLACED)),
      expect: "tvm/boc-malformed",
    },
    {
      case: "two faults: build of a choice whose state init's one cell names itself and whose attachNanotons is not above forwardTonAmount",
      call: async (f) => tonBuild(f, { stateInit: TON_SELF_REFERENCE }, tonWith({ forwardTonAmount: TVM.fixed.attachNanotons }, TON_PLACED)),
      expect: "tvm/value-too-low",
    },
    {
      case: "two faults: build of a choice of an option whose forwardPayload is empty, with a state init that is not base64",
      call: async (f) => tonBuild(f, { stateInit: "AA=A" }, tonWith({ forwardPayload: "" }, TON_PLACED)),
      expect: "tvm/boc-malformed",
    },
    {
      case: "two faults: build of a choice whose wallet's workchain, 1, is not one the network holds, with a state init that is not base64",
      call: async (f) => tonBuild(f, { wallet: `1:${TON_HEX}`, stateInit: "AA=A" }),
      expect: "tvm/boc-malformed",
    },
  ];
}

export interface SuiFns {
  build: Fn;
}

/**
 * `x402/exact/sui`'s `build` of the vectors' option, which writes its request without @mysten/sui (its kind and the
 * `Pure` input in hex), and `complete` of signed payloads, which reads the transaction as `bound` does: "payment" for
 * the payment it gives. Without the peer only `complete` of a transaction whose form, size and tags pass is
 * `sui/peer-missing`, as only its decode needs the peer.
 */
export function suiPeerStepRows(): PeerStepRow<SuiFns>[] {
  const { H, O, resource } = SUI.fixed;
  const built = async (f: SuiFns) => (await f.build({ required: { x402Version: 2, resource, accepts: [O] }, accepted: O } as never, H as never)) as Record<string, any>;
  const complete = async (f: SuiFns, signed: unknown) => {
    const u = await built(f);
    return "refused" in u ? u["code"] : codeOr(u["complete"](signed), () => "payment");
  };
  const notBound = "x402/signed-not-bound";
  return [
    { case: "build of the vectors' option", call: async (f) => codeOr(await built(f), (u) => `${u["request"].kind}:${Buffer.from(u["request"].pureInput).toString("hex")}`), expect: `sui-transaction:${H.slice(2)}` },
    { case: "complete of V2's transaction", call: async (f) => complete(f, { signature: "AAAA", transaction: SUI.V2.tx.transactionBase64 }), expect: "payment", without: "sui/peer-missing" },
    { case: "complete of a payload whose signature is empty", call: async (f) => complete(f, { signature: "", transaction: SUI.V2.tx.transactionBase64 }), expect: notBound },
    { case: "complete of a transaction whose version tag is not V1's", call: async (f) => complete(f, { signature: "AAAA", transaction: b64(suiTagged(0, 1)) }), expect: notBound },
    { case: "complete of a transaction of another kind", call: async (f) => complete(f, { signature: "AAAA", transaction: b64(suiTagged(1, 1)) }), expect: notBound },
    { case: "complete of a transaction that is not base64", call: async (f) => complete(f, { signature: "AAAA", transaction: "AA=A" }), expect: notBound },
  ];
}

export interface SolanaChargeFns {
  advertise: Fn;
  build: Fn;
}

const SOL_CHARGE = vector("mpp-charge-solana.json");

/**
 * `mpp/charge/solana`'s `build` of a placed challenge whose request names no `recentBlockhash`, so the choice's is
 * built with: its form is a key, base58 of 32 bytes, as @solana/kit's `blockhash` reads it, and is checked before the
 * kit writes the message, for a native SOL request as for a token one. "message" for the message the kit writes: without
 * it that is `svm/peer-missing`.
 */
export function solanaChargeBlockhashRows(): PeerStepRow<SolanaChargeFns>[] {
  const { H, link, payer } = SOL_CHARGE.fixed;
  const placed = (f: SolanaChargeFns, request: Record<string, unknown>) => {
    const { recentBlockhash: _given, ...methodDetails } = request["methodDetails"] as Record<string, unknown>;
    const issued = { ...SOL_CHARGE.challenge, request: Buffer.from(JSON.stringify({ ...request, methodDetails }), "utf8").toString("base64url") };
    const doc = f.advertise([issued] as never, H as never, link as never, issued as never) as unknown[];
    return doc[0];
  };
  const build = async (f: SolanaChargeFns, request: Record<string, unknown>, recentBlockhash: unknown) =>
    codeOr(await f.build({ challenge: placed(f, request), payer, recentBlockhash } as never, H as never), () => "message");
  const sol = SOL_CHARGE.sol.request as Record<string, unknown>;
  const token = SOL_CHARGE.fixed.request as Record<string, unknown>;
  const key: string = SOL_CHARGE.fixed.feePayer;
  const short = base58.encode(new Uint8Array(31).fill(7));
  return [
    { case: "a native SOL request, with the choice's blockhash", call: (f) => build(f, sol, key), expect: "message", without: "svm/peer-missing" },
    { case: "a native SOL request, with a blockhash that is not base58", call: (f) => build(f, sol, "0OIl"), expect: "svm/input-malformed" },
    { case: "a native SOL request, with a blockhash of 31 bytes", call: (f) => build(f, sol, short), expect: "svm/input-malformed" },
    { case: "a token request, with a blockhash that is not base58", call: (f) => build(f, token, "0OIl"), expect: "svm/input-malformed" },
  ];
}

export interface StellarCarrierFns {
  x402Bound: Fn;
  x402Reference: Fn;
  mppBound: Fn;
  mppReference: Fn;
}

/**
 * The Stellar pairings' `bound` and `reference` of payments under an option or challenge whose `payTo` or `recipient`
 * does or does not carry the echoed H's muxed id, which `unmux` reads without the SDK before the transaction is read:
 * `stellar/carrier-mismatch` with the SDK and without it. A payment whose option or challenge carries it reaches the
 * transaction: H and the read keys with the SDK, and `stellar/peer-missing` without it. Rows that state two faults give
 * the carrier's code, with the SDK too.
 */
export function stellarCarrierRows(): PeerStepRow<StellarCarrierFns>[] {
  const missing = "stellar/peer-missing";
  const mismatch = "stellar/carrier-mismatch";
  const { seller } = STELLAR.fixed;
  const key = base32.decode(seller).subarray(1, 33);
  const idZero = strkey(12 << 3, Uint8Array.from([...key, ...zeros(8)]));
  const V3 = STELLAR.V3;
  const x402 = (transaction: unknown, payTo: unknown = V3.accepted.payTo, extensions: unknown = V3.extensions) => ({
    x402Version: 2,
    accepted: { ...V3.accepted, payTo },
    payload: { transaction },
    extensions,
  });
  const plainTo = (STELLAR.V4 as { case: string; envelope: string }[]).find((r) => r.case === "to is the plain seller G")!.envelope;
  const otherH = (STELLAR.V4 as { case: string; extensions: unknown }[]).find((r) => r.case === "the echoed legalContext.value is not H")!.extensions;
  const placed = CHARGE.place.expect as { request: string };
  const mpp = (recipient?: string, transaction: string = CHARGE.V3.envelope, feePayer?: boolean) => {
    const challenge = recipient === undefined ? placed : withRequestMember(placed, "recipient", recipient);
    const details = { ...requestOf(placed).methodDetails, feePayer };
    return {
      challenge: feePayer === undefined ? challenge : withRequestMember(challenge, "methodDetails", details),
      payload: { type: "transaction", transaction },
    };
  };
  const answer = (r: unknown) => codeOr(r, (x) => x);
  return [
    { case: "x402 bound of V3's payment", call: async (f) => answer(await f.x402Bound(x402(V3.envelope) as never)), expect: V3.expectBound, without: missing },
    { case: "x402 reference of V3's payment", call: async (f) => answer(await f.x402Reference(x402(V3.envelope) as never)), expect: V3.expectReference, without: missing },
    { case: "x402 bound of V3's payment under an option whose payTo is the seller's account", call: async (f) => answer(await f.x402Bound(x402(V3.envelope, seller) as never)), expect: mismatch },
    { case: "x402 reference of V3's payment under an option whose payTo is the seller's account", call: async (f) => answer(await f.x402Reference(x402(V3.envelope, seller) as never)), expect: mismatch },
    {
      case: "x402 bound of V4's envelope to the seller's account, under an option whose payTo is that account",
      call: async (f) => answer(await f.x402Bound(x402(plainTo, seller) as never)),
      expect: mismatch,
    },
    {
      case: "x402 bound of V3's payment under an option whose payTo is the seller's account muxed with the id 0",
      call: async (f) => answer(await f.x402Bound(x402(V3.envelope, idZero) as never)),
      expect: mismatch,
    },
    { case: "x402 bound of V3's payment whose echoed legal context holds another hash", call: async (f) => answer(await f.x402Bound(x402(V3.envelope, V3.accepted.payTo, otherH) as never)), expect: mismatch },
    {
      case: "two faults: x402 bound of an envelope that is not base64, under an option whose payTo is the seller's account",
      call: async (f) => answer(await f.x402Bound(x402("AA=A", seller) as never)),
      expect: mismatch,
    },
    { case: "MPP bound of V3's envelope under the placed challenge", call: async (f) => answer(await f.mppBound(mpp() as never)), expect: CHARGE.fixed.H, without: missing },
    {
      case: "MPP bound of V3's envelope under a placed challenge whose recipient is the seller's account muxed with the id 0",
      call: async (f) => answer(await f.mppBound(mpp(strkey(12 << 3, Uint8Array.from([...base32.decode(issuedRecipient()).subarray(1, 33), ...zeros(8)]))) as never)),
      expect: mismatch,
    },
    {
      case: "MPP reference of V3's envelope under a placed challenge whose recipient is the seller's account",
      call: async (f) => answer(await f.mppReference(mpp(issuedRecipient()) as never)),
      expect: mismatch,
    },
    {
      case: "MPP bound of the plant's envelope to the seller's account, under a placed challenge whose recipient is that account",
      call: async (f) => answer(await f.mppBound(mpp(issuedRecipient(), CHARGE.plant.envelope) as never)),
      expect: mismatch,
    },
    {
      case: "MPP reference of the plant's envelope to the seller's account, under a placed challenge whose recipient is that account and whose feePayer is false",
      call: async (f) => answer(await f.mppReference(mpp(issuedRecipient(), CHARGE.plant.envelope, false) as never)),
      expect: mismatch,
    },
  ];
}
