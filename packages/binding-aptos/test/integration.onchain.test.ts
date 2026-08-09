/**
 * Live Aptos testnet integration for the lcp_payment overlay-contract binding. OPT-IN — it runs ONLY when a
 * funded testnet Ed25519 key is supplied via `APTOS_TESTNET_SECRET_KEY` (hex, with or without `0x` /
 * `ed25519-priv-` prefix); otherwise it is skipped LOUD (never faked; fund the account at the Aptos testnet
 * faucet). It signs + submits a real `settle_payment<AptosCoin>` transaction binding an atrHash as
 * `payment_id`, then recovers it through the live `Aptos` client + `makeAptosReader` — proving propose →
 * real tx → PaymentSettled event → recover end-to-end.
 *
 * `APTOS_TESTNET_SELLER` (a 0x + 64-hex recipient address) is required alongside the key; the settle_payment
 * Move call transfers a small APT amount to it. Both are read from the env — no hardcoded default (fail-fast).
 */

import {
  Account,
  Aptos,
  AptosConfig,
  Ed25519PrivateKey,
  Network,
} from "@aptos-labs/ts-sdk";
import { hashAtr } from "@integraledger/lcp-kernel";
import { describe, expect, it } from "vitest";
import { createAptosAdapter, makeAptosReader } from "../src/adapter.js";
import { getAptosConfig } from "../src/constants.js";
import { APTOS_MANIFEST } from "../src/manifest.js";

const SECRET = process.env["APTOS_TESTNET_SECRET_KEY"];
const SELLER = process.env["APTOS_TESTNET_SELLER"];
const suite = SECRET && SELLER ? describe : describe.skip;

function loadEd25519Key(secret: string): Ed25519PrivateKey {
  let s = secret.trim();
  if (s.startsWith("ed25519-priv-")) s = s.slice("ed25519-priv-".length);
  if (!s.startsWith("0x")) s = `0x${s}`;
  return new Ed25519PrivateKey(s);
}

suite(
  "binding-aptos — live testnet (APTOS_TESTNET_SECRET_KEY + APTOS_TESTNET_SELLER set)",
  () => {
    it("welds an atrHash into a settle_payment tx and recovers it", async () => {
      const cfg = getAptosConfig("testnet");
      const aptos = new Aptos(
        new AptosConfig({
          network: Network.TESTNET,
          fullnode: cfg.fullnodeUrl,
        }),
      );
      const buyer = Account.fromPrivateKey({
        privateKey: loadEd25519Key(SECRET as string),
      });
      const atrHash = await hashAtr(
        new TextEncoder().encode("# Terms\nid: 0xaptos-testnet\n"),
      );

      const adapter = createAptosAdapter(APTOS_MANIFEST, "testnet");
      const call = adapter.propose({
        atrHash,
        recipient: SELLER as string,
        amount: 1n,
      });

      const tx = await aptos.transaction.build.simple({
        sender: buyer.accountAddress,
        data: {
          function: call.function,
          typeArguments: call.typeArguments,
          functionArguments: call.functionArguments,
        },
      });
      const committed = await aptos.signAndSubmitTransaction({
        signer: buyer,
        transaction: tx,
      });
      await aptos.waitForTransaction({ transactionHash: committed.hash });

      const recovered = await adapter.recover(
        { hash: committed.hash },
        makeAptosReader(aptos),
      );
      expect("refused" in recovered).toBe(false);
      if (!("refused" in recovered)) expect(recovered.value).toBe(atrHash);
    }, 60_000);
  },
);
