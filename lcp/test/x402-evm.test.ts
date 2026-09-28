// Expected values are the fixed inputs and outputs below, each with its source: FIPS 180-2's SHA-256("abc"), x402's
// example option, the Anvil development key, eth-account 0.14.0 for the EIP-712 values, and GNU coreutils sha256sum.
import { describe, expect, it } from "vitest";
import {
  domainSeparator,
  encodePacked,
  hashStruct,
  hashTypedData,
  keccak256,
  recoverTypedDataAddress,
  sha256,
  toHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { pairingOf as rootPairingOf } from "../src/index.js";
import * as x402 from "../src/x402.js";
import { readFileSync } from "node:fs";
import {
  AUTHORIZATION_USED_TOPIC,
  ReaderError,
  TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
  authorizationIdDigest,
  type Eip3009TypedData,
  type EvmReader,
  type EvmReceipt,
  type Hex,
} from "../src/evm.js";
import {
  LEGAL_CONTEXT_SCHEMA,
  exactEip3009,
  issuedDigest,
  requestCommitment,
  tie,
  type Eip3009Payment as PaymentPayload,
  type PaymentRequired,
  type PaymentRequirements,
  type Unsigned,
} from "../src/x402.js";

// SHA-256("abc"), FIPS 180-2.
const H = "0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" as const;
// x402's example requirements (x402 specification §5.2.1).
const O: PaymentRequirements = {
  scheme: "exact",
  network: "eip155:84532",
  amount: "10000",
  asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  payTo: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
  maxTimeoutSeconds: 60,
  extra: { name: "USDC", version: "2" },
};
// The published Anvil development key and its address.
const KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const PAYER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as const;
const NOW = 1790000000;
const RESOURCE = { url: "https://api.seller.example/v1/quote" };
const REQUIRED: PaymentRequired = { x402Version: 2, resource: RESOURCE, accepts: [O] };
// eth-account 0.14.0 (Python 3.12.3): Account.sign_typed_data over V1's typed data.
const SIGNATURE =
  "0xd51cabca403ce9ee24ab0442df41928ef61c1c117bc211a2cac7c5b11c0084832e0cf7beda17ce863cec05d47b776dc24cecf0255b48b274cdf60f05129fe5771b" as const;
const LINK = "https://atr.seller.example/0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

const refused = (code: string) => ({ refused: true, code });
// viem's parameter types need literal field types; the typed data is passed to it as data.
const forViem = (td: Eip3009TypedData) => td as unknown as Parameters<typeof hashTypedData>[0];

async function unsignedV1(): Promise<Unsigned> {
  const u = await exactEip3009.build({ required: REQUIRED, accepted: O, from: PAYER, now: NOW }, H);
  if ("refused" in u) throw new Error(u.code);
  return u;
}

describe("V1 EIP-712", () => {
  it("the constants are the keccak of their signatures", () => {
    expect(TRANSFER_WITH_AUTHORIZATION_TYPEHASH).toBe(
      "0x7c7c6cdb67a18743f49ec6fa9b35f50d52ed05cbed4cc592e13b44501c1a2267",
    );
    expect(
      keccak256(
        toHex(
          "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)",
        ),
      ),
    ).toBe(TRANSFER_WITH_AUTHORIZATION_TYPEHASH);
    expect(AUTHORIZATION_USED_TOPIC).toBe("0x98de503528ee59b575ef0c0a2576a82497bfc029a5685b209e9ec333479b10a5");
    expect(keccak256(toHex("AuthorizationUsed(address,bytes32)"))).toBe(AUTHORIZATION_USED_TOPIC);
  });

  it("build's typed data hashes to eth-account's digest", async () => {
    const { typedData } = await unsignedV1();
    expect(domainSeparator({ domain: typedData.domain })).toBe(
      "0x71f17a3b2ff373b803d70a5a07c046c1a2bc8e89c09ef722fcb047abe94c9818",
    );
    expect(
      hashStruct({ data: typedData.message, primaryType: typedData.primaryType, types: typedData.types }),
    ).toBe("0xf1b86f117731eb916a2f20b008e21bf04ccbd7bc83827c06787756631e1fc450");
    expect(hashTypedData(forViem(typedData))).toBe("0xb9aac018ad9f1b48572085f195664ae44df86190db9d0d6191f53cc374eff528");
  });

  it("the message is the option's values with the hash as nonce", async () => {
    const { typedData } = await unsignedV1();
    expect(typedData.domain).toEqual({ name: "USDC", version: "2", chainId: 84532, verifyingContract: O.asset });
    expect(typedData.message).toEqual({
      from: PAYER,
      to: O.payTo,
      value: 10000n,
      validAfter: 0n,
      validBefore: 1790000060n,
      nonce: H,
    });
  });

  it("eth-account's signature recovers to the payer, and viem signs the same bytes", async () => {
    const { typedData } = await unsignedV1();
    expect(await recoverTypedDataAddress({ ...forViem(typedData), signature: SIGNATURE })).toBe(PAYER);
    expect(await privateKeyToAccount(KEY).signTypedData(forViem(typedData))).toBe(SIGNATURE);
  });
});

describe("V2 complete and bound", () => {
  it("complete gives x402's PaymentPayload", async () => {
    const u = await unsignedV1();
    expect(u.complete(SIGNATURE)).toEqual({
      x402Version: 2,
      resource: RESOURCE,
      accepted: O,
      payload: {
        signature: SIGNATURE,
        authorization: {
          from: PAYER,
          to: O.payTo,
          value: "10000",
          validAfter: "0",
          validBefore: "1790000060",
          nonce: H,
        },
      },
    });
  });

  it("bound returns H, also for an upper-case nonce", async () => {
    const p = (await unsignedV1()).complete(SIGNATURE) as PaymentPayload;
    expect(await exactEip3009.bound(p)).toBe(H);
    const upper = structuredClone(p);
    upper.payload.authorization.nonce = "0x" + H.slice(2).toUpperCase();
    expect(await exactEip3009.bound(upper)).toBe(H);
  });

  it("bound refuses an option that names Permit2", async () => {
    const p = structuredClone((await unsignedV1()).complete(SIGNATURE) as PaymentPayload);
    p.accepted.extra = { ...p.accepted.extra, assetTransferMethod: "permit2" };
    expect(await exactEip3009.bound(p)).toEqual(refused("x402/option-not-this-pairing"));
  });

  it("complete refuses a signature shorter than 65 bytes", async () => {
    const u = await unsignedV1();
    expect(u.complete("0x1234")).toEqual(refused("x402/signature-malformed"));
  });

  it("bound refuses a payload without the authorization's members, and a v1 payload", async () => {
    const p = structuredClone((await unsignedV1()).complete(SIGNATURE) as PaymentPayload) as unknown as {
      x402Version: number;
      payload: { authorization: Record<string, unknown> };
    };
    delete p.payload.authorization["validBefore"];
    expect(await exactEip3009.bound(p)).toEqual(refused("x402/payload-malformed"));
    expect(await exactEip3009.bound({ ...p, x402Version: 1 })).toEqual(refused("x402/not-v2"));
  });

  it("build refuses an option that is not in the document", async () => {
    const other = { ...O, amount: "20000" };
    expect(await exactEip3009.build({ required: REQUIRED, accepted: other, from: PAYER, now: NOW }, H)).toEqual(
      refused("x402/option-not-in-document"),
    );
  });
});

describe("V3 request commitment", () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  it("POST with a body", async () => {
    const c = await requestCommitment({ method: "POST", target: "/v1/quote?symbol=ETH&size=2", body: enc('{"side":"buy","qty":"2"}') });
    expect(c).toEqual({
      method: "POST",
      path: "/v1/quote",
      query: "symbol=ETH&size=2",
      bodyDigest: "0x1974ed74c4b07a90af58a2e387aa1625aa666a7a245b1308879f04bf66142961",
    });
    expect(await issuedDigest(c as never)).toBe("0x78e63d10013bb5b8f1290361fb31a9217ebc74d78c8103be31883a0bbbc08e1a");
  });
  it("GET with no body", async () => {
    const c = await requestCommitment({ method: "GET", target: "/v1/report", body: new Uint8Array() });
    expect(c).toEqual({
      method: "GET",
      path: "/v1/report",
      query: "",
      bodyDigest: "0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    });
    expect(await issuedDigest(c as never)).toBe("0x4f12d0075d3e63361bdeeac695015e16184bcd567c15f78c37333232c3d9933d");
  });
  it("reordered body members are a different commitment", async () => {
    const a = await requestCommitment({ method: "POST", target: "/v1/quote?symbol=ETH&size=2", body: enc('{"qty":"2","side":"buy"}') });
    expect((a as { bodyDigest: string }).bodyDigest).toBe(
      "0x8d5bc8c472ea91fbafd5761318d5546fab5fb95c4573d981dfd8d03400fcfe85",
    );
    expect(await issuedDigest(a as never)).not.toBe(
      "0x78e63d10013bb5b8f1290361fb31a9217ebc74d78c8103be31883a0bbbc08e1a",
    );
  });
  it("refuses a target that is not origin-form visible ASCII, and oversize inputs", async () => {
    const body = new Uint8Array();
    expect(await requestCommitment({ method: "GET", target: "v1", body })).toEqual(refused("x402/request-target-invalid"));
    expect(await requestCommitment({ method: "GET", target: "/a b", body })).toEqual(refused("x402/request-target-invalid"));
    expect(await requestCommitment({ method: "GET", target: "/" + "a".repeat(8192), body })).toEqual(
      refused("x402/request-too-large"),
    );
    expect(await requestCommitment({ method: "POST", target: "/", body: new Uint8Array(1_048_577) })).toEqual(
      refused("x402/request-too-large"),
    );
  });
});

describe("V4 option digest", () => {
  it("is the digest of the sorted form, whatever the member order", async () => {
    expect(await issuedDigest(O)).toBe("0xcfe6c196f3349d47f51598551a066e8a9661534eb89af6ed3b359e09acd1a256");
    const reordered: PaymentRequirements = {
      extra: { version: "2", name: "USDC" },
      payTo: O.payTo,
      maxTimeoutSeconds: 60,
      asset: O.asset,
      network: O.network,
      amount: O.amount,
      scheme: "exact",
    };
    expect(await issuedDigest(reordered)).toBe("0xcfe6c196f3349d47f51598551a066e8a9661534eb89af6ed3b359e09acd1a256");
  });
});

describe("V5 advertise and read", () => {
  it("adds exactly extensions.legalContext, and read gives it back", () => {
    const doc = exactEip3009.advertise({ x402Version: 2, resource: RESOURCE, accepts: [O] }, H, LINK, O);
    expect(doc).toEqual({
      x402Version: 2,
      resource: RESOURCE,
      accepts: [O],
      extensions: {
        legalContext: { info: { type: "sha256", value: H, legalContextUrl: LINK }, schema: LEGAL_CONTEXT_SCHEMA },
      },
    });
    expect((doc as PaymentRequired).accepts[0]).toEqual(O);
    const r = exactEip3009.read(doc);
    if ("refused" in r) throw new Error(r.code);
    expect(r.h).toBe(H);
    expect(r.link).toBe(LINK);
    expect(r.offer.options).toEqual([O]);
  });
  it("the schema is exactly the published one", () => {
    expect(JSON.stringify(LEGAL_CONTEXT_SCHEMA)).toBe(
      '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"type":{"const":"sha256"},"value":{"type":"string","pattern":"^0x[0-9a-f]{64}$"},"legalContextUrl":{"type":"string","pattern":"^https://"}},"required":["type","value","legalContextUrl"]}',
    );
  });
  it("refuses an http link and a conflicting legalContext", () => {
    const base: PaymentRequired = { x402Version: 2, resource: RESOURCE, accepts: [O] };
    expect(exactEip3009.advertise(base, H, "http://atr.seller.example/x", O)).toEqual(refused("x402/link-not-https"));
    const other = exactEip3009.advertise(base, H, LINK + "?v=other", O) as PaymentRequired;
    expect(exactEip3009.advertise(other, H, LINK, O)).toEqual(refused("x402/legal-context-conflict"));
  });
  it("is idempotent for the same hash and link, and keeps other extensions", () => {
    const base: PaymentRequired = {
      x402Version: 2,
      resource: RESOURCE,
      accepts: [O],
      extensions: { bazaar: { info: { a: 1 }, schema: {} } },
    };
    const once = exactEip3009.advertise(base, H, LINK, O) as PaymentRequired;
    expect(once.extensions?.["bazaar"]).toEqual({ info: { a: 1 }, schema: {} });
    expect(exactEip3009.advertise(once, H, LINK, O)).toEqual(once);
  });
  it("read refuses an http link as link-not-https, and a malformed context as legal-context-malformed", () => {
    const doc = exactEip3009.advertise({ x402Version: 2, resource: RESOURCE, accepts: [O] }, H, LINK, O) as PaymentRequired;
    const http = structuredClone(doc);
    (http.extensions!["legalContext"]!.info as Record<string, unknown>)["legalContextUrl"] = "http://atr.seller.example/" + H;
    expect(exactEip3009.read(http)).toEqual(refused("x402/link-not-https"));
    const snake = structuredClone(doc);
    const info = snake.extensions!["legalContext"]!.info as Record<string, unknown>;
    delete info["legalContextUrl"];
    info["legal_context_url"] = "http://atr.seller.example/" + H;
    expect(exactEip3009.read(snake)).toEqual(refused("x402/link-not-https"));
    const bad = structuredClone(doc);
    (bad.extensions!["legalContext"]!.info as Record<string, unknown>)["value"] = "0x1234";
    expect(exactEip3009.read(bad)).toEqual(refused("x402/legal-context-malformed"));
  });
  it("read ignores members a client appended to info, and refuses a missing legalContext", () => {
    const doc = exactEip3009.advertise({ x402Version: 2, resource: RESOURCE, accepts: [O] }, H, LINK, O) as PaymentRequired;
    const appended = structuredClone(doc);
    (appended.extensions!["legalContext"]!.info as Record<string, unknown>)["note"] = "x";
    expect((exactEip3009.read(appended) as { h: string }).h).toBe(H);
    expect(exactEip3009.read({ x402Version: 2, resource: RESOURCE, accepts: [O] })).toEqual(
      refused("x402/no-legal-context"),
    );
  });
  it("the pairing's filter, through the package's one resolver", () => {
    expect(rootPairingOf(O)).toBe("x402/exact/eip155/eip3009");
    expect(rootPairingOf({ ...O, extra: { ...O.extra, paymentFlow: "upfront" } })).toBe("x402/exact/eip155/eip3009");
    expect(rootPairingOf({ ...O, extra: { ...O.extra, paymentFlow: "escrow" } })).not.toBe("x402/exact/eip155/eip3009");
    expect(rootPairingOf({ ...O, scheme: "upto" })).not.toBe("x402/exact/eip155/eip3009");
    expect(rootPairingOf({ ...O, network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" })).not.toBe("x402/exact/eip155/eip3009");
  });
  it("the x402 entry point exports no pairingOf of its own", () => {
    expect("pairingOf" in x402).toBe(false);
  });
  it("tie holds every option and the request, and no hash", () => {
    const request = {
      method: "GET",
      path: "/v1/report",
      query: "",
      bodyDigest: "0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" as const,
    };
    expect(tie([O], request)).toEqual(["x402", { accepts: [O], request }]);
    expect(exactEip3009.unplaced(O)).toBe(O);
  });
});

describe("the record", () => {
  it("states what it proves", () => {
    expect(exactEip3009.pattern).toEqual({
      pattern: "native-field",
      canonical: false,
      profile: "x402/exact/eip155/eip3009",
      buyerSigns: true,
      onChain: true,
      zeroPartyRecoverable: true,
      forwardIndexable: true,
      publicProof: true,
      proves:
        "The payer signed an EIP-3009 transfer authorization whose nonce is this ATR's hash. The token contract verified that signature when it executed the transfer, and the hash is on chain as the nonce topic of its AuthorizationUsed event in the settlement transaction. This does not show that amount, payee, asset or timing match the ATR's content.",
    });
    expect(exactEip3009.claims).toBe(true);
  });
  it("ships the published profile", () => {
    const text = readFileSync(new URL("../profiles/x402-exact-eip155-eip3009.md", import.meta.url), "utf8");
    expect(text).toContain("**LCP profile `x402/exact/eip155/eip3009`: the ATR hash as the EIP-3009 nonce.**");
  });
});

describe("the identity digest and the reference", () => {
  // sha256sum over the 72 bytes of payer ‖ payTo ‖ uint256(10000):
  // printf '%s' f39f…2266209693…287c0000…2710 | xxd -r -p | sha256sum
  const ID_DIGEST = "0xc2396ede68ae6fe8e354ddf13ddb355932d97ac8cdeff1467f9307e47bf0d42f";
  it("authorizationIdDigest is SHA-256 over the packed address, address, uint256", async () => {
    expect(await authorizationIdDigest(PAYER, O.payTo as Hex, "10000")).toBe(ID_DIGEST);
    expect(await authorizationIdDigest(PAYER, O.payTo as Hex, 10000n)).toBe(ID_DIGEST);
    expect(sha256(encodePacked(["address", "address", "uint256"], [PAYER, O.payTo as Hex, 10000n]))).toBe(ID_DIGEST);
  });
  it("reference gives the read keys of V2's payment", async () => {
    const p = (await unsignedV1()).complete(SIGNATURE) as PaymentPayload;
    expect(await exactEip3009.reference(p)).toEqual({
      network: "eip155:84532",
      asset: O.asset,
      validBefore: "1790000060",
      maxTimeoutSeconds: O.maxTimeoutSeconds,
      idDigest: ID_DIGEST,
      bindingLog: { address: O.asset, topic0: AUTHORIZATION_USED_TOPIC, index: 2, value: H },
      transferLog: {
        address: O.asset,
        topic0: "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
        identity: "from,to,value",
        digest: ID_DIGEST,
      },
      search: { address: O.asset, topics: [AUTHORIZATION_USED_TOPIC, null, H] },
      authorization: { scheme: "eip3009", at: O.asset, nonce: H, deadline: "1790000060", asset: O.asset },
    });
  });
  it("authorizer gives the authorization's from, lowercase, and refuses what bound refuses", async () => {
    const p = (await unsignedV1()).complete(SIGNATURE) as PaymentPayload;
    expect(await exactEip3009.authorizer(p)).toBe(PAYER.toLowerCase());
    const permit2 = structuredClone(p);
    permit2.accepted.extra = { ...permit2.accepted.extra, assetTransferMethod: "permit2" };
    expect(await exactEip3009.authorizer(permit2)).toEqual(refused("x402/option-not-this-pairing"));
    const noFrom = structuredClone(p);
    noFrom.payload.authorization.from = "0x1234";
    expect(await exactEip3009.authorizer(noFrom)).toEqual(refused("x402/payload-malformed"));
  });
});

describe("V6 status and recover", () => {
  const TX = ("0x" + "11".repeat(32)) as Hex;
  const ASSET = O.asset as Hex;
  const other = (n: number) => ({
    address: ASSET,
    topics: [("0x" + n.toString(16).padStart(64, "0")) as Hex],
    data: "0x" as Hex,
  });
  const word = (a: string) => ("0x" + "00".repeat(12) + a.slice(2).toLowerCase()) as Hex;
  const used = (nonce: Hex, address: Hex = ASSET, authorizer: string = PAYER) => ({
    address,
    topics: [AUTHORIZATION_USED_TOPIC, word(authorizer), nonce],
    data: "0x" as Hex,
  });
  // keccak256("Transfer(address,address,uint256)"), ERC-20's event, with the value as one uint256 data word.
  const TRANSFER = keccak256(toHex("Transfer(address,address,uint256)"));
  const transfer = (from: string, to: string, value: bigint) => ({
    address: ASSET,
    topics: [TRANSFER, word(from), word(to)],
    data: toHex(value, { size: 32 }),
  });
  const payment = transfer(PAYER, O.payTo, 10000n);
  const receiptAt = (blockNumber: bigint, logs: EvmReceipt["logs"], status: 0 | 1 = 1): EvmReceipt => ({
    status,
    blockNumber,
    logs,
  });
  const reader = (r: EvmReceipt | null | Error): EvmReader => ({
    network: "eip155:84532",
    receipt: async () => {
      if (r instanceof Error) throw r;
      return r;
    },
    blockNumber: async (tag) => (tag === "finalized" ? 100n : 105n),
    transaction: async () => null,
    call: async () => {
      throw new ReaderError("transport");
    },
  });
  // The identity digest of V2's transfer (sha256sum, as in the reference test above).
  const transferLog = {
    address: ASSET,
    topic0: TRANSFER,
    identity: "from,to,value" as const,
    digest: "0xc2396ede68ae6fe8e354ddf13ddb355932d97ac8cdeff1467f9307e47bf0d42f" as Hex,
  };
  const ref = { network: "eip155:84532" as const, asset: ASSET, transaction: TX, h: H, transferLog };
  const matchingThirdOfFour = [other(1), other(2), used(H), other(3), payment];

  it("a reverted receipt is failed", async () => {
    expect(await exactEip3009.status(ref, reader(receiptAt(100n, [], 0)))).toEqual({ state: "failed", why: "reverted" });
  });
  it("the finality is the highest mark at or above the receipt's block", async () => {
    expect(await exactEip3009.status(ref, reader(receiptAt(100n, matchingThirdOfFour)))).toEqual({
      state: "settled",
      finality: "finalized",
      blockNumber: 100n,
    });
    expect(await exactEip3009.status(ref, reader(receiptAt(104n, matchingThirdOfFour)))).toEqual({
      state: "settled",
      finality: "safe",
      blockNumber: 104n,
    });
    expect(await exactEip3009.status(ref, reader(receiptAt(110n, matchingThirdOfFour)))).toEqual({
      state: "settled",
      finality: "latest",
      blockNumber: 110n,
    });
  });
  it("no receipt is pending not-found, and a reader failure pending unreadable", async () => {
    expect(await exactEip3009.status(ref, reader(null))).toEqual({ state: "pending", why: "not-found" });
    expect(await exactEip3009.status(ref, reader(new ReaderError("timeout")))).toEqual({
      state: "pending",
      why: "unreadable",
    });
  });
  it("a reader for another network is pending unreadable", async () => {
    const r = { ...reader(receiptAt(100n, matchingThirdOfFour)), network: "eip155:8453" as const };
    expect(await exactEip3009.status(ref, r)).toEqual({ state: "pending", why: "unreadable" });
  });
  it("a successful receipt without this authorization's use is failed", async () => {
    const otherNonce = ("0x" + "22".repeat(32)) as Hex;
    expect(await exactEip3009.status(ref, reader(receiptAt(100n, [used(otherNonce)])))).toEqual({
      state: "failed",
      why: "authorization-not-used",
    });
  });
  it("recover gives H from the block-100 receipt, and refuses two different nonces", async () => {
    const tx = { network: ref.network, asset: ASSET, transaction: TX };
    expect(await exactEip3009.recover(tx, reader(receiptAt(100n, matchingThirdOfFour)))).toBe(H);
    const two = [used(H), used(("0x" + "22".repeat(32)) as Hex)];
    expect(await exactEip3009.recover(tx, reader(receiptAt(100n, two)))).toEqual(refused("evm/ambiguous"));
    expect(await exactEip3009.recover(tx, reader(null))).toEqual(refused("evm/not-found"));
    expect(await exactEip3009.recover(tx, reader(receiptAt(100n, [], 0)))).toEqual(refused("evm/reverted"));
    expect(await exactEip3009.recover(tx, reader(new ReaderError("transport")))).toEqual(refused("evm/unreadable"));
  });

  it("the use of H must come with the transfer the same authorization produces", async () => {
    const another = "0x3333333333333333333333333333333333333333";
    const failed = { state: "failed", why: "transfer-not-found" };
    // Another account's own authorization with nonce H, and its zero-value transfer to itself.
    expect(await exactEip3009.status(ref, reader(receiptAt(100n, [used(H, ASSET, another), transfer(another, another, 0n)])))).toEqual(failed);
    // Another account's use of H beside the payer's transfer of the same value to the payee.
    expect(await exactEip3009.status(ref, reader(receiptAt(100n, [used(H, ASSET, another), payment])))).toEqual(failed);
    // The payer's use of H with a transfer of another value, or with the transfer from another token.
    expect(await exactEip3009.status(ref, reader(receiptAt(100n, [used(H), transfer(PAYER, O.payTo, 9999n)])))).toEqual(failed);
    const elsewhere = { ...payment, address: "0x000000000000000000000000000000000000dEaD" as Hex };
    expect(await exactEip3009.status(ref, reader(receiptAt(100n, [used(H), elsewhere])))).toEqual(failed);
  });
  it("a ref without a well-formed transferLog is pending unreadable", async () => {
    const { transferLog: _, ...bare } = ref;
    const r = reader(receiptAt(100n, matchingThirdOfFour));
    expect(await exactEip3009.status(bare as typeof ref, r)).toEqual({ state: "pending", why: "unreadable" });
    const short = { ...ref, transferLog: { ...transferLog, digest: "0x12" as Hex } };
    expect(await exactEip3009.status(short, r)).toEqual({ state: "pending", why: "unreadable" });
  });

  it("plant: an AuthorizationUsed log with H from another contract is never settled", async () => {
    const impostor = "0x000000000000000000000000000000000000dEaD" as Hex;
    expect(await exactEip3009.status(ref, reader(receiptAt(100n, [used(H, impostor)])))).toEqual({
      state: "failed",
      why: "authorization-not-used",
    });
  });
});
