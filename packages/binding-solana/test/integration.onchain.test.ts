/**
 * Live Solana devnet integration for the SPL-Memo binding. OPT-IN — it runs ONLY when a funded devnet
 * keypair is supplied via `SOLANA_DEVNET_SECRET_KEY` (a JSON array of the 64 secret-key bytes, e.g.
 * `solana-keygen` output); otherwise it is skipped LOUD (never faked). It welds a real atrHash into a memo
 * transaction on devnet and recovers it through a live RPC — proving buildAtrMemoInstruction → real tx →
 * makeSolanaReader → recover end-to-end. The SPL `transferChecked` payment leg (needs a devnet USDC token
 * account) is operational-pending, off the binding's critical path — the memo IS the LCP weld.
 *
 * ⭐⭐ **THE SDK IS THIS TEST'S, NOT THE PACKAGE'S — and this file is where that is demonstrated.**
 * `binding-solana` ships with NO chain SDK: `buildAtrMemoInstruction` returns a plain
 * {@link SolanaInstruction} and `makeSolanaReader` takes a two-method port over the wire shapes. What a
 * consumer does is exactly what happens below — hand the plain instruction to whatever their SDK builds
 * transactions with, and wire their RPC to the port. `@solana/kit` is a devDependency of this package for
 * this test alone and appears in no published tarball.
 *
 * ⛔ **IT IS `@solana/kit`, NOT `@solana/web3.js`, AND THAT IS NOT A PREFERENCE.** web3.js depends on
 * `jayson`, which depends on `stream-json`, which carried GHSA-528h-pc64-c93x — a moderate DoS that turned
 * `pnpm audit` red and, because `release.yml` runs on a successful `ci`, held the release train. No
 * override could clear it: both patched releases of `stream-json` moved their modules under `src/` and
 * renamed them to kebab-case, so `stream-json/streamers/StreamValues` — the subpath `jayson` requires —
 * resolves at NO fixed version. `@solana/kit` is the maintained successor and depends on none of it.
 */
import { hashAtr } from "@integraledger/lcp-kernel";
import {
  address,
  appendTransactionMessageInstruction,
  assertIsTransactionWithBlockhashLifetime,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  getSignatureFromTransaction,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  signature as toSignature,
} from "@solana/kit";
import { describe, expect, it } from "vitest";
import {
  buildAtrMemoInstruction,
  createSolanaAdapter,
  makeSolanaReader,
} from "../src/adapter.js";
import { getSolanaConfig } from "../src/constants.js";
import { SOLANA_MANIFEST } from "../src/manifest.js";
import type { ParsedTransactionShape, SolanaRpc } from "../src/rpc-shapes.js";

const SECRET = process.env["SOLANA_DEVNET_SECRET_KEY"];
const suite = SECRET ? describe : describe.skip;

suite("binding-solana — live devnet (SOLANA_DEVNET_SECRET_KEY set)", () => {
  it("welds an atrHash into a devnet memo tx and recovers it", async () => {
    const cfg = getSolanaConfig("devnet");
    const httpUrl = process.env["SOLANA_DEVNET_RPC_URL"] ?? cfg.rpcUrl;
    const rpc = createSolanaRpc(httpUrl);
    const rpcSubscriptions = createSolanaRpcSubscriptions(
      httpUrl.replace(/^http/, "ws"),
    );
    const payer = await createKeyPairSignerFromBytes(
      Uint8Array.from(JSON.parse(SECRET ?? "[]") as number[]),
    );
    const atrHash = await hashAtr(
      new TextEncoder().encode("# Terms\nid: 0xsolana-devnet\n"),
    );

    // ⭐ THE PORT'S PLAIN VALUE, converted by the CALLER into its SDK's instruction. This is the one seam,
    // and it is two lines — which is the argument for the package not owning an SDK at all.
    const memo = buildAtrMemoInstruction(atrHash, "hex");
    const { value: blockhash } = await rpc.getLatestBlockhash().send();
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(payer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
      (m) =>
        appendTransactionMessageInstruction(
          {
            programAddress: address(memo.programId),
            accounts: [],
            data: memo.data,
          },
          m,
        ),
    );
    const signed = await signTransactionMessageWithSigners(message);
    // ⭐ The assertion is the SDK's own, not a cast: the confirmer needs a blockhash lifetime and refuses
    // to guess. We set one above; this is where that becomes a fact the type system holds.
    assertIsTransactionWithBlockhashLifetime(signed);
    await sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions })(signed, {
      commitment: "confirmed",
    });
    const signature = getSignatureFromTransaction(signed);

    const adapter = createSolanaAdapter(SOLANA_MANIFEST);
    // ⭐ AND THE READ SEAM: the port takes the base58 address the wire carries, so an RPC whose own method
    // wants its own address type is the caller's to bridge. Here it wants a string too, so it is direct.
    const reader: SolanaRpc = {
      // ⛔ `0` as a LITERAL, not the port's `number`. Kit types `maxSupportedTransactionVersion` as a
      // `TransactionVersion`, so a widened `number` silently selects the `json` overload and the
      // `jsonParsed` encoding this binding reads stops type-checking. 0 is what this rail always asks for.
      getParsedTransaction: async (sig) =>
        (await rpc
          .getTransaction(toSignature(sig), {
            encoding: "jsonParsed",
            maxSupportedTransactionVersion: 0,
          })
          .send()) as ParsedTransactionShape | null,
      getSignaturesForAddress: async (addr, config) =>
        await rpc
          .getSignaturesForAddress(
            address(addr),
            config?.limit !== undefined ? { limit: config.limit } : {},
          )
          .send(),
    };
    const recovered = await adapter.recover(
      { signature },
      makeSolanaReader(reader),
    );
    expect("refused" in recovered).toBe(false);
    if (!("refused" in recovered)) expect(recovered.value).toBe(atrHash);
  }, 60_000);
});
