import { bytesToHex } from "./hex.js";

/** One-shot SHA-256 over exact bytes, lowercase hex (no 0x). Streaming digests are a shell concern. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return bytesToHex(new Uint8Array(digest));
}
