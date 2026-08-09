/**
 * Live EVM integration for the MPP-EVM Id-Reuse binding — the CONFIRMATION half against a real settlement.
 * OPT-IN: it runs ONLY when `MPP_EVM_SETTLEMENT_TX` names a settled transaction whose EIP-3009 nonce was
 * derived per `draft-evm-charge-00` §5.3.1 from a known `(challenge.id = atrHash, challenge.realm)` pair;
 * otherwise it is skipped LOUD (never faked). Required alongside it: `MPP_EVM_ATR_HASH`, `MPP_EVM_REALM`,
 * `MPP_EVM_ASSET` (the token that emitted `AuthorizationUsed`) and `MPP_EVM_CHAIN_ID`; `BASE_SEPOLIA_RPC_URL`
 * selects the endpoint, as elsewhere in this workspace.
 *
 * **Why confirmation-only, and why this discharges the exit criterion it can.** The `recovery` triple must be
 * declared from observed behaviour, and two of its three members are observable without a chain at all:
 * `zeroPartyRecoverable: false` because no code path maps a settlement to an atrHash (`recover` refuses and
 * takes no arguments), and `forwardIndexable: false` because no `enumerate` exists and keccak's other
 * preimage input is the realm. The member that genuinely needs a live settlement is `onChain: true` — that a
 * real `AuthorizationUsed` carries the derived nonce — and that is exactly what this test reads.
 *
 * Submitting a fresh settlement is deliberately NOT here: it would put buyer signing, funding and USDC
 * approval machinery into a package whose job is the weld, and MPP's own client owns that path. Point this at
 * any settlement produced by an MPP-EVM charge (or by any EIP-3009 transfer whose nonce was derived by
 * §5.3.1) and every claim in the manifest is exercised on live data.
 */

import { makeChainReader } from "@integraledger/lcp-binding-evm-common";
import { createPublicClient, http } from "viem";
import { describe, expect, it } from "vitest";
import { createMppEvmAdapter } from "../src/adapter.js";

const TX = process.env["MPP_EVM_SETTLEMENT_TX"];
const ATR = process.env["MPP_EVM_ATR_HASH"];
const REALM = process.env["MPP_EVM_REALM"];
const ASSET = process.env["MPP_EVM_ASSET"];
const CHAIN_ID = process.env["MPP_EVM_CHAIN_ID"];
const suite =
  TX && ATR && REALM && ASSET && CHAIN_ID ? describe : describe.skip;

suite("binding-evm-mpp — live settlement (MPP_EVM_SETTLEMENT_TX set)", () => {
  it("confirms the known atrHash against the settlement's on-chain nonce, and still refuses recovery", async () => {
    const adapter = createMppEvmAdapter({
      chainId: Number(CHAIN_ID),
      asset: ASSET as `0x${string}`,
      realm: String(REALM),
    });
    const client = createPublicClient({
      transport: http(process.env["BASE_SEPOLIA_RPC_URL"]),
    });
    const ref = {
      chainId: Number(CHAIN_ID),
      txHash: TX as `0x${string}`,
    };
    const ports = {
      chain: makeChainReader(client),
      artifacts: { resolve: async () => null },
    };

    const confirmed = await adapter.verifyCandidate(String(ATR), ref, ports);
    expect("refused" in confirmed).toBe(false);
    if (!("refused" in confirmed)) {
      expect(confirmed.value.confirmed).toBe(true);
      expect(confirmed.value.realm).toBe(REALM);
    }

    // The same live settlement, asked for recovery: still a refusal. `onChain: true` and
    // `zeroPartyRecoverable: false` hold together, which is the whole shape of an Id-Reuse binding.
    expect(await adapter.recover()).toMatchObject({
      code: "mpp-evm/not-recoverable-by-construction",
    });

    const observed = await adapter.observe(ref, ports);
    expect("refused" in observed).toBe(false);
    if (!("refused" in observed))
      for (const t of observed.value) expect(t.state).toBe("settled");
  }, 60_000);
});
