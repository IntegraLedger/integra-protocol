// Every `recover` in BINDINGS, given a ref whose transaction id is not in its rail's form, refuses before any read: the
// id cannot name a transaction, so no read can recover H from it, and the call answers as it answers a ref it cannot
// read (docs/reference/refusals.md: "A `recover` given a ref or reader that is not an object refuses with the code it
// gives a reader for another network"). The
// forms: an EVM, Tempo, Cardano, Tron or Stacks id is a 32-byte hash, `0x` and 64 hex digits (Ethereum JSON-RPC
// `eth_getTransactionReceipt`, Cardano's 32-byte BLAKE2b-256 body hash, TRON's SHA-256 transaction id, Stacks' txid);
// a Concordium block item hash and a Casper transaction hash are 32 bytes as 64 hex digits (gRPC v2
// `GetBlockItemStatus`, `info_get_transaction`); a Solana signature is base58 of 64 bytes (Solana's
// `getTransaction`); a Hedera transaction id is the Mirror Node form `shard.realm.num-seconds-nanos`; a Sui digest is
// base58 of 32 bytes, an Algorand id 52 base32 characters and a Polkadot transaction a `<block hash>-<index>`
// timepoint; a NEAR or TON id the package reads as a non-empty string.
import { describe, expect, it } from "vitest";
import { BINDINGS } from "../src/index.js";

type Recover = (ref: unknown, reader: unknown) => Promise<unknown>;

const HASH = `0x${"ab".repeat(32)}`;
const NOT_HASH = [undefined, 5, HASH.slice(2), HASH.slice(0, 64), `${HASH}00`];
const NOT_HEX64 = [undefined, 5, HASH, "ab".repeat(31), "zz".repeat(32)];
const NOT_SIGNATURE = [undefined, 5, "x", "11111111111111111111111111111111", "0".repeat(88)];
const NOT_STRING = [undefined, 5, ""];

// [pairing, the ref without its id, the id's member, the malformed ids, the code]
const ROWS: readonly [id: string, ref: Record<string, unknown>, member: string, ids: readonly unknown[], code: string][] = [
  ["x402/exact/eip155/eip3009", { network: "eip155:8453", asset: `0x${"11".repeat(20)}` }, "transaction", NOT_HASH, "evm/wrong-reader"],
  ["x402/exact/eip155/erc7710-salt", { network: "eip155:8453" }, "transaction", NOT_HASH, "evm/wrong-reader"],
  ["x402/exact/eip155/permit2", { network: "eip155:8453" }, "transaction", NOT_HASH, "evm/wrong-reader"],
  ["x402/upto/eip155/permit2", { network: "eip155:8453" }, "transaction", NOT_HASH, "evm/wrong-reader"],
  ["x402/batch-settlement/eip155", { network: "eip155:8453" }, "transaction", NOT_HASH, "evm/wrong-reader"],
  ["mpp/session/evm", { network: "eip155:8453" }, "transaction", NOT_HASH, "evm/wrong-reader"],
  ["mpp/session/tempo", { network: "eip155:42431" }, "transaction", NOT_HASH, "tempo/wrong-reader"],
  ["mpp/subscription/tempo", { network: "eip155:42431" }, "transaction", NOT_HASH, "tempo/wrong-reader"],
  ["mpp/session/hedera", { network: "hedera:testnet" }, "transaction", NOT_HASH, "hedera/wrong-reader"],
  ["x402/exact/cardano", { network: "cardano:preprod" }, "txId", NOT_HASH, "cardano/wrong-reader"],
  ["x402/exact/tron/lcp-trc20-memo", { network: "tron:728126428" }, "txid", NOT_HASH, "tron/wrong-reader"],
  ["mpp/charge/usdc/stacks", { network: "stacks:1", contract: "SP3Y2ZSH8P7D50B0VBTSX11S7XSG24M1VB9YFQA4K.token-aeusdc" }, "transaction", NOT_HASH, "stacks/wrong-reader"],
  ["x402/exact/ccd", { network: "ccd:4221332d34e1694168c2a0c0b3fd0f27" }, "transaction", NOT_HEX64, "ccd/wrong-reader"],
  ["x402/exact/casper", { network: "casper:casper-test", asset: "ab".repeat(32) }, "transaction", NOT_HEX64, "casper/wrong-reader"],
  ["x402/exact/solana", { network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1" }, "transaction", NOT_SIGNATURE, "svm/wrong-reader"],
  ["x402/upto/solana", { network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1" }, "transaction", NOT_SIGNATURE, "svm/wrong-reader"],
  ["x402/batch-settlement/solana", { network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1" }, "transaction", NOT_SIGNATURE, "svm/wrong-reader"],
  ["mpp/charge/solana", { network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1" }, "transaction", NOT_SIGNATURE, "svm/wrong-reader"],
  ["mpp/charge/usdc/solana", { network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1" }, "transaction", NOT_SIGNATURE, "svm/wrong-reader"],
  ["x402/exact/near", { network: "near:testnet" }, "transaction", NOT_STRING, "near/wrong-reader"],
  ["x402/exact/tvm", { network: "tvm:-3" }, "transaction", NOT_STRING, "tvm/wrong-reader"],
  ["x402/exact/hedera", { network: "hedera:testnet" }, "transactionId", [...NOT_STRING, "0.0.1235@1700000000.000000000"], "hedera/wrong-reader"],
  ["mpp/charge/xrpl", { network: "xrpl:1" }, "transaction", [undefined, 5, HASH], "xrpl/wrong-reader"],
  ["mpp/session/xrpl", { network: "xrpl:1" }, "transaction", [undefined, 5, HASH], "xrpl/wrong-reader"],
  ["x402/exact/sui", { network: "sui:testnet" }, "digest", [undefined, 5, "x"], "sui/wrong-reader"],
  ["x402/exact/algorand", { network: "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=" }, "txid", [undefined, 5, "x"], "avm/wrong-reader"],
  ["x402/exact/polkadot/lcp-assets-remark", { network: "polkadot:68d56f15f85d3136970ec16946040bc1" }, "transaction", [undefined, 5, "x", `${HASH}`], "polkadot/wrong-reader"],
];

/** A reader for `network` that has `relayers` and records every other member read, each a call that rejects. */
function recording(network: string): { reader: object; calls: string[] } {
  const calls: string[] = [];
  const reader = new Proxy(
    { network, relayers: ["relayer.testnet"] },
    {
      get(target, key) {
        if (key in target) return target[key as keyof typeof target];
        if (typeof key !== "string" || key === "then") return undefined;
        return (..._args: unknown[]) => {
          calls.push(key);
          return Promise.reject(new Error("read"));
        };
      },
    },
  );
  return { reader, calls };
}

describe("recover, given a ref whose transaction id is not in its rail's form", () => {
  it("covers every binding with a recover", () => {
    const withRecover = BINDINGS.filter((b) => typeof (b as { recover?: unknown }).recover === "function").map((b) => b.id);
    expect([...withRecover].sort()).toEqual(ROWS.map(([id]) => id).sort());
  });

  for (const [id, ref, member, ids, code] of ROWS) {
    it(`${id}: ${code}, with nothing read`, async () => {
      const recover = (BINDINGS.find((b) => b.id === id) as unknown as { recover: Recover }).recover;
      for (const value of ids) {
        const { reader, calls } = recording(ref["network"] as string);
        expect([value, await recover({ ...ref, [member]: value }, reader)]).toEqual([value, { refused: true, code }]);
        expect([value, calls]).toEqual([value, []]);
      }
    });
  }
});
