// The rail profiles that state a check their pairing's code makes are shipped verbatim. Each expected clause below is
// copied from the published profile:
// - `mpp/charge/usdc/stacks` clause 3: the transaction's chain id and version, which `bound` and `build`'s `complete`
//   hold to the challenge's network (`onNetwork`, src/mpp-usdc.ts).
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
];

describe("the rail profiles' rules, verbatim", () => {
  it.each(CLAUSES)("%s: clause %i is the published text", (file, n, text) => {
    expect(clause(read(file), n)).toEqual([text]);
  });
});
