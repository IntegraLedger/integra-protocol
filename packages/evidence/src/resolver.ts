/**
 * The default `ArtifactResolver` (binding-core port) over a hardened fetch. Artifacts are fetched as
 * plaintext bytes and content-addressed — hash-is-identity. SSRF ship-gate (LCP §12): HTTPS-only,
 * **per-redirect-hop re-validation** (manual redirects — each hop's host is re-checked, so a same-origin
 * first hop cannot redirect into the private range), a **unicast-only IP filter** (every resolved IP must
 * be public; loopback/private/link-local/ULA/unspecified are refused — over both families, and for a
 * bracketed IPv6 literal host as much as a resolved name), and **byte + time caps**. The time cap is ONE
 * budget for the whole `resolve()` — the name lookups included, which is where it used to leak — carried
 * as a single `AbortSignal` through every hop; the body read is bounded by that same signal reaching the
 * transport, so an injected `fetchImpl` that ignores it is bounded only by the byte cap.
 *
 * **HONEST LIMITATION — DNS rebinding (not yet closed):** the unicast filter validates the addresses
 * `lookupImpl` returns, but the subsequent `fetch` performs its OWN DNS resolution and nothing pins the
 * connection to the validated IP — so an attacker-controlled name with a sub-second TTL can pass a public
 * IP to the check and serve a private IP to the connection moments later (a classic check-then-connect
 * TOCTOU). The filter is therefore real **defense-in-depth** (it blocks the naive "name → private IP"
 * case outright), NOT a complete unicast guarantee. Closing it requires connection-level IP pinning (an
 * undici dispatcher, or `node:https` with a `lookup` that returns only the validated address); that lands
 * once the resolver is wired into a live verify walk, where the fetch path goes live. `verify()` itself
 * takes `atrBytes` directly, so it opens no fetch path of its own.
 *
 * **Workers caveat (LCP §12):** the unicast IP check is socket-level and unavailable on Cloudflare Workers —
 * a Workers deployment relies on the platform's own private-range egress blocking and still enforces the
 * per-hop re-check + byte/time caps. Stated, not assumed (`createHardenedResolver` runs on Node here).
 */
import type { ArtifactResolver } from "@integraledger/lcp-binding-core";

/** A resolver refusal, carrying a stable `code`. Every one is a REFUSAL TO FETCH under the LCP §12 SSRF
 *  gate — a non-HTTPS scheme, a host resolving into a private range, too many redirect hops, a response
 *  over the byte cap, a bodyless response, a timeout — never a transport hiccup. Compare the `code`, not
 *  the message. */
export class ResolverError extends Error {
  // Declared-and-assigned, not a `public readonly` constructor parameter: parameter properties are
  // TypeScript-only syntax that cannot be erased, and the workspace compiles under `erasableSyntaxOnly`.
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "ResolverError";
  }
}

/** Tuning for the hardened resolver. Every field is optional and the defaults are the shipped posture;
 *  `fetchImpl`/`lookupImpl` exist so tests can drive the SSRF gate without a network, and substituting
 *  either in production replaces the gate's own view of where a host points. */
export interface HardenedResolverOptions {
  /** Max response size before abort. Default 1 MiB (the raw-block ceiling — artifacts above it break CID == atrHash). */
  maxBytes?: number;
  /** Time budget in ms for the WHOLE `resolve()` call — every name lookup and every redirect hop inside
   *  it, not one budget each. Default 10s. */
  timeoutMs?: number;
  /** Max redirect hops (each re-validated). Default 5. */
  maxRedirects?: number;
  /** Injected fetch (tests). Default global fetch. */
  fetchImpl?: typeof fetch;
  /** Injected DNS lookup (tests). Default node:dns/promises lookup. */
  lookupImpl?: (host: string) => Promise<{ address: string; family: number }[]>;
}

const DEFAULT_MAX_BYTES = 1_048_576;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_REDIRECTS = 5;

const V4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/**
 * Strip the brackets WHATWG `URL` puts around an IPv6 literal host: `new URL("https://[::1]/").hostname`
 * is `"[::1]"`, not `"::1"`. Both exported predicates are fed straight from `url.hostname` — here and by
 * buyer-side fetchers — so the bracketed form is the ordinary input, not an edge case.
 */
function unbracket(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

/** IP family of `ip` (4, 6, or 0 if not an IP) — hand-rolled so the pure guard stays runtime-neutral (no node:net). */
export function ipKind(ip: string): 0 | 4 | 6 {
  const host = unbracket(ip);
  if (V4_RE.test(host)) return 4;
  // A colon means IPv6 (possibly IPv4-mapped `::ffff:a.b.c.d`); good enough for the SSRF guard.
  if (host.includes(":")) return 6;
  return 0;
}

/** Is `ip` a public unicast address? Rejects loopback/private/link-local/ULA/unspecified (SSRF guard). */
export function isUnicastPublic(ip: string): boolean {
  const host = unbracket(ip);
  const kind = ipKind(host);
  if (kind === 4) return isPublicV4(host);
  if (kind === 6) return isPublicV6(host.toLowerCase());
  return false;
}

function isPublicV4(ip: string): boolean {
  const parts = ip.split(".").map((p) => Number.parseInt(p, 10));
  if (
    parts.length !== 4 ||
    parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)
  )
    return false;
  const [a, b] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return false; // unspecified, private, loopback
  if (a === 169 && b === 254) return false; // link-local
  if (a === 172 && b >= 16 && b <= 31) return false; // private
  if (a === 192 && b === 168) return false; // private
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  if (a >= 224) return false; // multicast / reserved
  return true;
}

/**
 * Expand an IPv6 literal to its eight 16-bit groups, or `null` if it is not a well-formed address.
 * Matching on the textual prefix cannot do this job: `fe80::/10` runs to `febf`, an IPv4-mapped address
 * is equally valid written `::ffff:7f00:1`, and `0:0:0:0:0:0:0:1` is `::1` spelled out. Every one of those
 * has to reduce to the same numbers before any range test is meaningful.
 */
function parseV6(ip: string): number[] | null {
  // Rewrite a trailing dotted quad into two hex groups so the rest parses uniformly.
  let text = ip;
  const dotted = /^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(ip);
  if (dotted !== null) {
    // The regex already fixed these as 1-3 digits, so only the RANGE can still be wrong — no NaN or
    // negative is reachable here, and guarding for them would be unreachable code.
    const o = (dotted[2] as string)
      .split(".")
      .map((p) => Number.parseInt(p, 10));
    if (o.some((n) => n > 255)) return null;
    const hi = ((o[0] as number) << 8) | (o[1] as number);
    const lo = ((o[2] as number) << 8) | (o[3] as number);
    text = `${dotted[1]}${hi.toString(16)}:${lo.toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const toGroups = (s: string): number[] | null => {
    if (s === "") return [];
    const out: number[] = [];
    for (const g of s.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      out.push(Number.parseInt(g, 16));
    }
    return out;
  };
  const head = toGroups(halves[0] as string);
  if (head === null) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const tail = toGroups(halves[1] as string);
  if (tail === null) return null;
  const gap = 8 - head.length - tail.length;
  if (gap < 1) return null; // `::` must stand for at least one zero group
  return [...head, ...new Array<number>(gap).fill(0), ...tail];
}

/** Render two 16-bit groups as the dotted quad they embed, for delegation to the v4 guard. */
function v4From(hi: number, lo: number): string {
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

function isPublicV6(ip: string): boolean {
  const g = parseV6(ip);
  if (g === null) return false; // fail closed: unparseable is not public
  const top = g[0] as number;
  const zeroPrefix = g.slice(0, 5).every((x) => x === 0);
  // IPv4-mapped `::ffff:0:0/96` and IPv4-compatible `::/96` are v4 addresses wearing an IPv6 costume —
  // and that also settles `::` and `::1`, which delegate as 0.0.0.0 and 0.0.0.1 and are refused there.
  if (zeroPrefix && (g[5] === 0xffff || g[5] === 0))
    return isPublicV4(v4From(g[6] as number, g[7] as number));
  // NAT64 `64:ff9b::/96` and 6to4 `2002::/16` likewise embed a v4 address the v4 guard must judge.
  if (top === 0x0064 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0))
    return isPublicV4(v4From(g[6] as number, g[7] as number));
  if (top === 0x2002) return isPublicV4(v4From(g[1] as number, g[2] as number));
  if ((top & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local — runs to febf, not just fe80
  if ((top & 0xffc0) === 0xfec0) return false; // fec0::/10 deprecated site-local
  if ((top & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
  if ((top & 0xff00) === 0xff00) return false; // ff00::/8 multicast
  return true;
}

/**
 * Settle `work` under `signal`, or refuse the moment the budget expires.
 *
 * ⛔ A promise cannot be cancelled, and a DNS lookup is the plainest example: `dns.lookup` takes as long
 * as the resolver takes and accepts no signal. `AbortSignal.timeout` passed to `fetch` therefore bounds
 * the REQUEST and nothing before it, which is how a resolver with `timeoutMs: 50` was measured still
 * hanging at 1500 ms — the stated bound was not the real one. Racing the signal makes the caller's budget
 * cover the wait even where the work underneath it keeps running.
 */
function underBudget<T>(
  work: Promise<T>,
  signal: AbortSignal,
  what: string,
  timeoutMs: number,
): Promise<T> {
  const expired = new ResolverError(
    "resolver/timeout",
    `${what} exceeded the ${timeoutMs}ms budget for the whole resolve`,
  );
  // An already-spent budget is the second hop of a redirect chain that used it all up on the first.
  // `addEventListener` would never fire for an abort that has already happened.
  if (signal.aborted) return Promise.reject(expired);
  return new Promise<T>((resolve, reject) => {
    // No listener teardown: the signal is created per `resolve()` and dropped with it, so at most one
    // listener per hop exists and only for as long as the call does. Removing it would be ceremony no
    // behaviour can distinguish, and a settled promise ignores a later `reject`.
    signal.addEventListener("abort", () => reject(expired));
    work.then(resolve, reject);
  });
}

/** Assert an HTTPS URL whose host resolves only to public unicast addresses; throws on any violation.
 *  The lookup runs under the caller's `signal` — the budget starts before the first name is resolved,
 *  not after. */
async function assertFetchable(
  urlStr: string,
  lookupImpl: NonNullable<HardenedResolverOptions["lookupImpl"]>,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    throw new ResolverError("resolver/bad-url", `malformed URL: ${urlStr}`);
  }
  if (url.protocol !== "https:")
    throw new ResolverError(
      "resolver/not-https",
      `URL must be HTTPS: ${urlStr}`,
    );
  // A literal IP host is checked directly; a name is resolved and EVERY address must be public unicast.
  const kind = ipKind(url.hostname);
  const addrs =
    kind !== 0
      ? [{ address: url.hostname, family: kind }]
      : await underBudget(
          lookupImpl(url.hostname),
          signal,
          `DNS lookup for ${url.hostname}`,
          timeoutMs,
        );
  if (addrs.length === 0)
    throw new ResolverError(
      "resolver/no-address",
      `no address for ${url.hostname}`,
    );
  for (const { address } of addrs)
    if (!isUnicastPublic(address))
      throw new ResolverError(
        "resolver/non-unicast",
        `${url.hostname} resolves to a non-public address (${address}) — refused (SSRF guard)`,
      );
  return url;
}

/**
 * Read a response body under the byte cap, refusing the moment it is exceeded rather than after.
 *
 * ⛔ A successful response with NO body is refused, not read as zero bytes. A 204 says "no content";
 * `new Uint8Array(0)` says "the artifact is empty", and the caller then hashes that into
 * `e3b0c442…` and reports an artifact that does not match its reference — "could not read it" arriving
 * dressed as "does not verify". A genuinely empty artifact is a different thing and still works: an empty
 * body is a stream that ends immediately, not an absent one.
 */
async function readCapped(
  res: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  const body = res.body;
  if (body === null)
    throw new ResolverError(
      "resolver/no-body",
      `${res.status} carried no body — that is an absent artifact, not an empty one`,
    );
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new ResolverError(
        "resolver/oversize",
        `response exceeds the ${maxBytes}B cap`,
      );
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** Build the hardened `ArtifactResolver`. `resolve(url)` returns the bytes, or `null` on 404. */
export function createHardenedResolver(
  options: HardenedResolverOptions = {},
): ArtifactResolver {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const doFetch = options.fetchImpl ?? fetch;
  // node:dns is imported lazily so the eager module graph stays runtime-neutral (car/cid/manifest are
  // Workers-importable). A Workers deployment injects its own lookupImpl (or skips the Node resolver).
  const doLookup =
    options.lookupImpl ??
    (async (host: string) => {
      const dns = await import("node:dns/promises");
      return dns.lookup(host, { all: true });
    });

  return {
    async resolve(ref: string): Promise<Uint8Array | null> {
      // ONE budget for the whole call, opened before the first name is looked up. A signal minted per
      // fetch bounded neither the lookup ahead of it nor the chain around it: `timeoutMs` × (hops + 1)
      // was the real ceiling, and the DNS wait sat outside even that.
      const signal = AbortSignal.timeout(timeoutMs);
      let current = ref;
      for (let hop = 0; hop <= maxRedirects; hop++) {
        // per-hop re-validation, under the one budget
        const url = await assertFetchable(current, doLookup, signal, timeoutMs);
        const res = await doFetch(url.toString(), {
          redirect: "manual",
          signal,
        });
        if (res.status === 404) return null;
        if (res.status >= 300 && res.status < 400) {
          const location = res.headers.get("location");
          if (location === null)
            throw new ResolverError(
              "resolver/bad-redirect",
              "redirect without a Location",
            );
          current = new URL(location, url).toString(); // resolve relative, re-check next iteration
          continue;
        }
        if (!res.ok)
          throw new ResolverError(
            "resolver/http",
            `fetch failed: ${res.status} ${url.toString()}`,
          );
        return readCapped(res, maxBytes);
      }
      throw new ResolverError(
        "resolver/too-many-redirects",
        `exceeded ${maxRedirects} redirects`,
      );
    },
  };
}
