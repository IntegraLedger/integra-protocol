// The x402 payment handler's examples (profiles/ucp-payment-handler-x402.md) are reproducible from what the document
// states: bodyDigest is SHA-256 of the terms statement, each H is SHA-256 of the ATR bytes the document gives, the
// package assembles those bytes from the stated id, binding slot and terms slot, and the instrument's signature
// recovers to its `from` in the stated domain. The values were computed with Python's hashlib and eth-account 0.14.0;
// this test recomputes them with node:crypto and viem.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { recoverTypedDataAddress, type Hex as ViemHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { assemble, isRefusal } from "../src/index.js";
import { tie as ucpTie } from "../src/ucp.js";
import { tie as x402Tie, type PaymentRequirements, type RequestCommitment } from "../src/x402.js";

const text = readFileSync(new URL("../profiles/ucp-payment-handler-x402.md", import.meta.url), "utf8");
const fences = (info: string) => [...text.matchAll(new RegExp(`^\`\`\`${info}\\n(.*?)\\n\`\`\``, "gms"))].map((m) => m[1]!);
const preimages = fences("text").filter((s) => s.startsWith("{"));
const examples = fences("json").map((s) => JSON.parse(s) as Record<string, unknown>);
const sha256 = (s: string) => `0x${createHash("sha256").update(s, "utf8").digest("hex")}`;
const HANDLER = "com.integraledger.lcp.x402";

type Slot = { x402: { accepts: PaymentRequirements[]; request: RequestCommitment } };
type Config = { accepts: PaymentRequirements[]; extensions: { legalContext: { info: { value: string; legalContextUrl: string } } } };
type Link = { type: string; url: string; title?: string };
type Credential = {
  paymentPayload: {
    accepted: PaymentRequirements;
    payload: { signature: ViemHex; authorization: Record<string, string> };
    extensions: unknown;
  };
  paymentRequirements: PaymentRequirements;
};

describe("ucp/payment-handler/x402: every example value follows from its stated preimage", () => {
  it("states the terms statement and both ATRs' bytes", () => {
    expect(preimages).toHaveLength(3);
  });
  const [terms = "", atrX402 = "", atrUcp = ""] = preimages;
  const slot = examples.find((e) => "x402" in e) as Slot | undefined;
  const config = (examples.find((e) => HANDLER in e && "accepts" in ((e[HANDLER] as { config: object }[])[0]!.config)) as
    | Record<string, { config: Config }[]>
    | undefined)?.[HANDLER]![0]!.config;
  const linkLists = examples.filter((e) => "links" in e).map((e) => e["links"] as Link[]);
  const credential = (examples.find((e) => "payment" in e) as { payment: { instruments: { credential: Credential }[] } } | undefined)
    ?.payment.instruments[0]!.credential;

  it("bodyDigest is SHA-256 of the statement, and the ATR carries the statement as its terms slot", () => {
    expect(slot?.x402.request.bodyDigest).toBe(sha256(terms));
    expect(atrX402.endsWith(`,"terms":${terms}}`)).toBe(true);
    expect(atrUcp.endsWith(`,"terms":${terms}}`)).toBe(true);
  });

  it("the package assembles the stated bytes from the stated id, binding slot and terms slot", async () => {
    const utf8 = new TextEncoder();
    const parties: [string, Uint8Array][] = [["terms", utf8.encode(terms)]];
    const one = JSON.parse(atrX402) as { id: string };
    const two = JSON.parse(atrUcp) as { id: string };
    const x402 = await assemble(one.id, x402Tie(slot!.x402.accepts, slot!.x402.request), parties);
    const ucp = await assemble(two.id, ucpTie([{ checkout: "chk_123" }]), parties);
    if (isRefusal(x402) || isRefusal(ucp)) throw new Error("assemble refused");
    expect(new TextDecoder().decode(x402.bytes)).toBe(atrX402);
    expect(new TextDecoder().decode(ucp.bytes)).toBe(atrUcp);
  });

  it("H is SHA-256 of the ATR's bytes wherever the examples carry it, and no link is built from it", () => {
    const h = sha256(atrX402);
    const h2 = sha256(atrUcp);
    expect(text).toContain(`H is their SHA-256,\n\`${h}\``);
    expect(text).toContain(`H is their SHA-256, \`${h2}\``);
    expect(config?.extensions.legalContext.info.value).toBe(h);
    expect(config?.accepts).toEqual(slot?.x402.accepts);
    expect(linkLists[0]?.[0]).toEqual({ type: "legal_context", url: config?.extensions.legalContext.info.legalContextUrl, title: `lcp:sha256:${h}` });
    expect(linkLists[1]?.[0]?.title).toBe(`lcp:sha256:${h2}`);
    expect(credential?.paymentPayload.payload.authorization["nonce"]).toBe(h);
    expect(credential?.paymentPayload.extensions).toEqual(config?.extensions);
    for (const link of [config!.extensions.legalContext.info.legalContextUrl, linkLists[0]![0]!.url, linkLists[1]![0]!.url]) {
      expect(link).not.toContain(h.slice(2));
      expect(link).not.toContain(h2.slice(2));
    }
  });

  it("the instrument's signature recovers to from, the stated test key's address, in the stated domain", async () => {
    const key = /published test key,\n`(0x[0-9a-f]{64})`/.exec(text)?.[1] as ViemHex | undefined;
    const domain = JSON.parse(/domain\n`(\{.*?\})`/s.exec(text)?.[1] ?? "null") as Record<string, unknown> | null;
    const { accepted, payload } = credential!.paymentPayload;
    const a = payload.authorization;
    expect(accepted).toEqual(credential!.paymentRequirements);
    expect(domain).toEqual({ name: "USDC", version: "2", chainId: 84532, verifyingContract: accepted.asset });
    expect(privateKeyToAccount(key!).address).toBe(a["from"]);
    const signer = await recoverTypedDataAddress({
      domain: { ...domain!, chainId: 84532 },
      types: {
        TransferWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      primaryType: "TransferWithAuthorization",
      message: {
        from: a["from"] as ViemHex,
        to: a["to"] as ViemHex,
        value: BigInt(a["value"]!),
        validAfter: BigInt(a["validAfter"]!),
        validBefore: BigInt(a["validBefore"]!),
        nonce: a["nonce"] as ViemHex,
      },
      signature: payload.signature,
    });
    expect(signer).toBe(a["from"]);
  });
});
