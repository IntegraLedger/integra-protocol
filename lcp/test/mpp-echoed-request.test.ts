// `bound`, `reference` and `fetchPresented` start from the echoed challenge's H (`challengeBound`) and hold the echoed
// challenge to the pairing's filter, the checks `pairingsOf` makes for it: a challenge `pairingsOfPlaced` does not name
// for the pairing is refused with the code `pairingsOf` gives it, and of one it names, each reads only the request
// members its own read keys or derivation use. MPP's drafts name the members each method reads: the network or chain,
// the currency, the recipient and the escrow; `expires` is the challenge's own expiry, which the charge intent makes
// "REQUIRED for blockchain methods" where the payer signs it. Each credential is a vector file's buyer row as it
// presents it, whose expected H is that row's; the request is re-encoded as base64url of its JCS form after each change.
import { concat, fromRlp, toRlp, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { canonicalJson, type Json } from "../src/index.js";
import { ReaderError, type EvmReader } from "../src/evm.js";
import type { HederaEvmReader, HederaReader } from "../src/hedera.js";
import {
  chargeHedera,
  chargeSolana,
  chargeStellar,
  chargeUsdcEvm,
  chargeUsdcGateway,
  chargeUsdcSolana,
  chargeUsdcStacks,
  chargeXrpl,
  chargeNearIntents,
  evmAuthorization,
  evmHash,
  evmPermit2,
  pairingsOf,
  pairingsOfPlaced,
  sessionEvm,
  sessionHedera,
  sessionSolana,
  sessionTempo,
  sessionXrpl,
  subscriptionTempo,
  tempoMemo,
  tempoPush,
  usdcGatewaySalt,
  usdcRequestHash,
  type MppCredential,
} from "../src/mpp.js";
import { sessionLightning } from "../src/lightning.js";
import { gatewayAccount } from "../src/mpp-usdc.js";
import { load } from "./mpp-fixtures.js";
import { rowsOf } from "./rows.js";

type Edit = (request: { [k: string]: Json }, challenge: { [k: string]: unknown }) => void;

/** The vector file's buyer row `row` as presented, with `edit` applied to its request and challenge. */
function presented(file: string, row: number, edit: Edit = () => {}): MppCredential {
  const c = structuredClone(load(file).buyer.rows[row].input.presented) as MppCredential;
  const request = JSON.parse(Buffer.from(c.challenge.request, "base64url").toString("utf8"));
  edit(request, c.challenge as unknown as { [k: string]: unknown });
  c.challenge.request = Buffer.from(canonicalJson(request) as string, "utf8").toString("base64url");
  return c;
}
const expectedH = (file: string, row: number): string => load(file).buyer.rows[row].expect[0].h;
const noExpires: Edit = (_r, c) => {
  delete c["expires"];
};
const details = (r: { [k: string]: Json }) => r["methodDetails"] as { [k: string]: Json };
const refused = (code: string) => ({ refused: true, code });
/** The challenge as the seller issued it, before `place`: no id and no opaque. */
const offerOf = (c: MppCredential) => {
  const { id: _id, opaque: _opaque, ...offer } = c.challenge;
  return offer;
};

describe("bound holds the echoed challenge to the pairing's filter, and reads no other request member", () => {
  const H = "H";
  const rows: [string, { id: string; bound: (c: MppCredential) => Promise<unknown> }, string, number, Edit, string][] = [
    ["charge/evm/authorization, no expires", evmAuthorization, "mpp-charge-evm-authorization.json", 1, noExpires, "mpp/expires-required"],
    ["charge/evm/authorization, amount \"abc\"", evmAuthorization, "mpp-charge-evm-authorization.json", 1, (r) => (r["amount"] = "abc"), "mpp/request-malformed"],
    ["charge/evm/permit2, externalId null", evmPermit2, "mpp-charge-evm-permit2.json", 1, (r) => (r["externalId"] = null), "mpp/request-malformed"],
    ["charge/tempo/memo, amount \"abc\"", tempoMemo, "mpp-charge-tempo-memo.json", 1, (r) => (r["amount"] = "abc"), "mpp/request-malformed"],
    ["charge/tempo/push, no expires", tempoPush, "mpp-charge-tempo-push.json", 1, noExpires, "mpp/expires-required"],
    ["charge/solana, no expires", chargeSolana, "mpp-charge-solana.json", 1, noExpires, H],
    ["charge/stellar, amount \"0\"", chargeStellar, "mpp-charge-stellar.json", 1, (r) => (r["amount"] = "0"), H],
    ["charge/xrpl, no expires", chargeXrpl, "mpp-charge-xrpl.json", 1, noExpires, "mpp/expires-required"],
    ["charge/nearintents, amount \"x\"", chargeNearIntents, "mpp-charge-nearintents.json", 1, (r) => (r["amount"] = "x"), H],
    ["charge/usdc/evm, no expires", chargeUsdcEvm, "mpp-charge-usdc-evm.json", 1, noExpires, "mpp/expires-required"],
    ["charge/usdc/solana, no expires", chargeUsdcSolana, "mpp-charge-usdc-solana.json", 1, noExpires, H],
    ["charge/usdc/stacks, no expires", chargeUsdcStacks, "mpp-charge-usdc-stacks.json", 1, noExpires, H],
    ["charge/usdc/gateway, no expires", chargeUsdcGateway, "mpp-charge-usdc-gateway.json", 1, noExpires, H],
    ["session/evm, no expires and credentialTypes [\"other\"]", sessionEvm, "mpp-session-evm.json", 1, (r, c) => {
      noExpires(r, c);
      details(r)["credentialTypes"] = ["other"];
    }, "mpp/credential-types"],
    ["session/tempo, amount \"abc\"", sessionTempo, "mpp-session-tempo.json", 1, (r) => (r["amount"] = "abc"), H],
    ["session/solana, no expires", sessionSolana, "mpp-session-hedera-solana-xrpl.json", 3, noExpires, H],
    ["session/xrpl, no expires and currency \"USD\"", sessionXrpl, "mpp-session-hedera-solana-xrpl.json", 5, (r, c) => {
      noExpires(r, c);
      r["currency"] = "USD";
    }, "xrpl/currency-not-xrp"],
    ["subscription/tempo, periodCount \"0\", periodUnit \"month\", subscriptionExpires \"tomorrow\", amount \"abc\", no expires",
      subscriptionTempo, "mpp-subscription-tempo.json", 1, (r, c) => {
        Object.assign(r, { periodCount: "0", periodUnit: "month", subscriptionExpires: "tomorrow", amount: "abc" });
        noExpires(r, c);
      }, "mpp/request-malformed"],
  ];
  for (const [name, pairing, file, row, edit, answer] of rows) {
    it(name, async () => {
      expect(await pairing.bound(presented(file, row))).toBe(expectedH(file, row));
      const c = presented(file, row, edit);
      expect(pairingsOfPlaced(c.challenge).includes(pairing.id as never)).toBe(answer === H);
      if (answer === H) expect(await pairing.bound(c)).toBe(expectedH(file, row));
      else {
        expect(pairingsOf(offerOf(c))).toEqual(refused(answer));
        expect(await pairing.bound(c)).toEqual(refused(answer));
      }
    });
  }

  it("a usdc credential is read only by the pairing of the profile methodDetails.type names", async () => {
    expect(await chargeUsdcGateway.bound(presented("mpp-charge-usdc-evm.json", 1))).toEqual(refused("mpp/not-this-pairing"));
  });
});

describe("reference reads its read keys, and refuses one that is malformed, never throwing or defaulting", () => {
  it("charge/evm/authorization: the currency and the chain", async () => {
    const file = "mpp-charge-evm-authorization.json";
    expect(await evmAuthorization.reference(presented(file, 1))).toMatchObject({ network: "eip155:84532" });
    expect(await evmAuthorization.reference(presented(file, 1, noExpires))).toEqual(refused("mpp/expires-required"));
    expect(await evmAuthorization.reference(presented(file, 1, (r) => (r["currency"] = "usdc")))).toEqual(refused("mpp/request-malformed"));
    expect(await evmAuthorization.reference(presented(file, 1, (r) => delete details(r)["chainId"]))).toEqual(refused("mpp/request-malformed"));
  });

  // A request's methodDetails is an object (draft-payment-intent-charge-00, Table 3: "methodDetails | object |
  // Method-specific extension data"); advertise refuses one that is not with mpp/request-malformed (pairingsOf).
  it("a methodDetails that is not an object is mpp/request-malformed, never read as empty", async () => {
    const rows: [string, string, number, (c: MppCredential) => Promise<unknown>][] = [
      ["charge/tempo/memo bound", "mpp-charge-tempo-memo.json", 1, tempoMemo.bound],
      ["charge/tempo/memo reference", "mpp-charge-tempo-memo.json", 1, tempoMemo.reference],
      ["charge/tempo/push reference", "mpp-charge-tempo-push.json", 1, tempoPush.reference],
      ["charge/solana reference", "mpp-charge-solana.json", 1, chargeSolana.reference],
      ["charge/evm/hash reference", "mpp-charge-evm-authorization.json", 1, evmHash.reference],
      ["charge/hedera reference", "mpp-charge-hedera.json", 1, chargeHedera.reference],
      ["charge/hedera fetchPresented, given a default network", "mpp-charge-hedera.json", 1, (c) =>
        chargeHedera.fetchPresented(c, { network: "hedera:testnet" } as HederaReader, "hedera:testnet")],
      ["session/hedera channel.ref", "mpp-session-hedera-solana-xrpl.json", 1, (c) => sessionHedera.channel.ref(c)],
      ["session/evm reference", "mpp-session-evm.json", 1, sessionEvm.reference],
      ["session/tempo reference", "mpp-session-tempo.json", 1, sessionTempo.reference],
      ["subscription/tempo reference", "mpp-subscription-tempo.json", 1, subscriptionTempo.reference],
    ];
    for (const [name, file, row, read] of rows) {
      const c = presented(file, row, (r) => (r["methodDetails"] = 5));
      expect(pairingsOf(offerOf(c)), name).toEqual(refused("mpp/request-malformed"));
      expect(await read(c), name).toEqual(refused("mpp/request-malformed"));
    }
  });

  // The request member that carries H is read as advertise reads it (pairingsOf: mpp/request-malformed): externalId is
  // a string ("externalId | string | OPTIONAL", draft-nearintents-charge-01; an optional "externalId | string" in
  // draft-payment-intent-charge-00), on Solana one that "MUST NOT exceed 566 bytes (Solana Memo Program limit)"
  // (draft-solana-charge-00), a bound usdc's Solana profile inherits (draft-usdc-charge-00: "The Solana profile
  // inherits {{I-D.solana-charge}}"); the XRP Ledger's invoiceId is "64-hex" (draft-xrpl-charge-00). Absent, it is
  // the member's own refusal: the signed carrier differs.
  it("the carrier: a malformed externalId or invoiceId is mpp/request-malformed", async () => {
    const long = "x".repeat(567);
    const ext = (v: Json): Edit => (r) => (r["externalId"] = v);
    const inv = (v: Json): Edit => (r) => (details(r)["invoiceId"] = v);
    const rows: [string, string, (c: MppCredential) => Promise<unknown>, Edit][] = [
      ["charge/solana bound, externalId 5", "mpp-charge-solana.json", chargeSolana.bound, ext(5)],
      ["charge/solana reference, externalId 5", "mpp-charge-solana.json", chargeSolana.reference, ext(5)],
      ["charge/solana bound, externalId of 567 bytes", "mpp-charge-solana.json", chargeSolana.bound, ext(long)],
      ["charge/usdc/solana bound, externalId 5", "mpp-charge-usdc-solana.json", chargeUsdcSolana.bound, ext(5)],
      ["charge/usdc/solana bound, externalId of 567 bytes", "mpp-charge-usdc-solana.json", chargeUsdcSolana.bound, ext(long)],
      ["charge/nearintents bound, externalId 5", "mpp-charge-nearintents.json", chargeNearIntents.bound, ext(5)],
      ["charge/xrpl bound, invoiceId 5", "mpp-charge-xrpl.json", chargeXrpl.bound, inv(5)],
      ["charge/xrpl reference, invoiceId \"0x12\"", "mpp-charge-xrpl.json", chargeXrpl.reference, inv("0x12")],
    ];
    for (const [name, file, read, edit] of rows) {
      const c = presented(file, 1, edit);
      expect(pairingsOf(offerOf(c)), name).toEqual(refused("mpp/request-malformed"));
      expect(await read(c), name).toEqual(refused("mpp/request-malformed"));
    }
    const absent: Edit = (r) => delete r["externalId"];
    expect(await chargeSolana.bound(presented("mpp-charge-solana.json", 1, absent))).toEqual(refused("svm/carrier-mismatch"));
    expect(await chargeNearIntents.bound(presented("mpp-charge-nearintents.json", 1, absent))).toEqual(refused("near/memo-not-lcp"));
    const noInvoice = presented("mpp-charge-xrpl.json", 1, (r) => delete details(r)["invoiceId"]);
    expect(await chargeXrpl.bound(noInvoice)).toEqual(refused("xrpl/carrier-mismatch"));
  });

  it("charge/stellar: the network", async () => {
    const r = await chargeStellar.reference(presented("mpp-charge-stellar.json", 1, (q) => (details(q)["network"] = "stellar:mars")));
    expect(r).toEqual(refused("stellar/option-malformed"));
  });

  // The code advertise gives the same request (pairingsOf): an MPP Stellar charge's recipient is a Stellar account or
  // its muxed form.
  it("charge/stellar: the recipient", async () => {
    for (const recipient of [7, "GBAD"]) {
      const c = presented("mpp-charge-stellar.json", 1, (q) => (q["recipient"] = recipient));
      expect(pairingsOf(offerOf(c))).toEqual(refused("stellar/option-malformed"));
      expect(await chargeStellar.bound(c)).toEqual(refused("stellar/option-malformed"));
      expect(await chargeStellar.reference(c)).toEqual(refused("stellar/option-malformed"));
    }
  });

  it("session/evm: the escrow and the chain", async () => {
    const file = "mpp-session-evm.json";
    expect(await sessionEvm.reference(presented(file, 1, (r) => (details(r)["escrowContract"] = "0x12")))).toEqual(refused("mpp/escrow-malformed"));
    expect(await sessionEvm.reference(presented(file, 1, (r) => delete details(r)["chainId"]))).toEqual(refused("mpp/chain-id-required"));
  });

  // The codes advertise gives the same request (pairingsOf): a Tempo session's sessionProtocol is absent, "v1" or "v2",
  // and a v2 session names its chainId and its escrowContract (draft-tempo-session-00: "When
  // methodDetails.sessionProtocol is "v2", servers MUST include methodDetails.chainId and methodDetails.escrowContract
  // in the challenge after applying defaults.").
  it("session/tempo: the protocol version and the chain", async () => {
    const file = "mpp-session-tempo.json";
    const v3 = presented(file, 1, (r) => (details(r)["sessionProtocol"] = "v3"));
    const v2NoChain = presented(file, 1, (r) => delete details(r)["chainId"]);
    const v2NoEscrow = presented(file, 1, (r) => delete details(r)["escrowContract"]);
    const rows = [[v3, "mpp/session-protocol"], [v2NoChain, "mpp/chain-id-required"], [v2NoEscrow, "mpp/chain-id-required"]] as const;
    for (const [c, code] of rows) {
      expect(pairingsOf(offerOf(c))).toEqual(refused(code));
      expect(await sessionTempo.bound(c)).toEqual(refused(code));
      expect(await sessionTempo.reference(c)).toEqual(refused(code));
      expect(await sessionTempo.channel.ref(c)).toEqual(refused(code));
    }
  });

  // The Gateway salt's preimage carries the request's recipient, which advertise requires to be a string
  // (pairingsOf: mpp/request-malformed). The payer's salt here is computed with the recipient read as "".
  it("charge/usdc/gateway: the recipient the salt's preimage carries", async () => {
    const c = presented("mpp-charge-usdc-gateway.json", 1, (r) => (r["recipient"] = 5));
    type Spec = { [k: string]: string };
    const p = c.payload as unknown as {
      sourceNetwork: string;
      destinationNetwork: string;
      authorization: { transfer: { burnIntent: { maxFee: string; spec: Spec } } };
    };
    const intent = p.authorization.transfer.burnIntent;
    const requestHash = await usdcRequestHash(c.challenge.request);
    intent.spec["salt"] = usdcGatewaySalt({
      id: c.challenge.id,
      realm: c.challenge.realm,
      requestHash: requestHash as `0x${string}`,
      sourceNetwork: p.sourceNetwork,
      destinationNetwork: p.destinationNetwork,
      sourceDepositor: c.source!,
      sourceSigner: gatewayAccount(p.sourceNetwork, intent.spec["sourceSigner"])!,
      recipient: "",
      destinationRecipient: gatewayAccount(p.destinationNetwork, intent.spec["destinationRecipient"])!,
      amount: intent.spec["value"]!,
      maxFee: intent.maxFee,
    }) as string;
    expect(pairingsOf(offerOf(c))).toEqual(refused("mpp/request-malformed"));
    expect(await chargeUsdcGateway.bound(c)).toEqual(refused("mpp/request-malformed"));
  });

  it("session/hedera and session/solana: the escrow and the channel program", async () => {
    const hedera = presented("mpp-session-hedera-solana-xrpl.json", 1, (r) => delete details(r)["escrowContract"]);
    expect(await sessionHedera.reference(hedera)).toEqual(refused("mpp/request-malformed"));
    const solana = presented("mpp-session-hedera-solana-xrpl.json", 3, (r) => (details(r)["channelProgram"] = "program"));
    expect(await sessionSolana.reference(solana)).toEqual(refused("svm/input-malformed"));
  });

  // The subscription's activation is identified by what the payer signed; its reference reads only the chain, and the
  // filter holds the request's terms to their forms (draft-tempo-subscription-00's request members).
  it("subscription/tempo: the filter, then only the chain", async () => {
    const file = "mpp-subscription-tempo.json";
    const unread: Edit = (r, c) => {
      Object.assign(r, { amount: "abc", periodUnit: "month", currency: "pathUSD", recipient: "nobody" });
      noExpires(r, c);
    };
    expect(await subscriptionTempo.reference(presented(file, 1, noExpires))).toEqual(await subscriptionTempo.reference(presented(file, 1)));
    expect(await subscriptionTempo.reference(presented(file, 1, unread))).toEqual(refused("mpp/request-malformed"));
    expect(await subscriptionTempo.reference(presented(file, 1, (r) => delete details(r)["chainId"]))).toEqual(refused("mpp/chain-id-required"));
  });

  it("charge/tempo/memo: settleBy is the signed transaction's validBefore; without expires the filter refuses", async () => {
    const file = "mpp-charge-tempo-memo.json";
    const signed = (await tempoMemo.reference(presented(file, 1))) as { settleBy?: string };
    expect(signed.settleBy).toBeDefined();
    expect(await tempoMemo.reference(presented(file, 1, noExpires))).toEqual(refused("mpp/expires-required"));
  });

  // A Tempo transaction (type 0x76) is 0x76 || rlp([chainId, maxPriorityFeePerGas, maxFeePerGas, gas, calls, accessList,
  // nonceKey, nonce, validBefore, validAfter, feeToken, ...]); an empty validBefore is unset (ox 0.14.45,
  // tempo/TxEnvelopeTempo.ts `deserialize`). advertise refuses an expires that is not an RFC 3339 date-time with
  // mpp/expires-required.
  describe("the Tempo deadline: the transaction's validBefore, else the challenge's expires", () => {
    const noValidBefore = (wire: string): Hex => {
      const items = fromRlp(`0x${wire.slice(4)}`) as Hex[];
      items[8] = "0x";
      return concat(["0x76", toRlp(items)]);
    };
    const memo = (edit?: Edit) => {
      const c = presented("mpp-charge-tempo-memo.json", 1, edit);
      return { ...c, payload: { ...c.payload, signature: noValidBefore(c.payload["signature"] as string) } };
    };
    const session = (edit?: Edit) => {
      const c = presented("mpp-session-tempo.json", 1, edit);
      return { ...c, payload: { ...c.payload, transaction: noValidBefore(c.payload["transaction"] as string) } };
    };
    const notADate: Edit = (_r, c) => {
      c["expires"] = "tomorrow";
    };

    it("charge/tempo/memo: with expires alone, settleBy is expires; with neither, the reference is refused mpp/expires-required", async () => {
      expect(await tempoMemo.reference(memo(noExpires))).toEqual(refused("mpp/expires-required"));
      const byExpires = (await tempoMemo.reference(memo())) as { settleBy?: string };
      expect(byExpires.settleBy).toBe(String(Date.parse(presented("mpp-charge-tempo-memo.json", 1).challenge.expires!) / 1000));
    });

    it("session/tempo: with neither, the reference is refused mpp/expires-required", async () => {
      expect(await sessionTempo.reference(session(noExpires))).toEqual(refused("mpp/expires-required"));
    });

    it("an expires that is not a date is mpp/expires-required, whatever the transaction sets", async () => {
      expect(pairingsOf(offerOf(presented("mpp-charge-tempo-memo.json", 1, notADate)))).toEqual(refused("mpp/expires-required"));
      expect(await tempoMemo.reference(memo(notADate))).toEqual(refused("mpp/expires-required"));
      expect(await sessionTempo.reference(session(notADate))).toEqual(refused("mpp/expires-required"));
      expect(await tempoMemo.bound(memo(notADate))).toEqual(refused("mpp/expires-required"));
      expect(await tempoMemo.reference(presented("mpp-charge-tempo-memo.json", 1, notADate))).toEqual(refused("mpp/expires-required"));
      expect(await sessionTempo.reference(presented("mpp-session-tempo.json", 1, notADate))).toEqual(refused("mpp/expires-required"));
    });
  });
});

describe("fetchPresented holds the echoed challenge to the filter before it reads, and reads nothing else of the request", () => {
  /** A reader whose every call fails, and that counts its calls. */
  const evmReader = (network: string, calls: string[]): EvmReader => ({
    network: network as EvmReader["network"],
    receipt: async () => {
      calls.push("receipt");
      throw new ReaderError("transport");
    },
    blockNumber: async () => 0n,
    transaction: async () => null,
    call: async () => "0x",
  });

  it("charge/tempo/push: amount \"abc\" is refused before the read; a request member the filter does not read reaches the reader", async () => {
    const calls: string[] = [];
    const c = presented("mpp-charge-tempo-push.json", 1, (r) => (r["amount"] = "abc"));
    expect(await tempoPush.fetchPresented(c, evmReader("eip155:42431", calls))).toEqual(refused("mpp/request-malformed"));
    expect(calls).toEqual([]);
    const other = presented("mpp-charge-tempo-push.json", 1, (r) => (r["description"] = "x"));
    expect(await tempoPush.fetchPresented(other, evmReader("eip155:42431", calls))).toEqual(refused("tempo/unreadable"));
    expect(calls).toEqual(["receipt"]);
  });

  it("session/hedera: a named channel is refused before the read; no expires reaches the reader", async () => {
    const calls: string[] = [];
    const named = presented("mpp-session-hedera-solana-xrpl.json", 1, (r) => (details(r)["channelId"] = `0x${"11".repeat(32)}`));
    expect(await sessionHedera.fetchPresented(named, evmReader("hedera:testnet", calls) as HederaEvmReader)).toEqual(refused("mpp/channel-named"));
    expect(calls).toEqual([]);
    const c = presented("mpp-session-hedera-solana-xrpl.json", 1, noExpires);
    expect(await sessionHedera.fetchPresented(c, evmReader("hedera:testnet", calls) as HederaEvmReader)).toEqual(refused("hedera/unreadable"));
    expect(calls).toEqual(["receipt"]);
  });
});

// channel.ref names the channel of an opening from its echoed challenge, so it holds that challenge to the pairing's
// filter as bound does: a challenge pairingsOf refuses gives that refusal. The EVM and Tempo sessions need expires,
// which build writes into the opening the payer signs; Tempo's key authorization takes subscriptionExpires as a uint64
// expiry, from 1970; and the Lightning session's paymentHash is the "SHA-256 hash of the deposit invoice preimage"
// (draft-lightning-session-00), so the deposit invoice carries it. A within payment's challenge, which the seller
// issues naming the channel, is read without the filter.
describe("channel.ref holds an opening's echoed challenge to the pairing's filter", () => {
  type Ref = (c: MppCredential) => Promise<unknown>;
  const lowerChannel = (c: MppCredential) => String(c.payload["channelId"]).toLowerCase();
  const chainOf = (c: MppCredential) =>
    JSON.parse(Buffer.from(c.challenge.request, "base64url").toString("utf8")).methodDetails.chainId as number;
  const CASES = rowsOf<[string, { bound: Ref; channel: { ref: Ref } }, string, Edit, (c: MppCredential) => unknown, string]>(
    [
      ["session/evm, no expires", sessionEvm, "mpp-session-evm.json", noExpires, (c) => ({ network: `eip155:${chainOf(c)}`, channel: lowerChannel(c) }), "mpp/expires-required"],
      ["session/tempo, no expires", sessionTempo, "mpp-session-tempo.json", noExpires, (c) => ({ network: `eip155:${chainOf(c)}`, channel: lowerChannel(c) }), "mpp/expires-required"],
      ["subscription/tempo, subscriptionExpires in 1969", subscriptionTempo, "mpp-subscription-tempo.json", (r) => (r["subscriptionExpires"] = "1969-12-31T23:59:59Z"),
        (c) => ({ network: `eip155:${chainOf(c)}`, channel: load("mpp-subscription-tempo.json").SUB2.expectRefChannel }), "mpp/request-malformed"],
      ["session/lightning, a paymentHash the deposit invoice does not carry", sessionLightning, "mpp-session-lightning.json", (r) => (r["paymentHash"] = "11".repeat(32)),
        (c) => ({ network: "lightning", channel: JSON.parse(Buffer.from(c.challenge.request, "base64url").toString("utf8")).paymentHash }), "ln/payment-hash-mismatch"],
    ],
    "the openings each session pairing's filter refuses",
    { exact: 4 },
  );
  it.each(CASES)("%s", async (_, pairing, file, edit, keys, code) => {
    const own = presented(file, 1);
    expect(await pairing.channel.ref(own)).toEqual(keys(own));
    const c = presented(file, 1, edit);
    expect(pairingsOf(offerOf(c))).toEqual(refused(code));
    expect(await pairing.bound(c)).toEqual(refused(code));
    expect(await pairing.channel.ref(c)).toEqual(refused(code));
  });

  it("a within payment's challenge is read without the filter", async () => {
    for (const [pairing, file] of [[sessionEvm, "mpp-session-evm.json"], [sessionTempo, "mpp-session-tempo.json"]] as const) {
      const c = presented(file, 1, noExpires);
      const voucher = { ...c, payload: { action: "voucher", channelId: c.payload["channelId"]!, cumulativeAmount: "1", signature: "0x11" } };
      expect(await pairing.channel.kind(voucher), file).toBe("within");
      expect(await pairing.channel.ref(voucher), file).toEqual({ network: `eip155:${chainOf(c)}`, channel: lowerChannel(c) });
    }
    const bearer = presented("mpp-session-lightning.json", 1, (r) => (r["paymentHash"] = "11".repeat(32)));
    const sessionId = "22".repeat(32);
    const within = { ...bearer, payload: { action: "bearer", sessionId, preimage: "33".repeat(32) } };
    expect(await sessionLightning.channel.ref(within)).toEqual({ network: "lightning", channel: sessionId });
  });
});
