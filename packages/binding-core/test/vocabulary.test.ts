import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type {
  AssetBinding,
  BindingPattern,
  HaltClass,
} from "../src/vocabulary.js";

// The tree is the source of truth: each TS union must equal its schema enum exactly, so the two
// representations cannot drift.
function read(rel: string): unknown {
  return JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));
}

const halt = read("../../../vectors/vocabulary/halt-class.schema.json") as {
  enum: string[];
};
const profile = read("../../../vectors/binding/profile.schema.json") as {
  properties: {
    pattern: { enum: string[] };
    assetBinding: { enum: string[] };
  };
};

const HALT_UNION: HaltClass[] = [
  "risk-block",
  "policy-rejection",
  "verification-failure",
];

const PATTERN_UNION: BindingPattern[] = [
  "native-field",
  "overlay-contract",
  "sidecar-attestation",
  "opaque-challenge",
  "id-reuse",
  "protocol-extension",
  "http-advisory",
];

const ASSET_BINDING_UNION: AssetBinding[] = [
  "filtered",
  "carried",
  "proposal-only",
  "none",
];

describe("vocabulary ↔ tree", () => {
  it("HaltClass union equals the halt-class schema enum", () => {
    expect([...HALT_UNION].sort()).toEqual([...halt.enum].sort());
  });

  it("BindingPattern union equals the profile schema's pattern enum", () => {
    expect([...PATTERN_UNION].sort()).toEqual(
      [...profile.properties.pattern.enum].sort(),
    );
  });

  it("AssetBinding union equals the profile schema's assetBinding enum", () => {
    expect([...ASSET_BINDING_UNION].sort()).toEqual(
      [...profile.properties.assetBinding.enum].sort(),
    );
  });
});
