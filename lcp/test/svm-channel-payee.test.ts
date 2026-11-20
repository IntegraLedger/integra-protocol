// Replays fixtures/svm-channel-opens-devnet.json: two payment-channel openings on Solana devnet whose `open` names the
// seller as its payee account and holds no distribution, read through the recorded JSON-RPC answers. The reader turns
// each answer into the shape `SvmReader` documents (getTransaction's base64 wire, its loaded addresses, inner
// instructions and token balances; getSignaturesForAddress's entries; isBlockhashValid's value and context slot).
import { readFileSync } from "node:fs";
import { base58 } from "@scure/base";
import { expect, it } from "vitest";
import type { AtrHash } from "../src/index.js";
import { svmChannelStatus, svmOpeningStatus } from "../src/svm.js";
import { svmReference, type SvmLanded, type SvmReader } from "../src/internal/svm-read.js";
import { decodeSvmTx, type SolanaNetwork } from "../src/internal/svm.js";

interface Call {
  request: { method: string; params: unknown[] };
  answer: unknown;
}
const F = JSON.parse(readFileSync(new URL("./fixtures/svm-channel-opens-devnet.json", import.meta.url), "utf8")) as {
  network: SolanaNetwork;
  payee: string;
  reads: { name: string; read: "svmChannelStatus" | "svmOpeningStatus"; transaction: string; h: AtrHash; after: string; channel: string }[];
  calls: Call[];
};

/** getTransaction's result with encoding `base64`, in the members the read takes. */
interface RpcTransaction {
  slot: number;
  transaction: [string, "base64"];
  meta: {
    err: unknown;
    loadedAddresses?: { writable: string[]; readonly: string[] };
    innerInstructions?: { index: number; instructions: { programIdIndex: number; accounts: number[]; data: string }[] }[];
    preTokenBalances?: { accountIndex: number; mint: string; owner: string }[];
    postTokenBalances?: { accountIndex: number; mint: string; owner: string }[];
  };
}

function answer<T>(method: string, params: unknown[]): T {
  const key = JSON.stringify({ method, params });
  const found = F.calls.find((c) => JSON.stringify(c.request) === key);
  if (found === undefined) throw new Error(`no recorded answer: ${key}`);
  return found.answer as T;
}

const bytes = (s: string) => new Uint8Array(Buffer.from(s, "base64"));

function landedOf(r: RpcTransaction): SvmLanded {
  const inner = (r.meta.innerInstructions ?? []).flatMap((g) =>
    g.instructions.map((ix) => ({ index: g.index, program: ix.programIdIndex, accounts: ix.accounts, data: base58.decode(ix.data) })),
  );
  const balances = (list: RpcTransaction["meta"]["preTokenBalances"]) => (list ?? []).map((b) => ({ account: b.accountIndex, mint: b.mint, owner: b.owner }));
  return {
    wire: bytes(r.transaction[0]),
    err: r.meta.err,
    slot: BigInt(r.slot),
    loaded: {
      writable: (r.meta.loadedAddresses?.writable ?? []).map((a) => base58.decode(a)),
      readonly: (r.meta.loadedAddresses?.readonly ?? []).map((a) => base58.decode(a)),
    },
    inner,
    pre: balances(r.meta.preTokenBalances),
    post: balances(r.meta.postTokenBalances),
  };
}

const reader: SvmReader = {
  network: F.network,
  async transaction(signature, commitment) {
    const slot = answer<number>("getSlot", [{ commitment }]);
    const r = answer<RpcTransaction | null>("getTransaction", [signature, { encoding: "base64", maxSupportedTransactionVersion: 1, commitment }]);
    return r === null ? { notFound: true, slot: BigInt(slot) } : landedOf(r);
  },
  async signatures(address, { minContextSlot, ...page }) {
    const r = answer<{ signature: string; slot: number; memo: string | null }[]>("getSignaturesForAddress", [
      address,
      { ...page, ...(minContextSlot === undefined ? {} : { minContextSlot: Number(minContextSlot) }) },
    ]);
    return r.map((e) => ({ signature: e.signature, slot: BigInt(e.slot), memo: e.memo }));
  },
  async slot(commitment) {
    return BigInt(answer<number>("getSlot", [{ commitment }]));
  },
  async blockhashValid(blockhash, commitment) {
    const r = answer<{ value: boolean; context: { slot: number } }>("isBlockhashValid", [blockhash, { commitment }]);
    return { valid: r.value, slot: BigInt(r.context.slot) };
  },
  async firstAvailableBlock() {
    return BigInt(answer<number>("getFirstAvailableBlock", []));
  },
  async account() {
    throw new Error("no account read is recorded");
  },
};

const READS = { svmChannelStatus, svmOpeningStatus };

it.each(F.reads)("an open naming the payee as its payee account, with no distribution, is the sale: $name", async (r) => {
  const landed = answer<RpcTransaction>("getTransaction", [r.transaction, { encoding: "base64", maxSupportedTransactionVersion: 1, commitment: "finalized" }]);
  const tx = decodeSvmTx(bytes(landed.transaction[0]));
  if ("code" in tx) throw new Error(tx.code);
  const keys = await svmReference(F.network, tx);
  if ("code" in keys) throw new Error(keys.code);
  const status = await READS[r.read]({ ...keys, h: r.h, payee: F.payee }, reader, { act: "payment", finality: "finalized", after: BigInt(r.after) });
  expect(status).toMatchObject({
    state: "settled",
    transaction: r.transaction,
    presented: "yes",
    moved: [{ to: F.payee, contract: r.channel, beneficiary: F.payee, transaction: r.transaction, place: 0 }],
  });
});
