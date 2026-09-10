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

  it("a block CID in a codec this decoder does not read is named as such, not left to read as tamper", async () => {
    // dag-pb (0x70) instead of raw (0x55). `verifyBundle` recomputes every block CID as a raw-sha256
    // CIDv1 and compares strings, so a dag-pb block could only ever come back "does not hash to its
    // content (tamper)" — a forgery accusation against a bundle merely written in another shape.
    const car = await withBlockPatch(() => {});
    car[(await cidVersionOffset(car)) + 1] = 0x70;
    expect(codeOf(() => decodeCar(car))).toBe("car/cid-codec");
  });

  it("a block CID under another hash function is named as such", async () => {
    // 0x1e = sha3-256. Same 32-byte width, different function, and the same wrong tamper verdict.
    const car = await withBlockPatch(() => {});
    car[(await cidVersionOffset(car)) + 2] = 0x1e;
    expect(codeOf(() => decodeCar(car))).toBe("car/cid-multihash");
  });

  it("a block CID declaring a digest that is not 32 bytes", async () => {
    const car = await withBlockPatch(() => {});
    car[(await cidVersionOffset(car)) + 3] = 0x1f;
    expect(codeOf(() => decodeCar(car))).toBe("car/cid-digest-length");
  });

  it("accepts a 5-byte length as a length, then refuses it for not fitting the buffer", () => {
    // Five bytes is the widest accepted form; under a signed shift these bytes accumulate to -1. Two
    // separate facts, in order: the varint reader does NOT refuse shift 28 (no `car/varint-overflow`),
    // and the 34-billion-byte header it decodes to does not fit five bytes of input. Until the span gate
    // landed, that header was `subarray`d to an EMPTY one and reported as a header-SHAPE fault, which is
    // a sentence about the wrong thing — the shape was never read.
    const fiveByte = Uint8Array.from([0xff, 0xff, 0xff, 0xff, 0x7f]);
    expect(codeOf(() => decodeCar(fiveByte))).toBe("car/truncated");
  });
});

/**
 * ⛔ THE DECLARED LENGTHS, WHICH THE COUNTERPARTY WROTE.
 *
 * `subarray` clamps an out-of-range end instead of throwing, so an edited length prefix does not corrupt
 * the parse — it walks the cursor over whatever follows. Nothing throws, nothing is reported, and the
 * block list simply comes back shorter than the file. These cases drive real bundles with real one-byte
 * edits and count the blocks, because the count is the only place the fault was ever visible.
 */
describe("decodeCar refuses a declared span that does not fit the buffer", () => {
  const carBytesOf = async (blocks: Uint8Array[]): Promise<Uint8Array> => {
    const hex = await encodeCarBlocksHex(blocks, 0);
    return Uint8Array.from(
      (hex.match(/../g) ?? []).map((b) => Number.parseInt(b, 16)),
    );
  };

  /** LEB128 as the CAR framing writes it — test-local, since the decoder is the thing being driven. */
  const varintAt = (
    bytes: Uint8Array,
    at: number,
  ): { value: number; next: number } => {
    let value = 0;
    let shift = 0;
    let i = at;
    for (;;) {
      const b = bytes[i] ?? 0;
      value += (b & 0x7f) * 2 ** shift;
      i++;
      if ((b & 0x80) === 0) return { value, next: i };
      shift += 7;
    }
  };

  /** The offset of every block section's length varint, in order. */
  const sectionStarts = (car: Uint8Array): number[] => {
    const hlen = varintAt(car, 0);
    const starts: number[] = [];
    let i = hlen.next + hlen.value;
    while (i < car.length) {
      starts.push(i);
      const sec = varintAt(car, i);
      i = sec.next + sec.value;
    }
    return starts;
  };

  const bytesDiffering = (a: Uint8Array, b: Uint8Array): number => {
    let n = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
    return n;
  };

  it("ONE BYTE edited in a section's length used to delete every block after it", async () => {
    const car = await carBytesOf(
      // Four equal-width artifacts, so the overrun length below stays inside one varint byte and the
      // file's own length is provably untouched by the edit.
      ["alpha", "bravo", "delta", "gamma"].map((s) =>
        new TextEncoder().encode(s),
      ),
    );
    expect(decodeCar(car).blocks).toHaveLength(4);

    // Restate section 1's length as "everything past here", one byte past the end of the file. Sections
    // 2 and 3 are still in the file, in full; the cursor simply lands past them. Measured before the
    // span gate: FOUR blocks in, TWO blocks out, no throw and no reason — two artifacts missing from the
    // readout of a bundle that reported itself read.
    const starts = sectionStarts(car);
    const s1 = starts[1] as number;
    const overrun = car.length - s1;
    expect(overrun).toBeLessThan(0x80); // still a single-byte varint, so the FILE keeps its length
    const tampered = car.slice();
    tampered[s1] = overrun;
    expect(tampered.length).toBe(car.length);
    expect(bytesDiffering(car, tampered)).toBe(1);
    expect(codeOf(() => decodeCar(tampered))).toBe("car/truncated");
  });

  it("a section declaring more bytes than the file holds is refused, not clamped to what is there", async () => {
    // The LAST section, grown by one. `subarray` clamped the end back to the buffer, so the block's
    // bytes were unchanged, its CID still recomputed, and the whole CAR verified — a bundle whose own
    // framing says it carries bytes that are not there, reported as intact.
    const car = await carBytesOf([
      new TextEncoder().encode("alpha"),
      new TextEncoder().encode("bravo"),
    ]);
    const starts = sectionStarts(car);
    const last = starts[starts.length - 1] as number;
    const tampered = car.slice();
    tampered[last] = varintAt(car, last).value + 1;
    expect(bytesDiffering(car, tampered)).toBe(1);
    expect(codeOf(() => decodeCar(tampered))).toBe("car/truncated");
  });

  it("a block CID that overruns the section introducing it yields no bytes at all, so it is refused", async () => {
    // `subarray(dataStart, sectionEnd)` with start PAST end is not an error in JavaScript — it is an
    // empty array. The block is in the file and reads as zero bytes.
    const car = await carBytesOf([new TextEncoder().encode("alpha")]);
    const start = sectionStarts(car)[0] as number;
    const tampered = car.slice();
    tampered[start] = varintAt(car, start).value - 10; // section ends inside its own CID
    expect(codeOf(() => decodeCar(tampered))).toBe("car/truncated");
  });

  it("a root CID byte string that fits the header but is not a CID", async () => {
    // In bounds, so the span gate passes it — and `CID.decode` then throws something that is not a
    // CidError out of a codec whose every fault is one. Four bytes reading `01 55 12 20`: a CID header
    // announcing a 32-byte digest with nothing behind it.
    const car = await carBytesOf([new TextEncoder().encode("alpha")]);
    const tampered = car.slice();
    tampered[1 + 11] = 5; // byte-string length: the identity prefix plus four bytes
    expect(codeOf(() => decodeCar(tampered))).toBe("car/header");
  });

  it("a root CID byte string longer than the header it sits in", async () => {
    // The header's own length is honoured now, so this is the span INSIDE it: `subarray` would clamp and
    // hand CID.decode a short buffer, throwing something that is not a CidError out of the codec.
    const car = await carBytesOf([new TextEncoder().encode("alpha")]);
    const tampered = car.slice();
    tampered[1 + 11] = 0x40; // the tag-42 byte string's length byte, well past the header's end
    expect(codeOf(() => decodeCar(tampered))).toBe("car/truncated");
  });
});
