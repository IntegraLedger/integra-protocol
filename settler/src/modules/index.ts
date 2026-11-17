/**
 * The settler's modules, one line each in the order of their names, a blank line between two: the module's name, which
 * is also the member of the configuration that starts it, and the import of its folder, which exports the module's
 * `starter`. A module is imported only where the configuration names it. A line stays commented until its module is
 * built.
 */
import type { ModuleName, ModuleStarter } from "../module.js";

/** One module of the list: its name, and the import of its starter. */
export interface Listed<N extends ModuleName = ModuleName, C = never> {
  readonly name: N;
  load(): Promise<ModuleStarter<C>>;
}

/** A module's line: its name, and the import of its folder, whose `starter` is the module's. */
export function listed<N extends ModuleName, C>(
  name: N,
  load: () => Promise<{ readonly starter: ModuleStarter<C> }>,
): Listed<N, C> {
  return { name, load: async () => (await load()).starter };
}

export const MODULES = [
  listed("algorand", () => import("./algorand/index.js")),

  listed("aptos", () => import("./aptos/index.js")),

  listed("cardano", () => import("./cardano/index.js")),

  listed("casper", () => import("./casper/index.js")),

  listed("concordium", () => import("./concordium/index.js")),

  listed("erc7710", () => import("./erc7710/index.js")),

  listed("evm", () => import("./evm/index.js")),

  listed("hedera", () => import("./hedera/index.js")),

  listed("lnbtc", () => import("./lnbtc/index.js")),

  listed("near", () => import("./near/index.js")),

  listed("polkadot", () => import("./polkadot/index.js")),

  listed("solana", () => import("./solana/index.js")),

  listed("starknet", () => import("./starknet/index.js")),

  listed("stellar", () => import("./stellar/index.js")),

  listed("sui", () => import("./sui/index.js")),

  listed("ton", () => import("./ton/index.js")),

  listed("tron", () => import("./tron/index.js")),

  listed("xrpl", () => import("./xrpl/index.js")),
] as const satisfies readonly Listed<ModuleName, never>[];

/** The configuration a listed module's starter takes. */
export type ConfigOf<L> = L extends Listed<ModuleName, infer C> ? C : never;

/** The configuration's members that start modules: one per listed module, named for it. */
export type ModulesConfig<List extends readonly Listed<ModuleName, never>[] = typeof MODULES> = {
  readonly [L in List[number] as L["name"]]?: ConfigOf<L>;
};
