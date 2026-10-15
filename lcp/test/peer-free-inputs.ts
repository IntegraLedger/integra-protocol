// Inputs a function answers before it needs its rail's optional peer, so it gives each the same code with the peer
// (peer-free-inputs.test.ts, and failures-are-values.test.ts for muxedFor) and without it (the rail's peer-missing
// test):
// - TON's and Sui's `recover`: a reader for another network or a ref recover cannot read, with nothing read; a read
//   that fails, finds nothing or answers out of the reader's form; and the rail's own refusal of a transaction it finds,
//   before it decodes the transaction. The vector files' recover rows are decoded: each gets the vectors' answer with
//   the peer and `<rail>/peer-missing` without it.
// - `mpp/charge/stellar`'s `build`: a choice, challenge, H, current ledger or clock it refuses.
// - `muxedFor`: a base that is not a string, and an H that is not a 32-byte hash.
import { readFileSync } from "node:fs";

const vector = (name: string) => JSON.parse(readFileSync(new URL(`../vectors/${name}`, import.meta.url), "utf8"));
const TVM = vector("x402-exact-tvm.json");
const SUI = vector("x402-exact-sui.json");
const STELLAR = vector("x402-exact-stellar.json");
const CHARGE = vector("mpp-charge-stellar.json");

const bytes = (b64: string) => Uint8Array.from(Buffer.from(b64, "base64"));

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

/** A choice and H `mpp/charge/stellar`'s `build` refuses with the code given, before it reads the recipient. */
export function stellarChargeChoices(): { case: string; choice: unknown; h: unknown; expect: string }[] {
  const { choice, h } = stellarChargeChoice();
  return [
    { case: "a choice that is not an object", choice: null, h, expect: "stellar/tx-malformed" },
    { case: "a challenge that is not one", choice: { ...choice, challenge: {} }, h, expect: "mpp/credential-malformed" },
    { case: "an H the challenge does not carry", choice, h: CHARGE.fixed.H2, expect: "mpp/id-not-ours" },
    { case: "a current ledger below 0", choice: { ...choice, currentLedger: -1 }, h, expect: "stellar/tx-malformed" },
    { case: "a clock that is not an integer", choice: { ...choice, now: choice.now + 0.5 }, h, expect: "stellar/tx-malformed" },
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
