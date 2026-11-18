/**
 * eip155 rail pieces: EIP-3009 and Permit2 typed data, the settlement read from a token's events, the read of a signed
 * pull authorization's use, ERC-7710 permission contexts, the commerce-payments escrow's pieces, and x402's Permit2
 * proxy addresses.
 *
 * The settlement read is from the token's `AuthorizationUsed` event and the transfer it produced, and a pull
 * authorization's use is read before any transaction is named. It also holds the identity digest of a transfer; the
 * ERC-7710 permission-context decoder and MetaMask's DelegationManager address; and the commerce-payments escrow's
 * payment hash and the salt commitment to a receiver authorizer and policy.
 *
 * @module
 */
import {
  AUTHORIZATION_STATE_SELECTOR,
  AUTHORIZATION_USED_TOPIC,
  DELEGATION_MANAGER,
  DELEGATION_MANAGER_CHAINS,
  ESCROW,
  EXACT_PERMIT2_PROXY,
  NONCE_BITMAP_SELECTOR,
  PAYMENT_AUTHORIZED_TOPIC,
  PAYMENT_INFO_TYPEHASH,
  PERMIT2,
  REDEEMED_DELEGATION_TOPIC,
  ReaderError,
  SALT_BINDING_TYPEHASH,
  TRANSFER_TOPIC,
  TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
  UPTO_PERMIT2_PROXY,
  authorizationIdDigest,
  authorizationUsed,
  bindSalt,
  decodePermissionContext,
  eip3009Recover,
  eip3009TypedData,
  evmStatus,
  paymentHash,
  permit2TypedData,
  transferDigest,
} from "./internal/evm.js";
import { eip3009Read as eip3009Status } from "./internal/evm-x402-reads.js";
import {
  AUTHORIZATION_CANCELED_TOPIC,
  MAX_SEARCH_PAGES,
  SEARCH_PAGE_BLOCKS,
  UNORDERED_NONCE_INVALIDATION_TOPIC,
} from "./internal/evm-x402.js";

export {
  AUTHORIZATION_CANCELED_TOPIC,
  MAX_SEARCH_PAGES,
  SEARCH_PAGE_BLOCKS,
  UNORDERED_NONCE_INVALIDATION_TOPIC,
  AUTHORIZATION_STATE_SELECTOR,
  AUTHORIZATION_USED_TOPIC,
  DELEGATION_MANAGER,
  DELEGATION_MANAGER_CHAINS,
  ESCROW,
  EXACT_PERMIT2_PROXY,
  NONCE_BITMAP_SELECTOR,
  PAYMENT_AUTHORIZED_TOPIC,
  PAYMENT_INFO_TYPEHASH,
  PERMIT2,
  REDEEMED_DELEGATION_TOPIC,
  ReaderError,
  SALT_BINDING_TYPEHASH,
  TRANSFER_TOPIC,
  TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
  UPTO_PERMIT2_PROXY,
  authorizationIdDigest,
  authorizationUsed,
  bindSalt,
  decodePermissionContext,
  eip3009Recover,
  eip3009Status,
  eip3009TypedData,
  evmStatus,
  paymentHash,
  permit2TypedData,
  transferDigest,
};
export type {
  Delegation,
  Eip155,
  Eip3009TypedData,
  EvmBreadthStatus,
  EvmLog,
  EvmLogEntry,
  EvmMark,
  EvmQuery,
  EvmReader,
  EvmReceipt,
  EvmRef,
  EvmStatus,
  EvmTransaction,
  EvmTxRef,
  Field,
  HederaNetwork,
  Hex,
  PaymentInfo,
  Permit2TypedData,
  PullAuthorization,
  TransferIdentity,
  TransferLog,
} from "./internal/evm.js";
export type { AuthCaptureRef, BatchEvmRef, Eip3009Ref, Erc7710Ref, Permit2Ref } from "./internal/evm-x402-reads.js";
export type { EvmReadRefBase, Signed, X402EvmRefBase } from "./internal/evm-x402.js";
