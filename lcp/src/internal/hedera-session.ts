/**
 * Hedera's MPP session escrow: the `open` call, the channel id the escrow computes from the payer, payee, token, salt,
 * authorized signer, escrow and chain, the EIP-712 voucher, and the escrow's `ChannelOpened` and `ChannelClosed`
 * events. ABI words are written here, 32 bytes each. The public names are re-exported by `../hedera.ts`.
 */
import type { AtrHash } from "../core.js";
import { addressWord, bytes32Word, bytesOf, concat, hexOf, keccak, uintWord, type Hex } from "../evm-abi.js";
import type { EvmReader, EvmRef } from "../evm.js";

type HederaNetwork = "hedera:mainnet" | "hedera:testnet" | "hedera:previewnet" | "hedera:devnet";

/** `open(address,address,uint128,bytes32,address)`. */
export const ESCROW_OPEN_SELECTOR = "0xc79ea485";
export const APPROVE_SELECTOR = "0x095ea7b3";
/** `ChannelOpened(bytes32,address,address,address,address,bytes32,uint256)`: channel, payer, payee indexed. */
export const CHANNEL_OPENED_TOPIC = "0xcd6e60364f8ee4c2b0d62afc07a1fb04fd267ce94693f93f8f85daaa099b5c94";
export const CHANNEL_CLOSED_TOPIC = "0x92ed5fe0fe56b3f4185e688efb342e92a4492b9df29ad5de596c44e64d097b51";
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export interface HederaChannelConfig {
  payer: Hex;
  payee: Hex;
  token: Hex;
  salt: Hex;
  authorizedSigner: Hex;
  escrow: Hex;
  chainId: 295 | 296;
}

/** The EIP-712 voucher a Hedera session's payer signs: `Voucher(bytes32 channelId,uint128 cumulativeAmount)`. */
export interface HederaVoucherTypedData {
  domain: { name: "Hedera Stream Channel"; version: "1"; chainId: 295 | 296; verifyingContract: Hex };
  primaryType: "Voucher";
  types: { Voucher: [{ name: "channelId"; type: "bytes32" }, { name: "cumulativeAmount"; type: "uint128" }] };
  message: { channelId: Hex; cumulativeAmount: bigint };
}

/** A reader of a Hedera network's JSON-RPC relay: an `EvmReader` on a `hedera:` network. */
export type HederaEvmReader = Omit<EvmReader, "network"> & { readonly network: HederaNetwork };
/** The opening's read keys: the reported open transaction and its `ChannelOpened` log from the escrow. */
export type HederaSessionRef = Omit<EvmRef, "network"> & { network: HederaNetwork; transaction: Hex };
/**
 * A close: the transaction whose `ChannelClosed` log from the escrow names the channel, and `search`, the log filter
 * that finds that transaction when no one reports it.
 */
export type HederaCloseRef = {
  phase: "close";
  network: HederaNetwork;
  escrow: Hex;
  channel: Hex;
  search: { address: Hex; topics: readonly (Hex | null)[] };
  transaction: Hex;
};

/** keccak256(abi.encode(payer, payee, token, salt, authorizedSigner, escrow, chainId)), lowercase. */
export function hederaChannelId(c: HederaChannelConfig): Hex {
  return hexOf(
    keccak(
      concat([
        addressWord(c.payer),
        addressWord(c.payee),
        addressWord(c.token),
        bytes32Word(c.salt),
        addressWord(c.authorizedSigner),
        addressWord(c.escrow),
        uintWord(BigInt(c.chainId)),
      ]),
    ),
  );
}

/** The voucher for `cumulative` on a channel, under the escrow's domain. */
export function hederaVoucher(c: { channelId: Hex; escrow: Hex; chainId: 295 | 296 }, cumulative: bigint): HederaVoucherTypedData {
  return {
    domain: { name: "Hedera Stream Channel", version: "1", chainId: c.chainId, verifyingContract: c.escrow.toLowerCase() as Hex },
    primaryType: "Voucher",
    types: { Voucher: [{ name: "channelId", type: "bytes32" }, { name: "cumulativeAmount", type: "uint128" }] },
    message: { channelId: c.channelId.toLowerCase() as Hex, cumulativeAmount: cumulative },
  };
}

/** `approve(spender, amount)` calldata. */
export function approveCalldata(spender: Hex, amount: bigint): Hex {
  return hexOf(concat([bytesOf(APPROVE_SELECTOR)!, addressWord(spender), uintWord(amount)]));
}

/** The escrow's `open(payee, token, deposit, salt, authorizedSigner)` calldata. */
export function openCalldata(payee: Hex, token: Hex, deposit: bigint, salt: AtrHash, authorizedSigner: Hex): Hex {
  return hexOf(
    concat([
      bytesOf(ESCROW_OPEN_SELECTOR)!,
      addressWord(payee),
      addressWord(token),
      uintWord(deposit),
      bytes32Word(salt),
      addressWord(authorizedSigner),
    ]),
  );
}
