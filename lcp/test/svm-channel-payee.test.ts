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
import { decodeSvmTx, keyString, type SolanaNetwork } from "../src/internal/svm.js";

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

// ── the program's distribution (F11) and openings beside other payment-channels instructions (row 26) ──────────────
// Each case rewrites a recorded opening's wire with another deposit or distribution, a payee account repointed at the
// buyer (account 0), or another payment-channels instruction appended. The read takes only the discriminators, the
// open's accounts and its data, so the shapes need not be ones the program would land (it refuses a payee equal to the
// payer, and a real request_close names the channel): they stand for the shapes the round-6 trial lands for real. The read takes the
// rewritten wire as landed; the program's `distribute` pays each recipient floor(deposit × bps / 10,000) and the payee
// account floor(deposit × (10,000 − Σ bps) / 10,000) (`payment-channels` `instructions/distribute.rs`), which the trial
// `round-6/solana --only f11` checks against the real program on a local validator.

const THIRD = base58.encode(new Uint8Array(32).fill(7));

function cu16(b: Uint8Array, at: number): [number, number] {
  let v = 0;
  let s = 0;
  for (;;) {
    const x = b[at++]!;
    v |= (x & 0x7f) << s;
    if (!(x & 0x80)) return [v, at];
    s += 7;
  }
}
function enc16(v: number): number[] {
  const o: number[] = [];
  for (;;) {
    const x = v & 0x7f;
    v >>= 7;
    if (v === 0) return [...o, x];
    o.push(x | 0x80);
  }
}

interface Variant {
  /** The open's distribution, by recipient and bps; the recorded opens hold none. */
  recipients?: readonly [string, number][];
  /** Repoint the open's payee account (account 2) at its payer (account 0), a key of the buyer's. */
  payeeIsBuyer?: true;
  /** The open's deposit, in place of the recorded one. */
  deposit?: bigint;
  /** Payment-channels instructions appended after the open: their data, with the open's own first `n` accounts. */
  append?: readonly { data: number[]; accounts: number }[];
}

/** The wire with its one `open` rewritten, and the instructions appended, as `Variant` says. */
function rewrite(wire: Uint8Array, v: Variant): Uint8Array {
  let [nsig, at] = cu16(wire, 0);
  at += 64 * nsig;
  if (wire[at]! & 0x80) at += 1;
  at += 3;
  let nkeys: number;
  [nkeys, at] = cu16(wire, at);
  at += 32 * nkeys + 32;
  const head = wire.subarray(0, at);
  let nix: number;
  [nix, at] = cu16(wire, at);
  const ixs: { program: number; accounts: number[]; data: number[] }[] = [];
  for (let i = 0; i < nix; i++) {
    const program = wire[at++]!;
    let na: number;
    [na, at] = cu16(wire, at);
    const accounts = [...wire.subarray(at, at + na)];
    at += na;
    let nd: number;
    [nd, at] = cu16(wire, at);
    ixs.push({ program, accounts, data: [...wire.subarray(at, at + nd)] });
    at += nd;
  }
  const tail = wire.subarray(at);
  const open = ixs.find((ix) => ix.data[0] === 1 && ix.data.length === 33);
  if (open === undefined) throw new Error("no open with an empty distribution");
  const recipients = v.recipients ?? [];
  const data = new Uint8Array(33 + 34 * recipients.length);
  data.set(open.data);
  const view = new DataView(data.buffer);
  view.setUint32(29, recipients.length, true);
  if (v.deposit !== undefined) view.setBigUint64(9, v.deposit, true);
  recipients.forEach(([r, bps], i) => {
    data.set(base58.decode(r), 33 + 34 * i);
    view.setUint16(65 + 34 * i, bps, true);
  });
  const appended = (v.append ?? []).map((a) => ({ program: open.program, accounts: open.accounts.slice(0, a.accounts), data: a.data }));
  open.data = [...data];
  if (v.payeeIsBuyer) open.accounts[2] = open.accounts[0]!;
  const all = [...ixs, ...appended];
  return Uint8Array.from([
    ...head,
    ...enc16(all.length),
    ...all.flatMap((ix) => [ix.program, ...enc16(ix.accounts.length), ...ix.accounts, ...enc16(ix.data.length), ...ix.data]),
    ...tail,
  ]);
}

/** The read of the recorded opening `r` with its wire rewritten as `v` says, in both lookups. */
async function readAs(r: (typeof F.reads)[number], v: Variant) {
  const landedTx = answer<RpcTransaction>("getTransaction", [r.transaction, { encoding: "base64", maxSupportedTransactionVersion: 1, commitment: "finalized" }]);
  const wire = rewrite(bytes(landedTx.transaction[0]), v);
  const rewritten: SvmReader = {
    ...reader,
    async transaction(signature, commitment) {
      const got = await reader.transaction(signature, commitment);
      return signature === r.transaction && "wire" in got ? { ...got, wire } : got;
    },
  };
  const tx = decodeSvmTx(wire);
  if ("code" in tx) throw new Error(tx.code);
  const keys = await svmReference(F.network, tx);
  if ("code" in keys) throw new Error(keys.code);
  const status = await READS[r.read]({ ...keys, h: r.h, payee: F.payee }, rewritten, { act: "payment", finality: "finalized", after: BigInt(r.after) });
  const buyer = keyString(tx.keys[tx.instructions.find((ix) => ix.data[0] === 1)!.accounts[0]!]!);
  return { status, buyer, keys };
}

/** The recorded open's deposit. */
function depositOf(r: (typeof F.reads)[number]): bigint {
  const landedTx = answer<RpcTransaction>("getTransaction", [r.transaction, { encoding: "base64", maxSupportedTransactionVersion: 1, commitment: "finalized" }]);
  const tx = decodeSvmTx(bytes(landedTx.transaction[0]));
  if ("code" in tx) throw new Error(tx.code);
  const d = tx.instructions.find((ix) => ix.data[0] === 1)!.data;
  return new DataView(d.buffer, d.byteOffset, d.byteLength).getBigUint64(9, true);
}

const share = (r: (typeof F.reads)[number], to: string, amount: bigint) => ({ to, beneficiary: to, amount: amount.toString(), contract: r.channel, transaction: r.transaction, place: 0 });

it.each(F.reads)("F11: an open whose distribution pays the payee nothing is no payment to the payee, its twin a split that pays it half: $name", async (r) => {
  const d = depositOf(r);
  const none = await readAs(r, { recipients: [[THIRD, 10_000]] });
  expect(none.status.state).not.toBe("settled");
  expect(JSON.stringify(none.status, (_, x) => (typeof x === "bigint" ? x.toString() : x))).not.toContain(`"to":"${F.payee}"`);
  const half = await readAs(r, { recipients: [[THIRD, 5_000]] });
  expect(half.status).toMatchObject({ state: "settled", transaction: r.transaction, moved: [share(r, THIRD, d / 2n), share(r, F.payee, (d * 5_000n) / 10_000n)] });
  // The payee account's share is floor(deposit × its bps / 10,000), not what the recipients leave: on 1,001 split
  // [third 3,333] the program pays the third 333 and the payee 667 (6,667 bps), the rounding dust going to its treasury.
  const odd = await readAs(r, { deposit: 1_001n, recipients: [[THIRD, 3_333]] });
  expect(odd.status).toMatchObject({ state: "settled", moved: [share(r, THIRD, 333n), share(r, F.payee, 667n)] });
  const odd2 = await readAs(r, { deposit: 1_000n, recipients: [[THIRD, 3_333]] });
  expect(odd2.status).toMatchObject({ state: "settled", moved: [share(r, THIRD, 333n), share(r, F.payee, 666n)] });
  // The boundary: 1 bps left to the payee of a deposit of 5 rounds down to 0, so the program pays the payee nothing.
  const dust = await readAs(r, { deposit: 5n, recipients: [[THIRD, 9_999]] });
  expect(dust.status.state).not.toBe("settled");
});

it.each(F.reads)("F11, the reverse: a payee account of the buyer's, the payee 1%, reads the payee's own share, not the deposit: $name", async (r) => {
  const d = depositOf(r);
  const reverse = await readAs(r, { payeeIsBuyer: true, recipients: [[F.payee, 100], [THIRD, 9_900]] });
  expect(reverse.status).toMatchObject({
    state: "settled",
    moved: [share(r, F.payee, (d * 100n) / 10_000n), share(r, THIRD, (d * 9_900n) / 10_000n)],
  });
  expect(reverse.status).toHaveProperty("moved.length", 2);
  // 1 bps of a deposit below 10,000 rounds down to 0: the program pays the payee nothing, so the open is no payment to
  // it (the variant of scripts/svm-split-variant.mjs, which the report on F11 ran against this fixture).
  expect(d).toBeLessThan(10_000n);
  const dust = await readAs(r, { payeeIsBuyer: true, recipients: [[F.payee, 1], [THIRD, 9_999]] });
  expect(dust.status.state).not.toBe("settled");
  expect(JSON.stringify(dust.status, (_, x) => (typeof x === "bigint" ? x.toString() : x))).not.toContain(`"to":"${F.payee}"`);
  // The x402 stock shape: the payee account another's, the distribution the payee's whole; the payee takes the deposit.
  const stock = await readAs(r, { payeeIsBuyer: true, recipients: [[F.payee, 10_000]] });
  expect(stock.status).toMatchObject({ state: "settled", moved: [share(r, F.payee, d)] });
  expect(stock.status).toHaveProperty("moved.length", 1);
});

it.each(F.reads)("row 26: an open beside a top_up is still the opening; beside a request_close, or a second open, it is none: $name", async (r) => {
  const d = depositOf(r);
  const topUp = await readAs(r, { append: [{ data: [3, ...new Uint8Array(new BigUint64Array([500_000n]).buffer)], accounts: 6 }] });
  expect(topUp.status).toMatchObject({ state: "settled", moved: [share(r, F.payee, d)] });
  expect(topUp.keys.payer).toBe(topUp.buyer);
  // A request_close in the opening starts the close: the payer may seal and withdraw after the grace period, before
  // the seller settles (round-6 sweep "open + requestClose in the same transaction"), so it is no opening.
  const requestClose = await readAs(r, { append: [{ data: [5], accounts: 2 }] });
  expect(requestClose.status.state).not.toBe("settled");
  const twoOpens = await readAs(r, { append: [{ data: [1, ...new Uint8Array(32)], accounts: 6 }] });
  expect(twoOpens.status.state).not.toBe("settled");
});
