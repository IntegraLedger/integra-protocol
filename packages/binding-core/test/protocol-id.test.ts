import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isKnownProtocolId,
  KNOWN_PROTOCOL_IDS,
  type ProtocolId,
} from "../src/protocol-id.js";

// The tree is the source of truth: the TS union must equal the schema enum exactly, so the two
// representations cannot drift.
const schema = JSON.parse(
  readFileSync(
    new URL(
      "../../../vectors/vocabulary/protocol-id.schema.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as { enum: string[] };

const cases = JSON.parse(
  readFileSync(
    new URL(
      "../../../vectors/vocabulary/protocol-id-documents.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as { cases: { name: string; input: unknown; expected: boolean }[] };

// Written out rather than derived from KNOWN_PROTOCOL_IDS: deriving it would make this test assert that a
// value equals itself. The point is that a human-written union and the tree agree.
const UNION: ProtocolId[] = [
  "x402",
  "mpp",
  "ap2",
  "ack",
  "acp",
  "ucp",
  "visa-tap",
  "mastercard-vi",
  "a2a",
  "mcp",
];

describe("protocol-id ↔ tree", () => {
  it("ProtocolId union equals the schema enum exactly", () => {
    expect([...UNION].sort()).toEqual([...schema.enum].sort());
  });

  it("KNOWN_PROTOCOL_IDS preserves the schema's declared order", () => {
    expect([...KNOWN_PROTOCOL_IDS]).toEqual(schema.enum);
  });

  for (const c of cases.cases) {
    it(`isKnownProtocolId — ${c.name}`, () => {
      expect(isKnownProtocolId(c.input)).toBe(c.expected);
    });
  }
});
