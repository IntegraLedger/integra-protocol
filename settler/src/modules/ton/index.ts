/**
 * The TON module for `x402/exact/tvm` on each configured network: `@x402/tvm` 2.31.0's facilitator class, registered
 * unchanged. The payer signs a W5 request; the seller's highload-v3 wallet relays it in a message of its own, which it
 * signs and whose gas it pays (`extra.key` `relayer`). The wallet reaches the module as the `FacilitatorTvmSigner` the
 * class takes, its address in `signers`. lcp's checks name the instrument, the payer's wallet and the sequence number
 * the request was signed against; lcp's read goes through the reader the configuration gives over the seller's TON
 * Center v3 index, as the class's signer is given over its node.
 */
import { isRefusal, type Refusal } from "@integraledger/lcp";
import { exactTvm, type TvmNetwork, type TvmReader, type TvmRef } from "@integraledger/lcp/tvm";
import type { PaymentRequirements as LcpOption } from "@integraledger/lcp/x402";
import type { Network } from "@x402/core/types";
import type { FacilitatorTvmSigner } from "@x402/tvm";
import { ExactTvmScheme } from "@x402/tvm/exact/facilitator";
import { outcomeOf, type Instrumented, type Module, type ModuleStarter, type Refused, type Registration, type X402Payment } from "../../module.js";

export interface TonConfig {
  /** The network, exactly one. */
  readonly network: TvmNetwork;
  /** The seller's highload-v3 wallet and its node, as `@x402/tvm`'s facilitator class takes them. */
  readonly signer: FacilitatorTvmSigner;
  /** lcp's reader over the seller's TON Center v3 index for the network (`TvmReader` of `@integraledger/lcp/tvm`). */
  readonly reader: TvmReader;
}

function reasonOf(r: Refusal): string {
  if (r.code === "x402/not-v2") return "invalid_x402_version";
  if (r.code.startsWith("x402/option") || r.code === "tvm/option-malformed") return "invalid_payment_requirements";
  return "invalid_payload";
}

async function checked(p: X402Payment): Promise<TvmRef | Refusal> {
  const bound = await exactTvm.bound(p.payload);
  if (isRefusal(bound)) return bound;
  // The requirements arrive as JSON, which lcp's option type names.
  return exactTvm.reference(p.payload, p.requirements as LcpOption);
}

/** The module of `x402/exact/tvm` on the configured network. */
export function tonModule(c: TonConfig): Module {
  const network = c.network as Network;
  if (c.reader.network !== c.network) throw new TypeError(`the TON reader serves ${c.reader.network}, not ${c.network}`);
  return {
    descriptor: { name: "ton", key: "relayer", pairings: [exactTvm.id], acceptsZero: [exactTvm.id] },
    network,
    facilitator: new ExactTvmScheme(c.signer),
    record: {
      async instrument(p): Promise<Instrumented | Refused> {
        const ref = await checked(p);
        if (isRefusal(ref)) return { refused: reasonOf(ref) };
        return {
          pairing: exactTvm.id,
          // The W5 wallet takes one request at each sequence number.
          instrument: { by: "single-use", network, signer: ref.wallet, value: String(ref.seqno) },
          nonce: exactTvm.data.nonce,
          keep: { until: "lapse", at: ref.validUntil * 1000 },
        };
      },
      async read(p, at) {
        const ref = await checked(p);
        if (isRefusal(ref)) return outcomeOf({ state: "unreadable", reason: "unparseable", foreign: [] });
        const search = at.search as Parameters<typeof exactTvm.status>[2]["search"];
        return outcomeOf(await exactTvm.status(ref, c.reader, { act: "payment", finality: "finalized", ...(search === undefined ? {} : { search }) }));
      },
    },
    fees: {
      // The highload wallet pays the relay's gas and the value it attaches to the payer's wallet.
      paysFee: () => true,
      payerBroadcast: () => false,
    },
  };
}

export function tonRegistration(c: TonConfig): Registration {
  return { network: c.network as Network, module: tonModule(c), own: [] };
}

/** The module's start: one registration of `exact` per configured network. */
export const starter: ModuleStarter<readonly TonConfig[]> = {
  name: "ton",
  async start(config) {
    return { registrations: config.map(tonRegistration) };
  },
};
