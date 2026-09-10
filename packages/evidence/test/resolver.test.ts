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
    await expect(
      resolver.resolve("http://example.com/a"),
    ).rejects.toMatchObject({ code: "resolver/not-https" });
  });

  it("refuses a host that resolves to a private address", async () => {
    const resolver = createHardenedResolver({
      lookupImpl: async () => [{ address: "10.0.0.5", family: 4 }],
      fetchImpl: async () => new Response(),
    });
    await expect(
      resolver.resolve("https://internal.example/a"),
    ).rejects.toMatchObject({ code: "resolver/non-unicast" });
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
    await expect(
      resolver.resolve("https://good.example/a"),
    ).rejects.toMatchObject({ code: "resolver/non-unicast" });
  });

  it("enforces the byte cap", async () => {
    const resolver = createHardenedResolver({
      maxBytes: 8,
      lookupImpl: publicLookup,
      fetchImpl: async () => new Response(new Uint8Array(64), { status: 200 }),
    });
    await expect(
      resolver.resolve("https://example.com/big"),
    ).rejects.toMatchObject({ code: "resolver/oversize" });
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
    await expect(
      resolver.resolve("https://example.com/a"),
    ).rejects.toMatchObject({ code: "resolver/no-address" });
  });

  it("refuses a redirect carrying no Location header", async () => {
    const resolver = createHardenedResolver({
      lookupImpl: publicLookup,
      fetchImpl: async () => new Response(null, { status: 302 }),
    });
    await expect(
      resolver.resolve("https://example.com/a"),
    ).rejects.toMatchObject({ code: "resolver/bad-redirect" });
  });

  it("throws on a non-ok status that is neither 404 nor a redirect", async () => {
    // 500 is not "absent" — returning null here would report a missing artifact for a server fault.
    const resolver = createHardenedResolver({
      lookupImpl: publicLookup,
      fetchImpl: async () => new Response(null, { status: 500 }),
    });
    await expect(
      resolver.resolve("https://example.com/a"),
    ).rejects.toMatchObject({ code: "resolver/http" });
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
    await expect(
      resolver.resolve("https://example.com/a"),
    ).rejects.toMatchObject({ code: "resolver/too-many-redirects" });
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

  it("the time budget covers the NAME LOOKUP, which sits ahead of any fetch", async () => {
    // ⛔ `AbortSignal.timeout` handed to `fetch` bounds the request and nothing before it, and a DNS
    // lookup accepts no signal — `dns.lookup` takes as long as the resolver takes. Driven with
    // `timeoutMs: 50`, the call was still hanging at 1500 ms: the stated bound was not the real one.
    // A lookup that never settles is that case with the timing taken out of it.
    const resolver = createHardenedResolver({
      timeoutMs: 25,
      lookupImpl: () => new Promise(() => {}),
      fetchImpl: async () => {
        throw new Error("must not fetch before the host is validated");
      },
    });
    await expect(
      resolver.resolve("https://slow.example/a"),
    ).rejects.toMatchObject({ code: "resolver/timeout" });
  });

  it("ONE budget for the whole resolve, not a fresh one per redirect hop", async () => {
    // A signal minted inside the loop makes `timeoutMs` × (hops + 1) the real ceiling while the option
    // documents one number. The identity of the signal is the property: every hop runs under the budget
    // that opened before the first lookup.
    const signals: (AbortSignal | null | undefined)[] = [];
    const resolver = createHardenedResolver({
      lookupImpl: publicLookup,
      fetchImpl: async (_input, init) => {
        signals.push(init?.signal);
        return signals.length === 1
          ? new Response(null, {
              status: 302,
              headers: { location: "https://example.com/b" },
            })
          : new Response(new TextEncoder().encode("ok"), { status: 200 });
      },
    });
    await resolver.resolve("https://example.com/a");
    expect(signals).toHaveLength(2);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(signals[0]).toBe(signals[1]);
  });

  it("a budget already spent on an earlier hop refuses the next one without waiting", async () => {
    // The cross-hop half of the same bound, with the timing taken out: hop 1's fetch returns only once
    // the budget has expired, so hop 2 meets a signal that is ALREADY aborted. `addEventListener` never
    // fires for an abort that has already happened, so this is the arm that has to check first.
    const resolver = createHardenedResolver({
      timeoutMs: 5,
      lookupImpl: publicLookup,
      fetchImpl: async (_input, init) => {
        const signal = init?.signal as AbortSignal;
        if (!signal.aborted)
          await new Promise((r) =>
            signal.addEventListener("abort", r, { once: true }),
          );
        return new Response(null, {
          status: 302,
          headers: { location: "https://example.com/b" },
        });
      },
    });
    await expect(
      resolver.resolve("https://example.com/a"),
    ).rejects.toMatchObject({ code: "resolver/timeout" });
  });

  it("a literal IP host is judged directly, with no name lookup at all", async () => {
    // There is no name to resolve, and calling the lookup would be asking a resolver about an address.
    const resolver = createHardenedResolver({
      lookupImpl: async () => {
        throw new Error("must not look up a literal IP");
      },
      fetchImpl: async () =>
        new Response(new TextEncoder().encode("direct"), { status: 200 }),
    });
    const got = await resolver.resolve("https://93.184.216.34/a");
    expect(new TextDecoder().decode(got as Uint8Array)).toBe("direct");
  });

  it("a literal PRIVATE IP host is refused on the same path", async () => {
    const resolver = createHardenedResolver({
      lookupImpl: async () => {
        throw new Error("must not look up a literal IP");
      },
      fetchImpl: async () => {
        throw new Error("must not fetch a private literal");
      },
    });
    await expect(resolver.resolve("https://[::1]/a")).rejects.toMatchObject({
      code: "resolver/non-unicast",
    });
  });

  it("a body of EXACTLY the byte cap is allowed — the bound is inclusive", async () => {
    // `>` vs `>=` is the whole difference between a cap-sized artifact being fetchable and being
    // refused, and the cap had no case at its own boundary.
    const resolver = createHardenedResolver({
      maxBytes: 8,
      lookupImpl: publicLookup,
      fetchImpl: async () => new Response(new Uint8Array(8), { status: 200 }),
    });
    expect(await resolver.resolve("https://example.com/exact")).toEqual(
      new Uint8Array(8),
    );
  });

  it("a body arriving in several chunks is reassembled in order", async () => {
    // The cap counts across chunks and the copy walks forward through them. A single-chunk body proves
    // neither: it is one `set` at offset zero.
    const resolver = createHardenedResolver({
      lookupImpl: publicLookup,
      fetchImpl: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(Uint8Array.from([1, 2, 3]));
              controller.enqueue(Uint8Array.from([4, 5]));
              controller.enqueue(Uint8Array.from([6]));
              controller.close();
            },
          }),
          { status: 200 },
        ),
    });
    expect(await resolver.resolve("https://example.com/chunked")).toEqual(
      Uint8Array.from([1, 2, 3, 4, 5, 6]),
    );
  });

  it("300 with a Location is followed; 400 is a failure, not a redirect", async () => {
    // The redirect window is [300, 400). Both ends of it decide whether a response is followed or
    // reported, and neither end had a case.
    const followed = createHardenedResolver({
      lookupImpl: publicLookup,
      fetchImpl: async (input) =>
        String(input).endsWith("/a")
          ? new Response(null, {
              status: 300,
              headers: { location: "https://example.com/b" },
            })
          : new Response(new TextEncoder().encode("chosen"), { status: 200 }),
    });
    expect(
      new TextDecoder().decode(
        (await followed.resolve("https://example.com/a")) as Uint8Array,
      ),
    ).toBe("chosen");

    const reported = createHardenedResolver({
      lookupImpl: publicLookup,
      fetchImpl: async () => new Response(null, { status: 400 }),
    });
    await expect(
      reported.resolve("https://example.com/a"),
    ).rejects.toMatchObject({ code: "resolver/http" });
  });

  it("a malformed URL is refused before anything is looked up or fetched", async () => {
    const resolver = createHardenedResolver({
      lookupImpl: async () => {
        throw new Error("must not look up a malformed URL");
      },
      fetchImpl: async () => {
        throw new Error("must not fetch a malformed URL");
      },
    });
    await expect(resolver.resolve("not-a-url")).rejects.toMatchObject({
      code: "resolver/bad-url",
    });
  });

  it("a successful response with NO body is refused, not read as an empty artifact", async () => {
    // 204 says "no content"; `new Uint8Array(0)` says "the artifact is empty". The caller then hashes
    // that to e3b0c442… and reports an artifact that does not match its reference — "could not read it"
    // arriving dressed as "does not verify".
    const resolver = createHardenedResolver({
      lookupImpl: publicLookup,
      fetchImpl: async () => new Response(null, { status: 204 }),
    });
    await expect(
      resolver.resolve("https://example.com/a"),
    ).rejects.toMatchObject({ code: "resolver/no-body" });
  });

  it("a genuinely EMPTY artifact still resolves — an empty body is a stream, not an absent one", async () => {
    // The distinction the refusal above depends on. Zero bytes is a legitimate content-addressed
    // artifact and must not be swept up with the bodyless case.
    const resolver = createHardenedResolver({
      lookupImpl: publicLookup,
      fetchImpl: async () => new Response(new Uint8Array(0), { status: 200 }),
    });
    expect(await resolver.resolve("https://example.com/empty")).toEqual(
      new Uint8Array(0),
    );
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
