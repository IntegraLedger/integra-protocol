import { CID } from "multiformats/cid";
import * as raw from "multiformats/codecs/raw";
import { create as createDigest } from "multiformats/hashes/digest";
import { describe, expect, it } from "vitest";
import {
  atrHashFromCid,
  CidError,
  cidForAtrHash,
  decodeCar,
  encodeCarBlocksHex,
} from "../src/car.js";

/**
 * The DEFENSIVE half of the CAR/CID codec: everything that rejects a malformed input.
 *
 * car.test.ts pins the bytes of well-formed encodings against the spec vectors, which is the encode
 * side. The decode side is the one that meets a COUNTERPARTY's bytes — an evidence bundle handed over
 * by the other party to a transaction — and every guard in it was unexercised. A decoder that reads a
 * corrupt CAR as an empty-but-valid one is worse than one that crashes: it reports "nothing is wrong"
 * about evidence it could not actually read.
 *
 * Faults are asserted by their typed `code`, never by message text (the CidError contract).
 */
const ATR =
  "0x7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069";

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(CidError);
    return (e as CidError).code;
  }
  throw new Error("expected a CidError, but nothing was thrown");
}

describe("cidForAtrHash rejects anything that is not a 32-byte 0x digest", () => {
  it.each([
    ["not 0x-prefixed", "7f83b165".padEnd(64, "0"), "cid/bad-atrhash"],
    // Without the `^` anchor the regex matches a hash with junk in FRONT of it, and the digest is then
    // taken from `slice(2)` — two characters of the junk, silently producing a different CID.
    ["junk in front of a valid hash", `zz${ATR}`, "cid/bad-atrhash"],
    ["non-hex characters", `0x${"z".repeat(64)}`, "cid/bad-atrhash"],
    ["too short", "0xdead", "cid/bad-atrhash-length"],
    ["too long", `${ATR}ff`, "cid/bad-atrhash-length"],
    ["empty", "0x", "cid/bad-atrhash-length"],
  ])("%s", (_why, input, code) => {
    expect(codeOf(() => cidForAtrHash(input))).toBe(code);
  });

  it("round-trips a well-formed atrHash through the CID and back", () => {
    expect(atrHashFromCid(cidForAtrHash(ATR))).toBe(ATR);
    // Any-case in, canonical lowercase out (the ATR canon).
    expect(
      atrHashFromCid(cidForAtrHash(`0x${ATR.slice(2).toUpperCase()}`)),
    ).toBe(ATR);
  });
});

describe("atrHashFromCid rejects a CID that is not a 32-byte sha2-256 raw leaf", () => {
  it("an unparseable string", () => {
    expect(codeOf(() => atrHashFromCid("not-a-cid"))).toBe("cid/unparseable");
  });

  it("a CID whose multihash is not sha2-256 — its digest is NOT an atrHash", () => {
    // 0x1e = sha3-256: same 32-byte width, different function. Reading its digest as an atrHash would
    // claim a fingerprint that was never computed the way LCP §7.2 says it is.
    const cid = CID.create(
      1,
      raw.code,
      createDigest(0x1e, new Uint8Array(32).fill(9)),
    ).toString();
    expect(codeOf(() => atrHashFromCid(cid))).toBe("cid/not-sha256");
  });

  it("a sha2-256 CID whose digest is the wrong length", () => {
    const cid = CID.create(
      1,
      raw.code,
      createDigest(0x12, new Uint8Array(31).fill(9)),
    ).toString();
    expect(codeOf(() => atrHashFromCid(cid))).toBe("cid/bad-digest-length");
  });
});

describe("encodeCarBlocksHex", () => {
  it("refuses a rootIndex with no block behind it", async () => {
    // Without the guard this dereferences `undefined.cidBytes` — a TypeError from inside the codec
    // rather than a typed, attributable fault.
    await expect(
      encodeCarBlocksHex([new TextEncoder().encode("a")], 3),
    ).rejects.toMatchObject({ code: "car/bad-root-index" });
  });
});

/**
 * The CARv1 header is a fixed DAG-CBOR shape: `a2 65 "roots" 8N [d8 2a 58 len 00 <cid>]… 67 "version" 01`.
 * Each of these mutations corrupts exactly one of those markers, which is how a foreign encoder that
 * disagrees with the spec would present itself.
 */
describe("decodeCar rejects a corrupt CARv1 header", () => {
  const carBytes = async (): Promise<Uint8Array> => {
    const hex = await encodeCarBlocksHex([new TextEncoder().encode("a")], 0);
    return Uint8Array.from(
      (hex.match(/../g) ?? []).map((b) => Number.parseInt(b, 16)),
    );
  };
  /** Overwrite one byte of the header (which starts at offset 1 — past the 1-byte length varint). */
  const patched = async (offsetInHeader: number, value: number) => {
    const car = await carBytes();
    car[1 + offsetInHeader] = value;
    return car;
  };

  it.each([
    ["the map marker is not map(2)", 0, 0xa3],
    ['the first key is not "roots"', 1, 0x66],
    ["roots is not a CBOR array", 7, 0x60],
    ["the root is not tag-42", 8, 0xd9],
    ["the tag-42 body is not a byte string of the expected form", 10, 0x59],
    ["the CID byte string lacks the identity multibase prefix", 12, 0x01],
  ])("%s", async (_why, offset, value) => {
    const car = await patched(offset, value);
    expect(codeOf(() => decodeCar(car))).toBe("car/header");
  });

  it("a header that ends before the root CID's byte-string length", async () => {
    const car = await carBytes();
    car[0] = 11; // the header stops one byte short of the tag-42 length byte
    expect(codeOf(() => decodeCar(car))).toBe("car/header");
  });
});

describe("decodeCar rejects a corrupt block section", () => {
  const withBlockPatch = async (patch: (car: Uint8Array) => void) => {
    const hex = await encodeCarBlocksHex([new TextEncoder().encode("a")], 0);
    const car = Uint8Array.from(
      (hex.match(/../g) ?? []).map((b) => Number.parseInt(b, 16)),
    );
    patch(car);
    return car;
  };
  /** The block section starts after `varint(headerLen) ‖ header`; its own layout is `varint(len) ‖ cid`. */
  const cidVersionOffset = async (car: Uint8Array) => (car[0] ?? 0) + 2;

  it("a block CID that is not CIDv1", async () => {
    const car = await withBlockPatch(() => {});
    car[await cidVersionOffset(car)] = 0x02;
    expect(codeOf(() => decodeCar(car))).toBe("car/cid-version");
  });

  it("a CAR that ends part-way through a block CID's digest", async () => {
    // The CID declares a 32-byte digest that the file does not contain. Accepting the short digest
    // would mint a CID that no block hashes to — a tamper verdict on a merely truncated transfer.
    const car = await withBlockPatch(() => {});
    expect(codeOf(() => decodeCar(car.slice(0, car.length - 20)))).toBe(
      "car/truncated",
    );
  });

  it("a varint that runs past the end of the buffer", async () => {
    // Every byte with the continuation bit set and nothing after it — the decoder must stop, not read
    // undefined bytes as zeroes and carry on with a plausible-looking length.
    expect(codeOf(() => decodeCar(Uint8Array.from([0x80, 0x80, 0x80])))).toBe(
      "car/truncated",
    );
  });

  it("a varint too wide for the length range this decoder accepts", () => {
    // This decoder accumulates ARITHMETICALLY and refuses past five bytes. `value |= (b & 0x7f) << shift`
    // would be a 32-bit SIGNED op: past shift 31 the shift wraps, and at shift 28 a set high bit alone
    // makes the length negative. `decodeCar` assigns the section end straight to its loop cursor, so a
    // negative length is a cursor that moves BACKWARD.
    const tooWide = Uint8Array.from([
      0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01,
    ]);
    expect(codeOf(() => decodeCar(tooWide))).toBe("car/varint-overflow");
  });

  it("accepts a 5-byte length as a length, rather than refusing or crashing on it", () => {
    // Five bytes is the widest accepted form; under a signed shift these bytes accumulate to -1.
    // This pins the BOUNDARY — that shift 28 is inside the accepted range — not the sign of the result:
    // an over-long header end and a negative one both truncate to an empty header here, so the resulting
    // `car/header` cannot tell them apart. The sign is pinned by the arithmetic accumulator itself.
    const fiveByte = Uint8Array.from([0xff, 0xff, 0xff, 0xff, 0x7f]);
    expect(codeOf(() => decodeCar(fiveByte))).toBe("car/header");
  });
});
