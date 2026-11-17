// Drives the stock x402 TON server and client of @x402/tvm 2.30.0 offline and deterministically. The server fills an
// option's TON members; the client writes a payment from an option, after three reads of its TON Center v3 provider,
// which `fetch` answers here as the caller's `ton` states: the payer's Jetton wallet of the asset (`get_wallet_address`),
// the payer's W5R1 wallet, active at a sequence number, and the emulated trace of the transfer, whose fees the client
// adds to the inner TON it attaches. The answers are constructed, not recorded; no request leaves the process. The clock
// is the caller's.
import { vi } from "vitest";
import { Address, beginCell, Cell } from "@ton/core";
import { keyPairFromSeed } from "@ton/crypto";
import { toClientTvmSigner } from "@x402/tvm";
import { ExactTvmScheme as StockClient } from "@x402/tvm/exact/client";
import { ExactTvmScheme as StockServer } from "@x402/tvm/exact/server";

/** What the provider answers: the Jetton wallet, the wallet's sequence number and balance, and the trace's fees. */
export interface StockTon {
  jettonWallet: string;
  seqno: number;
  balance: string;
  /** The payee's Jetton wallet, which the trace's second transaction runs on. */
  receiverWallet: string;
  /** Nanotons, as decimal strings: the source Jetton wallet's forward and compute fees, the receiver's compute fee. */
  fees: { sourceFwd: string; sourceCompute: string; receiverCompute: string };
}

/** What the stock client returned, and the provider requests it made, each `METHOD path`. */
export interface Stock {
  out: { x402Version: number; payload: unknown };
  asked: string[];
}

const keyPairOf = (seedHex: string) => keyPairFromSeed(Buffer.from(seedHex, "hex"));

/** The W5 data cell (wallet_v5.fc `load_data`): signature allowed, the sequence number, the wallet id, the key, no extensions. */
function w5Data(seqno: number, walletId: number, publicKey: Buffer): Cell {
  return beginCell().storeBit(1).storeUint(seqno, 32).storeUint(walletId, 32).storeBuffer(publicKey, 32).storeBit(0).endCell();
}

/** The trace answer: the source Jetton wallet's transaction from the payer, and the receiver's from the source. */
function traceOf(payer: string, ton: StockTon): Record<string, unknown> {
  const ok = (gas: string) => ({ aborted: false, compute_ph: { skipped: false, success: true, gas_fees: gas }, action: { success: true } });
  return {
    transactions: {
      source: {
        account: ton.jettonWallet,
        description: ok(ton.fees.sourceCompute),
        in_msg: { source: payer, decoded_opcode: "jetton_transfer" },
        out_msgs: [{ fwd_fee: ton.fees.sourceFwd }],
      },
      receiver: {
        account: ton.receiverWallet,
        description: ok(ton.fees.receiverCompute),
        in_msg: { source: ton.jettonWallet, decoded_opcode: "jetton_internal_transfer" },
        out_msgs: [],
      },
    },
  };
}

/** The stock server's option for `base`: `enhancePaymentRequirements`, as a stock resource server fills it. */
export function stockOption(base: object, network: string): Promise<unknown> {
  return new StockServer().enhancePaymentRequirements(structuredClone(base) as never, { x402Version: 2, scheme: "exact", network: network as never }, []);
}

/** The stock exact client's payload for `option`, signed by the W5R1 wallet of the key of `seedHex` (subwallet 0). */
export async function stockExact(seedHex: string, option: { network: string }, now: number, ton: StockTon): Promise<Stock> {
  const signer = toClientTvmSigner(keyPairOf(seedHex), { network: option.network });
  const payer = Address.parse(signer.address).toRawString();
  const data = w5Data(ton.seqno, signer.walletId, Buffer.from(signer.publicKey, "hex"));
  const asked: string[] = [];
  vi.stubGlobal("fetch", async (url: URL | string, init: { method: string; body?: string }) => {
    const u = new URL(String(url));
    asked.push(`${init.method} ${u.pathname}`);
    const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
    if (u.pathname === "/api/v3/runGetMethod") {
      const req = JSON.parse(init.body!) as { method: string };
      if (req.method !== "get_wallet_address") throw new Error(`unexpected get-method ${req.method}`);
      const slice = beginCell().storeAddress(Address.parse(ton.jettonWallet)).endCell().toBoc().toString("base64");
      return json({ exit_code: 0, stack: [{ type: "cell", value: slice }] });
    }
    if (u.pathname === "/api/v3/accountStates") {
      return json({
        accounts: [
          {
            address: payer,
            balance: ton.balance,
            status: "active",
            code_boc: signer.stateInit.code!.toBoc().toString("base64"),
            data_boc: data.toBoc().toString("base64"),
          },
        ],
      });
    }
    if (u.pathname === "/api/emulate/v1/emulateTrace") return json(traceOf(payer, ton));
    throw new Error(`unexpected request ${init.method} ${u.pathname}`);
  });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now * 1000);
  const client = new StockClient(signer);
  try {
    return { out: await client.createPaymentPayload(2, option as never), asked };
  } finally {
    client.close();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
}
