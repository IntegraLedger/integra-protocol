// `pairingsOf` makes each check an MPP pairing's `build` makes on the challenge alone, whatever the buyer's inputs: for
// each such challenge, `pairingsOf` (over the challenge as issued) and `pairingsOfPlaced` do not name the pairing, and
// `build`, given the vector file's B2 inputs with that challenge in place of B2's, refuses with the same code. Where
// the challenge offers another pairing too, `pairingsOf` names that one. Each case names the rule `build` applies.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalJson, isRefusal, type Json } from "../src/index.js";
import { chargeHedera } from "../src/hedera.js";
import { chargeLightning, decodeBolt11, sessionLightning } from "../src/lightning.js";
import {
  chargeSolana,
  chargeUsdcSolana,
  chargeXrpl,
  evmPermit2,
  pairingsOf,
  pairingsOfPlaced,
  sessionXrpl,
  subscriptionTempo,
  type MppChallenge,
} from "../src/mpp.js";
import { rowsOf } from "./rows.js";

const vector = (f: string) => JSON.parse(readFileSync(new URL(`../vectors/${f}`, import.meta.url), "utf8"));
type B2 = { pairing: string; advertised: string; input: { doc: MppChallenge[]; account: string; inputs?: Record<string, unknown>; now?: number } };
const b2 = (file: string, pairing: string): B2 => vector(file).buyer.rows.find((r: B2 & { name: string }) => r.name === "B2" && r.pairing === pairing);

const decoded = (c: MppChallenge): Record<string, Json> => JSON.parse(Buffer.from(c.request, "base64url").toString("utf8"));
const withRequest = (c: MppChallenge, edit: (r: Record<string, Json>) => void): MppChallenge => {
  const r = structuredClone(decoded(c));
  edit(r);
  return { ...c, request: Buffer.from(canonicalJson(r) as string, "utf8").toString("base64url") };
};
const details = (r: Record<string, Json>) => r["methodDetails"] as Record<string, Json>;
const account = (row: B2) => row.input.account.split(":").slice(2).join(":");
const issued = (c: MppChallenge) => {
  const { id: _id, opaque: _opaque, ...rest } = c;
  return rest as MppChallenge;
};

type Build = (row: B2, challenge: MppChallenge) => Promise<unknown>;
/** Each pairing's `build`, with the B2 row's account, inputs and time. */
const BUILD: Record<string, Build> = {
  "mpp/charge/lightning": (row, challenge) => chargeLightning.build({ challenge: challenge as MppChallenge & { id: string } }, row.advertised as never),
  "mpp/session/lightning": (row, challenge) =>
    sessionLightning.build({ challenge: challenge as MppChallenge & { id: string }, returnInvoice: row.input.inputs!["returnInvoice"] as string }, row.advertised as never),
  "mpp/charge/solana": (row, challenge) => solanaBuild(chargeSolana.build, row, challenge, details(decoded(row.input.doc[0]!))),
  "mpp/charge/usdc/solana": (row, challenge) =>
    solanaBuild(chargeUsdcSolana.build, row, challenge, details(decoded(row.input.doc[0]!))["solana"] as Record<string, Json>),
  "mpp/charge/evm/permit2": (row, challenge) =>
    evmPermit2.build({ challenge: challenge as MppChallenge & { id: string }, from: account(row) as never, now: row.input.now!, spender: row.input.inputs!["spender"] as never }, row.advertised as never),
  "mpp/charge/xrpl": (row, challenge) =>
    chargeXrpl.build({ challenge: challenge as MppChallenge & { id: string }, account: account(row), ...(row.input.inputs as { fee: string; sequence: number; lastLedgerSequence: number }) }, row.advertised as never),
  "mpp/session/xrpl": (row, challenge) => {
    const i = row.input.inputs as { deposit: string; xrpl: { publicKey: string } & Record<string, unknown> };
    const xrpl = { ...i.xrpl, publicKey: i.xrpl.publicKey.replace(/^0x/, "") } as never;
    return sessionXrpl.build({ challenge: challenge as MppChallenge & { id: string }, from: account(row), now: 0, deposit: BigInt(i.deposit), xrpl }, row.advertised as never);
  },
  "mpp/subscription/tempo": (row, challenge) =>
    subscriptionTempo.build({ challenge: challenge as MppChallenge & { id: string }, from: account(row) as never, now: row.input.now! }, row.advertised as never),
  "mpp/charge/hedera": (row, challenge) => {
    const i = row.input.inputs as { node: string; validStart: { seconds: string; nanos: number }; maxFee: string };
    const c = { payer: account(row), node: i.node, validStart: { seconds: BigInt(i.validStart.seconds), nanos: i.validStart.nanos }, maxFee: BigInt(i.maxFee) };
    return chargeHedera.build(challenge as MppChallenge & { id: string }, decoded(challenge), c);
  },
};
/** The Solana charges' build, given the buyer's own decimals, token program and blockhash: those of B2's challenge. */
function solanaBuild(build: (c: never, h: never) => Promise<unknown>, row: B2, challenge: MppChallenge, own: Record<string, Json>) {
  const i = row.input.inputs as { computeUnitLimit: number; computeUnitPrice: string };
  return build(
    {
      challenge,
      payer: account(row),
      computeUnitLimit: i.computeUnitLimit,
      computeUnitPrice: BigInt(i.computeUnitPrice),
      decimals: own["decimals"],
      tokenProgram: own["tokenProgram"],
      recentBlockhash: own["recentBlockhash"],
    } as never,
    row.advertised as never,
  );
}

const FILE: Record<string, string> = {
  "mpp/charge/lightning": "mpp-charge-lightning.json",
  "mpp/session/lightning": "mpp-session-lightning.json",
  "mpp/charge/solana": "mpp-charge-solana.json",
  "mpp/charge/usdc/solana": "mpp-charge-usdc-solana.json",
  "mpp/charge/evm/permit2": "mpp-charge-evm-permit2.json",
  "mpp/charge/xrpl": "mpp-charge-xrpl.json",
  "mpp/session/xrpl": "mpp-session-hedera-solana-xrpl.json",
  "mpp/subscription/tempo": "mpp-subscription-tempo.json",
  "mpp/charge/hedera": "mpp-charge-hedera.json",
};

const iso = (s: number) => new Date(s * 1000).toISOString().replace(".000Z", "Z");
/** The challenge with `expires` one second after its invoice's expiry (BOLT 11: the timestamp plus `x`). */
async function pastInvoice(c: MppChallenge, invoice: string): Promise<MppChallenge> {
  const b = await decodeBolt11(invoice);
  if (isRefusal(b)) throw new Error(b.code);
  return { ...c, expires: iso(b.timestamp + b.expiry + 1) };
}

type Case = [string, string, (c: MppChallenge) => MppChallenge | Promise<MppChallenge>, string, string?];
const CASES: Case[] = rowsOf<Case>(
  [
    // draft-lightning-charge-00 and BOLT 11: the invoice decodes, carries the challenge's payment hash, no inline
    // description, and the currency of the network the challenge names; `expires` is no later than the invoice's expiry.
    ["an invoice that does not decode", "mpp/charge/lightning", (c) => withRequest(c, (r) => (details(r)["invoice"] = "lnbc1abc")), "ln/invoice-malformed"],
    ["another payment hash", "mpp/charge/lightning", (c) => withRequest(c, (r) => (details(r)["paymentHash"] = "00".repeat(32))), "ln/payment-hash-mismatch"],
    ["network signet for a bc invoice", "mpp/charge/lightning", (c) => withRequest(c, (r) => (details(r)["network"] = "signet")), "ln/currency-network"],
    ["a request description", "mpp/charge/lightning", (c) => withRequest(c, (r) => (r["description"] = "Weather")), "ln/description-present"],
    ["expires one second after the invoice's", "mpp/charge/lightning", (c) => pastInvoice(c, details(decoded(c))["invoice"] as string), "ln/expires-after-invoice"],
    ["expires one second after the deposit invoice's", "mpp/session/lightning", (c) => pastInvoice(c, decoded(c)["depositInvoice"] as string), "ln/expires-after-invoice"],
    ["a deposit invoice that does not decode", "mpp/session/lightning", (c) => withRequest(c, (r) => (r["depositInvoice"] = "lnbc1abc")), "ln/invoice-malformed"],
    ["another payment hash", "mpp/session/lightning", (c) => withRequest(c, (r) => (r["paymentHash"] = "00".repeat(32))), "ln/payment-hash-mismatch"],
    // The Solana charges' build writes one transfer, with the challenge's decimals, token program and blockhash where it
    // names them, else the buyer's: splits and confidential transfers are not built.
    ["methodDetails.splits", "mpp/charge/solana", (c) => withRequest(c, (r) => (details(r)["splits"] = [{ recipient: r["recipient"]!, amount: "1" }])), "svm/input-malformed"],
    ["methodDetails.confidential true", "mpp/charge/solana", (c) => withRequest(c, (r) => (details(r)["confidential"] = true)), "svm/input-malformed"],
    ["methodDetails.decimals 256, past a token's u8", "mpp/charge/solana", (c) => withRequest(c, (r) => (details(r)["decimals"] = 256)), "svm/input-malformed"],
    ["methodDetails.tokenProgram the System program", "mpp/charge/solana", (c) => withRequest(c, (r) => (details(r)["tokenProgram"] = "11111111111111111111111111111111")), "svm/input-malformed"],
    ["methodDetails.recentBlockhash not a key", "mpp/charge/solana", (c) => withRequest(c, (r) => (details(r)["recentBlockhash"] = "abc")), "svm/input-malformed"],
    ["methodDetails.solana.decimals 1.5", "mpp/charge/usdc/solana", (c) => withRequest(c, (r) => ((details(r)["solana"] as Record<string, Json>)["decimals"] = 1.5)), "svm/input-malformed"],
    // MPP's EVM charge: "The sum of `splits[].amount` MUST be strictly less than `amount`"; the Permit2 build pays the
    // recipient the rest, which must be above zero.
    ["splits adding up to amount", "mpp/charge/evm/permit2", (c) => withRequest(c, (r) => (details(r)["splits"] = [{ recipient: r["recipient"]!, amount: r["amount"]! }])), "mpp/input-malformed"],
    ["amount 0 with permit2 alone listed", "mpp/charge/evm/permit2", (c) => withRequest(c, (r) => ((r["amount"] = "0"), (details(r)["credentialTypes"] = ["permit2"]))), "mpp/input-malformed"],
    ["amount 0 with authorization listed too", "mpp/charge/evm/permit2", (c) => withRequest(c, (r) => (r["amount"] = "0")), "mpp/not-this-pairing", "mpp/charge/evm/authorization"],
    // The XRP Ledger charge's build writes only the LCP memo; the session's derives the channel id from the recipient's
    // AccountID, a classic address whose double-SHA-256 checksum holds.
    ["methodDetails.memos", "mpp/charge/xrpl", (c) => withRequest(c, (r) => (details(r)["memos"] = [{ Memo: { MemoData: "6C6370" } }])), "xrpl/memos-not-carried"],
    ["a recipient whose checksum fails", "mpp/session/xrpl", (c) => withRequest(c, (r) => (r["recipient"] = (r["recipient"] as string).slice(0, -1) + ((r["recipient"] as string).endsWith("r") ? "p" : "r"))), "mpp/request-malformed"],
    // Tempo's key authorization: `expiry` and each limit's `period` are uint64 seconds.
    ["periodCount 10^16 - 1 weeks", "mpp/subscription/tempo", (c) => withRequest(c, (r) => ((r["periodCount"] = "9999999999999999"), (r["periodUnit"] = "week"))), "mpp/request-malformed"],
    ["subscriptionExpires in 1969", "mpp/subscription/tempo", (c) => withRequest(c, (r) => (r["subscriptionExpires"] = "1969-12-31T23:59:59Z")), "mpp/request-malformed"],
    // MPP Hedera's chain ids: 295 (mainnet) and 296 (testnet).
    ["methodDetails.chainId 1", "mpp/charge/hedera", (c) => withRequest(c, (r) => (details(r)["chainId"] = 1)), "hedera/chain-id-unnamed"],
  ],
  "the challenges build refuses whatever the buyer's inputs",
  { exact: 22 },
);

describe("pairingsOf makes each check build makes on the challenge alone", () => {
  it.each(CASES.map((c) => [`${c[1]}: ${c[0]}`, c] as const))("%s", async (_, [, pairing, change, code, other]) => {
    const row = b2(FILE[pairing]!, pairing);
    const own = row.input.doc.find((c) => pairingsOfPlaced(c).includes(pairing as never))!;
    expect(isRefusal(await BUILD[pairing]!(row, own))).toBe(false);
    const changed = await change(own);
    expect(pairingsOfPlaced(changed).includes(pairing as never)).toBe(false);
    const named = pairingsOf(issued(changed));
    if (other === undefined) expect(named).toEqual({ refused: true, code });
    else expect(named).toEqual([other]);
    expect(await BUILD[pairing]!(row, changed)).toEqual({ refused: true, code });
  });
});
