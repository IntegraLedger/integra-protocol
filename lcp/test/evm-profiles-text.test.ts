// The EVM x402 profiles: each opens with its title and the two rules every profile that carries H in a signed field
// shares with the EIP-3009 profile, and the agreement's value each states is the one its vector file holds.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rowsOf } from "./rows.js";

const read = (name: string) => readFileSync(new URL(`../profiles/${name}`, import.meta.url), "utf8");
const load = (name: string) => JSON.parse(readFileSync(new URL(`../vectors/${name}`, import.meta.url), "utf8"));
const lines = (text: string) => text.split("\n").filter((l) => l.trim() !== "");

const SHARED = [
  '1. The resource server\'s `PaymentRequired` carries `extensions.legalContext.info` = `{"type":"sha256","value":H,"legalContextUrl":L}`. H is the SHA-256 of the ATR\'s exact bytes, as `0x` lowercase hex, and L is an `https` URL that serves those bytes.',
  "2. The client fetches L, computes SHA-256 over the bytes received, and compares the result with H as 32 decoded bytes. On a mismatch it does not sign.",
];

describe("the EVM x402 profiles", () => {
  it.each(
    rowsOf(
      [
        ["x402-exact-eip155-eip3009.md", "x402/exact/eip155/eip3009"],
        ["x402-exact-eip155-permit2.md", "x402/exact/eip155/permit2"],
        ["x402-upto-eip155-permit2.md", "x402/upto/eip155/permit2"],
        ["x402-exact-eip155-erc7710-salt.md", "x402/exact/eip155/erc7710-salt"],
        ["x402-auth-capture-eip155.md", "x402/auth-capture/eip155"],
        ["x402-batch-settlement-eip155.md", "x402/batch-settlement/eip155"],
      ] as const,
      "the EVM x402 profiles that carry H in a signed field",
      { exact: 6 },
    ),
  )("%s: its title, then the two shared rules first", (file, id) => {
    const all = lines(read(file));
    expect(all[0]!.startsWith(`**LCP profile \`${id}\`: `)).toBe(true);
    const numbered = all.filter((l) => /^\d+\. /.test(l));
    expect(numbered.slice(0, 2)).toEqual(SHARED);
  });

  it.each([
    ["x402-exact-eip155-erc7710.md", "x402/exact/eip155/erc7710"],
    ["x402-batch-settlement-cloudflare.md", "x402/batch-settlement/cloudflare"],
  ] as const)("%s: its title, and coverage none", (file, id) => {
    const text = read(file);
    expect(lines(text)[0]!.startsWith(`**LCP profile \`${id}\`: `)).toBe(true);
    expect(text).toContain("coverage `none`");
  });

  it("the eip3009 and Permit2 profiles state the agreement's value their vector files hold", () => {
    const e = load("x402-exact-eip155-eip3009.json").AG;
    const p = load("x402-exact-eip155-permit2.json").AG;
    for (const [file, ag] of [
      ["x402-exact-eip155-eip3009.md", e],
      ["x402-exact-eip155-permit2.md", p],
    ] as const) {
      const text = read(file);
      expect(text).toContain(`\`${ag.expectValue}\``);
      expect(text).toContain(`\`${ag.tagHex}\``);
    }
    expect(read("x402-exact-eip155-permit2.md")).toContain(`\`${p.expectNonceDecimal}\``);
  });
});
