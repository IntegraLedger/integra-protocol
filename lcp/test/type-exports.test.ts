// The types the package's public signatures name are exported, each as a type from the entry point whose functions take
// or return it, so a caller can name what it is given. The API reference named these in signatures and defined none of
// them: `X402Read`, what every x402 pairing's `read` returns; `EvmMark` and `EvmQuery`, in the EVM reader and `status`
// signatures; `PresentedOn` and `Surface`, of which `Presented` is made; what MPP's `build` and `buildWithin` return;
// what a rail's `complete` returns; and `X402Advertise`, `XrplQuery`, `CasperRefRead` and `StarknetRefRead`. TypeScript
// checks each line here (`pnpm run typecheck`): a type no entry point exports does not import.
import { describe, expectTypeOf, it } from "vitest";
import { exactAptos, type AptosPaymentPayload, type AptosUnsigned, type X402Read } from "../src/aptos.js";
import { casperStatus, exactCasper, type CasperRefRead, type X402Advertise } from "../src/casper.js";
import type { EvmMark, EvmQuery } from "../src/evm.js";
import type { Presented, PresentedOn, Surface } from "../src/index.js";
import {
  chargeSolana,
  sessionXrpl,
  type HederaSessionUnsigned,
  type RailSessionUnsigned,
  type SessionWithinUnsigned,
  type SolanaChargeUnsigned,
  type XrplSessionUnsigned,
} from "../src/mpp.js";
import type { Refusal } from "../src/refusal.js";
import { starknetStatus, type StarknetRefRead } from "../src/starknet.js";
import type { SvmPaymentPayload } from "../src/x402-exact-solana.js";
import type { XrplPaymentPayload } from "../src/x402-exact-xrpl.js";
import { xrplChannelStatus, type XrplChannelRef, type XrplQuery } from "../src/xrpl.js";

describe("the types public signatures name", () => {
  it("are exported by the entry points whose functions take or return them", () => {
    expectTypeOf(exactAptos.read).returns.toEqualTypeOf<X402Read | Refusal>();
    expectTypeOf<ReturnType<AptosUnsigned["complete"]>>().toEqualTypeOf<AptosPaymentPayload | Refusal>();
    expectTypeOf(exactCasper.advertise).toEqualTypeOf<X402Advertise>();
    expectTypeOf(casperStatus).parameter(0).toEqualTypeOf<CasperRefRead>();
    expectTypeOf(starknetStatus).parameter(0).toEqualTypeOf<StarknetRefRead>();
    expectTypeOf(xrplChannelStatus).parameter(2).toEqualTypeOf<XrplQuery<XrplChannelRef>>();
    expectTypeOf(chargeSolana.build).returns.resolves.toEqualTypeOf<Refusal | SolanaChargeUnsigned>();
    expectTypeOf(sessionXrpl.build).returns.resolves.toEqualTypeOf<XrplSessionUnsigned | Refusal>();
    expectTypeOf(sessionXrpl.buildWithin).returns.resolves.toEqualTypeOf<SessionWithinUnsigned | Refusal>();
    expectTypeOf<HederaSessionUnsigned>().toMatchTypeOf<RailSessionUnsigned>();
    expectTypeOf<Presented>().toEqualTypeOf<PresentedOn[Surface]>();
    expectTypeOf<EvmQuery<unknown>["finality"]>().toEqualTypeOf<EvmMark>();
    expectTypeOf<SvmPaymentPayload>().toMatchTypeOf<Presented>();
    expectTypeOf<XrplPaymentPayload>().toMatchTypeOf<Presented>();
  });
});
