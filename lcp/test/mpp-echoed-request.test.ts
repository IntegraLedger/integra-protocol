// `bound`, `reference` and `fetchPresented` start from the echoed challenge's H (`challengeBound`) and read, and check,
// only the request members their own read keys or derivation use; the request's other checks are `advertise`'s and
// `build`'s. MPP's drafts name the members each method reads: the network or chain, the currency, the recipient and the
// escrow; `expires` is the challenge's own expiry. Each credential is a vector file's buyer row as it presents it,
// whose expected H is that row's; the request is re-encoded as base64url of its JCS form after each change.
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
import { gatewayAccount } from "../src/mpp-usdc.js";
import { load } from "./mpp-fixtures.js";

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

describe("bound reads no request member it does not use", () => {
  const rows: [string, (c: MppCredential) => Promise<unknown>, string, number, Edit][] = [
    ["charge/evm/authorization, no expires", evmAuthorization.bound, "mpp-charge-evm-authorization.json", 1, noExpires],
    ["charge/evm/authorization, amount \"abc\"", evmAuthorization.bound, "mpp-charge-evm-authorization.json", 1, (r) => (r["amount"] = "abc")],
    ["charge/evm/permit2, externalId null", evmPermit2.bound, "mpp-charge-evm-permit2.json", 1, (r) => (r["externalId"] = null)],
    ["charge/tempo/memo, amount \"abc\"", tempoMemo.bound, "mpp-charge-tempo-memo.json", 1, (r) => (r["amount"] = "abc")],
    ["charge/tempo/push, no expires", tempoPush.bound, "mpp-charge-tempo-push.json", 1, noExpires],
    ["charge/solana, no expires", chargeSolana.bound, "mpp-charge-solana.json", 1, noExpires],
    ["charge/stellar, amount \"0\"", chargeStellar.bound, "mpp-charge-stellar.json", 1, (r) => (r["amount"] = "0")],
    ["charge/xrpl, no expires", chargeXrpl.bound, "mpp-charge-xrpl.json", 1, noExpires],
    ["charge/nearintents, amount \"x\"", chargeNearIntents.bound, "mpp-charge-nearintents.json", 1, (r) => (r["amount"] = "x")],
    ["charge/usdc/evm, no expires", chargeUsdcEvm.bound, "mpp-charge-usdc-evm.json", 1, noExpires],
    ["charge/usdc/solana, no expires", chargeUsdcSolana.bound, "mpp-charge-usdc-solana.json", 1, noExpires],
    ["charge/usdc/stacks, no expires", chargeUsdcStacks.bound, "mpp-charge-usdc-stacks.json", 1, noExpires],
    ["charge/usdc/gateway, no expires", chargeUsdcGateway.bound, "mpp-charge-usdc-gateway.json", 1, noExpires],
    ["session/evm, no expires and credentialTypes [\"other\"]", sessionEvm.bound, "mpp-session-evm.json", 1, (r, c) => {
      noExpires(r, c);
      details(r)["credentialTypes"] = ["other"];
    }],
    ["session/tempo, amount \"abc\"", sessionTempo.bound, "mpp-session-tempo.json", 1, (r) => (r["amount"] = "abc")],
    ["session/solana, no expires", sessionSolana.bound, "mpp-session-hedera-solana-xrpl.json", 3, noExpires],
    ["session/xrpl, no expires and currency \"USD\"", sessionXrpl.bound, "mpp-session-hedera-solana-xrpl.json", 5, (r, c) => {
      noExpires(r, c);
      r["currency"] = "USD";
    }],
    ["subscription/tempo, periodCount \"0\", periodUnit \"month\", subscriptionExpires \"tomorrow\", amount \"abc\", no expires",
      subscriptionTempo.bound, "mpp-subscription-tempo.json", 1, (r, c) => {
        Object.assign(r, { periodCount: "0", periodUnit: "month", subscriptionExpires: "tomorrow", amount: "abc" });
        noExpires(r, c);
      }],
  ];
  for (const [name, bound, file, row, edit] of rows) {
    it(name, async () => {
      expect(await bound(presented(file, row))).toBe(expectedH(file, row));
      expect(await bound(presented(file, row, edit))).toBe(expectedH(file, row));
    });
  }

  it("a usdc credential is read only by the pairing of the profile methodDetails.type names", async () => {
    expect(await chargeUsdcGateway.bound(presented("mpp-charge-usdc-evm.json", 1))).toEqual(refused("mpp/not-this-pairing"));
  });
});

describe("reference reads its read keys, and refuses one that is malformed, never throwing or defaulting", () => {
  it("charge/evm/authorization: the currency and the chain", async () => {
    const file = "mpp-charge-evm-authorization.json";
    expect(await evmAuthorization.reference(presented(file, 1, noExpires))).toMatchObject({ network: "eip155:84532" });
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

  it("subscription/tempo: only the chain; the activation is identified by what the payer signed", async () => {
    const file = "mpp-subscription-tempo.json";
    const unread: Edit = (r, c) => {
      Object.assign(r, { amount: "abc", periodUnit: "month", currency: "pathUSD", recipient: "nobody" });
      noExpires(r, c);
    };
    expect(await subscriptionTempo.reference(presented(file, 1, unread))).toEqual(await subscriptionTempo.reference(presented(file, 1)));
    expect(await subscriptionTempo.reference(presented(file, 1, (r) => delete details(r)["chainId"]))).toEqual(refused("mpp/chain-id-required"));
  });

  it("charge/tempo/memo: without expires, settleBy is the signed transaction's validBefore", async () => {
    const file = "mpp-charge-tempo-memo.json";
    const withExpires = (await tempoMemo.reference(presented(file, 1))) as { settleBy?: string };
    const without = (await tempoMemo.reference(presented(file, 1, noExpires))) as { settleBy?: string; refused?: true };
    expect(without.refused).toBeUndefined();
    expect(without.settleBy).toBe(withExpires.settleBy);
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

    it("charge/tempo/memo: with neither, the reference has no settleBy; with expires alone, settleBy is expires", async () => {
      const without = (await tempoMemo.reference(memo(noExpires))) as { settleBy?: string; refused?: true };
      expect(without.refused).toBeUndefined();
      expect(without).not.toHaveProperty("settleBy");
      const byExpires = (await tempoMemo.reference(memo())) as { settleBy?: string };
      expect(byExpires.settleBy).toBe(String(Date.parse(presented("mpp-charge-tempo-memo.json", 1).challenge.expires!) / 1000));
    });

    it("session/tempo: with neither, the reference is refused mpp/expires-required", async () => {
      expect(await sessionTempo.reference(session(noExpires))).toEqual(refused("mpp/expires-required"));
    });

    it("an expires that is not a date, read where the transaction sets no validBefore, is mpp/expires-required", async () => {
      expect(pairingsOf(offerOf(presented("mpp-charge-tempo-memo.json", 1, notADate)))).toEqual(refused("mpp/expires-required"));
      expect(await tempoMemo.reference(memo(notADate))).toEqual(refused("mpp/expires-required"));
      expect(await sessionTempo.reference(session(notADate))).toEqual(refused("mpp/expires-required"));
      expect(await tempoMemo.bound(memo(notADate))).toBe(expectedH("mpp-charge-tempo-memo.json", 1));
    });

    it("an expires that is not a date is not read where the transaction sets validBefore", async () => {
      const validBefore = (wire: string) => BigInt((fromRlp(`0x${wire.slice(4)}`) as Hex[])[8]!).toString();
      const m = presented("mpp-charge-tempo-memo.json", 1, notADate);
      const s = presented("mpp-session-tempo.json", 1, notADate);
      const memoRef = (await tempoMemo.reference(m)) as { settleBy?: string };
      const sessionRef = (await sessionTempo.reference(s)) as { settleBy?: string };
      expect(memoRef.settleBy).toBe(validBefore(m.payload["signature"] as string));
      expect(sessionRef.settleBy).toBe(validBefore(s.payload["transaction"] as string));
    });
  });
});

describe("fetchPresented reads the network or chain it reads from, and nothing else of the request", () => {
  const evmReader = (network: string): EvmReader => ({
    network: network as EvmReader["network"],
    receipt: async () => {
      throw new ReaderError("transport");
    },
    blockNumber: async () => 0n,
    transaction: async () => null,
    call: async () => "0x",
  });

  it("charge/tempo/push: no expires and amount \"abc\" reach the reader", async () => {
    const c = presented("mpp-charge-tempo-push.json", 1, (r, ch) => {
      r["amount"] = "abc";
      noExpires(r, ch);
    });
    expect(await tempoPush.fetchPresented(c, evmReader("eip155:42431"))).toEqual(refused("tempo/unreadable"));
  });

  it("session/hedera: no expires and a named channel reach the reader", async () => {
    const c = presented("mpp-session-hedera-solana-xrpl.json", 1, (r, ch) => {
      details(r)["channelId"] = `0x${"11".repeat(32)}`;
      noExpires(r, ch);
    });
    expect(await sessionHedera.fetchPresented(c, evmReader("hedera:testnet") as HederaEvmReader)).toEqual(refused("hedera/unreadable"));
  });
});
