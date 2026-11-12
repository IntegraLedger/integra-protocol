import type { PairingData } from "../registry.js";

/** A family's pairings' data, keyed by pairing id. */
export type Pairings<K extends string> = { readonly [id in K]: PairingData };

/** The family's data, every object and array in it frozen; its ids stay literal keys. */
export function freeze<K extends string>(data: Pairings<K>): Pairings<K> {
  const deep = (v: unknown): void => {
    if (typeof v !== "object" || v === null || Object.isFrozen(v)) return;
    for (const x of Object.values(v)) deep(x);
    Object.freeze(v);
  };
  deep(data);
  return data;
}
