export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/**
 * Byte equality. NOT timing-safe, and does not need to be: an atrHash is a public value, published in
 * settlement transactions and discovery documents, so there is no secret for a timing side channel to leak.
 *
 * It lives here rather than in a rail package because `atrHashEquals` needs it and a rail is a leaf — the
 * only other implementation in the tree is module-private at `binding-stellar/src/mux.ts`, which `kernel`
 * could not import without inverting the tiers.
 */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Requires the lowercase 0x prefix exactly (pinned by the reject vectors — the same rule the harness decodeInput enforces); digits are any-case. */
export function hexToBytes(hex: string): Uint8Array {
  if (!hex.startsWith("0x")) throw new Error(`hex must be 0x-prefixed: ${hex}`);
  const h = hex.slice(2);
  if (h.length % 2 !== 0) throw new Error(`odd-length hex: ${hex}`);
  if (!/^[0-9a-fA-F]*$/.test(h)) throw new Error(`non-hex characters: ${hex}`);
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++)
    out[i] = Number.parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}
