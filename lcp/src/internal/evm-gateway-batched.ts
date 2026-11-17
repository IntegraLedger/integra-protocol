/**
 * `x402/exact/eip155/gateway-batched`: x402's `exact` scheme in Circle Gateway's `GatewayWalletBatched` domain
 * (x402-exact-eip155-gateway-batched.md). The payer signs an EIP-3009 `TransferWithAuthorization` under the Gateway
 * Wallet's EIP-712 domain with the ATR hash as its nonce, and Circle Gateway settles it in batches. No public ledger
 * shows the authorization, so the pairing has no `reference`, `status` or `recover`.
 */
import { secp256k1 } from "@noble/curves/secp256k1.js";
import type { AtrHash } from "./core.js";
import { addressWord, bytes32Word, bytesOf, concat, hexOf, keccak, uintWord, type Hex } from "../evm-abi.js";
import { chainIdOf, deepFreeze, isAddress, isObject, normalHash, uint256Of } from "../fields.js";
import { carriesRefused, isRefusal, refusal, type Refusal } from "../refusal.js";
import { tie, type LcpPattern, type PaymentPayload, type PaymentRequirements, type X402Choice } from "../x402.js";
import { MAX_SIGNATURE_BYTES } from "./bounds.js";
import { EIP155_X402 } from "./data/eip155-x402.js";
import { TRANSFER_WITH_AUTHORIZATION_TYPEHASH, type Field } from "./evm.js";
import type { Entry, NoRead } from "./registry.js";
import {
  acceptedBy,
  advertiseFor,
  chosen,
  isAmount,
  isTimeoutSeconds,
  legalContextOf,
  paymentWith,
  readFor,
  x402Broadcaster,
  type OptionFilter,
  type X402Forms,
} from "./x402.js";

const ID = "x402/exact/eip155/gateway-batched" as const;

/** The EIP-712 domain name Circle Gateway's batched payment signs under, the option's `extra.name`. */
const BATCHED_NAME = "GatewayWalletBatched";

/** Seconds before the signing time at which the authorization becomes valid, as Circle's client signs it. */
const VALID_BEFORE_SIGNING = 600;

/** Circle's margin over the served minimum validity, for clock differences and latency. */
const VALIDITY_MARGIN = 100;

/** The length of an externally owned account's signature, `r ‖ s ‖ v`. */
const SIGNATURE_BYTES = 65;

const MAINNET_WALLET = "0x77777777dcc4d5a8b6e418fd04d8997ef11000ee";
const TESTNET_WALLET = "0x0077777d7eba4688bdef3e311b846f25870a19b9";

/** A network's Gateway Wallet and its USDC, lowercase. */
type Network = { wallet: string; usdc: string };

/** The Gateway Wallet and USDC on each network, by chain id, as `@circle-fin/x402-batching` 4.0.0 configures them. */
const NETWORKS: ReadonlyMap<number, Network> = new Map(
  (
    [
      [1, MAINNET_WALLET, "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"],
      [10, MAINNET_WALLET, "0x0b2c639c533813f4aa9d7837caf62653d097ff85"],
      [130, MAINNET_WALLET, "0x078d782b760474a361dda0af3839290b0ef57ad6"],
      [137, MAINNET_WALLET, "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359"],
      [146, MAINNET_WALLET, "0x29219dd400f2bf60e5a23d13be72b486d4038894"],
      [480, MAINNET_WALLET, "0x79a02482a880bce3f13e09da970dc34db4cd24d1"],
      [999, MAINNET_WALLET, "0xb88339cb7199b77e23db6e890353e22632ba630f"],
      [1329, MAINNET_WALLET, "0xe15fc38f6d8c56af07bbcbe3baf5708a2bf42392"],
      [5042, MAINNET_WALLET, "0x3600000000000000000000000000000000000000"],
      [8453, MAINNET_WALLET, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"],
      [42161, MAINNET_WALLET, "0xaf88d065e77c8cc2239327c5edb3a432268e5831"],
      [43114, MAINNET_WALLET, "0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e"],
      [998, TESTNET_WALLET, "0x2b3370ee501b4a559b57d449569354196457d8ab"],
      [1301, TESTNET_WALLET, "0x31d0220469e10c4e71834a79b1f276d740d3768f"],
      [1328, TESTNET_WALLET, "0x4fcf1784b31630811181f670aea7a7bef803eaed"],
      [4801, TESTNET_WALLET, "0x66145f38cbac35ca6f1dfb4914df98f1614aea88"],
      [14601, TESTNET_WALLET, "0x0ba304580ee7c9a980cf72e55f5ed2e9fd30bc51"],
      [43113, TESTNET_WALLET, "0x5425890298aed601595a70ab815c96711a31bc65"],
      [80002, TESTNET_WALLET, "0x41e94eb019c0762f9bfcf9fb1e58725bfb0e7582"],
      [84532, TESTNET_WALLET, "0x036cbd53842c5426634e7929541ec2318f3dcf7e"],
      [421614, TESTNET_WALLET, "0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d"],
      [5042002, TESTNET_WALLET, "0x3600000000000000000000000000000000000000"],
      [11155111, TESTNET_WALLET, "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238"],
      [11155420, TESTNET_WALLET, "0x5fd84259d66cd46123540766be93dfe6d43130d7"],
    ] as const
  ).map(([id, wallet, usdc]) => [id, { wallet, usdc }] as const),
);

/** The buyer's choice: x402's, with the `minValiditySeconds` Circle Gateway's `/supported` serves for the network. */
export interface GatewayBatchedChoice extends X402Choice {
  minValiditySeconds: number;
}

/** The EIP-712 typed data the payer signs: `TransferWithAuthorization` in the Gateway Wallet's domain. */
export interface GatewayBatchedTypedData {
  domain: { name: string; version: "1" | "2"; chainId: number; verifyingContract: Hex; salt?: Hex };
  types: { EIP712Domain: Field[]; TransferWithAuthorization: Field[] };
  primaryType: "TransferWithAuthorization";
  message: { from: Hex; to: Hex; value: bigint; validAfter: bigint; validBefore: bigint; nonce: AtrHash };
}

/** What `build` gives: the typed data to sign, and the step that wraps the signature in the payment. */
export interface GatewayBatchedUnsigned {
  typedData: GatewayBatchedTypedData;
  complete(signature: Hex): GatewayBatchedPayment | Refusal;
}

/** The batched authorization, every member a string, as Circle's client writes it. */
type BatchedAuthorization = {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
};

/** A payment of `x402/exact/eip155/gateway-batched`. */
export type GatewayBatchedPayment = PaymentPayload & { payload: { signature: Hex; authorization: BatchedAuthorization } };

const DOMAIN_FIELDS: readonly Field[] = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" },
];
const SALT_FIELD: Field = { name: "salt", type: "bytes32" };
const AUTHORIZATION_FIELDS: readonly Field[] = [
  { name: "from", type: "address" },
  { name: "to", type: "address" },
  { name: "value", type: "uint256" },
  { name: "validAfter", type: "uint256" },
  { name: "validBefore", type: "uint256" },
  { name: "nonce", type: "bytes32" },
];

/** The option's domain version: `extra.version`, `"1"` where it has none, or undefined for any other value. */
function versionOf(extra: Record<string, unknown>): "1" | "2" | undefined {
  const v = extra["version"] ?? "1";
  return v === "1" || v === "2" ? v : undefined;
}

/**
 * The option filter: `true` for an `exact` option on an `eip155` network whose `extra.name` is `GatewayWalletBatched`
 * and whose `extra.assetTransferMethod` is absent or `eip3009`, where it can be paid; undefined for any other option.
 * Of those, it refuses a non-empty `extra.splits` (`x402/splits-not-carried`), and an `extra.version` other than `"1"`
 * and `"2"`, an `extra.verifyingContract` that is not the Gateway Wallet on the option's network, at version `"1"` an
 * asset other than the network's USDC, or an asset, `payTo`, `amount` or `maxTimeoutSeconds` the payment cannot carry
 * (`x402/option-malformed`).
 */
const filter: OptionFilter = (o) => {
  if (!isObject(o) || o.scheme !== "exact") return undefined;
  const chainId = chainIdOf(o.network);
  const extra: unknown = o.extra;
  if (chainId === undefined || !isObject(extra) || extra["name"] !== BATCHED_NAME) return undefined;
  const method = extra["assetTransferMethod"];
  if (method !== undefined && method !== "eip3009") return undefined;
  const splits = extra["splits"];
  if (splits !== undefined && !(Array.isArray(splits) && splits.length === 0)) return refusal("x402/splits-not-carried");
  const wallet = extra["verifyingContract"];
  const network = NETWORKS.get(chainId);
  const version = versionOf(extra);
  const payable =
    network !== undefined &&
    version !== undefined &&
    isAddress(wallet) &&
    wallet.toLowerCase() === network.wallet &&
    isAddress(o.asset) &&
    (version === "2" || o.asset.toLowerCase() === network.usdc) &&
    isAddress(o.payTo) &&
    isAmount(o.amount) &&
    uint256Of(o.amount) !== undefined &&
    isTimeoutSeconds(o.maxTimeoutSeconds);
  return payable ? true : refusal("x402/option-malformed");
};

/** The typed data for an option the filter serves: its domain by `extra.version`, the message as given. */
function typedDataOf(option: PaymentRequirements, message: GatewayBatchedTypedData["message"]): GatewayBatchedTypedData {
  const extra = option.extra!;
  const version = versionOf(extra)!;
  const domain: GatewayBatchedTypedData["domain"] = {
    name: BATCHED_NAME,
    version,
    chainId: chainIdOf(option.network)!,
    verifyingContract: extra["verifyingContract"] as Hex,
    ...(version === "2" ? { salt: hexOf(addressWord(option.asset as Hex)) } : {}),
  };
  return {
    domain,
    types: {
      EIP712Domain: version === "2" ? [...DOMAIN_FIELDS, SALT_FIELD] : [...DOMAIN_FIELDS],
      TransferWithAuthorization: [...AUTHORIZATION_FIELDS],
    },
    primaryType: "TransferWithAuthorization",
    message,
  };
}

/** The EIP-712 digest of the typed data: keccak256 of `0x1901`, the domain separator and the message's struct hash. */
function digestOf(t: GatewayBatchedTypedData): Uint8Array {
  const type = `EIP712Domain(${t.types.EIP712Domain.map((f) => `${f.type} ${f.name}`).join(",")})`;
  const domain = keccak(
    concat([
      keccak(type),
      keccak(t.domain.name),
      keccak(t.domain.version),
      uintWord(BigInt(t.domain.chainId)),
      addressWord(t.domain.verifyingContract),
      ...(t.domain.salt === undefined ? [] : [bytes32Word(t.domain.salt)]),
    ]),
  );
  const m = t.message;
  const struct = keccak(
    concat([
      bytesOf(TRANSFER_WITH_AUTHORIZATION_TYPEHASH)!,
      addressWord(m.from),
      addressWord(m.to),
      uintWord(m.value),
      uintWord(m.validAfter),
      uintWord(m.validBefore),
      bytes32Word(m.nonce),
    ]),
  );
  return keccak(concat([Uint8Array.of(0x19, 0x01), domain, struct]));
}

/** `0x` and an even number of hex digits, of `min` to `max` bytes. */
function isHexBytes(s: unknown, min: number, max: number): s is Hex {
  if (typeof s !== "string" || s.length % 2 !== 0 || !/^0x[0-9a-fA-F]*$/.test(s)) return false;
  const bytes = (s.length - 2) / 2;
  return bytes >= min && bytes <= max;
}

/**
 * The `TransferWithAuthorization` the payer signs for the chosen option, with H as its nonce: `validAfter` 600 seconds
 * before `now`, and `validBefore` `now` plus the greater of the option's `maxTimeoutSeconds` and `minValiditySeconds`
 * plus 100. H is checked first, then the choice's `from`, `now` (at least 600) and `minValiditySeconds` (a positive
 * safe integer), then its document and option. `complete` takes a 65-byte signature.
 */
async function build(choice: GatewayBatchedChoice, h: AtrHash): Promise<GatewayBatchedUnsigned | Refusal> {
  const nonce = normalHash(h);
  if (nonce === null) return refusal("x402/payload-malformed");
  if (!isObject(choice)) return refusal("x402/not-v2");
  const { required, accepted, from, now, minValiditySeconds } = choice;
  if (!isAddress(from) || !Number.isSafeInteger(now) || now < VALID_BEFORE_SIGNING) return refusal("x402/option-malformed");
  if (!Number.isSafeInteger(minValiditySeconds) || minValiditySeconds <= 0) return refusal("x402/option-malformed");
  const wrong = chosen(required, accepted, filter);
  if (wrong !== true) return wrong;

  const window = Math.max(accepted.maxTimeoutSeconds, minValiditySeconds + VALIDITY_MARGIN);
  const validAfter = BigInt(now - VALID_BEFORE_SIGNING);
  const validBefore = BigInt(now) + BigInt(window);
  const value = uint256Of(accepted.amount)!;
  const typedData = typedDataOf(accepted, { from, to: accepted.payTo as Hex, value, validAfter, validBefore, nonce });
  const authorization: BatchedAuthorization = {
    from,
    to: accepted.payTo,
    value: accepted.amount,
    validAfter: validAfter.toString(),
    validBefore: validBefore.toString(),
    nonce,
  };
  return {
    typedData,
    complete(signature: Hex): GatewayBatchedPayment | Refusal {
      if (!isHexBytes(signature, SIGNATURE_BYTES, SIGNATURE_BYTES)) return refusal("x402/signature-malformed");
      return paymentWith(required, accepted, { signature, authorization: { ...authorization } }) as GatewayBatchedPayment;
    },
  };
}

/** The payment's shape as this pairing requires it, or the refusal that names what is wrong. */
function paymentOf(presented: unknown): GatewayBatchedPayment | Refusal {
  if (!isObject(presented) || presented["x402Version"] !== 2) return refusal("x402/not-v2");
  if (carriesRefused(presented)) return refusal("x402/payload-malformed");
  const accepted = acceptedBy(presented["accepted"], filter);
  if (isRefusal(accepted)) return accepted;
  const payload = presented["payload"];
  if (!isObject(payload)) return refusal("x402/payload-malformed");
  const a = payload["authorization"];
  if (!isObject(a)) return refusal("x402/payload-malformed");
  for (const k of ["from", "to", "value", "validAfter", "validBefore", "nonce"]) {
    if (typeof a[k] !== "string") return refusal("x402/payload-malformed");
  }
  if (!isHexBytes(payload["signature"], 1, MAX_SIGNATURE_BYTES)) return refusal("x402/signature-malformed");
  return presented as GatewayBatchedPayment;
}

/**
 * H as the authorization's nonce, lowercase. Where the payment echoes an `extensions.legalContext` that decodes, its H
 * must be the nonce, else `x402/signed-not-bound`. The signature is not verified here; Circle verifies it.
 */
async function bound(presented: unknown): Promise<AtrHash | Refusal> {
  const p = paymentOf(presented);
  if (isRefusal(p)) return p;
  const nonce = normalHash(p.payload.authorization.nonce);
  if (nonce === null) return refusal("x402/payload-malformed");
  const echoed = legalContextOf(p.extensions);
  if (!isRefusal(echoed) && normalHash(echoed.h) !== nonce) return refusal("x402/signed-not-bound");
  return nonce;
}

/**
 * The account whose signature authorises the payment, lowercase: the address recovered from the 65-byte signature over
 * the presented authorization's EIP-712 digest in the domain its option names, whether or not it is the authorization's
 * `from`. A signature that is not 65 bytes with a low `s` and a `v` of 27, 28, 0 or 1, from which no account is
 * recovered, is `x402/signature-malformed`.
 */
async function authorizer(presented: unknown): Promise<Hex | Refusal> {
  const h = await bound(presented);
  if (isRefusal(h)) return h;
  const { accepted, payload } = presented as GatewayBatchedPayment;
  const a = payload.authorization;
  const value = uint256Of(a.value);
  const validAfter = uint256Of(a.validAfter);
  const validBefore = uint256Of(a.validBefore);
  if (!isAddress(a.from) || !isAddress(a.to) || value === undefined || validAfter === undefined || validBefore === undefined) {
    return refusal("x402/payload-malformed");
  }
  const sig = bytesOf(payload.signature);
  if (sig === undefined || sig.length !== SIGNATURE_BYTES) return refusal("x402/signature-malformed");
  const v = sig[64]!;
  const parity = v === 27 || v === 28 ? v - 27 : v === 0 || v === 1 ? v : -1;
  if (parity < 0) return refusal("x402/signature-malformed");
  const digest = digestOf(typedDataOf(accepted, { from: a.from, to: a.to, value, validAfter, validBefore, nonce: h }));
  try {
    const s = secp256k1.Signature.fromBytes(sig.subarray(0, 64), "compact");
    if (s.hasHighS()) return refusal("x402/signature-malformed");
    const key = s.addRecoveryBit(parity).recoverPublicKey(digest).toBytes(false).subarray(1);
    return hexOf(keccak(key).subarray(12));
  } catch {
    return refusal("x402/signature-malformed");
  }
}

/** The option unchanged: the pairing carries no hash inside the option. One that carries a `refused` member is refused. */
function unplaced(option: PaymentRequirements): PaymentRequirements | Refusal {
  if (isObject(option) && carriesRefused(option)) return refusal("x402/option-malformed");
  return option;
}

const pattern: LcpPattern = deepFreeze({
  pattern: "native-field",
  profile: ID,
  onChain: false,
  zeroPartyRecoverable: false,
  forwardIndexable: false,
});

/** Whether the `x402/exact/eip155/gateway-batched` filter serves an option. */
export function isGatewayBatched(option: PaymentRequirements): boolean {
  return filter(option) === true;
}

/**
 * `x402/exact/eip155/gateway-batched`. The payee broadcasts (`broadcaster` answers `"payee"`): the resource server
 * hands the authorization the payer signed to Circle Gateway, which settles it; no `status` reads it.
 */
export const exactGatewayBatched = Object.freeze({
  id: ID,
  data: EIP155_X402[ID],
  pattern,
  claims: true as boolean,
  unplaced,
  tie,
  advertise: advertiseFor(filter),
  read: readFor(filter),
  build,
  bound,
  broadcaster: x402Broadcaster("payee", { refused: () => refusal("x402/payload-malformed") }),
  authorizer,
}) satisfies Entry<
  typeof ID,
  GatewayBatchedPayment,
  never,
  never,
  X402Forms & NoRead & { choice: GatewayBatchedChoice; unsigned: GatewayBatchedUnsigned }
>;
