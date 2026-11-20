// A module for the core's tests, written to the module contract (src/module.ts) for x402's `exact` EIP-3009 payment as
// x402's specification writes it (payload.authorization and payload.signature), keyed as the x402/exact/eip155/eip3009
// profile names its instrument: the network, the signer, the token and the nonce. Its verification, submission and read
// are a node stub's answers, which hold the chain's state: which nonces are consumed and by which transaction. The core
// is what is under test; nothing here is a chain's rule.
import type { PairingId } from "@integraledger/lcp";
import type { Network, PaymentPayload, PaymentRequirements, SchemeNetworkFacilitator } from "@x402/core/types";
import { outcomeOf, type Handoff, type KeyPurpose, type Module, type ModuleStarter, type ReadAnswer } from "../src/module.js";

export const PAIRING: PairingId = "x402/exact/eip155/eip3009";
export const OTHER_PAIRING: PairingId = "x402/exact/eip155/permit2";

export interface TestModuleConfig {
  readonly network: Network;
  /** The node stub's URL. */
  readonly node: string;
  /** The URL the module sends to, where it differs from `node`. */
  readonly sender?: string;
  readonly key?: KeyPurpose;
  readonly paysFee?: boolean;
  readonly acceptsZero?: readonly PairingId[];
  readonly signers?: readonly string[];
  readonly extra?: Record<string, unknown>;
  /** False where the module shows no fee it paid (`FeeNeeds.charged` left out). */
  readonly charged?: false;
}

/** x402's EIP-3009 authorization, as payload.authorization carries it. */
interface Authorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

async function ask(url: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return (await res.json()) as Record<string, unknown>;
}

function authorizationOf(payload: PaymentPayload): Authorization | undefined {
  const a = payload.payload["authorization"] as Partial<Authorization> | undefined;
  if (typeof payload.payload["signature"] !== "string" || a === undefined) return undefined;
  if (typeof a.from !== "string" || typeof a.validBefore !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(a.nonce ?? "")) {
    return undefined;
  }
  return a as Authorization;
}

/** The instrument's parts as the node stub keys a nonce: the signer, the token and the nonce, in lower case. */
export function nonceOf(payload: PaymentPayload, requirements: PaymentRequirements) {
  const a = authorizationOf(payload)!;
  return { signer: a.from.toLowerCase(), token: requirements.asset.toLowerCase(), value: a.nonce.toLowerCase() };
}

function moduleOf(c: TestModuleConfig, pairing: PairingId, form: string | undefined): Module {
  const sender = c.sender ?? c.node;
  const facilitator: SchemeNetworkFacilitator = {
    scheme: "exact",
    caipFamily: "eip155:*",
    getExtra: () => (form === undefined ? c.extra : { form }),
    getSigners: () => [...(c.signers ?? [])],
    async verify(payload, requirements) {
      const n = nonceOf(payload, requirements);
      // A signature that is not 65 bytes is refused, as x402's EVM class refuses one it cannot recover.
      if (!/^0x[0-9a-fA-F]{130}$/.test(payload.payload["signature"] as string)) {
        return { isValid: false, invalidReason: "invalid_exact_evm_payload_signature", payer: n.signer };
      }
      const checked = await ask(`${c.node}/check`, n);
      return checked["used"] === true
        ? { isValid: false, invalidReason: "invalid_exact_evm_payload_authorization_nonce_used", payer: n.signer }
        : { isValid: true, payer: n.signer };
    },
    async settle(payload, requirements) {
      const n = nonceOf(payload, requirements);
      let sent: Record<string, unknown>;
      try {
        sent = await ask(`${sender}/send`, n);
      } catch {
        return { success: false, errorReason: "node_unreachable", transaction: "", network: requirements.network };
      }
      const transaction = sent["transaction"] as string;
      if (sent["included"] === true) return { success: true, transaction, network: requirements.network, payer: n.signer };
      return { success: false, errorReason: sent["reason"] as string, transaction, network: requirements.network };
    },
  };
  return {
    descriptor: { name: "evm", key: c.key ?? "none", pairings: [pairing], acceptsZero: c.acceptsZero ?? [] },
    network: c.network,
    facilitator,
    record: {
      async instrument(p) {
        const a = authorizationOf(p.payload);
        if (a === undefined) return { refused: "invalid_payload" };
        const n = nonceOf(p.payload, p.requirements);
        return {
          pairing,
          instrument: { by: "single-use", network: c.network, signer: n.signer, value: n.value, scope: n.token },
          nonce: "single-use",
          keep: { until: "lapse", at: Number(a.validBefore) * 1000 },
        };
      },
      async read(p, at) {
        const from = at.from === undefined ? null : String((at.from as { block: bigint }).block);
        const validBefore = authorizationOf(p.payload)!.validBefore;
        const answer = await ask(`${c.node}/read`, { ...nonceOf(p.payload, p.requirements), validBefore, from, transaction: at.transaction ?? null });
        return outcomeOf(answer as unknown as ReadAnswer);
      },
      // The block the node is at, kept as a bigint, as a chain's own height is.
      async position() {
        return { block: BigInt((await ask(`${c.node}/head`, {}))["block"] as string) };
      },
    },
    fees: {
      paysFee: () => c.paysFee === true,
      payerBroadcast: () => false,
      ...(c.charged === false
        ? {}
        : {
            async charged(_p, sent) {
              // A node call whose deadline has passed is not made, as the settler's node calls are not.
              if (sent.deadline <= performance.now()) throw new Error("the deadline left no time for the node");
              const shown = await ask(`${c.node}/fee`, { transaction: sent.transaction });
              return { fee: BigInt(shown["fee"] as string), included: shown["included"] === true };
            },
          }),
    },
  };
}

/** The test module's starter: one `exact` registration per configured network. */
export const starter: ModuleStarter<readonly TestModuleConfig[]> = {
  name: "evm",
  async start(configs) {
    return { registrations: configs.map((c) => ({ network: c.network, module: moduleOf(c, PAIRING, undefined), own: [] })) };
  },
};

/**
 * A starter that offers its own module to the `exact` registration the test module makes on its network, claiming the
 * option whose `extra.form` is `"offered"`, as a transfer method alongside `exact`'s own is offered on one network.
 */
export const offering: ModuleStarter<TestModuleConfig> = {
  name: "erc7710",
  async start(c) {
    const handoff: Handoff = {
      claim: { by: "option", claims: (r: PaymentRequirements) => r.extra["form"] === "offered" },
      module: moduleOf(c, OTHER_PAIRING, "offered"),
    };
    return { registrations: [], handoffs: [{ scheme: "exact", network: c.network, handoff }] };
  },
};
