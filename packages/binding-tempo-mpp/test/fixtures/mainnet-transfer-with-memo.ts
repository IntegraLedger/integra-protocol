/**
 * A REAL Tempo mainnet settlement, transcribed verbatim from the public RPC (`https://rpc.tempo.xyz`,
 * chainId 4217) on 2026-07-30 — not synthesized. Everything the codec, the log parser and the adapter are
 * tested against comes from here, so the unit suite is checked against bytes the chain actually produced.
 *
 *   eth_getTransactionByHash / eth_getTransactionReceipt
 *     0x45dfbd262d0d43e3ad72f35ce6e6ac7861c112a1aeee48c2e8fa0be9031f9aef   (block 32395772 = 0x1ee51fc)
 *
 * Three facts this fixture exists to hold in place, none of which is in LCP §C.1 or the completion plan:
 *
 * 1. **One memo transfer emits TWO logs** — the standard ERC-20 `Transfer` (logIndex 0x2) AND
 *    `TransferWithMemo` (logIndex 0x3), plus a third `Transfer` for the sponsored fee (logIndex 0x4).
 *    A reader that matches `Transfer` finds no memo; the memo lives only on the second log.
 * 2. **The transaction has no top-level `to`/`input`.** Tempo's type `0x76` transaction carries the
 *    transfer inside a `calls[]` array, under the payer's own `signature`, with the sponsor's
 *    `feePayerSignature` beside it. That is the observation behind the manifest's signature-grade weld.
 * 3. **The memo slot is occupied by MPP's own attribution memo, not by an LCP reference.** Its first five
 *    bytes are `ef1ed712 01` = keccak256("mpp")[0..3] ‖ version 1. In the sampled mainnet ranges this was
 *    true of EVERY `TransferWithMemo` observed (45/45 and 73/73 in two 300–400 block windows). The carrier
 *    LCP wants is genuinely contested, and `recover` must refuse rather than return attribution bytes.
 */

import type { TempoLogView } from "../../src/log.js";

/** The settlement transaction hash. */
export const MAINNET_TX_HASH: string =
  "0x45dfbd262d0d43e3ad72f35ce6e6ac7861c112a1aeee48c2e8fa0be9031f9aef";

/** The block the settlement landed in (hex quantity, as the RPC returns it). */
export const MAINNET_BLOCK_NUMBER: string = "0x1ee51fc";

/** The TIP-20 token that emitted the events (note the `0x20c0…` TIP-20 address prefix). */
export const MAINNET_TOKEN: string =
  "0x20c000000000000000000000b9537d11c60e8b50";

/** The payer (the transaction's recovered `from`) and the recipient of the transfer. */
export const MAINNET_PAYER: string =
  "0x2d739f03b0a6b2cae1d2028792bb1cc07f3aa543";
export const MAINNET_RECIPIENT: string =
  "0x10c140022927429afb5f7779f4bc5495da8c1e24";

/** The transferred amount in the token's base units (`0x9230`). */
export const MAINNET_AMOUNT: bigint = 37424n;

/** The 32-byte memo carried by the settlement — an MPP attribution memo, NOT an atrHash. */
export const MAINNET_MEMO: string =
  "0xef1ed7120127a6b6ab68afb53d38020000000000000000000066689448d5d103";

/** `calls[0].input` — the real `transferWithMemo(to, amount, memo)` calldata, byte for byte. */
export const MAINNET_CALLDATA: string =
  "0x95777d5900000000000000000000000010c140022927429afb5f7779f4bc5495da8c1e240000000000000000000000000000000000000000000000000000000000009230ef1ed7120127a6b6ab68afb53d38020000000000000000000066689448d5d103";

/** The settlement's `TransferWithMemo` log, exactly as `eth_getTransactionReceipt` returned it. */
export const MAINNET_MEMO_LOG: TempoLogView = {
  address: MAINNET_TOKEN,
  topics: [
    "0x57bc7354aa85aed339e000bccffabbc529466af35f0772c8f8ee1145927de7f0",
    "0x0000000000000000000000002d739f03b0a6b2cae1d2028792bb1cc07f3aa543",
    "0x00000000000000000000000010c140022927429afb5f7779f4bc5495da8c1e24",
    MAINNET_MEMO,
  ],
  data: "0x0000000000000000000000000000000000000000000000000000000000009230",
  blockNumber: MAINNET_BLOCK_NUMBER,
  transactionHash: MAINNET_TX_HASH,
  logIndex: "0x3",
};

/** The plain ERC-20 `Transfer` log of the SAME transfer (logIndex 0x2) — carries no memo. */
export const MAINNET_PLAIN_TRANSFER_LOG: TempoLogView = {
  address: MAINNET_TOKEN,
  topics: [
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
    "0x0000000000000000000000002d739f03b0a6b2cae1d2028792bb1cc07f3aa543",
    "0x00000000000000000000000010c140022927429afb5f7779f4bc5495da8c1e24",
  ],
  data: "0x0000000000000000000000000000000000000000000000000000000000009230",
  blockNumber: MAINNET_BLOCK_NUMBER,
  transactionHash: MAINNET_TX_HASH,
  logIndex: "0x2",
};

/** The sponsored-fee `Transfer` log (logIndex 0x4) — a third log in the same settlement. */
export const MAINNET_FEE_TRANSFER_LOG: TempoLogView = {
  address: MAINNET_TOKEN,
  topics: [
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
    "0x000000000000000000000000385193793fe875cd9f2341409563932023fb4fab",
    "0x000000000000000000000000feec000000000000000000000000000000000000",
  ],
  data: "0x0000000000000000000000000000000000000000000000000000000000000027",
  blockNumber: MAINNET_BLOCK_NUMBER,
  transactionHash: MAINNET_TX_HASH,
  logIndex: "0x4",
};

/** All three logs of the settlement, in receipt order. */
export const MAINNET_RECEIPT_LOGS: TempoLogView[] = [
  MAINNET_PLAIN_TRANSFER_LOG,
  MAINNET_MEMO_LOG,
  MAINNET_FEE_TRANSFER_LOG,
];
