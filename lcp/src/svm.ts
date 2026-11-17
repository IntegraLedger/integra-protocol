/**
 * Solana rail pieces: the wire transaction, its one Memo instruction carrying the ATR hash in LCP string form, the
 * digest of the message the payer signed, settlement read through a bounded reader, and the payment-channels program's
 * pieces: its instructions and PDAs, the voucher, the session proof, and the channel's status read.
 */
export {
  ATA_PROGRAM,
  COMPUTE_BUDGET,
  MEMO_V3,
  MEMO_V4,
  PAYMENT_CHANNELS,
  RENT_SYSVAR,
  SYSTEM,
  TOKEN,
  TOKEN_2022,
  buildChannelMessage,
  buildSvmMessage,
  channelInstruction,
  channelPda,
  channelVoucherMessage,
  decodeSvmTx,
  findPda,
  isKey,
  openInstructionData,
  svmCarrier,
  svmDigest,
} from "./internal/svm.js";
export type {
  ChannelBuildInput,
  ChannelIx,
  SolanaNetwork,
  SvmBuildInput,
  SvmNonce,
  SvmTx,
  SvmV1Header,
} from "./internal/svm.js";
export {
  SVM_MAX_CANDIDATES,
  SVM_SEARCH_SHOWN,
  svmChannelStatus,
  svmOpeningStatus,
  svmRecover,
  svmStatus,
} from "./internal/svm-read.js";
export type {
  ChannelStatus,
  SvmCommitment,
  SvmCursor,
  SvmInner,
  SvmLanded,
  SvmMark,
  SvmQuery,
  SvmReader,
  SvmRef,
  SvmSignature,
  SvmStatus,
  SvmTokenBalance,
} from "./internal/svm-read.js";
export {
  OPEN_DISCRIMINATOR,
  SEAL_DISCRIMINATOR,
  SETTLE_AND_SEAL_DISCRIMINATOR,
  openOf,
  sessionProof,
  solanaVoucher,
} from "./internal/svm-session.js";
export type { SvmCloseRef, SvmCloseStatus } from "./internal/svm-session.js";
