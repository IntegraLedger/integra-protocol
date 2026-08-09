/** Where a settlement lives, at the coarsest granularity every rail can express. `txHash` and `logIndex`
 *  are OPTIONAL because not every rail has them: a Canton exercise or an XRPL transaction is addressed
 *  differently, and each adapter narrows this shape to what its own reader needs. `chainId` is a number
 *  by EVM inheritance; non-EVM adapters assign their own stable network numbering in `constants.ts`. */
export type SettlementRef = {
  chainId: number;
  txHash?: `0x${string}`;
  logIndex?: number;
};
/** One observed state change on a settlement, as `observe` reports it. `state` is a free string drawn from
 *  the binding's own `lifecycleStates` — the sets differ per rail and LCP does not unify them — and `at`
 *  is CHAIN time, not wall-clock, so it is only ordered within a chain. */
export type LifecycleTransition = {
  state: string;
  at: bigint /* chain time */;
  ref: SettlementRef;
};
/** The read-only chain access an adapter is given. Deliberately four primitives and no client: the port is
 *  chain-library-agnostic (`unknown` in, `unknown` out) so binding-core depends on no chain SDK, and the
 *  imperative shell — `binding-evm-common` for EVM, each rail's own `makeXxxReader` otherwise — is what
 *  supplies a typed implementation. There is no write side; a `WeldAdapter` never sends a transaction. */
export interface ChainReader {
  /** Range/topic query — `eth_getLogs`. Used for forward enumeration by an indexed value (a nonce topic). */
  getLogs(q: unknown): Promise<unknown[]>;
  /** The logs emitted by ONE settlement transaction — `eth_getTransactionReceipt().logs`. `eth_getLogs`
   *  has no transaction filter, so recovering an atrHash from a specific settlement (or mapping its
   *  lifecycle) needs this primitive; the range query cannot do it. Consumed by every adapter's
   *  `recover`/`observe` and by `verify`'s walk. Returns `unknown[]` — the viem `Log[]`
   *  the imperative shell (binding-evm-common) supplies; binding-core stays chain-library-agnostic. */
  getTransactionLogs(ref: SettlementRef): Promise<unknown[]>;
  readContract(c: unknown): Promise<unknown>;
  blockTime(ref: SettlementRef): Promise<bigint>;
}
/** Fetches an off-chain artifact — an ATR file, an evidence bundle — by reference. `null` means "not
 *  found", and the verification walk treats that as a GAP rather than a failure: an absent input never
 *  proves. Resolving `ipfs:`/`ar:`/`https:` is the caller's business; this port takes no view. */
export interface ArtifactResolver {
  resolve(ref: string): Promise<Uint8Array | null>;
}
/** The two ports an adapter's `observe`/`recover`/`enumerate` are handed. Constructing this pair is the
 *  caller's job, and it is the whole of the I/O surface — everything else in a binding is pure. */
export type VerifierPorts = { chain: ChainReader; artifacts: ArtifactResolver };
