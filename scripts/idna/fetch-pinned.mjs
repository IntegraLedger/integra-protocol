// A download pinned by its SHA-256: the bytes at a URL, fetched in up to six attempts (the first and five retries,
// after 1, 2, 4, 8 and 16 s, whatever the error), and returned only when their SHA-256 is the pinned one.
import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

/** The attempts at one download: a network error or an answer other than 2xx starts the next. */
const ATTEMPTS = 6;

/** An error's message, with the code or message of its cause (fetch reports a reset connection as its cause). */
function reason(e) {
  const cause = e?.cause?.code ?? e?.cause?.message;
  return cause ? `${e.message}: ${cause}` : String(e?.message ?? e);
}

/**
 * The bytes at `url`, when their SHA-256 is `sha256` (lowercase hex). Throws, naming the URL, when every attempt fails
 * or when the bytes have another SHA-256.
 */
export async function fetchPinned(url, sha256) {
  let bytes;
  for (let attempt = 1; bytes === undefined; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`HTTP ${response.status}`);
      }
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch (e) {
      if (attempt === ATTEMPTS) {
        throw new Error(`${url}: ${ATTEMPTS} attempts failed, the last with ${reason(e)}`, { cause: e });
      }
      const wait = 2 ** (attempt - 1);
      console.error(`${url}: attempt ${attempt} of ${ATTEMPTS} failed with ${reason(e)}; the next in ${wait} s`);
      await sleep(wait * 1000);
    }
  }
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== sha256) throw new Error(`${url} has SHA-256 ${digest}, not the pinned ${sha256}`);
  return bytes;
}
