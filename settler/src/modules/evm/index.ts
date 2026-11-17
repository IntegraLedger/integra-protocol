/**
 * The `evm` module: x402's published EVM facilitator classes of `@x402/evm` 2.31.0, one module for each configured
 * scheme on one `eip155` network. `exact` settles EIP-3009 and Permit2 (`ExactEvmScheme`), `upto` Permit2
 * (`UptoEvmScheme`), `auth-capture` the commerce-payments escrow over either (`AuthCaptureEvmScheme`), and
 * `batch-settlement` the payment channel, in each of its modes (`BatchSettlementEvmScheme`). Each class verifies and
 * settles unchanged; the module adds the profile's pure checks, which lcp's codecs make before the class is asked, the
 * record's key and lcp's read, and what the fee budget counts. The key is the seller's gas key: it sends each
 * transaction and pays its gas, so `extra.key` is `relayer` and its address is the class's signer. A class names in its
 * answer the one transaction that pays, which the core counts; the module counts every transaction the key sends, so
 * that one the class sends and does not name, the deployment of a payer's ERC-6492 wallet, is counted too.
 */
import type { Eip155, Hex } from "@integraledger/lcp/evm";
import type { PendingSettlementStore } from "@x402/core/facilitator";
import type { Network, PaymentPayload, PaymentRequirements, SchemeNetworkFacilitator } from "@x402/core/types";
import { AuthCaptureEvmScheme, type AuthCaptureFacilitatorConfig } from "@x402/evm/auth-capture/facilitator";
import { BatchSettlementEvmScheme } from "@x402/evm/batch-settlement/facilitator";
import { ExactEvmScheme } from "@x402/evm/exact/facilitator";
import { UptoEvmScheme } from "@x402/evm/upto/facilitator";
import type { FacilitatorEvmSigner } from "@x402/evm";
import { NODE_TIMEOUT_MS } from "../../http.js";
import type { FeeMeter, FeeNeeds, Module, ModuleStarter, RecordNeeds, Registration } from "../../module.js";
import { admit, instrumentOf, PAIRINGS, readOf, type EvmScheme } from "./forms.js";
import { chargedFrom, evmReader, feeShown } from "./node.js";

/** One `eip155` network the `evm` module serves. */
export interface EvmConfig {
  /** The network, `eip155:<chain id>`: one module per scheme on it. */
  readonly network: `eip155:${number}`;
  /** The seller's node, an EVM JSON-RPC endpoint, which lcp's reads and the fee's read go through. */
  readonly rpc: string;
  /**
   * The seller's gas key, as x402's EVM classes take it (`toFacilitatorEvmSigner` of a client over the same node): it
   * sends every transaction the module submits and pays its gas.
   */
  readonly signer: FacilitatorEvmSigner;
  /** The schemes registered on the network; every one of the four where absent. */
  readonly schemes?: readonly EvmScheme[];
  /** ERC-6492 factories `exact` and `batch-settlement` may call to deploy a payer's wallet; none where absent. */
  readonly eip6492AllowedFactories?: readonly string[];
  /** `auth-capture`'s own configuration (fee terms, operators, its authorizers), passed to its class unchanged. */
  readonly authCapture?: AuthCaptureFacilitatorConfig;
}

/** A module whose key pays the fee of what it sends, with the read of each transaction's fee. */
export type EvmModule = Module & { readonly fees: Required<FeeNeeds> };

const SCHEMES: readonly EvmScheme[] = ["exact", "upto", "auth-capture", "batch-settlement"];

/**
 * The gas key as the classes take it, each transaction it sends (`writeContract`, `sendTransaction`) given to the
 * network's fee meter once sent and again once a class's wait for its receipt ends; every other member unchanged.
 */
function counted(signer: FacilitatorEvmSigner, meter: FeeMeter, rpc: string): FacilitatorEvmSigner {
  const count = (transaction: Hex): void => meter.sent(transaction, () => feeShown(rpc, transaction, performance.now() + NODE_TIMEOUT_MS));
  return new Proxy(signer, {
    get(inner, member) {
      const value: unknown = Reflect.get(inner, member);
      if (typeof value !== "function") return value;
      if (member === "writeContract" || member === "sendTransaction") {
        return async (args: unknown) => {
          const transaction = (await value.call(inner, args)) as Hex;
          count(transaction);
          return transaction;
        };
      }
      if (member === "waitForTransactionReceipt") {
        return async (args: { hash: Hex }) => {
          try {
            return await value.call(inner, args);
          } finally {
            count(args.hash);
          }
        };
      }
      return value.bind(inner);
    },
  });
}

/** x402's class for `scheme`, given the module's key and configuration, unchanged. */
function classOf(
  scheme: EvmScheme,
  c: EvmConfig,
  signer: FacilitatorEvmSigner,
  pendingSettlementStore?: PendingSettlementStore,
): SchemeNetworkFacilitator {
  const factories = [...(c.eip6492AllowedFactories ?? [])];
  const pending = pendingSettlementStore === undefined ? {} : { pendingSettlementStore };
  switch (scheme) {
    case "exact":
      return new ExactEvmScheme(signer, { eip6492AllowedFactories: factories, ...pending });
    case "upto":
      return new UptoEvmScheme(signer, pending);
    case "auth-capture":
      return new AuthCaptureEvmScheme(signer, c.authCapture);
    case "batch-settlement":
      return new BatchSettlementEvmScheme(signer, undefined, { eip6492AllowedFactories: factories, ...pending });
  }
}

/** The payer a payload names, where it names one, for a refusal's answer. */
function payerOf(payload: PaymentPayload): string | undefined {
  const body = payload.payload as Record<string, unknown> | undefined;
  for (const k of ["authorization", "permit2Authorization"]) {
    const a = body?.[k] as Record<string, unknown> | undefined;
    if (typeof a?.["from"] === "string") return a["from"];
  }
  return undefined;
}

/**
 * The class behind the profile's pure checks: a payment they refuse is answered with their reason and never reaches
 * the class; every other call is the class's own, its `getExtra` and `getSigners` included.
 */
function checked(scheme: EvmScheme, inner: SchemeNetworkFacilitator, pairings: readonly string[]): SchemeNetworkFacilitator {
  return {
    scheme: inner.scheme,
    caipFamily: inner.caipFamily,
    getExtra: (network) => inner.getExtra(network),
    getSigners: (network) => inner.getSigners(network),
    async verify(payload: PaymentPayload, requirements: PaymentRequirements, context) {
      const a = await admit(scheme, { payload, requirements }, pairings as never);
      if ("refused" in a) {
        const payer = payerOf(payload);
        return payer === undefined ? { isValid: false, invalidReason: a.refused } : { isValid: false, invalidReason: a.refused, payer };
      }
      return inner.verify(payload, requirements, context);
    },
    async settle(payload: PaymentPayload, requirements: PaymentRequirements, context) {
      const a = await admit(scheme, { payload, requirements }, pairings as never);
      if ("refused" in a) return { success: false, errorReason: a.refused, transaction: "", network: requirements.network };
      return inner.settle(payload, requirements, context);
    },
  };
}

/**
 * The `evm` module's schemes on one network, each x402's class with what the core needs beside it, the gas key counted
 * by `meter`, the network's fee meter. `pending` is where `exact`, `upto` and `batch-settlement` keep a settlement they
 * sent and the chain does not yet show, so that a retried settle reconciles against it; each class keeps its own in
 * memory where absent.
 */
export function evmModules(c: EvmConfig, meter: FeeMeter, pending?: PendingSettlementStore): EvmModule[] {
  const network = c.network as Network;
  const signer = counted(c.signer, meter, c.rpc);
  return (c.schemes ?? SCHEMES).map((scheme): EvmModule => {
    const pairings = PAIRINGS[scheme];
    const record: RecordNeeds = {
      async instrument(p) {
        const a = await admit(scheme, p, pairings);
        return "refused" in a ? a : instrumentOf(network, p, a);
      },
      async read(p, at) {
        const a = await admit(scheme, p, pairings);
        if ("refused" in a) return { outcome: "live", answer: { state: "unreadable", reason: "unparseable", foreign: [] } };
        return readOf(evmReader(c.network as Eip155, c.rpc, at.deadline), a, at);
      },
    };
    return {
      descriptor: {
        name: "evm",
        key: "relayer",
        pairings,
        // Permit2 takes no zero (its proxies refuse an amount of 0), and every other EVM class form but EIP-3009's
        // `exact` is unestablished at zero; a kind takes zero only where each of its pairings does.
        acceptsZero: false,
      },
      network,
      facilitator: checked(scheme, classOf(scheme, c, signer, pending), pairings),
      record,
      fees: {
        paysFee: () => true,
        payerBroadcast: () => false,
        charged: chargedFrom(c.rpc),
      },
    };
  });
}

/**
 * How the core starts the module: the configuration's `evm` member lists the networks, one entry each, and each
 * configured scheme on a network is one registration of x402's class, whose pending settlements are kept in the
 * settler's database. The `erc7710` module offers itself to the `exact` registration made here.
 */
export const starter: ModuleStarter<readonly EvmConfig[]> = {
  name: "evm",
  async start(networks, core) {
    const pending = core.state.pendingSettlements();
    return {
      registrations: networks.flatMap((c) =>
        evmModules(c, core.meter(c.network as Network), pending).map(
          (module): Registration => ({ network: module.network, module, own: [] }),
        ),
      ),
    };
  },
};
