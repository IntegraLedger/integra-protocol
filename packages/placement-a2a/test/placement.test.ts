import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { a2aPlacement } from "../src/index.js";

const vec = JSON.parse(
  readFileSync(
    new URL("../../../vectors/placement/a2a.json", import.meta.url),
    "utf8",
  ),
) as {
  cases: {
    name: string;
    input: {
      op: "place" | "place-purity" | "extract";
      ref?: { type: string; value: string };
      doc: unknown;
    };
    expected?: unknown;
  }[];
};

describe("A2A placement — cases", () => {
  for (const c of vec.cases) {
    it(c.name, () => {
      const { op, doc } = c.input;
      // The narrowing cast is the SAME one the conformance subject makes when it reads `ref` out of JSON,
      // and one case relies on it: `place REFUSES a carrier type outside the §8.2 registry` carries
      // `sha512`, which no TypeScript caller can express. That arm exists for the untyped door, so the test
      // has to stand in that door to reach it.
      const ref = c.input.ref as {
        type: "sha256" | "ipfs" | "ar" | "url";
        value: string;
      };

      if (op === "place-purity") {
        const before = JSON.stringify(doc);
        a2aPlacement.place(ref, doc);
        expect(JSON.stringify(doc)).toBe(before);
        return;
      }

      // The vector pins the whole `Outcome` on BOTH arms and for BOTH members — the same shape the
      // conformance area certifies, so the unit test and the corpus cannot disagree about what this
      // package returns. Refusals are matched STRUCTURALLY (refused/haltClass/code) because `detail` is
      // human-facing prose the vector deliberately omits; successes are matched EXACTLY, because the
      // document a placement emits IS the wire contract and an extra or missing key there must fail.
      const out =
        op === "extract"
          ? a2aPlacement.extract(doc)
          : a2aPlacement.place(ref, doc);
      if ("refused" in out) expect(out).toMatchObject(c.expected as object);
      else expect(out).toEqual(c.expected);
    });
  }
});

describe("A2A placement — purity proven by construction, not by comparison", () => {
  it("places into a deeply FROZEN task without touching it", () => {
    // Stronger than the corpus's purity case, which re-serializes either side of the call: a mutate-then-
    // restore would pass that and throw here. A2A tasks are shared server-side state, and a placement that
    // wrote into the caller's object would corrupt whatever else holds a reference to it.
    const task = Object.freeze({
      id: "task_frozen",
      metadata: Object.freeze({ traceId: "t-1" }),
    });
    const out = a2aPlacement.place(
      {
        type: "sha256",
        value:
          "0x7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069",
      },
      task,
    );
    expect(out).toEqual({
      ok: true,
      value: {
        id: "task_frozen",
        metadata: {
          traceId: "t-1",
          legalContext: {
            type: "sha256",
            value:
              "0x7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069",
          },
        },
      },
    });
    expect(task).toEqual({ id: "task_frozen", metadata: { traceId: "t-1" } });
  });
});
