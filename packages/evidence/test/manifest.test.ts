import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  decodeCar,
  encodeCarBlocksHex,
  RAW_BLOCK_MAX_BYTES,
} from "../src/car.js";
import {
  type Artifact,
  type BundleVerification,
  buildBundle,
  EVIDENCE_ROLES,
  type EvidenceRole,
  verifyBundle,
} from "../src/manifest.js";

/**
 * The refusal arm of the verdict, or a failure naming what came back instead.
 *
 * `fault` and `reason` are readable only once `ok` is false — that is the union's whole point, and it is
 * why this helper exists rather than a cast: a test that wants to read a reason has to establish that
 * there was a refusal first, exactly as a caller does.
 */
function refusal(v: BundleVerification): {
  entries: readonly { role: string; ref: string }[];
  fault: string;
  reason: string;
} {
  if (v.ok)
    throw new Error(
      `expected a refusal; got ok:true with ${v.entries.length} entries`,
    );
  return v;
}

type BundleInput = {
  artifacts: { role: string; encoding: string; data: string }[];
};
const V = JSON.parse(
  readFileSync(
    new URL("../../../vectors/evidence/bundle-roundtrip.json", import.meta.url),
    "utf8",
  ),
) as {
  cases: {
    name: string;
    input: BundleInput;
    expected: { role: string; ref: string }[];
  }[];
};

/** The manifest schema itself — the authority for the role vocabulary the code checks against. */
const SCHEMA = JSON.parse(
  readFileSync(
    new URL("../../../vectors/evidence/manifest.schema.json", import.meta.url),
    "utf8",
  ),
) as { $defs: { role: { enum: string[] } } };

function toArtifacts(input: BundleInput): Artifact[] {
  return input.artifacts.map((a) => ({
    role: a.role as EvidenceRole,
    bytes: new TextEncoder().encode(a.data),
  }));
}

/** Encode raw blocks into a CARv1 rooted at `rootIndex` (hex → bytes, as buildBundle does). */
async function carOf(
  blocks: Uint8Array[],
  rootIndex: number,
): Promise<Uint8Array> {
  const hex = await encodeCarBlocksHex(blocks, rootIndex);
  return Uint8Array.from(
    (hex.match(/../g) ?? []).map((b: string) => Number.parseInt(b, 16)),
  );
}

/** The bytes of the block with `cid`, read back out of an encoded CAR. */
function blockOf(car: Uint8Array, cid: string): Uint8Array {
  const found = decodeCar(car).blocks.find((b) => b.cid === cid);
  if (found === undefined) throw new Error(`no block ${cid} in car`);
  return found.bytes;
}

// CARv1 is varint-framed: `varint(len) ‖ header`, then `varint(len) ‖ cid ‖ data` per block. These two
// helpers reach into that framing to build the two malformed shapes `encodeCarBlocksHex` cannot produce
// — a header with an empty roots array, and a CAR missing the very block its root names. Both are
// reachable from a foreign or corrupted CAR, which is the only kind verifyBundle exists to judge.
function varintAt(
  bytes: Uint8Array,
  at: number,
): { value: number; next: number } {
  let value = 0;
  let shift = 0;
  let i = at;
  for (;;) {
    const b = bytes[i] ?? 0;
    value |= (b & 0x7f) << shift;
    i++;
    if ((b & 0x80) === 0) return { value, next: i };
    shift += 7;
  }
}

/** A CARv1 whose DAG-CBOR header is `{roots: [], version: 1}` — well-formed, but rooted at nothing. */
function rootlessCar(): Uint8Array {
  const header = [
    0xa2, // map(2)
    0x65,
    0x72,
    0x6f,
    0x6f,
    0x74,
    0x73, // "roots"
    0x80, // array(0)
    0x67,
    0x76,
    0x65,
    0x72,
    0x73,
    0x69,
    0x6f,
    0x6e, // "version"
    0x01,
  ];
  return Uint8Array.from([header.length, ...header]);
}

/** The same CAR with its single root CID written TWICE — `{roots: [cid, cid], version: 1}`. The header's
 *  shape is fixed (`a2 65 "roots" 8N [d8 2a 58 len 00 <cid>]… 67 "version" 01`), so the roots array's
 *  count byte and one 41-byte entry are all this has to move. Not a shape `encodeCarBlocksHex` can
 *  produce; entirely reachable from a foreign encoder. */
function withDuplicatedRoot(car: Uint8Array): Uint8Array {
  const hlen = varintAt(car, 0);
  const headerEnd = hlen.next + hlen.value;
  const header = car.subarray(hlen.next, headerEnd);
  const arrayAt = 7; // past 0xa2 and the five-byte "roots" key
  const bslen = header[arrayAt + 4] as number; // the tag-42 byte string's length byte
  const entry = header.subarray(arrayAt + 1, arrayAt + 5 + bslen);
  const grown = Uint8Array.from([
    ...header.subarray(0, arrayAt),
    0x82, // array(2)
    ...entry,
    ...entry,
    ...header.subarray(arrayAt + 5 + bslen),
  ]);
  return Uint8Array.from([
    grown.length, // still a single-byte varint at this size
    ...grown,
    ...car.subarray(headerEnd),
  ]);
}

/** The offset of the LAST block section's length varint. */
function lastSectionStart(car: Uint8Array): number {
  const hlen = varintAt(car, 0);
  let i = hlen.next + hlen.value;
  let last = i;
  while (i < car.length) {
    last = i;
    const sec = varintAt(car, i);
    i = sec.next + sec.value;
  }
  return last;
}

/** The same CAR with its FIRST block section dropped — the header still names it as the root. */
function withoutFirstBlock(car: Uint8Array): Uint8Array {
  const hlen = varintAt(car, 0);
  const headerEnd = hlen.next + hlen.value;
  const seclen = varintAt(car, headerEnd);
  const out = new Uint8Array(
    headerEnd + (car.length - (seclen.next + seclen.value)),
  );
  out.set(car.subarray(0, headerEnd), 0);
  out.set(car.subarray(seclen.next + seclen.value), headerEnd);
  return out;
}

describe("evidence bundle round-trip (build → encode → decode → recompute)", () => {
  it.each(V.cases)("$name", async ({ input, expected }) => {
    const bundle = await buildBundle(toArtifacts(input));
    expect(bundle.entries).toEqual(expected);
    const verified = await verifyBundle(bundle.car);
    expect(verified.ok).toBe(true);
    expect(verified.entries).toEqual(expected);
  });

  it("the root is the manifest's own CID", async () => {
    const bundle = await buildBundle([
      { role: "atr", bytes: new TextEncoder().encode("x") },
    ]);
    expect(bundle.root).toMatch(/^bafkrei/);
    const verified = await verifyBundle(bundle.car);
    expect(verified.ok).toBe(true);
  });

  it("fails loud when a block is tampered (no longer hashes to its CID)", async () => {
    const bundle = await buildBundle([
      { role: "atr", bytes: new TextEncoder().encode("# Terms") },
    ]);
    const tampered = bundle.car.slice();
    const last = tampered.length - 1;
    tampered[last] = (tampered[last] ?? 0) ^ 0xff; // flip the last byte of the last block
    const verified = await verifyBundle(tampered);
    expect(refusal(verified).reason).toMatch(/tamper|hash/);
    // INTEGRITY, not "malformed": these bytes ARE a bundle, and the block in it does not hash to the CID
    // claiming it. Saying which of the two happened is the difference between accusing a counterparty
    // and reporting a bad transfer.
    expect(refusal(verified).fault).toBe("integrity");
    // A rejected bundle reports NO entries: nothing in it was validated, so listing any would be a
    // claim about evidence the verifier just refused.
    expect(verified.entries).toEqual([]);
  });

  it("rejects an empty artifact set (manifest minItems: 1)", async () => {
    await expect(buildBundle([])).rejects.toThrow(/at least one/);
  });

  it("buildBundle fails loud on an artifact over the 1 MiB ceiling (never silently mints a bad CID)", async () => {
    const oversize = new Uint8Array(RAW_BLOCK_MAX_BYTES + 1);
    // The typed `code` is the contract the callers switch on, not the sentence.
    await expect(
      buildBundle([{ role: "atr", bytes: oversize }]),
    ).rejects.toMatchObject({ code: "cid/oversize" });
  });

  it("verifyBundle returns {ok:false} (never throws) on a corrupt oversize block", async () => {
    // Hand-build a CAR with an oversize block (buildBundle would refuse it) to exercise verify's guard.
    const oversize = new Uint8Array(RAW_BLOCK_MAX_BYTES + 1);
    const verified = await verifyBundle(await carOf([oversize], 0));
    expect(refusal(verified).reason).toMatch(/ceiling/);
    expect(refusal(verified).fault).toBe("malformed");
    expect(verified.entries).toEqual([]);
  });

  it("a block of EXACTLY the ceiling is legal on both paths (the bound is inclusive)", async () => {
    // `>` vs `>=` is the whole difference between a 1 MiB artifact being storable and being refused,
    // and neither path had a case at the boundary.
    const exact = new Uint8Array(RAW_BLOCK_MAX_BYTES).fill(7);
    const bundle = await buildBundle([{ role: "atr", bytes: exact }]);
    const verified = await verifyBundle(bundle.car);
    expect(verified.ok).toBe(true);
  });
});

describe("assurance flows onto the manifest entry", () => {
  it("carries a stated assurance for an attestation, and omits the key when there is none", async () => {
    // Manifest entries are the evidence record's own text. Dropping a stated assurance would publish an
    // attestation as though its assurance had never been claimed; emitting the key when nothing was
    // stated would claim one that was not.
    const bundle = await buildBundle([
      { role: "atr", bytes: new TextEncoder().encode("# Terms") },
      {
        role: "attestation",
        bytes: new TextEncoder().encode("{}"),
        assurance: "legal-party",
      },
    ]);
    expect(bundle.entries[1]?.assurance).toBe("legal-party");
    expect(Object.keys(bundle.entries[0] ?? {})).toStrictEqual(["role", "ref"]);

    // …and it survives the round-trip through the serialized manifest, which is what fixes the root CID.
    const verified = await verifyBundle(bundle.car);
    expect(verified.entries[1]).toStrictEqual({
      role: "attestation",
      ref: bundle.entries[1]?.ref,
      assurance: "legal-party",
    });
    expect(Object.keys(verified.entries[0] ?? {})).toStrictEqual([
      "role",
      "ref",
    ]);
  });
});

describe("verifyBundle reports each way a bundle can be wrong", () => {
  it("COMPLETENESS: a manifest ref with no matching block is an incomplete bundle", async () => {
    // The headline check, and nothing exercised it. Strip the artifact blocks and keep the manifest:
    // its refs still name them, so the bundle claims evidence it does not carry.
    const bundle = await buildBundle([
      { role: "atr", bytes: new TextEncoder().encode("# Terms") },
      { role: "settlement", bytes: new TextEncoder().encode("0xabc") },
    ]);
    const manifestBytes = blockOf(bundle.car, bundle.root);
    const verified = await verifyBundle(await carOf([manifestBytes], 0));
    expect(refusal(verified).reason).toMatch(/incomplete bundle/);
    expect(refusal(verified).fault).toBe("completeness");
    // The entries are still reported — an incomplete bundle is readable, just not complete.
    expect(verified.entries).toEqual(bundle.entries);
  });

  it("COMPLETENESS the other way: a block no manifest entry names is refused", async () => {
    // `buildBundle` writes the manifest and exactly the artifacts it references, so an unlisted block is
    // a shape it cannot produce — and bytes travelling inside an evidence package that the manifest, the
    // readout a dispute actually reads, does not account for. Verified `ok:true` before this check.
    const bundle = await buildBundle([
      { role: "atr", bytes: new TextEncoder().encode("# Terms") },
    ]);
    const manifestBytes = blockOf(bundle.car, bundle.root);
    const smuggled = new TextEncoder().encode("a side letter nobody listed");
    const verified = await verifyBundle(
      await carOf(
        [manifestBytes, new TextEncoder().encode("# Terms"), smuggled],
        0,
      ),
    );
    expect(refusal(verified).reason).toMatch(/no manifest entry references/);
    expect(refusal(verified).fault).toBe("completeness");
  });

  it("a bundle whose framing declares bytes the file does not carry is refused, not reported intact", async () => {
    // The end-to-end shape of the length-clamp fault. One byte added to the LAST section's declared
    // length: `subarray` clamped the end back to the buffer, so the block's bytes were unchanged, its
    // CID still recomputed, every ref still resolved — and this answered `ok: true` about a CAR whose
    // own framing says it carries bytes that are not there. A wrong answer in the shape of a right one.
    const bundle = await buildBundle([
      { role: "atr", bytes: new TextEncoder().encode("# Terms") },
      { role: "settlement", bytes: new TextEncoder().encode("0xabc") },
    ]);
    const tampered = bundle.car.slice();
    const last = lastSectionStart(tampered);
    tampered[last] = varintAt(tampered, last).value + 1;
    const verified = await verifyBundle(tampered);
    expect(refusal(verified).fault).toBe("malformed");
    expect(refusal(verified).reason).toMatch(/car is not decodable/);
  });

  it("a CAR rooted at more than one manifest is refused, not read through its first root", async () => {
    // Only `roots[0]` was ever consulted, so a second root could name evidence nothing read. One
    // manifest, or this is not the shape `buildBundle` builds.
    const bundle = await buildBundle([
      { role: "atr", bytes: new TextEncoder().encode("# Terms") },
    ]);
    const verified = await verifyBundle(withDuplicatedRoot(bundle.car));
    expect(refusal(verified).reason).toMatch(/2 roots/);
    expect(refusal(verified).fault).toBe("malformed");
  });

  it("a CAR with no root at all is refused rather than read as an empty bundle", async () => {
    const verified = await verifyBundle(rootlessCar());
    expect(verified).toEqual({
      ok: false,
      entries: [],
      fault: "malformed",
      reason: "car has no root",
    });
  });

  it("a CAR whose root block is absent is refused", async () => {
    const bundle = await buildBundle([
      { role: "atr", bytes: new TextEncoder().encode("# Terms") },
    ]);
    const verified = await verifyBundle(withoutFirstBlock(bundle.car));
    expect(verified).toEqual({
      ok: false,
      entries: [],
      fault: "malformed",
      reason: "manifest block (the root) is absent from the car",
    });
  });

  it("an ENTRY-LESS manifest is refused — the builder will not make one, so the verifier will not bless one", async () => {
    // The disagreement that mattered most: `buildBundle([])` throws (`minItems: 1`), while `{}` and
    // `{"entries":[]}` both came back `{ok: true, entries: []}` — "vacuously complete". An empty bundle
    // evidences nothing, so `ok: true` about one is a false claim, and it is the single worst sentence
    // this function can produce. `vectors/evidence/manifest-documents.json` already rules "empty
    // entries" invalid; this is that ruling reaching the code path a counterparty's bytes travel.
    for (const [label, json] of [
      ["entries key absent", "{}"],
      ["entries present but empty", '{"entries":[]}'],
    ] as const) {
      const car = await carOf([new TextEncoder().encode(json)], 0);
      const verified = await verifyBundle(car);
      expect(refusal(verified).fault, label).toBe("malformed");
      expect(verified.entries, label).toEqual([]);
    }
    // The two are distinguishable in the message: an absent key is a shape fault, an empty list is the
    // minItems rule.
    const absent = await verifyBundle(
      await carOf([new TextEncoder().encode("{}")], 0),
    );
    expect(refusal(absent).reason).toMatch(/manifest entries are malformed/);
    const stated = await verifyBundle(
      await carOf([new TextEncoder().encode('{"entries":[]}')], 0),
    );
    expect(refusal(stated).reason).toMatch(/manifest states no entries/);
  });

  it("a role outside the eighteen is refused, never cast into the vocabulary", async () => {
    // `role as EvidenceRole` made the readout's own type a claim about the counterparty's bytes that
    // nothing had checked — the schema's `role` enum is closed and manifest-documents.json rules an
    // unknown role invalid. Spelled out rather than built from EVIDENCE_ROLES: an assertion made out of
    // the constant it checks cannot fail.
    const car = await carOf(
      [
        new TextEncoder().encode(
          JSON.stringify({
            entries: [
              {
                role: "mystery",
                ref: `lcp:sha256:0x${"7f83b165".repeat(8)}`,
              },
            ],
          }),
        ),
      ],
      0,
    );
    expect(refusal(await verifyBundle(car)).reason).toMatch(
      /manifest entries are malformed/,
    );
    // …and the vocabulary the code checks against is the SCHEMA's, read from the schema rather than
    // restated here. A list retyped in the test would agree with a drifted constant forever.
    expect([...EVIDENCE_ROLES]).toStrictEqual(SCHEMA.$defs.role.enum);
  });

  it("undecodable CAR BYTES are refused as a value — verifyBundle's contract is not an exception", async () => {
    // The bytes are a counterparty's. `decodeCar` throws a typed CidError on every one of these, and it
    // was the unguarded first line of verifyBundle — so the documented value contract held for a corrupt
    // BLOCK but not for a corrupt FRAME, which is the easier of the two to author.
    const cases: [string, Uint8Array][] = [
      ["empty", new Uint8Array(0)],
      ["garbage", new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff])],
      ["truncated header", new Uint8Array([0x20, 0xa2, 0x65])],
    ];
    for (const [label, car] of cases) {
      const verified = await verifyBundle(car);
      expect(refusal(verified).reason, label).toMatch(/car is not decodable/);
      // "We could not read these bytes", never "this bundle does not verify". A CAR whose transfer was
      // cut short is not a counterparty who tampered, and the verdict has to be able to say so.
      expect(refusal(verified).fault, label).toBe("malformed");
      expect(verified.entries, label).toEqual([]);
    }
  });

  it("a manifest whose entries are malformed is refused as a value, not a TypeError", async () => {
    // The manifest block need only hash to the root CID — which also comes off the CAR — so its JSON is
    // entirely counterparty-authored. `entries` was cast, never shape-checked, and each of these reached
    // `e.ref.slice(...)` and threw a raw TypeError out of a function documented to return one.
    const ref = `lcp:sha256:0x${"7f83b165".repeat(8)}`;
    const cases: [string, string][] = [
      // The manifest DOCUMENT itself, before any entry is reached. `JSON.parse` answers each of these
      // happily, and `null` is the one that matters: `typeof null === "object"`, so the null check is
      // the only thing between it and a TypeError on property access.
      ["manifest is null", "null"],
      ["manifest is a number", "7"],
      ["manifest is a string", '"nope"'],
      ["manifest is an array", "[]"],
      ["entries not an array", JSON.stringify({ entries: "nope" })],
      ["entry missing ref", JSON.stringify({ entries: [{ role: "atr" }] })],
      ["null entry", JSON.stringify({ entries: [null] })],
      ["entry is a number", JSON.stringify({ entries: [7] })],
      ["entry is an array", JSON.stringify({ entries: [[]] })],
      ["role not a string", JSON.stringify({ entries: [{ role: 7, ref }] })],
      [
        "ref not a string",
        JSON.stringify({ entries: [{ role: "atr", ref: 7 }] }),
      ],
      [
        "ref not an lcp:sha256 reference",
        JSON.stringify({ entries: [{ role: "atr", ref: "ipfs://bafy" }] }),
      ],
      [
        "assurance not a string",
        JSON.stringify({ entries: [{ role: "atr", ref, assurance: 7 }] }),
      ],
    ];
    for (const [label, json] of cases) {
      const car = await carOf([new TextEncoder().encode(json)], 0);
      const verified = await verifyBundle(car);
      expect(refusal(verified).reason, label).toMatch(
        /manifest entries are malformed/,
      );
      expect(refusal(verified).fault, label).toBe("malformed");
    }
  });

  it("a root block that is not JSON is refused, not parsed as an empty manifest", async () => {
    // Root the CAR at an artifact instead of the manifest: the root block resolves, but its bytes are
    // not a manifest. Treating a parse failure as `{entries: []}` would pass every such bundle.
    const car = await carOf(
      [new TextEncoder().encode("# Terms"), new TextEncoder().encode("x")],
      0,
    );
    const verified = await verifyBundle(car);
    expect(verified).toEqual({
      ok: false,
      entries: [],
      fault: "malformed",
      reason: "manifest is not valid JSON",
    });
  });
});
