// Every MPP pairing whose build returns a `complete` that makes a credential measures that credential as `bound`
// measures every credential, its echoed challenge included, and refuses one over the credential size bound with the
// code `bound` gives it. mpp-challenge.json's credentialSize rows are the sizes; each pairing's credential is the one its
// build and complete give on its vector file's B2 inputs and the payment its B6 row carries, under that file's placed
// challenge with a description of as many characters as bring the credential to the row's size.
import { xdr } from "@stellar/stellar-sdk/base";
import { describe, expect, it } from "vitest";
import { concat, toHex, type Hex } from "viem";
import { privateKeyToAccount, sign } from "viem/accounts";
import type { Json } from "../src/index.js";
import type { StellarPaymentPayload } from "../src/internal/stellar.js";
import type { PaymentRequired, PaymentRequirements } from "../src/x402.js";
import { exactStellar } from "../src/x402-exact-stellar.js";
import {
  chargeSolana,
  chargeStellar,
  chargeUsdcEvm,
  chargeUsdcGateway,
  chargeUsdcSolana,
  chargeUsdcStacks,
  chargeXrpl,
  evmAuthorization,
  evmHash,
  evmPermit2,
  evmTransaction,
  sessionEvm,
  sessionHedera,
  sessionSolana,
  sessionTempo,
  sessionXrpl,
  subscriptionTempo,
  tempoMemo,
  tempoPush,
  type MppChallenge,
  type MppCredential,
} from "../src/mpp.js";
import { chargeLightning, sessionLightning } from "../src/lightning.js";
import { rlpBytes, rlpList } from "../src/rlp.js";
import { encodeKeyAuthorization } from "../src/tempo.js";
import { described, descriptionFor, sizeOf } from "./credential-size.js";
import { load } from "./mpp-fixtures.js";
import { rowsOf } from "./rows.js";

type Placed = MppChallenge & { id: string };
type Payload = MppCredential["payload"];
/** The B2 inputs the pairings' builds take, as the vector files write them. */
type Inputs = {
  tokenDomain?: { name: string; version: string };
  spender?: Hex;
  returnInvoice?: string;
  computeUnitLimit?: number;
  computeUnitPrice?: string;
  simulatedXdr?: string;
  currentLedger?: number;
  fee?: string;
  sequence?: number;
  lastLedgerSequence?: number;
  deposit?: string;
  credentialType?: "authorization" | "permit2" | "hash";
  xrpl?: { publicKey: string; settleDelay: number; fee: string; sequence: number; lastLedgerSequence: number };
};
/** A buyer row of an MPP vector file: B2's build inputs, or B6's payment. */
type BuyerRow = {
  name: string;
  pairing: string;
  advertised: Hex;
  input: { account: string; now?: number; inputs?: Inputs; doc?: Placed[]; presented?: MppCredential & { challenge: Placed } };
};
type Refused = { refused: true; code: string };

const MC = load("mpp-challenge.json");
const A = load("mpp-charge-evm-authorization.json");
const TX = load("mpp-charge-evm-transaction.json");

/**
 * MV11's EIP-1559 transaction, signed by the payer key with viem as mpp-charge.test.ts signs it: the EVM transaction
 * charge's complete reads the transaction's chain id, so it takes a transaction of the challenge's chain only.
 */
async function mv11Transaction(): Promise<Hex> {
  const t = TX.MV11.transaction;
  const signed = await privateKeyToAccount(TX.fixed.payerKey).signTransaction({
    type: "eip1559",
    chainId: t.chainId,
    nonce: t.nonce,
    gas: BigInt(t.gas),
    to: t.to as Hex,
    data: TX.MV11.expectCalldata as Hex,
    maxPriorityFeePerGas: BigInt(t.maxPriorityFeePerGas),
    maxFeePerGas: BigInt(t.maxFeePerGas),
  });
  if ((signed.length - 2) / 2 !== TX.MV11.expectRawLength) throw new Error("not MV11's transaction");
  return signed;
}

/** The buyer row `name` of `file` for `pairing`. */
const buyer = (file: string, pairing: string, name: "B2" | "B6"): BuyerRow | undefined =>
  (load(file).buyer.rows as BuyerRow[]).find((r) => r.name === name && r.pairing === pairing);
/** The address of a CAIP-10 account: what follows its namespace and reference. */
const accountOf = (row: BuyerRow) => row.input.account.split(":").slice(2).join(":");
const refused = (code: string): Refused => ({ refused: true, code });
/** A build's refusal, as `built` throws it, so that a run can tell it from its complete's answer (`answered`). */
class BuildRefused extends Error {
  constructor(readonly refusal: Refused) {
    super(`build refused: ${refusal.code}`);
  }
}
/** A build's answer, which these rows' inputs never have refused. */
function built<U>(u: U | Refused): U {
  if (typeof u === "object" && u !== null && "refused" in u) throw new BuildRefused(u as Refused);
  return u as U;
}
/** What a run of build and complete gives: build's refusal, or complete's answer. */
async function answered(run: Promise<unknown>): Promise<{ by: "build" | "complete"; answer: unknown }> {
  try {
    return { by: "complete", answer: await run };
  } catch (e) {
    if (e instanceof BuildRefused) return { by: "build", answer: e.refusal };
    throw e;
  }
}
const decoded = (c: MppChallenge): { [k: string]: Json } => JSON.parse(Buffer.from(c.request, "base64url").toString("utf8"));


/** How a pairing's build and complete run on its B2 row and its B6 payment's payload and source, under `challenge`. */
type Run = (challenge: Placed, b2: BuyerRow, b6: { payload: Payload; source?: string }) => Promise<unknown>;
type Pairing = { file: string; bound: (c: unknown) => Promise<unknown>; run: Run; answer?: string };
/**
 * Each pairing whose build returns a `complete` that makes a credential: its vector file, `bound`, how it builds and
 * completes, and the code `bound` gives its credential where that is not H (`answer`).
 */
const P: Record<string, Pairing> = {
  "mpp/charge/evm/authorization": {
    file: "mpp-charge-evm-authorization.json",
    bound: evmAuthorization.bound,
    run: async (challenge, b2, b6) => {
      const choice = { challenge, from: accountOf(b2) as Hex, now: b2.input.now ?? 0, tokenDomain: b2.input.inputs!.tokenDomain! };
      return built(await evmAuthorization.build(choice, b2.advertised)).complete(b6.payload["signature"] as Hex);
    },
  },
  "mpp/charge/evm/permit2": {
    file: "mpp-charge-evm-permit2.json",
    bound: evmPermit2.bound,
    run: async (challenge, b2, b6) => {
      const choice = { challenge, from: accountOf(b2) as Hex, now: b2.input.now ?? 0, spender: b2.input.inputs!.spender! };
      return built(await evmPermit2.build(choice, b2.advertised)).complete(b6.payload["signature"] as Hex);
    },
  },
  // No B6 row: the credential has no signed place for H. complete takes MV11's signed transaction, and H.
  "mpp/charge/evm/transaction": {
    file: "mpp-charge-evm-transaction.json",
    bound: evmTransaction.bound,
    answer: "mpp/no-signed-place",
    run: async (challenge, b2) =>
      built(await evmTransaction.build({ challenge, from: accountOf(b2) as Hex, now: b2.input.now ?? 0 }, b2.advertised)).complete(
        await mv11Transaction(),
      ),
  },
  "mpp/charge/evm/hash": {
    file: "mpp-charge-evm-hash.json",
    bound: evmHash.bound,
    answer: "mpp/no-signed-place",
    run: async (challenge, b2) =>
      built(await evmHash.build({ challenge, from: accountOf(b2) as Hex, now: b2.input.now ?? 0 }, b2.advertised)).complete(b2.advertised),
  },
  "mpp/charge/tempo/memo": {
    file: "mpp-charge-tempo-memo.json",
    bound: tempoMemo.bound,
    run: async (challenge, b2, b6) =>
      built(await tempoMemo.build({ challenge, from: accountOf(b2) as Hex, now: b2.input.now ?? 0 }, b2.advertised)).complete(
        b6.payload["signature"] as Hex,
      ),
  },
  // bound reads the push payment once fetchPresented has landed it.
  "mpp/charge/tempo/push": {
    file: "mpp-charge-tempo-push.json",
    bound: tempoPush.bound,
    answer: "tempo/read-first",
    run: async (challenge, b2, b6) =>
      built(await tempoPush.build({ challenge, from: accountOf(b2) as Hex, now: b2.input.now ?? 0 }, b2.advertised)).complete(
        b6.payload["hash"] as Hex,
      ),
  },
  "mpp/charge/lightning": {
    file: "mpp-charge-lightning.json",
    bound: chargeLightning.bound,
    run: async (challenge, b2, b6) => built(await chargeLightning.build({ challenge }, b2.advertised)).complete(b6.payload["preimage"] as string),
  },
  "mpp/session/lightning": {
    file: "mpp-session-lightning.json",
    bound: sessionLightning.bound,
    run: async (challenge, b2, b6) =>
      built(await sessionLightning.build({ challenge, returnInvoice: b2.input.inputs!.returnInvoice! }, b2.advertised)).complete(
        b6.payload["preimage"] as string,
      ),
  },
  "mpp/charge/solana": { file: "mpp-charge-solana.json", bound: chargeSolana.bound, run: solanaRun(chargeSolana.build, (r) => r) },
  "mpp/charge/usdc/solana": {
    file: "mpp-charge-usdc-solana.json",
    bound: chargeUsdcSolana.bound,
    run: solanaRun(chargeUsdcSolana.build, (r) => r["solana"] as { [k: string]: Json }),
  },
  // complete takes the payer's 64-byte signature, which it does not verify.
  "mpp/charge/stellar": {
    file: "mpp-charge-stellar.json",
    bound: chargeStellar.bound,
    run: async (challenge, b2) => {
      const i = b2.input.inputs!;
      const choice = { challenge, payer: accountOf(b2), now: b2.input.now ?? 0, simulatedXdr: i.simulatedXdr!, currentLedger: i.currentLedger! };
      return built(await chargeStellar.build(choice, b2.advertised)).complete(new Uint8Array(64).fill(0x11));
    },
  },
  "mpp/charge/xrpl": {
    file: "mpp-charge-xrpl.json",
    bound: chargeXrpl.bound,
    run: async (challenge, b2, b6) => {
      const i = b2.input.inputs!;
      const choice = { challenge, account: accountOf(b2), fee: i.fee!, sequence: i.sequence!, lastLedgerSequence: i.lastLedgerSequence! };
      return built(await chargeXrpl.build(choice, b2.advertised)).complete(b6.payload["blob"] as string);
    },
  },
  "mpp/charge/usdc/evm": {
    file: "mpp-charge-usdc-evm.json",
    bound: chargeUsdcEvm.bound,
    run: async (challenge, b2, b6) => {
      const choice = { challenge, from: accountOf(b2) as Hex, now: b2.input.now ?? 0, tokenDomain: b2.input.inputs!.tokenDomain! };
      const u = built(await chargeUsdcEvm.build(choice, b2.advertised)) as { complete(signature: Hex): unknown };
      return u.complete(b6.payload["signature"] as Hex);
    },
  },
  "mpp/charge/usdc/stacks": {
    file: "mpp-charge-usdc-stacks.json",
    bound: chargeUsdcStacks.bound,
    run: async (challenge, b2, b6) => {
      const u = built(await chargeUsdcStacks.build({ challenge, from: accountOf(b2) }, b2.advertised)) as { complete(tx: Uint8Array): unknown };
      return u.complete(Uint8Array.from(Buffer.from(b6.payload["transaction"] as string, "base64")));
    },
  },
  "mpp/charge/usdc/gateway": {
    file: "mpp-charge-usdc-gateway.json",
    bound: chargeUsdcGateway.bound,
    run: async (challenge, b2, b6) => {
      const u = built(await chargeUsdcGateway.build({ challenge, from: accountOf(b2) as Hex, now: b2.input.now ?? 0 }, b2.advertised)) as {
        complete(c: unknown): unknown;
      };
      const transfer = (b6.payload["authorization"] as { transfer: { burnIntent: Json; signature: Hex } }).transfer;
      return u.complete({
        source: b6.source,
        sourceNetwork: b6.payload["sourceNetwork"],
        destinationNetwork: b6.payload["destinationNetwork"],
        maxFee: b6.payload["maxFee"],
        burnIntent: transfer.burnIntent,
        signature: transfer.signature,
      });
    },
  },
  "mpp/session/evm": {
    file: "mpp-session-evm.json",
    bound: sessionEvm.bound,
    run: async (challenge, b2, b6) => {
      const i = b2.input.inputs!;
      const choice = {
        challenge,
        from: accountOf(b2) as Hex,
        now: b2.input.now ?? 0,
        deposit: BigInt(i.deposit!),
        credentialType: i.credentialType!,
        tokenDomain: i.tokenDomain!,
      };
      return built(await sessionEvm.build(choice, b2.advertised)).complete(b6.payload["signature"] as Hex, b6.payload["voucherSignature"] as Hex);
    },
  },
  "mpp/session/tempo": {
    file: "mpp-session-tempo.json",
    bound: sessionTempo.bound,
    run: async (challenge, b2, b6) => {
      const choice = { challenge, from: accountOf(b2) as Hex, now: b2.input.now ?? 0, deposit: BigInt(b2.input.inputs!.deposit!) };
      return built(await sessionTempo.build(choice, b2.advertised)).complete(b6.payload["transaction"] as Hex, b6.payload["signature"] as Hex);
    },
  },
  // The root key signs the digest: the B2 account's key, which is the authorization file's payer key.
  "mpp/subscription/tempo": {
    file: "mpp-subscription-tempo.json",
    bound: subscriptionTempo.bound,
    run: async (challenge, b2) => {
      const u = built(await subscriptionTempo.build({ challenge, from: accountOf(b2) as Hex, now: b2.input.now ?? 0 }, b2.advertised));
      const s = await sign({ hash: u.request.digest, privateKey: A.fixed.payerKey });
      return u.complete(concat([s.r, s.s, toHex(Number(s.v), { size: 1 })]));
    },
  },
  // bound reads the opening once fetchPresented has landed it.
  "mpp/session/hedera": {
    file: "mpp-session-hedera-solana-xrpl.json",
    bound: sessionHedera.bound,
    answer: "hedera/read-first",
    run: async (challenge, b2, b6) => {
      const choice = { challenge, from: accountOf(b2), now: b2.input.now ?? 0, deposit: BigInt(b2.input.inputs!.deposit!) };
      const u = built(await sessionHedera.build(choice, b2.advertised)) as { complete(s: { openTx: Hex; signature: Hex }): unknown };
      return u.complete({ openTx: b6.payload["txHash"] as Hex, signature: b6.payload["signature"] as Hex });
    },
  },
  // The Solana session's build reads no deposit: the channel client composes the open payload.
  "mpp/session/solana": {
    file: "mpp-session-hedera-solana-xrpl.json",
    bound: sessionSolana.bound,
    run: async (challenge, b2, b6) => {
      const u = built(await sessionSolana.build({ challenge, from: accountOf(b2), now: b2.input.now ?? 0, deposit: 1n }, b2.advertised)) as {
        complete(open: Payload): unknown;
      };
      return u.complete(b6.payload);
    },
  },
  "mpp/session/xrpl": {
    file: "mpp-session-hedera-solana-xrpl.json",
    bound: sessionXrpl.bound,
    run: async (challenge, b2, b6) => {
      const i = b2.input.inputs!;
      const xrpl = { ...i.xrpl!, publicKey: i.xrpl!.publicKey.replace(/^0x/, "") };
      const choice = { challenge, from: accountOf(b2), now: b2.input.now ?? 0, deposit: BigInt(i.deposit!), xrpl };
      const u = built(await sessionXrpl.build(choice, b2.advertised)) as { complete(s: { signedBlob: string; claimSignature: string }): Promise<unknown> };
      return u.complete({ signedBlob: b6.payload["transaction"] as string, claimSignature: b6.payload["signature"] as string });
    },
  },
};

/**
 * The Solana charges' build, given the buyer's own decimals, token program and blockhash: those `own` reads from the
 * challenge's methodDetails. complete takes the payer's 64-byte signature, which it does not verify.
 */
function solanaRun(build: (choice: never, h: never) => Promise<unknown>, own: (details: { [k: string]: Json }) => { [k: string]: Json }): Run {
  return async (challenge, b2) => {
    const i = b2.input.inputs!;
    const d = own(decoded(challenge)["methodDetails"] as { [k: string]: Json });
    const choice = {
      challenge,
      payer: accountOf(b2),
      computeUnitLimit: i.computeUnitLimit,
      computeUnitPrice: BigInt(i.computeUnitPrice!),
      decimals: d["decimals"],
      tokenProgram: d["tokenProgram"],
      recentBlockhash: d["recentBlockhash"],
    };
    const u = built(await build(choice as never, b2.advertised as never)) as { complete(signature: Uint8Array): unknown };
    return u.complete(new Uint8Array(64).fill(0x11));
  };
}

/** The pairing's placed challenge and its complete under a given challenge: B6's challenge, else B2's first. */
function setUp(id: string) {
  const p = P[id]!;
  const b2 = buyer(p.file, id, "B2")!;
  const b6 = buyer(p.file, id, "B6")?.input.presented;
  const placed = b6?.challenge ?? b2.input.doc![0]!;
  const payment = { payload: b6?.payload ?? {}, ...(b6?.source === undefined ? {} : { source: b6.source }) };
  return { placed, h: b2.advertised, complete: (challenge: Placed) => p.run(challenge, b2, payment) };
}


type SizeRow = { case: string; size: number; taken?: true; expect?: string };
const ROWS = rowsOf<SizeRow>(MC.credentialSize.rows, "mpp-challenge.json credentialSize.rows", { exact: 3 });
const PAIRINGS = rowsOf(Object.keys(P), "the pairings whose build returns a complete that makes a credential", { exact: 21 });

describe("mpp-challenge.json credentialSize: every complete measures its credential as bound does", () => {
  for (const id of PAIRINGS) {
    describe(id, () => {
      for (const row of ROWS) {
        it(row.case, async () => {
          const { placed, h, complete } = setUp(id);
          const bound = P[id]!.bound;
          expect(placed.description).toBeUndefined();
          const plain = (await complete(placed)) as MppCredential;
          const answer = P[id]!.answer === undefined ? h : refused(P[id]!.answer!);
          expect(await bound(plain)).toEqual(answer);
          const challenge = described(placed, descriptionFor(plain, row.size));
          const sized = { ...plain, challenge };
          expect(sizeOf(sized)).toBe(row.size);
          const made = await complete(challenge);
          if (row.taken) {
            expect(made).toEqual(sized);
            expect(await bound(made)).toEqual(answer);
          } else {
            expect(made).toEqual(refused(row.expect!));
            expect(await bound(sized)).toEqual(refused(row.expect!));
          }
        });
      }
    });
  }
});

describe("mpp-charge-xrpl.json completeBlob: complete reads the blob as bound reads it, after the credential's size", () => {
  type BlobRow = { case: string; blobBytes: number; expect: string };
  const ROWS_BLOB = rowsOf<BlobRow>(load("mpp-charge-xrpl.json").completeBlob.rows, "mpp-charge-xrpl.json completeBlob.rows", { exact: 5 });
  const { placed } = setUp("mpp/charge/xrpl");
  const b2 = buyer("mpp-charge-xrpl.json", "mpp/charge/xrpl", "B2")!;
  const i = b2.input.inputs!;
  const choice = { challenge: placed, account: accountOf(b2), fee: i.fee!, sequence: i.sequence!, lastLedgerSequence: i.lastLedgerSequence! };
  const credentialOf = (blob: string) => ({ challenge: placed, payload: { type: "transaction", blob } });

  it("the credential measures 65,535 with a blob of 32,400 bytes and 65,537 with one of 32,401", () => {
    expect([sizeOf(credentialOf("00".repeat(32_400))), sizeOf(credentialOf("00".repeat(32_401)))]).toEqual([65_535, 65_537]);
  });
  for (const row of ROWS_BLOB) {
    it(row.case, async () => {
      const blob = "00".repeat(row.blobBytes);
      const made = await built(await chargeXrpl.build(choice, b2.advertised)).complete(blob);
      expect(made).toEqual(refused(row.expect));
      expect(await chargeXrpl.bound(credentialOf(blob))).toEqual(refused(row.expect));
    });
  }
});

/**
 * `envelope` with its transaction's ext set to Soroban transaction data whose footprint holds one read-only contract-data
 * key: contract id 32 bytes of 0x07, key an ScVal of `keyBytes` zero bytes, persistent; zero resources and fee.
 */
function footprinted(envelope: string, keyBytes: number): string {
  const env = xdr.TransactionEnvelope.fromXdr(envelope, "base64").toXdrObject();
  if (env.type !== 2) throw new Error("not a v1 envelope");
  const key = { type: 6, contractData: { contract: { type: 1, contractId: new Uint8Array(32).fill(7) }, key: { type: 13, bytes: new Uint8Array(keyBytes) }, durability: 1 } };
  const resources = { footprint: { readOnly: [key], readWrite: [] }, instructions: 0, diskReadBytes: 0, writeBytes: 0 };
  (env.v1.tx as { ext: unknown }).ext = { v: 1, sorobanData: { ext: { v: 0 }, resources, resourceFee: 0n } };
  return Buffer.from(xdr.TransactionEnvelope.schema.encode(env, { maxDepth: 1_000_000 })).toString("base64");
}
const SIGNATURE = new Uint8Array(64).fill(0x11);

describe("mpp-charge-stellar.json completeXdr: complete refuses a signed envelope bound refuses for its length", () => {
  type XdrRow = { case: string; keyBytes: number; simulatedLength: number; signedLength: number; taken?: true; expect?: string };
  const ROWS_XDR = rowsOf<XdrRow>(load("mpp-charge-stellar.json").completeXdr.rows, "mpp-charge-stellar.json completeXdr.rows", { exact: 3 });
  const { placed } = setUp("mpp/charge/stellar");
  const b2 = buyer("mpp-charge-stellar.json", "mpp/charge/stellar", "B2")!;
  const completed = async (keyBytes: number) => {
    const simulatedXdr = footprinted(b2.input.inputs!.simulatedXdr!, keyBytes);
    const choice = { challenge: placed, payer: accountOf(b2), now: b2.input.now ?? 0, simulatedXdr, currentLedger: b2.input.inputs!.currentLedger! };
    return { simulatedXdr, made: built(await chargeStellar.build(choice, b2.advertised)).complete(SIGNATURE) };
  };
  const credentialOf = (transaction: string) => ({ challenge: placed, payload: { type: "transaction", transaction } });

  for (const row of ROWS_XDR) {
    it(row.case, async () => {
      const { simulatedXdr, made } = await completed(row.keyBytes);
      expect(simulatedXdr.length).toBe(row.simulatedLength);
      if (row.taken) {
        const transaction = (made as MppCredential).payload["transaction"] as string;
        expect(transaction.length).toBe(row.signedLength);
        expect(made).toEqual(credentialOf(transaction));
        expect(await chargeStellar.bound(made)).toBe(b2.advertised);
      } else {
        expect(made).toEqual(refused(row.expect!));
        // The envelope complete would write: a taken row's signed envelope with this row's key, which the payer does not sign.
        const taken = (await completed(ROWS_XDR.find((r) => r.taken)!.keyBytes)).made as MppCredential;
        const over = footprinted(taken.payload["transaction"] as string, row.keyBytes);
        expect(over.length).toBe(row.signedLength);
        expect(await chargeStellar.bound(credentialOf(over))).toEqual(refused(row.expect!));
      }
    });
  }
});

// x402-exact-stellar.json V2's simulated envelope, with a footprint key as completeXdr's rows make it: the x402 build's
// complete writes the signature as the MPP one does, and refuses the same lengths its bound refuses.
describe("x402 exact Stellar: complete refuses a signed envelope over 8,192 characters, as bound does", () => {
  const X = load("x402-exact-stellar.json");
  const accepted: PaymentRequirements = X.V3.accepted;
  const required: PaymentRequired = { x402Version: 2, resource: X.fixed.resource, accepts: [accepted] };
  const complete = async (keyBytes: number) => {
    const simulatedXdr = footprinted(X.V2.simulatedXdr, keyBytes);
    expect(simulatedXdr.length).toBeLessThanOrEqual(8192);
    const choice = { required, accepted, simulatedXdr, currentLedger: X.V2.currentLedger, payer: X.fixed.payer };
    return built(await exactStellar.build(choice, X.fixed.H)).complete(SIGNATURE);
  };
  const paid = (transaction: string): StellarPaymentPayload => ({ x402Version: 2, accepted, payload: { transaction }, extensions: X.V3.extensions });

  it("the longest signed envelope within the bound is taken, and the next is refused stellar/tx-too-large", async () => {
    let n = 5000;
    while (typeof (await complete(n + 4)) === "string") n += 4;
    const within = (await complete(n)) as string;
    expect(within.length).toBeLessThanOrEqual(8192);
    expect(within.length).toBeGreaterThan(8184);
    expect(await exactStellar.bound(paid(within))).toBe(X.V3.expectBound);
    expect(await complete(n + 4)).toEqual(refused("stellar/tx-too-large"));
    const over = footprinted(within, n + 4);
    expect(over.length).toBeGreaterThan(8192);
    expect(await exactStellar.bound(paid(over))).toEqual(refused("stellar/tx-too-large"));
  });
});

// completeOrder: a complete checks the credential in its bound's order. bound measures a credential before it reads the
// payment it carries, so a payment fault in a credential over the credential size bound is mpp/credential-malformed
// from complete as from bound, and at the bound each gives the fault's own code (bound the row's bound code, or H, where
// it reads nothing of the payment).
describe("mpp-challenge.json completeOrder: a complete checks the credential in its bound's order", () => {
  type OrderRow = { case: string; pairing: string; fault: string; size: number; expect: string; bound?: string; boundTakes?: true };
  const ROWS_ORDER = rowsOf<OrderRow>(MC.completeOrder.rows, "mpp-challenge.json completeOrder.rows", { exact: 14 });
  /** The pairing's credential, completed from its B2 and B6 rows under its credentialSize challenge. */
  const taken = async (pairing: string) => {
    const { placed, complete } = setUp(pairing);
    return (await complete(placed)) as MppCredential;
  };
  /** The credential complete would make under `challenge`: the pairing's own, its payload's `field` set to `value`. */
  const swapped = async (pairing: string, challenge: Placed, field: string, value: string): Promise<MppCredential> => {
    const c = await taken(pairing);
    return { ...c, challenge, payload: { ...c.payload, [field]: value } };
  };
  const stellarB2 = buyer("mpp-charge-stellar.json", "mpp/charge/stellar", "B2")!;
  /** The Stellar build's complete under `challenge`, B2's simulated envelope given a footprint key of `keyBytes` bytes. */
  const stellarComplete = async (challenge: Placed, keyBytes: number) => {
    const i = stellarB2.input.inputs!;
    const simulatedXdr = footprinted(i.simulatedXdr!, keyBytes);
    const choice = { challenge, payer: accountOf(stellarB2), now: stellarB2.input.now ?? 0, simulatedXdr, currentLedger: i.currentLedger! };
    return built(await chargeStellar.build(choice, stellarB2.advertised)).complete(SIGNATURE);
  };
  const stacksWire = rowsOf(load("mpp-charge-usdc-stacks.json").agreedRefusals.rows as { wireHex: string; bytes?: number }[], "mpp-charge-usdc-stacks.json agreedRefusals.rows", { min: 49 })[48]!;
  const subscriptionB2 = buyer("mpp-subscription-tempo.json", "mpp/subscription/tempo", "B2")!;
  const subscriptionUnsigned = (challenge: Placed) =>
    subscriptionTempo.build({ challenge, from: accountOf(subscriptionB2) as Hex, now: subscriptionB2.input.now ?? 0 }, subscriptionB2.advertised).then(built);
  const rootSignature = `0x${"11".repeat(8192)}` as Hex;
  const evmTransactionB2 = buyer("mpp-charge-evm-transaction.json", "mpp/charge/evm/transaction", "B2")!;
  const otherChain = (TX.agreedRefusals.rows[0].transactions as Hex[])[0]!;
  const xrplB2 = buyer("mpp-charge-xrpl.json", "mpp/charge/xrpl", "B2")!;
  const lightningB2 = buyer("mpp-charge-lightning.json", "mpp/charge/lightning", "B2")!;
  const solanaB2 = buyer("mpp-session-hedera-solana-xrpl.json", "mpp/session/solana", "B2")!;
  const solanaOpen = buyer("mpp-session-hedera-solana-xrpl.json", "mpp/session/solana", "B6")!.input.presented!.payload;

  type Fault = { complete(challenge: Placed): Promise<unknown>; credential(challenge: Placed): Promise<MppCredential> };
  const FAULTS: Record<string, Fault> = {
    // complete writes and signs the envelope; bound is given completeXdr's way of it, a taken envelope given the key.
    "a signed envelope of 8,200 characters": {
      complete: (challenge) => stellarComplete(challenge, 5405),
      credential: async (challenge) => {
        const within = (await stellarComplete(setUp("mpp/charge/stellar").placed, 5401)) as MppCredential;
        const over = footprinted(within.payload["transaction"] as string, 5405);
        expect(over.length).toBe(8200);
        return swapped("mpp/charge/stellar", challenge, "transaction", over);
      },
    },
    "a transaction of 16,385 bytes": {
      complete: async (challenge) => {
        const u = built(await chargeUsdcStacks.build({ challenge, from: accountOf(buyer("mpp-charge-usdc-stacks.json", "mpp/charge/usdc/stacks", "B2")!) }, setUp("mpp/charge/usdc/stacks").h)) as { complete(tx: Uint8Array): unknown };
        return u.complete(Uint8Array.from(Buffer.from(stacksWire.wireHex.replace(/^0x/, ""), "hex")));
      },
      credential: async (challenge) => {
        expect(stacksWire.bytes).toBe(16_385);
        return swapped("mpp/charge/usdc/stacks", challenge, "transaction", Buffer.from(stacksWire.wireHex.replace(/^0x/, ""), "hex").toString("base64"));
      },
    },
    "a signed key authorization over 8,192 bytes": {
      complete: async (challenge) => (await subscriptionUnsigned(challenge)).complete(rootSignature),
      credential: async (challenge) => {
        const u = await subscriptionUnsigned(setUp("mpp/subscription/tempo").placed);
        const unsigned = encodeKeyAuthorization(u.request.authorization) as Uint8Array;
        const signed = rlpList([unsigned, rlpBytes(Buffer.from(rootSignature.slice(2), "hex"))]);
        expect(signed.length).toBeGreaterThan(8192);
        return swapped("mpp/subscription/tempo", challenge, "signature", toHex(signed));
      },
    },
    "a blob of 2,049 bytes": {
      complete: async (challenge) => {
        const i = xrplB2.input.inputs!;
        const choice = { challenge, account: accountOf(xrplB2), fee: i.fee!, sequence: i.sequence!, lastLedgerSequence: i.lastLedgerSequence! };
        return built(await chargeXrpl.build(choice, xrplB2.advertised)).complete("00".repeat(2049));
      },
      credential: (challenge) => swapped("mpp/charge/xrpl", challenge, "blob", "00".repeat(2049)),
    },
    "an EIP-1559 transaction for chain 1": {
      complete: async (challenge) =>
        built(await evmTransaction.build({ challenge, from: accountOf(evmTransactionB2) as Hex, now: evmTransactionB2.input.now ?? 0 }, evmTransactionB2.advertised)).complete(otherChain),
      credential: (challenge) => swapped("mpp/charge/evm/transaction", challenge, "signature", otherChain),
    },
    "a preimage that is not 64 hex digits": {
      complete: async (challenge) => built(await chargeLightning.build({ challenge }, lightningB2.advertised)).complete("00"),
      credential: (challenge) => swapped("mpp/charge/lightning", challenge, "preimage", "00"),
    },
    "an opening whose action is voucher": {
      complete: (challenge) => P["mpp/session/solana"]!.run(challenge, solanaB2, { payload: { ...solanaOpen, action: "voucher" } }),
      credential: (challenge) => swapped("mpp/session/solana", challenge, "action", "voucher"),
    },
  };

  it("each row names a pairing of credentialSize and a fault this test makes", () => {
    for (const row of ROWS_ORDER) {
      expect(PAIRINGS).toContain(row.pairing);
      expect(Object.keys(FAULTS)).toContain(row.fault);
    }
  });
  for (const row of ROWS_ORDER) {
    it(row.case, async () => {
      const { placed, h } = setUp(row.pairing);
      const fault = FAULTS[row.fault]!;
      const challenge = described(placed, descriptionFor(await fault.credential(placed), row.size));
      const presented = await fault.credential(challenge);
      expect(sizeOf(presented)).toBe(row.size);
      expect(await fault.complete(challenge)).toEqual(refused(row.expect));
      expect(await P[row.pairing]!.bound(presented)).toEqual(row.boundTakes ? h : refused(row.bound ?? row.expect));
    });
  }
});

// voucherSize: a session build's voucher measures the credential its complete would give with a one-byte voucher
// signature, as complete measures every credential, and refuses with complete's code before the voucher is signed.
describe("mpp-challenge.json voucherSize: a session build's voucher measures as its complete does", () => {
  type VoucherRow = { case: string; size: number; taken?: true; expect?: string };
  const ROWS_VOUCHER = rowsOf<VoucherRow>(MC.voucherSize.rows, "mpp-challenge.json voucherSize.rows", { exact: 2 });
  type Voucher = { voucher(funded: Hex): unknown; complete(funded: Hex, voucherSignature: Hex): unknown };
  /** Each session build with a voucher: its build under a challenge, from its B2 row, and its B6 funding. */
  const SESSIONS: Record<string, { build(challenge: Placed): Promise<Voucher>; funded: Hex }> = {
    "mpp/session/evm": {
      build: async (challenge) => {
        const b2 = buyer("mpp-session-evm.json", "mpp/session/evm", "B2")!;
        const i = b2.input.inputs!;
        const choice = { challenge, from: accountOf(b2) as Hex, now: b2.input.now ?? 0, deposit: BigInt(i.deposit!), credentialType: i.credentialType!, tokenDomain: i.tokenDomain! };
        return built(await sessionEvm.build(choice, b2.advertised));
      },
      funded: buyer("mpp-session-evm.json", "mpp/session/evm", "B6")!.input.presented!.payload["signature"] as Hex,
    },
    "mpp/session/tempo": {
      build: async (challenge) => {
        const b2 = buyer("mpp-session-tempo.json", "mpp/session/tempo", "B2")!;
        const choice = { challenge, from: accountOf(b2) as Hex, now: b2.input.now ?? 0, deposit: BigInt(b2.input.inputs!.deposit!) };
        return built(await sessionTempo.build(choice, b2.advertised));
      },
      funded: buyer("mpp-session-tempo.json", "mpp/session/tempo", "B6")!.input.presented!.payload["transaction"] as Hex,
    },
  };
  for (const [id, session] of Object.entries(SESSIONS)) {
    describe(id, () => {
      for (const row of ROWS_VOUCHER) {
        it(row.case, async () => {
          const { placed } = setUp(id);
          const shortest = (await session.build(placed)).complete(session.funded, "0x00") as MppCredential;
          expect(shortest).not.toHaveProperty("refused");
          const challenge = described(placed, descriptionFor(shortest, row.size));
          const sized = { ...shortest, challenge };
          expect(sizeOf(sized)).toBe(row.size);
          const u = await session.build(challenge);
          if (row.taken) {
            expect(u.voucher(session.funded)).toEqual((await session.build(placed)).voucher(session.funded));
            expect(u.voucher(session.funded)).toHaveProperty("primaryType", "Voucher");
            expect(u.complete(session.funded, "0x00")).toEqual(sized);
          } else {
            expect(u.voucher(session.funded)).toEqual(refused(row.expect!));
            expect(u.complete(session.funded, "0x00")).toEqual(refused(row.expect!));
          }
        });
      }
    });
  }
});

// inChannelSize on the two session pairings with channel members and no buildWithin: channel.kind, channel.ref and
// channel.boundWithin measure the payment they are given, here the pairing's opening, padded as credentialSize pads it.
describe("mpp-challenge.json inChannelSize: the channel members of the sessions without a buildWithin", () => {
  const ROWS_IN = rowsOf<SizeRow>(MC.inChannelSize.rows, "mpp-challenge.json inChannelSize.rows", { exact: 3 });
  type Members = { kind(p: MppCredential): unknown; ref(p: MppCredential): Promise<unknown>; boundWithin(p: MppCredential): Promise<unknown> };
  const MEMBERS: Record<string, Members> = { "mpp/session/lightning": sessionLightning.channel, "mpp/subscription/tempo": subscriptionTempo.channel };
  const answers = async (m: Members, c: MppCredential) => [m.kind(c), await m.ref(c), await m.boundWithin(c)];
  for (const [id, members] of Object.entries(MEMBERS)) {
    describe(id, () => {
      for (const row of ROWS_IN) {
        it(row.case, async () => {
          const { placed, complete } = setUp(id);
          const plain = (await complete(placed)) as MppCredential;
          const sized = { ...plain, challenge: described(placed, descriptionFor(plain, row.size)) };
          expect(sizeOf(sized)).toBe(row.size);
          if (row.taken) expect(await answers(members, sized)).toEqual(await answers(members, plain));
          else expect(await answers(members, sized)).toEqual([refused(row.expect!), refused(row.expect!), refused(row.expect!)]);
        });
      }
    });
  }
});

// buildChallenge: each MPP build holds the chosen challenge as bound holds the challenge a credential echoes, with
// bound's code for each fault, in bound's order, before it builds anything, so no complete is handed a challenge bound
// refuses.
describe("mpp-challenge.json buildChallenge: each build holds the chosen challenge as bound holds an echoed one", () => {
  type ChallengeRow = { case: string; opaque?: string | null; legalContext?: string; leastSize?: number; expect: string };
  const ROWS_CHALLENGE = rowsOf<ChallengeRow>(MC.buildChallenge.rows, "mpp-challenge.json buildChallenge.rows", { exact: 5 });
  /** `placed` with the row's fault. */
  const faulty = (placed: Placed, row: ChallengeRow): Placed => {
    if (row.opaque === null) {
      const { opaque: _, ...rest } = placed;
      return rest;
    }
    if (row.opaque !== undefined) return { ...placed, opaque: row.opaque };
    if (row.legalContext !== undefined) {
      const map = JSON.parse(Buffer.from(placed.opaque!, "base64url").toString("utf8")) as Record<string, string>;
      return { ...placed, opaque: Buffer.from(JSON.stringify({ ...map, legalContext: row.legalContext })).toString("base64url") };
    }
    return described(placed, descriptionFor({ challenge: placed, payload: {} }, row.leastSize!));
  };

  it("each row makes one fault", () => {
    for (const row of ROWS_CHALLENGE) {
      expect([row.opaque !== undefined, row.legalContext !== undefined, row.leastSize !== undefined].filter(Boolean)).toHaveLength(1);
    }
  });
  for (const id of PAIRINGS) {
    describe(id, () => {
      for (const row of ROWS_CHALLENGE) {
        it(row.case, async () => {
          const { placed, complete } = setUp(id);
          expect(placed.opaque).toBeDefined();
          const plain = (await complete(placed)) as MppCredential;
          const challenge = faulty(placed, row);
          if (row.leastSize !== undefined) expect(sizeOf({ challenge, payload: {} })).toBe(row.leastSize);
          expect(await answered(complete(challenge))).toEqual({ by: "build", answer: refused(row.expect) });
          expect(await P[id]!.bound({ ...plain, challenge })).toEqual(refused(row.expect));
        });
      }
    });
  }

  // The EVM transaction charge's complete holds the echoed challenge (echoedFor) before it reads the transaction, as
  // bound does: so whatever transaction it is given, build and complete give bound's code for the row's challenge.
  describe("mpp/charge/evm/transaction: build and complete give bound's code, whatever the transaction", () => {
    const b2 = buyer("mpp-charge-evm-transaction.json", "mpp/charge/evm/transaction", "B2")!;
    const run = async (challenge: Placed, signature: Hex) =>
      built(await evmTransaction.build({ challenge, from: accountOf(b2) as Hex, now: b2.input.now ?? 0 }, b2.advertised)).complete(signature);
    for (const row of ROWS_CHALLENGE) {
      it(row.case, async () => {
        const { placed } = setUp("mpp/charge/evm/transaction");
        const plain = (await run(placed, await mv11Transaction())) as MppCredential;
        const challenge = faulty(placed, row);
        for (const signature of ["0xzz", "0x02c0", await mv11Transaction()] as Hex[]) {
          expect((await answered(run(challenge, signature))).answer).toEqual(refused(row.expect));
          expect(await evmTransaction.bound({ ...plain, challenge, payload: { ...plain.payload, signature } })).toEqual(refused(row.expect));
        }
      });
    }
  });
});

// A session complete reads the opening it is given as bound reads it, in bound's order. The Solana session's complete
// refuses an opening that is not an object with mpp/credential-malformed, as bound refuses a credential carrying it;
// the XRPL session's reads the blob's type in bound's read of the opening (xrpl/blob-malformed), and the claim
// signature, which bound does not read, after it.
describe("a session complete gives bound's code for an opening member of another type, in bound's order", () => {
  const FILE = "mpp-session-hedera-solana-xrpl.json";

  it("mpp/session/solana: an opening that is not an object is mpp/credential-malformed, as bound gives it", async () => {
    const b2 = buyer(FILE, "mpp/session/solana", "B2")!;
    const { placed } = setUp("mpp/session/solana");
    for (const open of [null, "x", 5]) {
      expect(await P["mpp/session/solana"]!.run(placed, b2, { payload: open as never })).toEqual(refused("mpp/credential-malformed"));
      expect(await sessionSolana.bound({ challenge: placed, payload: open })).toEqual(refused("mpp/credential-malformed"));
    }
  });

  it("mpp/session/xrpl: a blob that is not a string is xrpl/blob-malformed, before the claim signature, as bound gives it", async () => {
    const b2 = buyer(FILE, "mpp/session/xrpl", "B2")!;
    const b6 = buyer(FILE, "mpp/session/xrpl", "B6")!.input.presented!;
    const { placed, h } = setUp("mpp/session/xrpl");
    const run = (payload: Payload) => P["mpp/session/xrpl"]!.run(placed, b2, { payload });
    const plain = (await run(b6.payload)) as MppCredential;
    for (const signature of [b6.payload["signature"] as string, "zz"]) {
      expect(await run({ ...b6.payload, transaction: 5, signature })).toEqual(refused("xrpl/blob-malformed"));
      expect(await sessionXrpl.bound({ ...plain, payload: { ...plain.payload, transaction: 5, signature } })).toEqual(refused("xrpl/blob-malformed"));
    }
    // A claim signature that is not hex is complete's own check: bound does not read it.
    expect(await run({ ...b6.payload, signature: "zz" })).toEqual(refused("mpp/credential-malformed"));
    expect(await sessionXrpl.bound({ ...plain, payload: { ...plain.payload, signature: "zz" } })).toBe(h);
  });
});
