// The rail profiles that state a check their pairing's code makes are shipped verbatim. Each expected clause below is
// copied from the published profile:
// - `mpp/charge/usdc/stacks` clause 3: the transaction's chain id and version, which `bound` and `build`'s `complete`
//   hold to the challenge's network (`onNetwork`, src/mpp-usdc.ts);
// - clause 1 of the two transfer methods this package defines, `x402/exact/polkadot/lcp-assets-remark` and
//   `x402/exact/tron/lcp-trc20-memo`: the option's `amount` and `maxTimeoutSeconds`, as each pairing's option filter
//   holds them (`isAmount` and `isTimeoutSeconds`, src/internal/x402.ts, with the pairing's own upper bound).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (name: string) => readFileSync(new URL(`../profiles/${name}`, import.meta.url), "utf8");
const clause = (text: string, n: number) => text.split("\n").filter((l) => l.startsWith(`${n}. `));

const CLAUSES: readonly [file: string, n: number, text: string][] = [
  [
    "mpp-charge-usdc-stacks.md",
    3,
    "3. The transaction is a contract call to the profile's token contract named `transfer`, with post-condition mode Deny and anchor mode OnChainOnly, signed by the payer's Stacks wallet. Its chain id is the profile's `chainId`, and its version is that network's, as stacks-core's `validation.rs` requires: 0x00 on chain id 1 (CAIP-2's `stacks:1`, mainnet) and 0x80 on any other.",
  ],
  [
    "x402-exact-polkadot-lcp-assets-remark.md",
    1,
    "1. The option gives `amount` in the asset's atomic units as the canonical decimal of a positive integer (digits only, the first not `0`), `asset` as the `pallet-assets` asset id in decimal, `payTo` in SS58, and `maxTimeoutSeconds` as an integer from 1 to 3,600. `PaymentRequired` carries `extensions.legalContext.info` = `{\"type\":\"sha256\",\"value\":H,\"legalContextUrl\":L}`, where H is the SHA-256 of the ATR's exact bytes as `0x` lowercase hex and L is an `https` URL that serves them.",
  ],
  [
    "x402-exact-tron-lcp-trc20-memo.md",
    1,
    "1. The resource server's option gives `amount` in the token's atomic units as the canonical decimal of a positive integer (digits only, the first not `0`), `asset` (the TRC-20 contract) and `payTo` in base58check, and `maxTimeoutSeconds` as an integer from 1 to 86,340. `PaymentRequired` carries `extensions.legalContext.info` = `{\"type\":\"sha256\",\"value\":H,\"legalContextUrl\":L}`, where H is the SHA-256 of the ATR's exact bytes as `0x` lowercase hex and L is an `https` URL that serves them.",
  ],
];

describe("the rail profiles' rules, verbatim", () => {
  it.each(CLAUSES)("%s: clause %i is the published text", (file, n, text) => {
    expect(clause(read(file), n)).toEqual([text]);
  });
});
