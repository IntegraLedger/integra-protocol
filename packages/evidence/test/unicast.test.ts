/**
 * `isUnicastPublic` — the SSRF predicate, exhaustively.
 *
 * `resolver.ts` is the SSRF guard, and its predicate is the kind nothing else in the suite pins — more than any
 * other file in the protocol. The cause: this predicate had exactly two tests — one public host, one
 * private — so every individual range could be deleted or its bounds moved without a single failure.
 *
 * That matters more than a score. `@integraledger/agentic-terms` — the buyer kit, in its own repository
 * since the 2026-08-13 severance — refuses a seller-supplied terms URL by calling straight into here;
 * `createHardenedResolver` gates every artifact fetch on it. An off-by-one in the CGNAT or RFC1918
 * bounds is a hole in the buyer's network, and the tests would have stayed green.
 *
 * Each range is therefore pinned at BOTH edges — the last address outside it and the first address inside —
 * because a bound that is only tested from the middle is a bound nobody has checked.
 */
import { describe, expect, it } from "vitest";
import { ipKind, isUnicastPublic } from "../src/resolver.js";

/** Table-driven so a new reserved range is one line, and so every case states WHY it is what it is. */
const PUBLIC_V4 = [
  ["8.8.8.8", "ordinary public"],
  ["93.184.216.34", "ordinary public"],
  ["1.1.1.1", "lowest ordinary unicast"],
  ["9.255.255.255", "last address below 10/8"],
  ["11.0.0.0", "first address above 10/8"],
  ["126.255.255.255", "last address below 127/8"],
  ["128.0.0.0", "first address above 127/8"],
  ["169.253.255.255", "last address below link-local"],
  ["169.255.0.0", "first address above link-local"],
  ["172.15.255.255", "last address below 172.16/12"],
  ["172.32.0.0", "first address above 172.16/12"],
  ["192.167.255.255", "last address below 192.168/16"],
  ["192.169.0.0", "first address above 192.168/16"],
  ["100.63.255.255", "last address below CGNAT 100.64/10"],
  ["100.128.0.0", "first address above CGNAT 100.64/10"],
  ["223.255.255.255", "last address below multicast"],
] as const;

const REFUSED_V4 = [
  ["0.0.0.0", "unspecified"],
  ["0.1.2.3", "0/8 reserved"],
  ["10.0.0.0", "RFC1918 10/8 first"],
  ["10.255.255.255", "RFC1918 10/8 last"],
  ["127.0.0.1", "loopback"],
  ["127.255.255.255", "loopback last"],
  ["169.254.0.0", "link-local first"],
  ["169.254.169.254", "cloud metadata — the canonical SSRF target"],
  ["169.254.255.255", "link-local last"],
  ["172.16.0.0", "RFC1918 172.16/12 first"],
  ["172.31.255.255", "RFC1918 172.16/12 last"],
  ["192.168.0.0", "RFC1918 192.168/16 first"],
  ["192.168.255.255", "RFC1918 192.168/16 last"],
  ["100.64.0.0", "CGNAT first"],
  ["100.127.255.255", "CGNAT last"],
  ["224.0.0.0", "multicast first"],
  ["239.255.255.255", "multicast last"],
  ["240.0.0.0", "reserved"],
  ["255.255.255.255", "broadcast"],
] as const;

const MALFORMED = [
  ["", "empty"],
  ["1.2.3", "too few octets"],
  ["1.2.3.4.5", "too many octets"],
  ["256.1.1.1", "octet out of range"],
  ["1.1.1.256", "last octet out of range"],
  ["a.b.c.d", "not numeric"],
  ["8.8.8.8 ", "trailing space"],
  [" 8.8.8.8", "leading space"],
  ["8.8.8.8/24", "CIDR, not an address"],
  ["not-an-ip", "hostname"],
] as const;

describe("isUnicastPublic — IPv4 ranges, pinned at both edges", () => {
  it.each(PUBLIC_V4)("allows %s (%s)", (ip) => {
    expect(isUnicastPublic(ip)).toBe(true);
  });

  it.each(REFUSED_V4)("REFUSES %s (%s)", (ip) => {
    expect(isUnicastPublic(ip)).toBe(false);
  });

  it.each(MALFORMED)("refuses malformed input %s (%s)", (ip) => {
    // Fail closed: anything that is not recognisably an address is not a public one.
    expect(isUnicastPublic(ip)).toBe(false);
  });

  it("refuses EVERY address across the RFC1918 172.16/12 span, not just its edges", () => {
    for (let b = 16; b <= 31; b++) {
      expect(isUnicastPublic(`172.${b}.0.1`)).toBe(false);
    }
    expect(isUnicastPublic("172.15.0.1")).toBe(true);
    expect(isUnicastPublic("172.32.0.1")).toBe(true);
  });

  it("refuses EVERY address across the CGNAT 100.64/10 span", () => {
    for (let b = 64; b <= 127; b++) {
      expect(isUnicastPublic(`100.${b}.0.1`)).toBe(false);
    }
    expect(isUnicastPublic("100.63.0.1")).toBe(true);
    expect(isUnicastPublic("100.128.0.1")).toBe(true);
  });

  it("refuses the whole multicast-and-above block from 224 up", () => {
    for (let a = 224; a <= 255; a++) {
      expect(isUnicastPublic(`${a}.0.0.1`)).toBe(false);
    }
  });
});

describe("isUnicastPublic — IPv6", () => {
  it("refuses unspecified, loopback, link-local and ULA", () => {
    for (const ip of [
      "::",
      "::1",
      "fe80::1",
      "fe80::abcd:1234",
      "fc00::1",
      "fd00::1",
      "fdff:ffff::1",
    ]) {
      expect(isUnicastPublic(ip)).toBe(false);
    }
  });

  it("is case-insensitive — an uppercase link-local is still link-local", () => {
    // The predicate lowercases before matching; without this, `FE80::1` would read as public.
    expect(isUnicastPublic("FE80::1")).toBe(false);
    expect(isUnicastPublic("FC00::1")).toBe(false);
    expect(isUnicastPublic("FD00::1")).toBe(false);
  });

  it("allows ordinary global unicast", () => {
    for (const ip of ["2001:4860:4860::8888", "2606:4700:4700::1111"]) {
      expect(isUnicastPublic(ip)).toBe(true);
    }
  });

  it("defers IPv4-MAPPED addresses to the v4 guard — the classic bypass", () => {
    // `::ffff:127.0.0.1` is loopback wearing an IPv6 costume. Treating the mapped form as "just IPv6"
    // would let every RFC1918 range back in through the front door.
    expect(isUnicastPublic("::ffff:127.0.0.1")).toBe(false);
    expect(isUnicastPublic("::ffff:10.0.0.1")).toBe(false);
    expect(isUnicastPublic("::ffff:192.168.1.1")).toBe(false);
    expect(isUnicastPublic("::ffff:169.254.169.254")).toBe(false);
    expect(isUnicastPublic("::ffff:8.8.8.8")).toBe(true);
  });

  // Every case below passed the guard before the v6 arm was rewritten to parse rather than prefix-match.
  // The v4 tables above are pinned at both edges; the v6 cases were all written in the one spelling the
  // predicate happened to handle, so the arm could be — and was — inert against the real input.

  it("REFUSES a BRACKETED literal — the form `URL.hostname` actually yields", () => {
    // `new URL("https://[::1]/").hostname` is "[::1]", brackets included. Comparing that against the bare
    // literals the old arm matched on classified every IPv6 literal host as public unicast.
    expect(isUnicastPublic("[::1]")).toBe(false);
    expect(isUnicastPublic("[fe80::1]")).toBe(false);
    expect(isUnicastPublic("[fc00::1]")).toBe(false);
    expect(isUnicastPublic("[::ffff:169.254.169.254]")).toBe(false);
    expect(isUnicastPublic("[2606:4700:4700::1111]")).toBe(true);
    expect(ipKind("[::1]")).toBe(6);
  });

  it("REFUSES loopback and unspecified however they are spelled", () => {
    for (const ip of [
      "::1",
      "0:0:0:0:0:0:0:1",
      "0000:0000:0000:0000:0000:0000:0000:0001",
      "::",
      "0:0:0:0:0:0:0:0",
    ]) {
      expect(isUnicastPublic(ip)).toBe(false);
    }
  });

  it("REFUSES an IPv4-mapped address written in HEX, not just dotted", () => {
    // `::ffff:7f00:1` and `::ffff:127.0.0.1` are the same address; only the second was ever refused.
    expect(isUnicastPublic("::ffff:7f00:1")).toBe(false); // 127.0.0.1
    expect(isUnicastPublic("::ffff:a9fe:a9fe")).toBe(false); // 169.254.169.254, cloud metadata
    expect(isUnicastPublic("::ffff:c0a8:1")).toBe(false); // 192.168.0.1
    expect(isUnicastPublic("::ffff:0a00:1")).toBe(false); // 10.0.0.1
    expect(isUnicastPublic("::ffff:808:808")).toBe(true); // 8.8.8.8
  });

  it("REFUSES the WHOLE fe80::/10 link-local block, which runs to febf", () => {
    // The old arm matched the literal prefix "fe80", leaving fe81–febf — the rest of the block — public.
    for (const top of ["fe80", "fe90", "fea0", "feaf", "febf"]) {
      expect(isUnicastPublic(`${top}::1`)).toBe(false);
    }
    expect(isUnicastPublic("fe7f::1")).toBe(true); // last group below the block
    expect(isUnicastPublic("fec0::1")).toBe(false); // deprecated site-local, refused separately
  });

  it("REFUSES the whole fc00::/7 ULA block and ff00::/8 multicast", () => {
    for (const top of ["fc00", "fcff", "fd00", "fdff"]) {
      expect(isUnicastPublic(`${top}::1`)).toBe(false);
    }
    for (const top of ["ff00", "ff02", "ff05", "ffff"]) {
      expect(isUnicastPublic(`${top}::1`)).toBe(false);
    }
  });

  it("defers NAT64 and 6to4 embedded v4 addresses to the v4 guard", () => {
    expect(isUnicastPublic("64:ff9b::7f00:1")).toBe(false); // NAT64 of 127.0.0.1
    expect(isUnicastPublic("64:ff9b::808:808")).toBe(true); // NAT64 of 8.8.8.8
    expect(isUnicastPublic("2002:7f00:1::1")).toBe(false); // 6to4 of 127.0.0.1
    expect(isUnicastPublic("2002:808:808::1")).toBe(true); // 6to4 of 8.8.8.8
  });

  it("matches the NAT64 prefix on its WHOLE 96 bits, not just the first two groups", () => {
    // `64:ff9b:1::/48` is local-use NAT64, a DIFFERENT prefix. Treating any 64:ff9b:* as well-known
    // NAT64 would run the v4 guard over groups that are not the embedded address at all.
    expect(isUnicastPublic("64:ff9b:1::7f00:1")).toBe(true); // not well-known NAT64 — judged as v6
    expect(isUnicastPublic("64:ff9c::7f00:1")).toBe(true); // second group differs
    expect(isUnicastPublic("65:ff9b::7f00:1")).toBe(true); // first group differs
  });

  it("distinguishes IPv4-MAPPED from IPv4-COMPATIBLE by the marker group", () => {
    // `::ffff:x` is mapped, `::x` is compatible; anything else in group 5 is an ordinary v6 address
    // whose last two groups are NOT an embedded v4 address.
    expect(isUnicastPublic("::fffe:7f00:1")).toBe(true); // group 5 is not 0xffff or 0 — ordinary v6
    expect(isUnicastPublic("::1:7f00:1")).toBe(true); // ditto
    expect(isUnicastPublic("1::ffff:7f00:1")).toBe(true); // nonzero prefix — not mapped at all
  });

  it("requires `::` to stand for at least one zero group", () => {
    // Eight explicit groups either side of an elision is nine groups' worth of address.
    expect(isUnicastPublic("1:2:3:4::5:6:7:8")).toBe(false);
    expect(isUnicastPublic("1:2:3:4:5:6:7::8")).toBe(false);
    expect(isUnicastPublic("1:2:3:4:5:6:7:8")).toBe(true); // exactly eight, no elision
  });

  it("fails CLOSED on malformed v6 rather than defaulting to public", () => {
    for (const ip of [
      "::1::2", // two elisions
      "gggg::1", // not hex
      "1:2:3:4:5:6:7", // too few groups, no elision
      "1:2:3:4:5:6:7:8:9", // too many groups
      "12345::1", // group wider than 16 bits
      "fe80::1%25eth0", // percent-encoded zone id
      "[::1", // unbalanced bracket
      "::ffff:999.1.1.1", // dotted quad out of range
    ]) {
      expect(isUnicastPublic(ip)).toBe(false);
    }
  });
});

describe("ipKind — the classifier the guard dispatches on", () => {
  it("classifies v4, v6 and neither", () => {
    expect(ipKind("8.8.8.8")).toBe(4);
    expect(ipKind("::1")).toBe(6);
    expect(ipKind("2001:db8::1")).toBe(6);
    expect(ipKind("::ffff:8.8.8.8")).toBe(6);
    expect(ipKind("example.com")).toBe(0);
    expect(ipKind("")).toBe(0);
    expect(ipKind("8.8.8")).toBe(0);
  });

  it("treats an out-of-range dotted quad as v4-SHAPED, leaving the range check to reject it", () => {
    // The split matters: `ipKind` answers "which family", `isUnicastPublic` answers "is it allowed".
    // If `ipKind` returned 0 here the address would be refused for the wrong reason, and a later
    // loosening of the range check would not be caught by these tests.
    expect(ipKind("256.256.256.256")).toBe(4);
    expect(isUnicastPublic("256.256.256.256")).toBe(false);
  });
});
