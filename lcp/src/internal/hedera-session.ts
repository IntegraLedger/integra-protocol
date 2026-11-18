/**
 * Hedera's MPP session escrow: the `open` call, the channel id the escrow computes from the payer, payee, token, salt,
 * authorized signer, escrow and chain, the EIP-712 voucher, and the escrow's `ChannelOpened` and `ChannelClosed`
 * events. ABI words are written here, 32 bytes each. The public names are re-exported by `../hedera.ts`.
 */
import { addressWord, bytes32Word, concat, hexOf, keccak, uintWord, type Hex } from "../evm-abi.js";
import { isAddress, isObject, normalHash } from "../fields.js";
import type { HederaNetwork } from "../hedera.js";

/** `approve(address,uint256)`. */
export const APPROVE_SELECTOR = "0x095ea7b3";
/** `ChannelOpened(bytes32,address,address,address,address,bytes32,uint256)`: channel, payer, payee indexed. */
export const CHANNEL_OPENED_TOPIC = "0xcd6e60364f8ee4c2b0d62afc07a1fb04fd267ce94693f93f8f85daaa099b5c94";
/** `ChannelClosed(bytes32,address,address,uint256,uint256)`. */
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

/**
 * keccak256(abi.encode(payer, payee, token, salt, authorizedSigner, escrow, chainId)), lowercase. Throws TypeError
 * when an address is not `0x` and 40 hex digits, the salt is not a 32-byte hash, or the chain id is not 295 or 296.
 */
export function hederaChannelId(c: HederaChannelConfig): Hex {
  if (!isObject(c) || ![c.payer, c.payee, c.token, c.authorizedSigner, c.escrow].every(isAddress)) {
    throw new TypeError("not a Hedera channel configuration");
  }
  if (normalHash(c.salt) === null || !isChainId(c.chainId)) throw new TypeError("not a Hedera channel configuration");
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

/**
 * The voucher for `cumulative` on a channel, under the escrow's domain. Throws TypeError when the channel id is not a
 * 32-byte hash, the escrow not `0x` and 40 hex digits, the chain id not 295 or 296, or `cumulative` not a bigint that
 * fits a uint128.
 */
export function hederaVoucher(c: { channelId: Hex; escrow: Hex; chainId: 295 | 296 }, cumulative: bigint): HederaVoucherTypedData {
  if (!isObject(c) || normalHash(c.channelId) === null || !isAddress(c.escrow) || !isChainId(c.chainId)) {
    throw new TypeError("not a Hedera channel");
  }
  if (typeof cumulative !== "bigint" || cumulative < 0n || cumulative >= 1n << 128n) {
    throw new TypeError("not a uint128 cumulative amount");
  }
  return {
    domain: { name: "Hedera Stream Channel", version: "1", chainId: c.chainId, verifyingContract: c.escrow.toLowerCase() as Hex },
    primaryType: "Voucher",
    types: { Voucher: [{ name: "channelId", type: "bytes32" }, { name: "cumulativeAmount", type: "uint128" }] },
    message: { channelId: c.channelId.toLowerCase() as Hex, cumulativeAmount: cumulative },
  };
}

function isChainId(n: unknown): n is 295 | 296 {
  return n === 295 || n === 296;
}
