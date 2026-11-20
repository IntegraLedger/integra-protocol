// The TON, Concordium and Cardano modules through the settler's HTTP surface, against lcp's vectors for x402/exact/tvm,
// x402/exact/ccd and x402/exact/cardano: what each kind states, and lcp's refusals of each pairing's payment, answered
// before the published class is asked, with nothing read, signed or sent. Each class's own checks need node answers
// (an emulated trace, an account's keys, an input's snapshot) that no vector records, so the classes' success paths
// are held by the runs, not here.
import { readFileSync } from "node:fs";
import type { FacilitatorCardanoSigner } from "@x402/cardano";
import type { FacilitatorConcordiumSigner } from "@x402/concordium";
import type { Network, PaymentPayload, PaymentRequirements } from "@x402/core/types";
import type { FacilitatorTvmSigner } from "@x402/tvm";
import { afterEach, describe, expect, it } from "vitest";
import { serveSettler, type SettlerConfig } from "../src/core.js";
import { starter as cardano } from "../src/modules/cardano/index.js";
import { starter as concordium } from "../src/modules/concordium/index.js";
import { listed } from "../src/modules/index.js";
import { starter as ton } from "../src/modules/ton/index.js";
import { CREDENTIAL, serving, type Serving } from "./routes.js";

const read = (name: string) => JSON.parse(readFileSync(new URL(`../../lcp/vectors/${name}`, import.meta.url), "utf8"));
const TVM = read("x402-exact-tvm.json");
const CCD = read("x402-exact-ccd.json");
const ADA = read("x402-exact-cardano.json");
const LIST = [listed("cardano", async () => ({ starter: cardano })), listed("concordium", async () => ({ starter: concordium })), listed("ton", async () => ({ starter: ton }))] as const;
/** The seller's highload wallet in this test. */
const RELAY_WALLET = "0:3333333333333333333333333333333333333333333333333333333333333333";

let settler: Serving | undefined;
afterEach(async () => {
  await settler?.close();
  settler = undefined;
});

/** An object whose every method records its name and fails: a node boundary no call of these tests may reach. */
function untouched<T>(calls: string[], members: Record<string, unknown>): T {
  return new Proxy(members, {
    get(target, key) {
      if (typeof key === "string" && key in target) return target[key];
      return async () => {
        calls.push(String(key));
        throw new Error(`${String(key)} was called`);
      };
    },
  }) as T;
}

function signers(calls: string[]) {
  return {
    ton: untouched<FacilitatorTvmSigner>(calls, { getAddresses: () => [RELAY_WALLET], getAddressesForNetwork: () => [RELAY_WALLET] }),
    concordium: untouched<FacilitatorConcordiumSigner>(calls, { getAddress: () => CCD.fixed.sponsor, getNetwork: () => CCD.fixed.network }),
    cardano: untouched<FacilitatorCardanoSigner>(calls, { getAddresses: () => [] }),
  };
}

async function start(calls: string[]) {
  const s = signers(calls);
  const config: Partial<SettlerConfig> & Record<string, unknown> = {
    ton: [{ network: TVM.fixed.O.network, signer: s.ton, reader: untouched(calls, { network: TVM.fixed.O.network }) }],
    concordium: [{ network: CCD.fixed.network, signer: s.concordium, reader: untouched(calls, { network: CCD.fixed.network }) }],
    cardano: [{ network: ADA.fixed.O.network, signer: s.cardano, reader: untouched(calls, { network: ADA.fixed.O.network }) }],
  };
  settler = await serving((port, url) =>
    serveSettler({ listen: `127.0.0.1:${port}`, store: { url }, settleWaitMs: 3_000, credential: CREDENTIAL, operatorLog: () => {}, ...config } as never, LIST),
  );
}

/** A JSON Pointer (RFC 6901) into a vector file. */
function at(file: unknown, pointer: string): unknown {
  return pointer
    .split("/")
    .slice(1)
    .reduce((o: unknown, k) => (o as Record<string, unknown>)[k.replace(/~1/g, "/").replace(/~0/g, "~")], file);
}

const body = (p: PaymentPayload) => ({ x402Version: 2, paymentPayload: p, paymentRequirements: p.accepted });

/** Each file's boundAccepted rows: the file's payment presented under an option lcp's filter refuses. */
function boundAccepted(file: { boundAccepted: { payment?: unknown; rows: { payment?: string; accepted: PaymentRequirements }[] } }): PaymentPayload[] {
  return file.boundAccepted.rows.map((r) => {
    const p = (typeof r.payment === "string" ? at(file, r.payment) : file.boundAccepted.payment) as PaymentPayload;
    return { ...p, accepted: r.accepted };
  });
}

describe("the TON, Concordium and Cardano modules", () => {
  it("state the pairings each submits, its key and signer, and whether it takes zero", async () => {
    await start([]);
    const s = (await settler!.supported()) as { kinds: { network: Network; extra: Record<string, unknown> }[]; signers: Record<string, string[]> };
    const kind = (network: string) => s.kinds.find((k) => k.network === network)?.extra;
    expect(kind(TVM.fixed.O.network)).toEqual({ areFeesSponsored: true, key: "relayer", acceptsZero: ["x402/exact/tvm"], pairings: ["x402/exact/tvm"] });
    expect(kind(CCD.fixed.network)).toEqual({ feePayer: CCD.fixed.sponsor, key: "fee-payer", acceptsZero: ["x402/exact/ccd"], pairings: ["x402/exact/ccd"] });
    expect(kind(ADA.fixed.O.network)).toMatchObject({ key: "none", acceptsZero: [], pairings: ["x402/exact/cardano", "x402/exact/cardano/lock"] });
    expect([s.signers["tvm:*"], s.signers["ccd:*"]]).toEqual([[RELAY_WALLET], [CCD.fixed.sponsor]]);
  });

  it("refuse lcp's refusal vectors before the class reads, signs or sends anything", async () => {
    const calls: string[] = [];
    await start(calls);
    const tvm: PaymentPayload = TVM.V6.presented;
    const ada = (transactionBase64: string): PaymentPayload => ({ x402Version: 2, accepted: ADA.fixed.O, payload: { transaction: transactionBase64, nonce: ADA.fixed.nonce } });
    const payments: PaymentPayload[] = [
      ...boundAccepted(TVM),
      ...boundAccepted(CCD),
      // A row refused by the lock pairing alone, the lock's payment under the address method's option, is the address
      // pairing's payment to the module, which routes by the option's method: the class judges it.
      ...boundAccepted({
        ...ADA,
        boundAccepted: {
          ...ADA.boundAccepted,
          rows: ADA.boundAccepted.rows.filter((r: { pairing: string; accepted: PaymentRequirements }) => {
            const method = r.accepted.extra?.["assetTransferMethod"];
            return r.pairing === (method === "masumi" || method === "script" ? "x402/exact/cardano/lock" : "x402/exact/cardano");
          }),
        },
      }),
      // TON: a forward payload that is not H's comment, and the other refusals of V3.
      ...TVM.V3.refusals.map((r: { settlementBoc: string; accepted?: PaymentRequirements }) => ({
        ...tvm,
        ...(r.accepted === undefined ? {} : { accepted: r.accepted }),
        payload: { ...(tvm.payload as object), settlementBoc: r.settlementBoc },
      })),
      // Cardano: a body whose auxiliary data does not carry H, and V2 with its auxiliary data changed.
      ada(ADA.V3.transactionBase64),
      ada(ADA.plant.transactionBase64),
    ];
    for (const p of payments) {
      expect(await settler!.verify(body(p))).toMatchObject({ isValid: false });
      expect(await settler!.settle(body(p))).toMatchObject({ success: false, transaction: "" });
    }
    expect(calls).toEqual([]);
  });
});
