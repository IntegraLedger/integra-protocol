/**
 * Ambient types for `@stellar/js-xdr` — an UNTYPED transitive of `@stellar/stellar-sdk` (its `lib/xdr.js`
 * ships no `.d.ts` and no `@types/stellar__js-xdr` exists on the registry). Because `skipLibCheck` is
 * `false` workspace-wide, the SDK's own `.d.ts` files (`base/index.d.ts`, `base/jsxdr.d.ts`,
 * `base/numbers/*.d.ts`) fail with TS7016 unless this module is declared. These declarations mirror the
 * four symbols the SDK re-exports; the adapter never touches js-xdr directly (it uses StrKey /
 * MuxedAccount / Horizon / typed classes only), so the surface here is intentionally minimal — enough to
 * satisfy the SDK's re-exports without leaking an `any`-typed value into this package's exports.
 */
declare module "@stellar/js-xdr" {
  export class XdrWriter {
    constructor(buffer?: Uint8Array);
    toArray(): Uint8Array;
  }
  export class XdrReader {
    constructor(buffer: Uint8Array);
    read(count: number): Uint8Array;
  }
  /** Base class the SDK's fixed-width XDR integers (Int128/UInt128/Int256/UInt256, XdrLargeInt.int) extend. */
  export class LargeInt {
    constructor(...parts: Array<bigint | number | string>);
    toBigInt(): bigint;
    toString(): string;
  }
  export class UnsignedHyper extends LargeInt {
    static fromString(value: string): UnsignedHyper;
  }
  export class Hyper extends LargeInt {
    static fromString(value: string): Hyper;
  }
}
