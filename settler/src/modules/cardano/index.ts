/**
 * The Cardano module for `x402/exact/cardano` (the address method) and `x402/exact/cardano/lock` (the `masumi` and
 * `script` locks) on each configured network: `@x402/cardano` 2.31.0's facilitator class, registered unchanged. The
 * module holds no key (`extra.key` `none`): the class broadcasts the transaction the buyer signed, whose fee the buyer
 * pays. A provider's project id or endpoint is the configuration of the chain-query object the class takes, which is
 * not a key. The class's guard against broadcasting one transaction twice is kept in the settler's database, so a
 * repeat after a restart resumes observing what was broadcast. lcp's checks name the instrument, the transaction id,
 * which the body alone fixes; lcp's read goes through the reader the configuration gives over the seller's indexer.
 */
import { isRefusal, type Refusal } from "@integraledger/lcp";
import { exactCardano, exactCardanoLock, type CardanoNetwork, type CardanoReader, type CardanoRef } from "@integraledger/lcp/cardano";
import type { PaymentRequirements as LcpOption } from "@integraledger/lcp/x402";
import type { FacilitatorCardanoSigner } from "@x402/cardano";
import { ExactCardanoScheme, type CardanoSettlementStore } from "@x402/cardano/exact/facilitator";
import type { Network } from "@x402/core/types";
import { outcomeOf, type Instrumented, type Module, type ModuleState, type ModuleStarter, type Refused, type Registration, type X402Payment } from "../../module.js";

export interface CardanoConfig {
  /** The network, exactly one. */
  readonly network: CardanoNetwork;
  /** The chain-query object `@x402/cardano`'s facilitator class takes, over the seller's provider. */
  readonly signer: FacilitatorCardanoSigner;
  /** lcp's reader over the seller's indexer for the network (`CardanoReader` of `@integraledger/lcp/cardano`). */
  readonly reader: CardanoReader;
}

function reasonOf(r: Refusal): string {
  if (r.code === "x402/not-v2") return "invalid_x402_version";
  if (r.code.startsWith("x402/option") || r.code === "cardano/option-malformed") return "invalid_payment_requirements";
  return "invalid_payload";
}

/** The pairing an option is: a lock where its method names one, else the address method. */
function codecOf(p: X402Payment): typeof exactCardano | typeof exactCardanoLock {
  const method = p.requirements.extra?.["assetTransferMethod"];
  return method === "masumi" || method === "script" ? exactCardanoLock : exactCardano;
}

async function checked(p: X402Payment): Promise<CardanoRef | Refusal> {
  const codec = codecOf(p);
  const bound = await codec.bound(p.payload as never);
  if (isRefusal(bound)) return bound;
  // The requirements arrive as JSON, which lcp's option type names.
  return codec.reference(p.payload as never, p.requirements as LcpOption);
}

type Claimed = { state: "in-flight" | "submitted" | "rejected"; owner: string };

/** `@x402/cardano`'s duplicate-settlement guard over the module's durable state: one value per transaction id. */
export function settlementStore(state: ModuleState, network: string): CardanoSettlementStore {
  const key = (txHash: string) => `settlement:${network}:${txHash}`;
  async function move(txHash: string, owner: string, to: Claimed["state"] | undefined): Promise<void> {
    const now = (await state.get(key(txHash))) as Claimed | undefined;
    if (now?.owner !== owner) return;
    if (to === undefined) {
      if (now.state === "in-flight") await state.delete(key(txHash));
      return;
    }
    await state.swap(key(txHash), now, { state: to, owner });
  }
  return {
    async claimSettlement(claim) {
      if (claim.termsDigest !== undefined) {
        const terms = `terms:${network}:${claim.termsDigest}`;
        const bound = await state.swap(terms, undefined, claim.txHash);
        if (!bound && (await state.get(terms)) !== claim.txHash) return "terms-conflict";
      }
      if (await state.swap(key(claim.txHash), undefined, { state: "in-flight", owner: claim.ownerToken })) return "fresh";
      const now = (await state.get(key(claim.txHash))) as Claimed | undefined;
      return now?.state ?? "in-flight";
    },
    markSubmitted: (txHash, owner) => move(txHash, owner, "submitted"),
    markRejected: (txHash, owner) => move(txHash, owner, "rejected"),
    releaseClaim: (txHash, owner) => move(txHash, owner, undefined),
  };
}

/** The module of the two Cardano pairings on the configured network. */
export function cardanoModule(c: CardanoConfig, state: ModuleState): Module {
  const network = c.network as Network;
  if (c.reader.network !== c.network) throw new TypeError(`the Cardano reader serves ${c.reader.network}, not ${c.network}`);
  return {
    // Every output carries at least the ledger's smallest, so neither pairing takes zero.
    descriptor: { name: "cardano", key: "none", pairings: [exactCardano.id, exactCardanoLock.id], acceptsZero: [] },
    network,
    facilitator: new ExactCardanoScheme(c.signer, { settlementStore: settlementStore(state, c.network) }),
    record: {
      async instrument(p): Promise<Instrumented | Refused> {
        const ref = await checked(p);
        if (isRefusal(ref)) return { refused: reasonOf(ref) };
        const codec = codecOf(p);
        return {
          pairing: codec.id,
          // The id is the Blake2b-256 of the body; the witnesses are outside it.
          instrument: { by: "transaction", network, transaction: ref.txId.replace(/^0x/, "") },
          nonce: codec.data.nonce,
          // Its TTL is a slot, which no clock bounds from above.
          keep: { until: "settler" },
        };
      },
      // The position recorded at issue: the block the security parameter below the tip.
      async position() {
        const [tip, k] = await Promise.all([c.reader.tip(), c.reader.securityParam()]);
        return tip.blockHeight - k;
      },
      async read(p, at) {
        const ref = await checked(p);
        if (isRefusal(ref)) return outcomeOf({ state: "unreadable", reason: "unparseable", foreign: [] });
        const search = at.search as bigint | undefined;
        const after = at.from as bigint | undefined;
        return outcomeOf(
          await codecOf(p).status(ref, c.reader, {
            act: "payment",
            finality: await c.reader.securityParam(),
            ...(search === undefined ? {} : { search }),
            ...(after === undefined ? {} : { after }),
          }),
        );
      },
    },
    fees: {
      // The buyer's own transaction pays its fee; the module sends it and pays nothing.
      paysFee: () => false,
      payerBroadcast: () => false,
    },
  };
}

/** The module's start: one registration of `exact` per configured network, its guard in the module's state. */
export const starter: ModuleStarter<readonly CardanoConfig[]> = {
  name: "cardano",
  async start(config, core) {
    const registrations: Registration[] = config.map((c) => ({ network: c.network as Network, module: cardanoModule(c, core.state), own: [] }));
    return { registrations };
  },
};
