// Drives the stock x402 Solana clients of @x402/svm 2.31.0 (exact, upto and batch-settlement) offline and
// deterministically: the one RPC read they make, the asset's mint, is answered with a Token mint of 6 decimals; the
// clock is the caller's; and the random bytes upto's channel salt is drawn from are the caller's.
import { vi } from "vitest";
import { createKeyPairSignerFromPrivateKeyBytes } from "@solana/kit";
import { BatchSvmScheme } from "@x402/svm/batch-settlement/client";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import { UptoSvmScheme } from "@x402/svm/upto/client";

export const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
/** The RPC URL the clients are given; no request reaches it, since `fetch` is replaced while a client runs. */
const RPC_URL = "http://rpc.invalid";

/**
 * The SPL Token mint account the mint read answers: 82 bytes, no mint or freeze authority, supply 0, decimals 6,
 * initialized (spl-token `state.rs` `Mint::LEN` and `pack_into_slice`: authority option u32 and key, supply u64,
 * decimals u8, is_initialized u8, freeze authority option u32 and key).
 */
export function mintAccount(): Uint8Array {
  const mint = new Uint8Array(82);
  mint[44] = 6;
  mint[45] = 1;
  return mint;
}

/** Runs `f` with `fetch` answering `getAccountInfo` with the mint above, and nothing else; the methods asked. */
async function offline<T>(f: () => Promise<T>, opts: { now: number; random?: Uint8Array }): Promise<{ out: T; asked: string[] }> {
  const asked: string[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
    const req = JSON.parse(init.body) as { id: unknown; method: string };
    asked.push(req.method);
    if (req.method !== "getAccountInfo") throw new Error(`unexpected RPC ${req.method}`);
    const value = {
      data: [Buffer.from(mintAccount()).toString("base64"), "base64"],
      executable: false,
      lamports: 1461600,
      owner: TOKEN,
      rentEpoch: 0,
      space: 82,
    };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: req.id, result: { context: { slot: 1 }, value } }), {
      headers: { "content-type": "application/json" },
    });
  });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(opts.now * 1000);
  const random = opts.random;
  const spy =
    random === undefined
      ? undefined
      : vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(<A extends ArrayBufferView | null>(a: A): A => {
          const view = new Uint8Array(a!.buffer, a!.byteOffset, a!.byteLength);
          view.set(random.subarray(0, view.length));
          return a;
        });
  try {
    return { out: await f(), asked };
  } finally {
    spy?.mockRestore();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
}

/** What a stock client returned, and the RPC methods it asked. */
export interface Stock {
  out: { x402Version: number; payload: unknown };
  asked: string[];
}

const signerOf = (seedHex: string) => createKeyPairSignerFromPrivateKeyBytes(Uint8Array.from(Buffer.from(seedHex, "hex")));

/** The stock exact client's payload for `option`, signed by the key of `seedHex`. */
export async function stockExact(seedHex: string, option: object, now: number): Promise<Stock> {
  const signer = await signerOf(seedHex);
  return offline(() => new ExactSvmScheme(signer, { rpcUrl: RPC_URL }).createPaymentPayload(2, option as never), { now });
}

/** The stock upto client's payload for `option`, its channel salt drawn from `random`. */
export async function stockUpto(seedHex: string, option: object, now: number, random: Uint8Array): Promise<Stock> {
  const signer = await signerOf(seedHex);
  return offline(() => new UptoSvmScheme(signer, { rpcUrl: RPC_URL }).createPaymentPayload(2, option as never), {
    now,
    random,
  });
}

/** The stock batch-settlement client's first payload for `option`: the deposit that opens the channel. */
export async function stockBatch(seedHex: string, option: object, now: number, salt: string, deposit: string): Promise<Stock> {
  const signer = await signerOf(seedHex);
  const client = new BatchSvmScheme(signer, { rpcUrl: RPC_URL, salt, depositAmount: deposit, discoverChannels: false });
  return offline(() => client.createPaymentPayload(2, option as never), { now });
}
