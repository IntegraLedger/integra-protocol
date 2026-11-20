// The XRPL pairings' share of the read kit: each case of read-status.json made on a ledger of XRPL transactions,
// constructed and marked so, and run through the pairing's own `status`. A transaction of a case is a blob encoded by
// ripple-binary-codec, which the reader answers in its `tx` and `account_tx` calls; its hash is SHA-512Half over
// `TXN\0` and the blob (node:crypto), which names it in the answer. The instrument is the payer's `Sequence` 7; a
// transaction of the payer's that takes no instrument of the case takes a ticket. Positions are ledger indexes from
// 1000. XRPL has one mark: the case's `final` is `validated`; its `included` and `safe` are `current`, a transaction
// the server answers in a ledger it has not validated, or a lapse read there, which is no mark. A case whose facts give
// no single-use value is a payer's account the validated ledger does not show (deleted), or, on `mpp/charge/xrpl`
// where the case meets nothing and its lookup is read whole, a payment presented by its hash alone that no lookup finds. The payment presented is
// the act's own signed body where the case states `presented` yes, and the same body with another `Fee` where it
// states no; the read always compares, and the kit holds `presented` only where a case states it. Where XRPL
// cannot hold a case's fact as the case states it, the case is made in the ledger's own spelling where the rule that
// decides it treats the two alike, each named here and in the profiles: only the payer's own account takes its
// sequence, so a transaction that took the instrument is the payer's whatever party the case names, read-status rule
// 16 deciding `before-position` before anything asks who signed it; and a Payment or a PaymentChannelCreate always
// names a `Destination`, so an act that names no account names another account than the payee's, which read-status
// rule 9 answers alike. What moved is put back in the case's terms by asset (XRP is `A`, the issued currency `B`),
// account and transaction; a create deposits XRP alone, so a case's other asset on an opening or a channel is spelled
// as XRP of the case's amount, which read-status rule 10 answers alike, and put back as the case's asset. The form
// skips exactly the cases each pairing's profile declares inapplicable to the read kit (`declared`). `x402/upto/xrpl`'s
// channel is made as the stock session's is: the payment names the channel and its payer, and the read finds the create.
import { createHash } from "node:crypto";
import { encode } from "ripple-binary-codec";
import { ReaderError } from "../../../src/evm.js";
import type { Act, Moved } from "../../../src/internal/read.js";
import { decodeBlob, signedBodyOf } from "../../../src/internal/xrpl.js";
import { isRefusal } from "../../../src/refusal.js";
import { chargeXrpl } from "../../../src/mpp-xrpl.js";
import { sessionXrpl, sessionXrplStock } from "../../../src/mpp-session-rails.js";
import { exactXrpl } from "../../../src/x402-exact-xrpl.js";
import { uptoXrpl } from "../../../src/x402-upto-xrpl.js";
import type { XrplLanded, XrplReader, XrplStatus } from "../../../src/xrpl.js";
import type { Arranged, CaseAnswer, CaseMark, DeclaredForm, Inapplicable, ReadCase } from "../form.js";
import { ACTS, answering, READ_STATUS } from "../harness.js";

const BASE = 1000;
const LLS = BASE + 50;
const NETWORK = "xrpl:1" as const;
const H = "0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
const LCP = `lcp:sha256:${H}`;
const PAYER = "r3sNTMefq5gsRumMYsNznnX6yzzxVH6dTC";
const PAYEE = "rpjfAeE3DeeHPFnN2PgGFW5YxnZFAjrEyN";
const OTHER = "rPPdduC9MRTrXZP1J7MQyEKKEYiFigWZ6Q";
const ELSEWHERE = "rfPaNmieF15VqV752Q8qAc6ugtkKhWsA2R";
const ISSUER = "rH9ESAdrFfDAZtCZGa7JiwNJfKnC6CmGFQ";
const X402_INVOICE = createHash("sha256").update(LCP, "utf8").digest("hex").toUpperCase();
const MPP_INVOICE = H.slice(2).toUpperCase();
const MEMO = Buffer.from(LCP, "utf8").toString("hex").toUpperCase();
const CHANNEL = createHash("sha256").update("the case's channel").digest("hex").toUpperCase();

type Form = "x402" | "mpp" | "memo" | "channel";

const txHash = (blob: string): string =>
  createHash("sha512")
    .update(Buffer.from(`54584E00${blob}`, "hex"))
    .digest()
    .subarray(0, 32)
    .toString("hex")
    .toUpperCase();
const nameHash = (name: string): string => createHash("sha256").update(`the case's ${name}`).digest("hex").toUpperCase();

/** The transaction a case's seen item is on XRPL, its blob, and the moved it is realized with. */
function blobOf(form: Form, s: ReadCase["facts"]["seen"][number], i: number): { blob: string; delivered?: XrplLanded["delivered"] } {
  const account = s.consumed || s.party === "payer" ? PAYER : s.party === "payee" ? PAYEE : OTHER;
  const destination = s.account === "payee" ? PAYEE : ELSEWHERE;
  const m: Moved | undefined = s.moved?.[0];
  const drops = m?.amount ?? "1000000";
  const delivered: XrplLanded["delivered"] =
    m !== undefined && m.asset === "B" ? { currency: "USD", issuer: ISSUER, value: m.amount } : drops;
  const instrument = s.consumed
    ? { Sequence: 7 }
    : account === PAYER
      ? { Sequence: 0, TicketSequence: 100 + i }
      : { Sequence: 5 + i };
  const signing = { Fee: String(12 + i), Flags: 0, LastLedgerSequence: LLS, SigningPubKey: `ED${"11".repeat(32)}`, TxnSignature: "22".repeat(64) };
  const otherForm = form === "x402" ? MPP_INVOICE : X402_INVOICE;
  let tx: Record<string, unknown>;
  if (form === "memo" || form === "channel") {
    tx = s.kind === "same"
      ? {
          TransactionType: "PaymentChannelCreate",
          Account: account,
          Destination: destination,
          Amount: drops,
          SettleDelay: 86400,
          PublicKey: `ED${"33".repeat(32)}`,
          ...(s.carries && form === "memo" ? { Memos: [{ Memo: { MemoData: MEMO } }] } : {}),
        }
      : { TransactionType: "Payment", Account: account, Destination: destination, Amount: drops, ...(s.carries ? { InvoiceID: MPP_INVOICE } : {}) };
  } else if (s.kind === "same" || s.carries) {
    tx = {
      TransactionType: "Payment",
      Account: account,
      Destination: destination,
      Amount: delivered,
      ...(s.carries ? { InvoiceID: s.kind === "same" ? (form === "x402" ? X402_INVOICE : MPP_INVOICE) : otherForm } : {}),
    };
  } else {
    tx = { TransactionType: "AccountSet", Account: account };
  }
  return { blob: encode({ ...tx, ...instrument, ...signing } as Parameters<typeof encode>[0]), delivered };
}

/**
 * Whether the case is made on `mpp/charge/xrpl` as a payment presented by its hash alone, which no lookup finds: no
 * value, nothing met or left undecoded, and the lookup read whole.
 */
const byHashOf = (form: Form, c: ReadCase): boolean =>
  form === "mpp" &&
  c.facts.value === undefined &&
  c.facts.seen.length === 0 &&
  (c.facts.undecoded ?? []).length === 0 &&
  c.facts.search.whole;

/** The XRPL ledger a case states, a reader of it, and the maps from its transactions and marks back to the case's. */
function ledgerOf(form: Form, c: ReadCase) {
  const f = c.facts;
  const lower: CaseMark = f.seen.find((s) => s.mark !== "final")?.mark ?? f.value?.mark ?? "included";
  const lapsedFinal = f.value?.lapsed === true && f.value.mark === "final";
  const validated = lapsedFinal ? LLS + 10 : LLS - 5;
  const latest = f.value?.lapsed === true ? LLS + 15 : LLS - 1;
  const names = new Map<string, string>();
  const landed: XrplLanded[] = [];
  const blobs = new Map<string, string>();
  const created = new Map<string, string>();
  f.seen.forEach((s, i) => {
    const { blob, delivered } = blobOf(form, s, i);
    const hash = txHash(blob);
    names.set(hash, s.transaction);
    blobs.set(s.transaction, blob);
    const asset = s.moved?.[0]?.asset;
    if ((form === "memo" || form === "channel") && asset !== undefined) created.set(s.transaction, asset);
    landed.push({
      hash,
      validated: s.mark === "final",
      ...(s.position === undefined ? {} : { ledgerIndex: BASE + s.position }),
      result: s.result === "succeeded" ? "tesSUCCESS" : "tecUNFUNDED_PAYMENT",
      blob,
      ...(form === "x402" || form === "mpp" ? (s.result === "succeeded" ? { delivered: delivered! } : {}) : {}),
      ...(form === "channel" ? { createdChannels: [CHANNEL] } : {}),
    });
  });
  for (const u of f.undecoded ?? []) {
    const hash = nameHash(u.transaction);
    names.set(hash, u.transaction);
    landed.push({ hash, validated: true, ...(u.at === undefined ? {} : { ledgerIndex: BASE + u.at }), result: "tesSUCCESS", blob: "00" });
  }
  landed.sort((a, b) => (a.ledgerIndex ?? 0) - (b.ledgerIndex ?? 0));
  const history = f.history;
  const fail = (): never => {
    if (f.unreadable === "transport") throw new ReaderError("transport");
    if (f.unreadable === "unparseable") throw new ReaderError("malformed");
    throw new ReaderError("too-large");
  };
  const channelShown = form === "channel" && f.seen.length > 0;
  const reader: XrplReader = {
    network: f.unreadable === "chain-mismatch" ? "xrpl:0" : NETWORK,
    server: async () => {
      if (f.unreadable !== undefined && f.unreadable !== "chain-mismatch") fail();
      return { validated, latest, completeLedgers: history ? `${BASE - 100}-${latest}` : `${BASE - 100}-${BASE - 60}` };
    },
    tx: async () => ({ notFound: true, searchedAll: f.search.whole }),
    // Only the payer's account holds the case's transactions and its instrument: a read of any other account's
    // `account_tx` meets nothing, its `account_info` finds no account, and its ticket is absent.
    accountTx: async (account, range) => ({
      transactions: account === PAYER ? landed : [],
      min: range.min,
      max: f.search.whole ? range.max : BASE + (f.search.at ?? 0) - 1,
    }),
    accountInfo: async (account, ledger) => {
      const v = f.value;
      if (v === undefined || account !== PAYER) return { notFound: true, ledgerIndex: ledger === "validated" ? validated : latest };
      if (ledger === "validated") return { sequence: v.consumed && v.mark === "final" ? 8 : 7, ledgerIndex: validated };
      if (v.head !== undefined) return { sequence: v.head.consumed ? 8 : 7, ledgerIndex: latest };
      if (v.mark !== "final" || v.consumed) return { sequence: v.consumed ? 8 : 7, ledgerIndex: latest };
      return { notFound: true, ledgerIndex: latest };
    },
    ticket: async (account) => ({ present: account === PAYER, ledgerIndex: validated }),
    channel: async (id) =>
      channelShown && id === CHANNEL
        ? { account: PAYER, destination: PAYEE, amount: "1000000" }
        : { notFound: true, ledgerIndex: validated },
  };
  const others = (c.query.others ?? []).map((o) =>
    "transaction" in o
      ? {
          transaction: (
            [...names].find(([, n]) => n === o.transaction)?.[0] ?? nameHash(String(o.transaction))
          ).toLowerCase(),
        }
      : o,
  );
  const query = {
    act: undefined as unknown as Act,
    finality: "validated" as const,
    ...(c.query.after === undefined ? {} : { after: BASE + c.query.after }),
    ...(c.query.search === undefined ? {} : { search: BASE + c.query.search }),
    ...(others.length === 0 ? {} : { others }),
  };
  const name = (t: string): string => names.get(t.toUpperCase()) ?? t;
  const movedBack = (m: readonly Moved[] | undefined): readonly Moved[] | undefined =>
    m?.map((x) => ({
      asset:
        x.asset === "XRP"
          ? (created.get(name(x.transaction ?? "")) ?? "A")
          : x.asset === `USD:${ISSUER}`
            ? "B"
            : x.asset,
      amount: x.amount,
      to: x.to === PAYEE ? "payee" : x.to === ELSEWHERE ? "elsewhere" : x.to,
      ...(x.transaction === undefined ? {} : { transaction: name(x.transaction) }),
      ...(x.place === undefined ? {} : { place: x.place }),
    }));
  const back = (answer: XrplStatus): CaseAnswer => {
    const a = { ...answer } as Record<string, unknown>;
    delete a["signer"];
    delete a["authority"];
    if (typeof a["transaction"] === "string") a["transaction"] = name(a["transaction"] as string);
    if (a["moved"] !== undefined) a["moved"] = movedBack(a["moved"] as readonly Moved[]);
    if (typeof a["position"] === "number") a["position"] = (a["position"] as number) - BASE;
    if (typeof a["search"] === "number") a["search"] = (a["search"] as number) - BASE;
    if (a["finality"] === "validated") a["finality"] = "final";
    else if (a["finality"] === "current") a["finality"] = lower;
    if (Array.isArray(a["undecoded"])) a["undecoded"] = (a["undecoded"] as string[]).map(name);
    a["foreign"] = answer.foreign.map((x) => {
      const m = movedBack(x.moved);
      return {
        transaction: name(x.transaction),
        reason: x.reason,
        ...(x.position === undefined ? {} : { position: x.position - BASE }),
        ...(m === undefined ? {} : { moved: m }),
      };
    });
    return a as unknown as CaseAnswer;
  };
  return { reader, query, back, blobs };
}

/** The signed body of a blob of the case's ledger, `Fee` changed where the payment presented differs from it. */
async function bodyOf(blob: string, differs: boolean): Promise<string> {
  const d = await decodeBlob(blob);
  if (isRefusal(d)) throw new Error("a blob of the case's ledger does not decode");
  const body = await signedBodyOf(differs ? { ...d.tx, Fee: "999" } : d.tx);
  if (body === undefined) throw new Error("a body of the case's ledger does not encode");
  return body;
}

/**
 * A presented payment's reference on the case's ledger: the payer's instrument, Sequence 7, and its signed body, that of
 * the act whose `presented` the case states; or, on a payment presented by its hash alone, its hash.
 */
async function refOf(form: Form, c: ReadCase, blobs: ReadonlyMap<string, string>) {
  if (form === "channel") return { network: NETWORK, channel: CHANNEL, payer: PAYER, payee: PAYEE, fromLedger: BASE - 50 };
  const base = { network: NETWORK, transaction: nameHash("presented payment"), h: H, payee: PAYEE, fromLedger: BASE - 50 };
  if (byHashOf(form, c)) return base;
  const stating = c.facts.seen.find((s) => s.presented !== undefined);
  const body = stating === undefined ? "" : await bodyOf(blobs.get(stating.transaction)!, stating.presented === "no");
  return { ...base, signed: { account: PAYER, sequence: 7, lastLedgerSequence: LLS, body } };
}

/** Where each XRPL pairing's profile states the cases it declares inapplicable to the read kit. */
const STATED: { readonly [f in Form]: string } = {
  x402: "the profile x402-exact-xrpl.md, rule 16",
  mpp: "the profile mpp-charge-xrpl.md, rule 9",
  memo: "the profile mpp-session-hedera-solana-xrpl.md, clause 3",
  channel: "the profile mpp-session-hedera-solana-xrpl.md, clause 3",
};

const NOT_FOUND =
  "`not-found`, since the payment carries the signed transaction, so the read holds its sequence number or ticket " +
  "(`account_info`, `ledger_entry`)";
const CHANNELS =
  "on the stock session's channel, `instrument-live`, `instrument-unused` and `transaction-failed`, since a create whose " +
  "metadata creates the channel's entry has landed and succeeded";
const UPTO_CHANNEL =
  "on `x402/upto/xrpl`'s channel, `instrument-live`, `instrument-unused` and `transaction-failed`, since a create whose " +
  "metadata creates the channel's entry has landed and succeeded";
const BELOW_CASE = "an act read at the finality asked for, below the final mark";
const BELOW = `*${BELOW_CASE}*, since a seller names \`validated\` alone`;
const EACH_CASE = "each transfer of what moved is named by its transaction and its place in it";
const EACH =
  `*${EACH_CASE}*, since each transaction the read takes holds one transfer, a \`Payment\` delivering one amount to its ` +
  "one `Destination` and a `PaymentChannelCreate` making one deposit";
const ZERO_CASES = ["a payment act carrying H that transferred zero", "an act carrying H that transferred zero"] as const;
const ZERO =
  `*${ZERO_CASES[0]}* and *${ZERO_CASES[1]}*, since a \`Payment\` of zero is malformed, a partial payment that delivers ` +
  "nothing does not succeed, and a `PaymentChannelCreate` of zero is malformed too";

/** Every case whose name opens with `words`, on both acts, stated by `stated`; words that open no case throw. */
const byWords = (words: string, stated: string): Inapplicable[] => {
  const found = READ_STATUS.cases.filter((c) => c.case.startsWith(words));
  if (found.length === 0) throw new Error(`no case of read-status.json opens with "${words}"`);
  return found.map((c) => ({ case: c.case, stated }));
};

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

/** The cases a form's profile declares inapplicable to the read kit, as its pairing's entry in the profile states them. */
function declared(form: Form, where: string = STATED[form], channels: string = CHANNELS): Inapplicable[] {
  const at = (text: string): string => `${where}: ${text}`;
  const coverageFull = form !== "channel";
  return once([
    ...(form === "x402" || form === "memo" ? answering("not-found", at(NOT_FOUND)) : []),
    ...(form === "channel" ? ["instrument-live", "instrument-unused", "transaction-failed"].flatMap((r) => answering(r, at(channels))) : []),
    ...byWords(BELOW_CASE, at(BELOW)),
    ...byWords(EACH_CASE, at(EACH)),
    ...(coverageFull ? ZERO_CASES.flatMap((w) => byWords(w, at(ZERO))) : []),
  ]);
}

/** Why the case cannot be made on the form's ledger, by the fact its profile states, or undefined where it can. */
function cannot(form: Form, c: ReadCase, act: Act): string | undefined {
  if (c.query.finality !== "final") return "a query names `validated` alone, XRPL's one mark";
  if (c.case.startsWith(EACH_CASE)) return "each transaction the read takes holds one transfer, its place the whole transaction";
  const want = c.expect[act];
  const reason = "reason" in want ? want.reason : undefined;
  if ((form === "x402" || form === "memo") && reason === "not-found") {
    return "the payment carries the signed transaction, so the read holds its sequence number or ticket";
  }
  if (form === "channel" && (reason === "instrument-live" || reason === "instrument-unused" || reason === "transaction-failed")) {
    return "a create whose metadata makes the channel's entry has landed and succeeded";
  }
  if (form === "channel") return undefined;
  if (ZERO_CASES.some((w) => c.case.startsWith(w))) return "no act of these pairings transfers zero and succeeds";
  return undefined;
}

function formOf(form: Form, subject: DeclaredForm["form"]["subject"], status: (ref: never, reader: XrplReader, query: never) => Promise<XrplStatus>) {
  return {
    subject,
    arrange: (c: ReadCase, act: Act): Arranged | { inapplicable: string } => {
      const why = cannot(form, c, act);
      if (why !== undefined) return { inapplicable: why };
      const { reader, query, back, blobs } = ledgerOf(form, c);
      return { run: async () => back(await status((await refOf(form, c, blobs)) as never, reader, { ...query, act } as never)) };
    },
  };
}

export const forms: readonly DeclaredForm[] = [
  { form: formOf("x402", "x402/exact/xrpl", exactXrpl.status as never), inapplicable: declared("x402") },
  { form: formOf("mpp", "mpp/charge/xrpl", chargeXrpl.status as never), inapplicable: declared("mpp") },
  { form: formOf("memo", "mpp/session/xrpl", sessionXrpl.status as never), inapplicable: declared("memo") },
  { form: formOf("channel", "mpp/session/xrpl/stock", sessionXrplStock.status as never), inapplicable: declared("channel") },
  {
    form: formOf("channel", "x402/upto/xrpl", uptoXrpl.status as never),
    inapplicable: declared("channel", "the profile x402-upto-xrpl.md, rule 18", UPTO_CHANNEL),
  },
];
