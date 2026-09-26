// The EIP-3009 typed data's domain against each token's own DOMAIN_SEPARATOR(), read live.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { domainSeparator } from "viem";
import { eip3009TypedData, type Eip155, type Hex } from "../src/evm.js";

type Row = { chain: string; caip2: Eip155; token: "USDC" | "EURC"; asset: Hex; name: string; version: string; separator: Hex; standard: boolean };
const { rows } = JSON.parse(readFileSync(new URL("./fixtures/circle-evm-domains.json", import.meta.url), "utf8")) as { rows: Row[] };
const H = "0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" as const;

function separatorOf(r: Row, override: Partial<Row> = {}): Hex {
  const t = eip3009TypedData({
    network: r.caip2,
    asset: r.asset,
    name: override.name ?? r.name,
    version: override.version ?? r.version,
    from: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    to: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
    value: "10000",
    validAfter: 0n,
    validBefore: 1790000060n,
    nonce: H,
  });
  if ("refused" in t) throw new Error(`${r.chain}: ${t.code}`);
  // viem checks EIP-55 casing; the World Chain USDC address as the fixture writes it is not checksum-cased.
  const domain = { ...t.domain, verifyingContract: t.domain.verifyingContract.toLowerCase() as Hex };
  return domainSeparator({ domain });
}

describe("circle-evm-domains.json", () => {
  it("holds 68 rows: 54 USDC, 14 EURC, 67 standard", () => {
    expect(rows.length).toBe(68);
    expect(rows.filter((r) => r.token === "USDC").length).toBe(54);
    expect(rows.filter((r) => r.token === "EURC").length).toBe(14);
    expect(rows.filter((r) => r.standard).length).toBe(67);
  });
  it.each(rows.map((r) => [`${r.chain} ${r.token}`, r] as const))("C-V1 · %s", (_, r) => {
    expect(separatorOf(r) === r.separator).toBe(r.standard);
  });
  it("plant: the symbol is not the domain name, the version is the token's, and Linea Sepolia stays non-standard", () => {
    const base = rows.find((r) => r.caip2 === "eip155:8453" && r.token === "USDC")!;
    const sepolia = rows.find((r) => r.caip2 === "eip155:84532" && r.token === "USDC")!;
    const linea = rows.find((r) => r.caip2 === "eip155:59141")!;
    expect(separatorOf(base, { name: "USDC" })).not.toBe(base.separator);
    expect(separatorOf(sepolia, { version: "1" })).not.toBe(sepolia.separator);
    expect(linea.standard).toBe(false);
    expect(separatorOf(linea)).not.toBe(linea.separator);
  });
});
