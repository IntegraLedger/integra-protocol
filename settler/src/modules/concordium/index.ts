/**
 * The Concordium module for `x402/exact/ccd` on each configured network: `@x402/concordium` 2.31.0's facilitator
 * class, registered unchanged, with the network taken from configuration: the class serves the network its signer is
 * connected to. The payer signs a sponsored account transaction; the seller's sponsor co-signs it and pays its energy
 * (`extra.key` `fee-payer`). The sponsor reaches the module as the `FacilitatorConcordiumSigner` the class takes, its
 * account in `signers` and the class's `extra.feePayer`. lcp's checks name the instrument by the digest of what the
 * sender signed, since the pairing's single-use value is not yet shown; lcp's read goes through the reader the
 * configuration gives over the seller's node (gRPC v2), as the class's signer is given over it.
 */
import { isRefusal, type Refusal } from "@integraledger/lcp";
import { exactCcd, type CcdNetwork, type CcdReader, type CcdRef } from "@integraledger/lcp/ccd";
import type { PaymentRequirements as LcpOption } from "@integraledger/lcp/x402";
import type { FacilitatorConcordiumSigner } from "@x402/concordium";
import { ExactConcordiumScheme } from "@x402/concordium/exact/facilitator";
import type { Network } from "@x402/core/types";
import { outcomeOf, type Instrumented, type Module, type ModuleStarter, type Refused, type Registration, type X402Payment } from "../../module.js";

export interface ConcordiumConfig {
  /** The network, exactly one: the one the signer is connected to. */
  readonly network: CcdNetwork;
  /** The seller's sponsor account and its key, with its node, as `@x402/concordium`'s facilitator class takes them. */
  readonly signer: FacilitatorConcordiumSigner;
  /** lcp's reader over the seller's node for the network (`CcdReader` of `@integraledger/lcp/ccd`). */
  readonly reader: CcdReader;
}

function reasonOf(r: Refusal): string {
  if (r.code === "x402/not-v2") return "invalid_x402_version";
  if (r.code.startsWith("x402/option") || r.code === "ccd/option-malformed") return "invalid_payment_requirements";
  return "invalid_payload";
}

async function checked(p: X402Payment): Promise<CcdRef | Refusal> {
  const bound = await exactCcd.bound(p.payload);
  if (isRefusal(bound)) return bound;
  // The requirements arrive as JSON, which lcp's option type names.
  return exactCcd.reference(p.payload, p.requirements as LcpOption);
}

/** The module of `x402/exact/ccd` on the configured network. */
export function concordiumModule(c: ConcordiumConfig): Module {
  const network = c.network as Network;
  if (c.signer.getNetwork() !== network || c.reader.network !== c.network) {
    throw new TypeError(`the Concordium signer and reader must serve ${c.network}`);
  }
  return {
    descriptor: { name: "concordium", key: "fee-payer", pairings: [exactCcd.id], acceptsZero: true },
    network,
    facilitator: new ExactConcordiumScheme({ signer: c.signer }),
    record: {
      async instrument(p): Promise<Instrumented | Refused> {
        const ref = await checked(p);
        if (isRefusal(ref)) return { refused: reasonOf(ref) };
        // Until a run shows a landed payment refused when sent again, the sender's sequence number is not shown to be
        // single-use (lcp's registry: `nonce`), so each signed payment is its own instrument.
        return {
          pairing: exactCcd.id,
          instrument: { by: "digest", network, digest: ref.signed },
          nonce: exactCcd.data.nonce,
          keep: { until: "settler" },
        };
      },
      async read(p, at) {
        const ref = await checked(p);
        if (isRefusal(ref)) return outcomeOf({ state: "unreadable", reason: "unparseable", foreign: [] });
        const search = at.search as Parameters<typeof exactCcd.status>[2]["search"];
        const named = at.transaction === undefined ? ref : { ...ref, transaction: at.transaction };
        return outcomeOf(await exactCcd.status(named, c.reader, { act: "payment", finality: "finalized", ...(search === undefined ? {} : { search }) }));
      },
    },
    fees: {
      // The sponsor pays the energy of every transaction it co-signs.
      paysFee: () => true,
      payerBroadcast: () => false,
    },
  };
}

export function concordiumRegistration(c: ConcordiumConfig): Registration {
  return { network: c.network as Network, module: concordiumModule(c), own: [] };
}

/** The module's start: one registration of `exact` per configured network. */
export const starter: ModuleStarter<readonly ConcordiumConfig[]> = {
  name: "concordium",
  async start(config) {
    return { registrations: config.map(concordiumRegistration) };
  },
};
