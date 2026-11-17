// The read kit's form of x402/exact/sui: each case of read-status.json arranged on a constructed Sui GraphQL endpoint
// (no endpoint was read), its transactions built with @mysten/sui (the workspace's development dependency) and digested
// by it, and read through the pairing's own `status`; the answer is put back in the case's terms. A transaction the
// case names is the one with the reference's digest where it consumed the single-use value, the digest, unless the case
// states it is not the payment presented, and otherwise one the search for H returns; the case's positions are
// checkpoints; a case that gives no position reads after checkpoint 0; where no transaction consumed the digest and the
// case reads no value, the digest's epoch has passed so that the read searches, from the position the case gives, for the
// reference's sender, to one past the head. The form skips exactly the cases the profile's rule 18 declares.
import { readFileSync } from "node:fs";
import { Transaction, TransactionDataBuilder } from "@mysten/sui/transactions";
import { exactSui, type SuiReader, type SuiRef } from "../../../src/sui.js";
import type { Act, Moved } from "../../../src/internal/read.js";
import type { CaseAnswer, DeclaredForm, Inapplicable, ReadCase } from "../form.js";
import { ACTS, answering, READ_STATUS } from "../harness.js";

const V = JSON.parse(readFileSync(new URL("../../../vectors/x402-exact-sui.json", import.meta.url), "utf8"));
const H: `0x${string}` = V.fixed.H;
const PAYER: string = V.fixed.sender;
const PAYEE: string = V.fixed.payTo;
const OTHER: string = V.fixed.other;
const ELSEWHERE = "0x" + "55".repeat(32);
const NOT_H = Uint8Array.from(Buffer.from("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "hex"));
const UNTIL = 1000;
/** A coin object's digest for the payer's own coin in another type: base58 of 32 bytes, constructed. */
const COIN_DIGEST = TransactionDataBuilder.getDigestFromBytes(Uint8Array.of(0xc0));
/** The case's assets and accounts, and the coin types and addresses they stand for. */
const ASSET: Record<string, string> = { A: "0x2::sui::SUI", B: "0xb::usdc::USDC" };
const ACCOUNT: Record<string, string> = { payee: PAYEE, elsewhere: ELSEWHERE };
const PARTY: Record<string, string> = { payer: PAYER, payee: PAYEE, other: OTHER };
const back = (m: Record<string, string>, v: string): string => Object.entries(m).find(([, x]) => x === v)?.[0] ?? v;

const RULE = "the profile x402-exact-sui.md, rule 18";

/** Every case whose text opens with `opening`, on both acts; a declaration that names no case is a fault of the form. */
function byWords(opening: string, why: string): Inapplicable[] {
  const named = READ_STATUS.cases.filter((c) => c.case.startsWith(opening));
  if (named.length === 0) throw new Error(`no case of read-status.json opens with "${opening}"`);
  return named.map((c) => ({ case: c.case, stated: `${RULE} (${why})` }));
}

/** Each case at coverage full whose answer on an act carries `reason`, on those acts. */
function byReasonAtFull(reason: string, why: string): Inapplicable[] {
  const full = new Set(READ_STATUS.cases.filter((c) => c.coverage === "full").map((c) => c.case));
  return answering(reason, `${RULE} (${why})`).filter((d) => full.has(d.case));
}

/** One statement for each case and act, the first that names it. */
function once(list: readonly Inapplicable[]): Inapplicable[] {
  const out: Inapplicable[] = [];
  const taken = new Set<string>();
  for (const d of list) {
    const acts = (d.acts ?? ACTS).filter((a) => !taken.has(`${d.case}\u0000${a}`));
    for (const a of acts) taken.add(`${d.case}\u0000${a}`);
    if (acts.length > 0) out.push({ ...d, acts });
  }
  return out;
}

const VALUE_IS_THE_TRANSACTION = "a value read consumed whose transaction is not found, since the value is the transaction";
const NO_CHECKPOINT = "a transaction below the final mark is in no checkpoint, so has no position";
const NOT_PLACED = "every transaction the read meets is in a checkpoint or after all of them";
const DIGEST_READ = "the read reads the digest at the latest checkpoint";
const SEARCH_BEFORE_FAILED = "the search is made only before a failed";
const GATE = "while the search proves no absence, rule 15: its gate holds the case";

/** The cases the profile declares inapplicable to the read kit (rule 18), by reason, by their opening words, and by the gate. */
export const DECLARED: readonly Inapplicable[] = once([
  ...answering("not-found", `${RULE} (not-found, since the read reads the digest, the single-use value itself)`),
  ...byWords("a value read consumed whose transaction the search has not found", VALUE_IS_THE_TRANSACTION),
  ...byWords("a value unconsumed at the final mark and consumed at the latest head", VALUE_IS_THE_TRANSACTION),
  ...byWords("a value whose validity passed, unconsumed at the final mark and consumed at the latest head", VALUE_IS_THE_TRANSACTION),
  ...byWords("an act read at the finality asked for, below the final mark", "a seller names the one mark"),
  ...byWords("an act found above the final head", NO_CHECKPOINT),
  ...byWords("a transaction that consumed the value, read below the final mark", NO_CHECKPOINT),
  ...byWords("below-mark is answered before instrument-live", NO_CHECKPOINT),
  ...byWords("the validity passed with the value unconsumed, read below the final mark", "the epoch is read at a final checkpoint"),
  ...byWords("an act of another pairing or kind carrying H", "every transaction whose one unused Pure input is H is an act of this one pairing"),
  ...byWords("an act the read cannot place against the position given", NOT_PLACED),
  ...byWords("an item the search could not decode that gives no position", NOT_PLACED),
  ...byWords("a read with no means to read the single-use value", DIGEST_READ),
  ...byWords("search-incomplete is answered before not-found", DIGEST_READ),
  ...byWords("a read that did not read the value at the latest head", DIGEST_READ),
  ...byWords(
    "each transfer of what moved is named by its transaction and its place in it",
    "the effects carry one net balance change per owner and coin type, so two transfers of one asset to one account in one transaction are one entry of what moved",
  ),
  ...byWords("the settled act's answer names every foreign item", SEARCH_BEFORE_FAILED),
  ...byWords("instrument-live is answered before search-incomplete", SEARCH_BEFORE_FAILED),
  ...byWords("instrument-live is answered before an item the search could not decode", SEARCH_BEFORE_FAILED),
  ...byReasonAtFull("instrument-unused", GATE),
  ...byReasonAtFull("instrument-consumed", GATE),
  ...byReasonAtFull("transaction-failed", GATE),
]);

type Seen = ReadCase["facts"]["seen"][number];
type Built = { b64: string; digest: string; seen: Seen };

let salt = 0;

/** A transaction a case's row stands for: its sender, H or not, and the transfer its account and moved name. */
async function build(seen: Seen | undefined, carries: boolean): Promise<{ b64: string; digest: string }> {
  const tx = new Transaction();
  tx.setSender(seen === undefined ? PAYER : PARTY[seen.party]!);
  tx.pure(carries ? Uint8Array.from(Buffer.from(H.slice(2), "hex")) : NOT_H);
  const first = seen?.moved?.[0];
  const to = first !== undefined ? ACCOUNT[first.to] : seen?.account === "payee" || seen === undefined ? PAYEE : seen.account === "other" ? ELSEWHERE : undefined;
  if (to !== undefined && first !== undefined && first.asset !== "A") {
    // Another coin type: `0x2::coin::send_funds<T>` of a coin the payer owns, so the command shows the type it moved.
    const coin = tx.objectRef({ objectId: "0x" + "c0".repeat(32), version: "1", digest: COIN_DIGEST });
    tx.moveCall({ target: "0x2::coin::send_funds", typeArguments: [ASSET[first.asset]!], arguments: [coin, tx.pure.address(to)] });
  } else if (to !== undefined) {
    const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(first === undefined ? 1 : Number(first.amount))]);
    tx.transferObjects([coin!], tx.pure.address(to));
  }
  tx.setGasPrice(1000);
  tx.setGasBudget(5_000_000 + salt++);
  tx.setGasPayment([]);
  tx.setExpiration({ Epoch: UNTIL });
  const bytes = await tx.build();
  return { b64: Buffer.from(bytes).toString("base64"), digest: TransactionDataBuilder.getDigestFromBytes(bytes) };
}

/** The balance changes a row's moved, or its account, shows: each positive transfer credits its account. */
function changesOf(seen: Seen): { owner: string; coinType: string; amount: bigint }[] {
  const moved = seen.moved ?? (seen.account === "payee" ? [{ asset: "A", amount: "1", to: "payee" }] : seen.account === "other" ? [{ asset: "A", amount: "1", to: "elsewhere" }] : []);
  return moved.filter((m) => BigInt(m.amount) > 0n).map((m) => ({ owner: ACCOUNT[m.to]!, coinType: ASSET[m.asset]!, amount: BigInt(m.amount) }));
}

const executed = (b: Built) => ({
  transactionBcs: Uint8Array.from(Buffer.from(b.b64, "base64")),
  status: b.seen.result === "succeeded" ? ("SUCCESS" as const) : ("FAILURE" as const),
  checkpoint: b.seen.position === undefined ? null : BigInt(b.seen.position),
  balanceChanges: changesOf(b.seen),
});

async function run(c: ReadCase, act: Act): Promise<CaseAnswer> {
  const f = c.facts;
  const after = BigInt(c.query.after ?? 0);
  // The digest names the payment presented: a case whose act is another message (presented no) is a transaction the
  // search finds under its own digest, the presented one never landing.
  const consumedRow = f.seen.find((s) => s.consumed && s.presented !== "no");
  const own: Built | { b64: string; digest: string } =
    consumedRow === undefined ? await build(undefined, true) : { ...(await build(consumedRow, consumedRow.carries)), seen: consumedRow };
  const found: Built[] = [];
  for (const s of f.seen.filter((x) => x !== consumedRow)) found.push({ ...(await build(s, s.carries)), seen: s });
  const filler = { ...(await build({ ...f.seen[0]!, party: "payer", account: "none", position: 43 } as Seen, false)) };
  const names = new Map<string, string>(found.map((b) => [b.digest, b.seen.transaction]));
  if ("seen" in own) names.set(own.digest, own.seen.transaction);
  const lapsed = f.value?.lapsed ?? consumedRow === undefined;
  const epoch = BigInt(lapsed ? UNTIL + 1 : UNTIL);
  const node = (b: Built) => ({ ...executed(b), digest: b.digest });
  // An item the search cannot decode: bytes that do not hash to the digest the endpoint names for it.
  const undecodable = (f.undecoded ?? []).map((u, i) => {
    const digest = TransactionDataBuilder.getDigestFromBytes(Uint8Array.of(i));
    names.set(digest, u.transaction);
    return { ...executed({ ...filler, seen: { ...f.seen[0]!, result: "succeeded", position: (u.at ?? 0) + 1 } as Seen }), balanceChanges: [], digest };
  });
  const listed = [...found.map(node), ...undecodable].sort((a, b) => Number(a.checkpoint! - b.checkpoint!));
  const fill = { ...executed({ ...filler, seen: { ...f.seen[0]!, result: "succeeded", position: 43 } as Seen }), balanceChanges: [], digest: filler.digest };
  const pages = f.search.whole
    ? [{ transactions: listed, hasNextPage: false, endCursor: null }]
    : Array.from({ length: 8 }, (_, i) => ({ transactions: [...(i === 0 ? listed : []), fill], hasNextPage: true, endCursor: `c${i}` }));
  const network = f.unreadable === "chain-mismatch" ? "sui:mainnet" : "sui:testnet";
  const reader: SuiReader = {
    network,
    async read() {
      if (f.unreadable === "transport") throw new Error("timeout");
      if (f.unreadable === "unparseable") return { epoch: "x" } as never;
      const tx =
        f.unreadable === "too-large"
          ? { transactionBcs: new Uint8Array(128 * 1024 + 1), status: "SUCCESS" as const, checkpoint: 1n, balanceChanges: [] }
          : "seen" in own
            ? executed(own as Built)
            : null;
      return {
        tx,
        epoch,
        firstCheckpoint: f.history ? 0n : after + 1n,
        searchRange: { first: 0n, last: 50n, epoch },
      };
    },
    async search(sender, afterCheckpoint, beforeCheckpoint, cursor) {
      // The search reads the reference's sender, from the position given or the search's own, to one past its head.
      if (sender !== PAYER || afterCheckpoint !== BigInt(c.query.search ?? after) || beforeCheckpoint !== 51n) {
        throw new Error(`searched ${sender} from ${afterCheckpoint} before ${beforeCheckpoint}`);
      }
      const i = cursor === null ? 0 : Number(cursor.slice(1)) + 1;
      return pages[i] ?? { transactions: [], hasNextPage: false, endCursor: null };
    },
  };
  const ref: SuiRef & { h: `0x${string}` } = { network: "sui:testnet", payee: PAYEE, sender: PAYER, digest: own.digest, untilEpoch: String(UNTIL), h: H };
  const digestOf = (t: string) => [...names].find(([, n]) => n === t)?.[0] ?? t;
  const others = c.query.others?.map((o) => ("transaction" in o ? { transaction: digestOf(o.transaction) } : o));
  const search = c.query.search === undefined ? {} : { search: BigInt(c.query.search) };
  const query = { act, finality: c.query.finality as never, after, ...search, ...(others === undefined ? {} : { others: others as never }) };
  return caseTerms(await exactSui.status(ref, reader, query), names);
}

/** The answer in the case's terms: transaction names, integer positions, the case's assets and accounts. */
function caseTerms(a: Awaited<ReturnType<typeof exactSui.status>>, names: Map<string, string>): CaseAnswer {
  const name = (d: string) => names.get(d) ?? d;
  const moved = (m: readonly Moved[]) =>
    m.map((x) => ({ ...x, asset: back(ASSET, x.asset), to: back(ACCOUNT, x.to), ...(x.transaction === undefined ? {} : { transaction: name(x.transaction) }) }));
  const out: Record<string, unknown> = { ...a, foreign: a.foreign.map((x) => ({ ...x, transaction: name(x.transaction), ...(x.position === undefined ? {} : { position: Number(x.position) }) })) };
  if ("transaction" in a && a.transaction !== undefined) out["transaction"] = name(a.transaction);
  if ("position" in a && a.position !== undefined) out["position"] = Number(a.position);
  if ("search" in a && a.search !== undefined) out["search"] = Number(a.search);
  if ("moved" in a && a.moved !== undefined) out["moved"] = moved(a.moved);
  if ("undecoded" in a && a.undecoded !== undefined) out["undecoded"] = a.undecoded.map(name);
  return out as unknown as CaseAnswer;
}

const inapplicable = DECLARED;

export const forms: readonly DeclaredForm[] = [
  {
    form: {
      subject: "x402/exact/sui",
      arrange: (c, act) => {
        const stated = inapplicable.find((d) => d.case === c.case && (d.acts === undefined || d.acts.includes(act)));
        return stated !== undefined ? { inapplicable: stated.stated } : { run: () => run(c, act) };
      },
    },
    inapplicable,
  },
];
