/**
 * THE HOST-SPECIFICATION PINS ARE WELL-FORMED, AND THEY COVER THE HOSTS THIS TREE TALKS ABOUT.
 *
 * `spec-pins.json` names every host specification a package makes claims about and the revision it was
 * read at. `pnpm spec-drift` compares those revisions against upstream when a maintainer runs it — by
 * hand, because this repository stands alone and does not take a scheduled dependency on eight
 * third-party APIs. This test is the offline half, and it is the half that runs in `verify`: it cannot
 * tell whether a host has moved, but it can guarantee the file is worth reading, which is the part that
 * rots silently.
 *
 * ★ WHY IT EXISTS. Measured 2026-08-12, shipped source carried about thirty-six host claims pinned by DATE
 * ("read 2026-08-08") and roughly ten by revision. A date cannot be checked by anything, which is why an
 * external-conformance audit of this tree "has a shelf life measured in weeks" — its own words. The pins
 * turn that into a scheduled job; this keeps the pins honest.
 *
 * ★ WHAT IT ASSERTS, AND WHY EACH ONE. Structure, so the runner cannot silently skip a malformed entry.
 * Coverage, so adding a placement for a new protocol without pinning its host fails here rather than
 * going unnoticed. And that every `drifted` entry carries a note — a recorded debt is only a debt if it
 * says what is owed; without that it is indistinguishable from an entry nobody has looked at.
 */
import { readdirSync, readFileSync } from "node:fs";
import { KNOWN_PROTOCOL_IDS } from "@integraledger/lcp-binding-core";
import { describe, expect, it } from "vitest";

const ROOT = new URL("../../../", import.meta.url).pathname;

type Host = {
  id: string;
  repo?: string;
  url?: string;
  paths?: string[];
  readAt?: string;
  readOn: string;
  status?: "current" | "drifted";
  pinnable?: false;
  reason?: string;
  note?: string;
  citedBy: string[];
};

const PINS = JSON.parse(readFileSync(`${ROOT}spec-pins.json`, "utf8")) as {
  hosts: Host[];
};

describe("spec-pins.json is a file worth running a drift job against", () => {
  it("parses, and pins a plausible number of hosts", () => {
    // The blind-gate canary. An empty or truncated file makes every assertion below vacuous.
    expect(PINS.hosts.length).toBeGreaterThan(8);
  });

  it("every host is either pinned by revision or says why it cannot be", () => {
    const bad = PINS.hosts
      .filter((h) =>
        h.pinnable === false
          ? !(h.url && h.reason)
          : !(h.repo && h.paths?.length && h.readAt && h.status),
      )
      .map((h) => h.id);
    // A host with neither a revision nor a stated reason is the date-pinning this file exists to end.
    expect(bad).toEqual([]);
  });

  it("every readAt is a git object id, and every readOn a date", () => {
    for (const h of PINS.hosts) {
      if (h.readAt !== undefined)
        expect(h.readAt, h.id).toMatch(/^[0-9a-f]{10,40}$/);
      expect(h.readOn, h.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("every drifted host records what the re-read owes", () => {
    const silent = PINS.hosts
      .filter((h) => h.status === "drifted" && (h.note ?? "").length < 80)
      .map((h) => h.id);
    // A drifted pin with no note is indistinguishable from one nobody has looked at, and the weekly job
    // does not fail on it — so the note is the only thing standing between a recorded debt and a hole.
    expect(silent).toEqual([]);
  });

  it("every cited package exists, and no package is cited twice by one host", () => {
    const dirs = new Set(readdirSync(`${ROOT}packages`));
    for (const h of PINS.hosts) {
      expect(h.citedBy.length, `${h.id} cites nothing`).toBeGreaterThan(0);
      expect(new Set(h.citedBy).size, `${h.id} repeats a package`).toBe(
        h.citedBy.length,
      );
      for (const pkg of h.citedBy)
        expect(dirs.has(pkg), `${h.id} cites missing package ${pkg}`).toBe(
          true,
        );
    }
  });

  it("every protocol this tree places into has a pinned host", () => {
    // The coverage assertion, and the reason this test lives beside the manifests. `mcp` is the one
    // protocol id with no placement — a delivery surface rather than a carrier — so it is the one id that
    // legitimately needs no host pin. Everything else does: a placement is a claim about a host.
    const pinned = new Set(PINS.hosts.map((h) => h.id));
    const missing = KNOWN_PROTOCOL_IDS.filter(
      (id) =>
        id !== "mcp" &&
        !pinned.has(id === "mastercard-vi" ? "verifiable-intent" : id),
    );
    expect(missing).toEqual([]);
  });
});
