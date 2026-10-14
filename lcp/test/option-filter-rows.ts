// The option filter rows of six pairings, one option per arm: the pairing's fixed option from its vector file with one
// member changed. What each member must be comes from x402's scheme texts (x402-foundation/x402 at e95b06661e,
// specs/schemes/exact/scheme_exact_<rail>.md, and specs/x402-specification-v2.md's PaymentRequirements table: `amount` a
// string of atomic units, `maxTimeoutSeconds` a number) and, for Tron, the published profile
// (lcp/profiles/x402-exact-tron-lcp-trc20-memo.md rule 1); the refusal codes are the ones docs/reference/refusals.md
// lists for the pairing's option faults, and an option a filter does not serve is `x402/option-not-this-pairing`.
import { readFileSync } from "node:fs";
import type { AtrHash } from "../src/core.js";
import { exactCasper } from "../src/casper.js";
import { exactCcd } from "../src/ccd.js";
import { exactStarknet } from "../src/starknet.js";
import { exactTronMemo } from "../src/tron.js";
import { exactTvm } from "../src/tvm.js";
import { exactXrpl } from "../src/x402-exact-xrpl.js";
import type { PaymentRequired, PaymentRequirements } from "../src/x402.js";

export const H: AtrHash = "0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
export const LINK = "https://atr.seller.example/7c8acfa2-f800-4192-89e9-1cef9833180f";
export const NOT_THIS = "x402/option-not-this-pairing";

type Advertise = (doc: PaymentRequired, h: AtrHash, link: string, offer: PaymentRequirements) => unknown;
type Change = Record<string, unknown>;

const fixed = (file: string, path: string): PaymentRequirements =>
  path
    .split(".")
    .reduce<unknown>(
      (o, k) => (o as Record<string, unknown>)[k],
      JSON.parse(readFileSync(new URL(`../vectors/${file}.json`, import.meta.url), "utf8")),
    ) as PaymentRequirements;

/** The option with each path set to its value, or removed where the value is `undefined`. */
export function changed(o: PaymentRequirements, change: Change): PaymentRequirements {
  const copy = structuredClone(o) as Record<string, unknown>;
  for (const [path, value] of Object.entries(change)) {
    const keys = path.split(".");
    let at = copy;
    for (const k of keys.slice(0, -1)) at = at[k] as Record<string, unknown>;
    const last = keys[keys.length - 1]!;
    if (value === undefined) delete at[last];
    else at[last] = value;
  }
  return copy as PaymentRequirements;
}

export const doc = (o: PaymentRequirements): PaymentRequired => ({
  x402Version: 2,
  resource: { url: "https://api.seller.example/v1/quote" },
  accepts: [o],
});

export interface Rail {
  id: string;
  advertise: Advertise;
  option: PaymentRequirements;
  /** Each arm: what it requires, the change that breaks it, and `advertise`'s code for the changed option. */
  refused: readonly [arm: string, change: Change, code: string][];
  /** Options the filter serves, beside the fixed one: the root `pairingOf` names the pairing. */
  served?: readonly [arm: string, change: Change][];
}

export const RAILS: readonly Rail[] = [
  {
    // scheme_exact_concordium.md: the requirements example, "All amounts are expressed in the smallest unit (atomic)",
    // and `extra.feePayer`, the sponsor's account; a CCD or PLT amount is a u64 on Concordium.
    id: "x402/exact/ccd",
    advertise: exactCcd.advertise,
    option: fixed("x402-exact-ccd", "fixed.O"),
    refused: [
      ["scheme is exact", { scheme: "upto" }, NOT_THIS],
      ["network is a string", { network: ["ccd:4221332d34e1694168c2a0c0b3fd0f27"] }, NOT_THIS],
      ["asset is a string", { asset: 7 }, NOT_THIS],
      ["asset is a token symbol", { asset: "" }, NOT_THIS],
      ["extra is an object", { extra: undefined }, NOT_THIS],
      ["extra is an object, not null", { extra: null }, NOT_THIS],
      ["amount is a string", { amount: 1000000 }, NOT_THIS],
      ["amount is decimal digits", { amount: "1.5" }, NOT_THIS],
      ["amount is below 2^64", { amount: "18446744073709551616" }, NOT_THIS],
      ["maxTimeoutSeconds is an integer", { maxTimeoutSeconds: 1.5 }, NOT_THIS],
      ["maxTimeoutSeconds is positive", { maxTimeoutSeconds: 0 }, NOT_THIS],
    ],
    served: [["amount 2^64 - 1", { amount: "18446744073709551615" }]],
  },
  {
    // scheme_exact_casper.md "PaymentRequirements": `asset` the 32-byte hex package hash, `amount` a decimal string,
    // `extra.name` and `extra.version` required (the CEP-3009 domain's name and version).
    id: "x402/exact/casper",
    advertise: exactCasper.advertise,
    option: fixed("x402-exact-casper", "fixed.O"),
    refused: [
      ["scheme is exact", { scheme: "upto" }, NOT_THIS],
      ["asset is 32 bytes of hex", { asset: "17be3c3dc67ddf193b8f64bfc2421826407470f88b3dab68184ebffebdd57f" }, NOT_THIS],
      ["amount is a decimal string", { amount: "7.5" }, NOT_THIS],
      ["extra.name is present", { "extra.name": undefined }, NOT_THIS],
      ["extra.name is not empty", { "extra.name": "" }, NOT_THIS],
      ["maxTimeoutSeconds is an integer", { maxTimeoutSeconds: 1.5 }, NOT_THIS],
      ["maxTimeoutSeconds is positive", { maxTimeoutSeconds: 0 }, NOT_THIS],
    ],
  },
  {
    // scheme_exact_starknet.md: the `starknet:SN_MAIN` and `starknet:SN_SEPOLIA` networks, `extra.feePayer` required (the
    // SNIP-9 Caller), `asset` the token contract; the requirements follow the core v2 schema.
    id: "x402/exact/starknet",
    advertise: exactStarknet.advertise,
    option: fixed("x402-exact-starknet", "fixed.O"),
    refused: [
      ["scheme is exact", { scheme: "upto" }, NOT_THIS],
      ["network is starknet:", { network: "cosmos:cosmoshub-4" }, NOT_THIS],
      ["extra is an object", { extra: 5 }, "starknet/option-malformed"],
      ["paymentFlow is authorization", { "extra.paymentFlow": "upfront" }, NOT_THIS],
      ["asset is a felt", { asset: "0xzz" }, "starknet/felt-malformed"],
      ["extra.feePayer is present", { "extra.feePayer": undefined }, "starknet/felt-malformed"],
      ["extra.feePayer is a felt", { "extra.feePayer": "feePayer" }, "starknet/felt-malformed"],
      ["maxTimeoutSeconds is an integer", { maxTimeoutSeconds: 1.5 }, "starknet/option-malformed"],
      ["maxTimeoutSeconds is at least 1", { maxTimeoutSeconds: 0 }, "starknet/option-malformed"],
    ],
    served: [["paymentFlow authorization", { "extra.paymentFlow": "authorization" }]],
  },
  {
    // scheme_exact_ton.md: the `tvm:-239` and `tvm:-3` networks, `asset` and `payTo` in raw form (`workchain:hex`),
    // `extra.responseDestination` a TON address, `extra.areFeesSponsored` true.
    id: "x402/exact/tvm",
    advertise: exactTvm.advertise,
    option: fixed("x402-exact-tvm", "fixed.O"),
    refused: [
      ["scheme is exact", { scheme: "upto" }, NOT_THIS],
      ["network is tvm:", { network: "cosmos:cosmoshub-4" }, NOT_THIS],
      ["extra is an object when present", { extra: 5 }, "tvm/option-malformed"],
      [
        "extra is an object when present, read before the network id",
        { extra: 5, network: "tvm:9999999999999999" },
        "tvm/option-malformed",
      ],
      ["the network id is a safe integer", { network: "tvm:9999999999999999" }, "tvm/network-malformed"],
      ["asset is a raw address", { asset: "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs" }, "tvm/option-malformed"],
      ["extra.responseDestination is a raw address", { "extra.responseDestination": "0:zz" }, "tvm/option-malformed"],
    ],
    served: [
      ["a raw responseDestination", { "extra.responseDestination": "0:92433a576cbe56c4dcc86d94b497a2cf18a9baa9c8283fea28ea43eb3c25cfed" }],
    ],
  },
  {
    // The profile's rule 1: an `exact` option on a `tron:` network with `extra.assetTransferMethod` lcp-trc20-memo,
    // `asset` and `payTo` in base58check (version byte 0x41), and `maxTimeoutSeconds` an integer; the flow is
    // authorization or upfront. A network reference is a decimal chain id with no leading zero.
    id: "x402/exact/tron/lcp-trc20-memo",
    advertise: exactTronMemo.advertise,
    option: fixed("x402-exact-tron-lcp-trc20-memo", "fixed.O"),
    refused: [
      ["scheme is exact", { scheme: "upto" }, NOT_THIS],
      ["network is a string", { network: 728126428 }, NOT_THIS],
      ["network is tron:", { network: "eip155:8453" }, NOT_THIS],
      ["extra is an object", { extra: undefined }, NOT_THIS],
      ["the network id has no leading zero", { network: "tron:01" }, "tron/network-malformed"],
      ["the network id is a safe integer", { network: "tron:9007199254740993" }, "tron/network-malformed"],
      ["asset is base58check", { asset: "0xa614f803B6FD780986A42c78Ec9c7f77e6DeD13C" }, "tron/address-malformed"],
      ["asset's first byte is 0x41", { asset: "1BoatSLRHtKNngkdXEeobR76b53LETtpyT" }, "tron/address-malformed"],
      ["maxTimeoutSeconds is an integer", { maxTimeoutSeconds: 1.5 }, "tron/option-malformed"],
    ],
    served: [
      ["paymentFlow authorization", { "extra.paymentFlow": "authorization" }],
      ["paymentFlow upfront", { "extra.paymentFlow": "upfront" }],
    ],
  },
  {
    // scheme_exact_xrpl.md: "`PaymentRequirements.extra.areFeesSponsored` MUST be present and MUST be `false`";
    // `extra.assetTransferMethod` is `sequence` or `ticketSequence`; the example's `invoiceId` is a string.
    id: "x402/exact/xrpl",
    advertise: exactXrpl.advertise,
    option: fixed("x402-exact-xrpl", "fixed.option"),
    refused: [
      ["areFeesSponsored is false", { "extra.areFeesSponsored": true }, NOT_THIS],
      ["areFeesSponsored is present", { "extra.areFeesSponsored": undefined }, NOT_THIS],
      ["assetTransferMethod is sequence or ticketSequence", { "extra.assetTransferMethod": "permit2" }, NOT_THIS],
      ["invoiceId is a string", { "extra.invoiceId": 7 }, NOT_THIS],
    ],
    served: [
      ["assetTransferMethod sequence", { "extra.assetTransferMethod": "sequence" }],
      ["assetTransferMethod ticketSequence", { "extra.assetTransferMethod": "ticketSequence" }],
      ["a string invoiceId", { "extra.invoiceId": "INV-2025-001" }],
    ],
  },
];

/** Every option the rows hold, each with what it is: each rail's fixed option, each refused arm's and each served arm's. */
export function railOptions(): [what: string, option: PaymentRequirements][] {
  return RAILS.flatMap((rail) => [
    [`${rail.id}: the fixed option`, rail.option] as [string, PaymentRequirements],
    ...rail.refused.map(([arm, change]) => [`${rail.id}: ${arm}, broken`, changed(rail.option, change)] as [string, PaymentRequirements]),
    ...(rail.served ?? []).map(([arm, change]) => [`${rail.id}: ${arm}`, changed(rail.option, change)] as [string, PaymentRequirements]),
  ]);
}
