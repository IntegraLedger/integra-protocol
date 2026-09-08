/**
 * Live Solana devnet integration for the SPL-Memo binding. OPT-IN — it runs ONLY when a funded devnet
 * keypair is supplied via `SOLANA_DEVNET_SECRET_KEY` (a JSON array of the 64 secret-key bytes, e.g.
 * `solana-keygen` output); otherwise it is skipped LOUD (never faked). It welds a real atrHash into a
 * memo transaction on devnet and recovers it through the live `Connection` — proving buildAtrMemoInstruction
 * → real tx → makeSolanaReader → recover end-to-end.
 *
 * ⭐⭐ **THE SDK IS THE TEST'S, NOT THE PACKAGE'S — and this file is where that is demonstrated.**
 * `binding-solana` ships with NO chain SDK: `buildAtrMemoInstruction` returns a plain
 * {@link SolanaInstruction} and `makeSolanaReader` takes a two-method port. What a consumer does is
 * exactly what happens below — convert the plain value into whatever their SDK's builder wants, and hand
 * their `Connection` to the port, which it satisfies structurally. `@solana/web3.js` is a devDependency
 * of this package for this test alone and appears in no published tarball. The SPL `transferChecked` payment leg (needs a devnet
 * USDC token account) is operational-pending, off the binding's critical path — the memo IS the LCP weld.
 */
import { hashAtr } from "@integraledger/lcp-kernel";
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  buildAtrMemoInstruction,
  createSolanaAdapter,
  makeSolanaReader,
} from "../src/adapter.js";
import { getSolanaConfig } from "../src/constants.js";
import { SOLANA_MANIFEST } from "../src/manifest.js";
import type { SolanaRpc } from "../src/rpc-shapes.js";

const SECRET = process.env["SOLANA_DEVNET_SECRET_KEY"];
const suite = SECRET ? describe : describe.skip;

suite("binding-solana — live devnet (SOLANA_DEVNET_SECRET_KEY set)", () => {
  it("welds an atrHash into a devnet memo tx and recovers it", async () => {
    const cfg = getSolanaConfig("devnet");
    const connection = new Connection(
      process.env["SOLANA_DEVNET_RPC_URL"] ?? cfg.rpcUrl,
      "confirmed",
    );
    const payer = Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(SECRET ?? "[]") as number[]),
    );
    const atrHash = await hashAtr(
      new TextEncoder().encode("# Terms\nid: 0xsolana-devnet\n"),
    );

    // The port's plain value, converted by the CALLER into its SDK's instruction — the one seam.
    const memo = buildAtrMemoInstruction(atrHash, "hex");
    const tx = new Transaction().add(
      new TransactionInstruction({
        keys: [],
        programId: new PublicKey(memo.programId),
        data: Buffer.from(memo.data),
      }),
    );
    const signature = await sendAndConfirmTransaction(connection, tx, [payer]);

    const adapter = createSolanaAdapter(SOLANA_MANIFEST);
    const recovered = await adapter.recover(
      { signature },
      // ⭐ THE BRIDGE, WRITTEN OUT: the SDK's `getSignaturesForAddress` takes a `PublicKey` where the port
      // takes the base58 string the wire carries. Two lines, and they are the consumer's, not this
      // package's — which is the whole reason no chain SDK ships with it.
      makeSolanaReader({
        getParsedTransaction: (signature, config) =>
          connection.getParsedTransaction(signature, {
            maxSupportedTransactionVersion:
              config?.maxSupportedTransactionVersion ?? 0,
          }) as ReturnType<SolanaRpc["getParsedTransaction"]>,
        getSignaturesForAddress: (address, config) =>
          connection.getSignaturesForAddress(
            new PublicKey(address),
            config?.limit !== undefined ? { limit: config.limit } : {},
          ),
      }),
    );
    expect("refused" in recovered).toBe(false);
    if (!("refused" in recovered)) expect(recovered.value).toBe(atrHash);
  }, 60_000);
});
