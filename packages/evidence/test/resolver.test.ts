import { describe, expect, it } from "vitest";
import { createHardenedResolver, isUnicastPublic } from "../src/resolver.js";

describe("isUnicastPublic (SSRF IP guard)", () => {
  it.each([
    ["8.8.8.8", true],
    ["1.1.1.1", true],
    ["10.0.0.1", false],
    ["10.255.255.255", false],
    ["172.16.0.1", false],
    ["172.31.255.255", false],
    ["172.32.0.1", true],
    ["192.168.1.1", false],
    ["127.0.0.1", false],
    ["169.254.169.254", false],
    ["100.64.0.1", false],
    ["0.0.0.0", false],
    ["224.0.0.1", false],
    ["::1", false],
    ["::", false],
    ["fe80::1", false],
    ["fc00::1", false],
    ["fd12:3456::1", false],
    ["2606:4700:4700::1111", true],
    ["::ffff:10.0.0.1", false],
    ["not-an-ip", false],
    ["example.com", false],
  ] as const)("%s -> %s", (ip, expected) => {
    expect(isUnicastPublic(ip)).toBe(expected);
  });
});

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

describe("createHardenedResolver", () => {
  it("returns bytes for an HTTPS URL resolving to a public unicast host", async () => {
    const bytes = new TextEncoder().encode("payload");
    const resolver = createHardenedResolver({
      lookupImpl: publicLookup,
      fetchImpl: async () => new Response(bytes, { status: 200 }),
    });
    const got = await resolver.resolve("https://example.com/a");
    expect(got).not.toBeNull();
    expect(new TextDecoder().decode(got as Uint8Array)).toBe("payload");
  });

  it("returns null on 404", async () => {
    const resolver = createHardenedResolver({
      lookupImpl: publicLookup,
      fetchImpl: async () => new Response(null, { status: 404 }),
    });
    expect(await resolver.resolve("https://example.com/missing")).toBeNull();
  });

  it("refuses a non-HTTPS URL (fail-loud)", async () => {
    const resolver = createHardenedResolver({
      lookupImpl: publicLookup,
      fetchImpl: async () => new Response(),
    });
    await expect(resolver.resolve("http://example.com/a")).rejects.toThrow(
      /HTTPS/,
    );
  });

  it("refuses a host that resolves to a private address", async () => {
    const resolver = createHardenedResolver({
      lookupImpl: async () => [{ address: "10.0.0.5", family: 4 }],
      fetchImpl: async () => new Response(),
    });
    await expect(
      resolver.resolve("https://internal.example/a"),
    ).rejects.toThrow(/non-public|SSRF/);
  });

  it("re-validates every redirect hop — a redirect into the private range is refused", async () => {
    let hop = 0;
    const resolver = createHardenedResolver({
      // first host public, redirect target resolves private
      lookupImpl: async (host: string) =>
        host === "evil.example"
          ? [{ address: "169.254.169.254", family: 4 }]
          : [{ address: "93.184.216.34", family: 4 }],
      fetchImpl: async () => {
        hop++;
        return hop === 1
          ? new Response(null, {
              status: 302,
              headers: { location: "https://evil.example/meta" },
            })
          : new Response(new TextEncoder().encode("secret"), { status: 200 });
      },
    });
    await expect(resolver.resolve("https://good.example/a")).rejects.toThrow(
      /non-public|SSRF/,
    );
  });

  it("enforces the byte cap", async () => {
    const resolver = createHardenedResolver({
      maxBytes: 8,
      lookupImpl: publicLookup,
      fetchImpl: async () => new Response(new Uint8Array(64), { status: 200 }),
    });
    await expect(resolver.resolve("https://example.com/big")).rejects.toThrow(
      /cap/,
    );
  });

  // The rest of the redirect/status loop. Each of these is a distinct outcome a counterparty's artifact
  // host can produce at will, and each was unexercised — the loop could return the wrong one silently.

  it("refuses a host that resolves to NO address", async () => {
    // An empty answer is not "no restriction" — nothing was validated, so nothing may be fetched.
    const resolver = createHardenedResolver({
      lookupImpl: async () => [],
      fetchImpl: async () => {
        throw new Error("must not fetch a host that resolved to nothing");
      },
    });
    await expect(resolver.resolve("https://example.com/a")).rejects.toThrow(
      /no address/,
    );
  });

  it("refuses a redirect carrying no Location header", async () => {
    const resolver = createHardenedResolver({
      lookupImpl: publicLookup,
      fetchImpl: async () => new Response(null, { status: 302 }),
    });
    await expect(resolver.resolve("https://example.com/a")).rejects.toThrow(
      /Location/,
    );
  });

  it("throws on a non-ok status that is neither 404 nor a redirect", async () => {
    // 500 is not "absent" — returning null here would report a missing artifact for a server fault.
    const resolver = createHardenedResolver({
      lookupImpl: publicLookup,
      fetchImpl: async () => new Response(null, { status: 500 }),
    });
    await expect(resolver.resolve("https://example.com/a")).rejects.toThrow(
      /500/,
    );
  });

  it("stops at the redirect ceiling rather than following forever", async () => {
    let hops = 0;
    const resolver = createHardenedResolver({
      maxRedirects: 3,
      lookupImpl: publicLookup,
      fetchImpl: async () => {
        hops++;
        return new Response(null, {
          status: 302,
          headers: { location: "https://example.com/next" },
        });
      },
    });
    await expect(resolver.resolve("https://example.com/a")).rejects.toThrow(
      /redirect/,
    );
    expect(hops).toBe(4); // the initial fetch plus 3 permitted redirects
  });

  it("resolves a RELATIVE Location against the current hop", async () => {
    const seen: string[] = [];
    const resolver = createHardenedResolver({
      lookupImpl: publicLookup,
      fetchImpl: async (input) => {
        seen.push(String(input));
        return seen.length === 1
          ? new Response(null, {
              status: 301,
              headers: { location: "/moved/here" },
            })
          : new Response(new TextEncoder().encode("ok"), { status: 200 });
      },
    });
    const got = await resolver.resolve("https://example.com/deep/a");
    expect(new TextDecoder().decode(got as Uint8Array)).toBe("ok");
    expect(seen[1]).toBe("https://example.com/moved/here");
  });

  it("returns null for a 404 reached THROUGH a redirect", async () => {
    let n = 0;
    const resolver = createHardenedResolver({
      lookupImpl: publicLookup,
      fetchImpl: async () => {
        n++;
        return n === 1
          ? new Response(null, {
              status: 307,
              headers: { location: "https://example.com/b" },
            })
          : new Response(null, { status: 404 });
      },
    });
    expect(await resolver.resolve("https://example.com/a")).toBeNull();
  });
});
