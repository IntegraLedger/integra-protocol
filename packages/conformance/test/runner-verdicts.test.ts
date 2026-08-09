import { describe, expect, it } from "vitest";
import { CliSubject } from "../src/adapters/cli.js";
import { InProcessSubject } from "../src/adapters/inprocess.js";
import { parseCliArgs } from "../src/args.js";
import { runCorpus } from "../src/runner.js";
import type {
  Subject,
  SubjectRequest,
  SubjectResponse,
} from "../src/subject.js";

/**
 * The runner's own verdict logic, over a MINIATURE corpus (test/fixtures/mini) rather than the real one.
 *
 * runner.test.ts only ever runs the real corpus GREEN, which cannot distinguish a runner that compares
 * from a runner that agrees with everything — and this is the code every downstream conformance claim
 * rests on. A `deepEqual` that returned true, or a `passed++` that ran unconditionally, would certify a
 * subject that answers with garbage. So these cases drive it RED on purpose.
 *
 * The fixture corpus has one P1 area (an output case + an error case) and one P4 area.
 */
const MINI = new URL("./fixtures/mini/", import.meta.url);

/** Echoes its input back, or refuses with a stated code — enough to be right, wrong, or wrong-shaped. */
class EchoSubject implements Subject {
  // Declared-and-assigned, not a `private readonly` constructor parameter: parameter properties are
  // TypeScript-only syntax that cannot be erased, and the workspace compiles under `erasableSyntaxOnly`.
  private readonly mode:
    | "honest"
    | "wrong-output"
    | "wrong-code"
    | "always-error"
    | "always-output";

  constructor(
    mode:
      | "honest"
      | "wrong-output"
      | "wrong-code"
      | "always-error"
      | "always-output",
  ) {
    this.mode = mode;
  }
  async handle(req: SubjectRequest): Promise<SubjectResponse> {
    const input = req.input as { say?: string; fail?: string };
    switch (this.mode) {
      case "honest":
        return input.fail === undefined
          ? { output: input }
          : { error: input.fail };
      case "wrong-output":
        return { output: { say: "something else" } };
      case "wrong-code":
        return { error: "mini/a-different-code" };
      case "always-error":
        return { error: "mini/expected-code" };
      case "always-output":
        return { output: input };
    }
  }
}

const run = (subject: Subject, phase?: string) =>
  runCorpus(subject, {
    vectors: MINI,
    ...(phase === undefined ? {} : { phase }),
  });

describe("the runner's verdict is a comparison, not an assumption", () => {
  it("an honest subject passes every case at the wired phase", async () => {
    const report = await run(new EchoSubject("honest"), "P4");
    expect(report).toEqual({
      passed: 3,
      skipped: [],
      failed: [],
      // The mini fixture tree carries no seal, and that reads as a gap rather than as an error: pointing
      // the runner at a corpus under development is supported. What it must never do is report the tree as
      // complete, so there are no `expected` counts to compare the actuals against.
      corpus: {
        sealed: false,
        authentic: false,
        areas: { actual: 2 },
        cases: { actual: 3 },
      },
    });
  });

  it("a wrong OUTPUT is counted failed, and reported with both sides", async () => {
    const report = await run(new EchoSubject("wrong-output"), "P1");
    expect(report.passed).toBe(0);
    expect(report.failed).toContainEqual({
      area: "mini.early",
      case: "expects-an-output",
      expected: { say: "hello" },
      got: { say: "something else" },
    });
  });

  it("a wrong REFUSAL CODE is counted failed — any error is not the expected error", async () => {
    const report = await run(new EchoSubject("wrong-code"), "P1");
    expect(report.failed).toContainEqual({
      area: "mini.early",
      case: "expects-a-refusal-code",
      expected: "mini/expected-code",
      got: "mini/a-different-code",
    });
  });

  it("a case that expects a REFUSAL is not satisfied by an output", async () => {
    // The branch is chosen by what the VECTOR expects, not by what the subject returned. Choosing it
    // the other way round would let a subject that never refuses pass every negative case in the corpus.
    const report = await run(new EchoSubject("always-output"), "P1");
    const failed = report.failed.map((f) => f.case);
    expect(failed).toContain("expects-a-refusal-code");
    expect(failed).not.toContain("expects-an-output");
    expect(report.passed).toBe(1);
  });

  it("a case that expects an OUTPUT is not satisfied by a refusal, even the right code", async () => {
    const report = await run(new EchoSubject("always-error"), "P1");
    const failed = report.failed.map((f) => f.case);
    expect(failed).toContain("expects-an-output");
    expect(failed).not.toContain("expects-a-refusal-code");
    expect(report.passed).toBe(1);
  });
});

describe("the phase ladder", () => {
  it("defaults to P1, which SKIPS the later areas rather than running them", async () => {
    const report = await run(new EchoSubject("honest"));
    expect(report.passed).toBe(2);
    expect(report.skipped).toEqual(["mini.late"]);
  });

  it.each(["P4", "P5", "P6"])(
    "at %s the whole ladder runs and nothing is skipped (later rungs are a floor, not a filter)",
    async (phase) => {
      const report = await run(new EchoSubject("honest"), phase);
      expect(report.skipped).toEqual([]);
      expect(report.passed).toBe(3);
    },
  );

  it("a phase that is not on the ladder throws instead of silently running nothing", async () => {
    // Returning -1 here would make every area compare as later-than-requested: a run of ZERO cases,
    // reported as zero failures. A conformance claim from that run would be true and worthless.
    await expect(run(new EchoSubject("honest"), "P2")).rejects.toThrow(
      /unknown phase/,
    );
  });
});

describe("CliSubject", () => {
  it("rejects when the executable cannot be spawned, rather than hanging on it", async () => {
    // Without the 'error' listener this promise never settles, and the corpus run hangs forever with
    // no output — the worst failure mode for a gate that other implementations depend on.
    await expect(
      new CliSubject("integra-no-such-executable-exists").handle({
        class: "echo",
        input: {},
      }),
    ).rejects.toThrow();
  });

  it("rejects when the subject writes something that is not JSON", async () => {
    // The same hang, one step later: a subject that prints a stack trace, or nothing at all, must
    // surface as a parse error against the offending subject — not as a run that never finishes.
    await expect(
      new CliSubject("node", ["-e", "process.stdout.write('not json')"]).handle(
        { class: "echo", input: {} },
      ),
    ).rejects.toThrow();
  });
});

describe("InProcessSubject", () => {
  it("refuses a schema-class request that carries no schema", async () => {
    // The runner passes the canonical schema INLINE (subjects stay tree-independent), so an absent
    // one is a harness defect. Validating against `undefined` would pass every document instead.
    const res = await new InProcessSubject().handle({
      class: "schema",
      input: { anything: true },
    });
    expect(res.error).toBe("schema/missing");
  });

  it("refuses an UNKNOWN verify step rather than running one of the known ones", async () => {
    // The dispatch arm is a chain of equality checks, so a mis-typed or not-yet-wired step name must
    // fall through to a NAMED error. Without the check it would reach the last arm's handler and be
    // silently evaluated as `reference-placement` — a case reading out a verdict for a step nobody ran,
    // which is worse than no verdict because it looks like one.
    const res = await new InProcessSubject().handle({
      class: "verifyStep",
      input: { step: "resolve-parties" }, // plural: the near-miss a typo actually produces
    });
    expect(res.error).toBe("unknown-verify-step:resolve-parties");
    expect(res.output).toBeUndefined();
  });

  it("dispatches resolve-party to the identity step, not to the fallthrough arm", async () => {
    const res = await new InProcessSubject().handle({
      class: "verifyStep",
      input: {
        step: "resolve-party",
        identity: {
          seller: {
            subject: "s",
            assurance: "legal-party",
            chain: [{ via: "domain-control" }],
          },
          buyer: {
            subject: "b",
            assurance: "wallet-signature-only",
            chain: [{ via: "key" }],
          },
        },
      },
    });
    expect(res.error).toBeUndefined();
    expect(res.output).toEqual({ status: "proved" });
  });
});

describe("parseCliArgs", () => {
  const DEFAULTS = {
    vectors: new URL("file:///packaged/vectors/"),
    phase: "P4",
  };
  const argv = (...flags: string[]) => ["node", "cli.js", ...flags];

  it("falls back to the packaged tree and the wired phase when neither flag is given", () => {
    expect(parseCliArgs(argv(), DEFAULTS)).toEqual({
      ...DEFAULTS,
      vectorsExplicit: false,
    });
  });

  it("records whether --vectors was NAMED, which is what makes an unrecognised corpus a refusal or a fact", () => {
    // Not derivable by comparing the resulting URL to the default: a caller who passes `--vectors` at the
    // packaged path has still stated an intent, and the difference decides whether the CLI exits non-zero.
    expect(
      parseCliArgs(argv("--vectors", "/tmp/x"), DEFAULTS).vectorsExplicit,
    ).toBe(true);
    expect(parseCliArgs(argv("--phase", "P1"), DEFAULTS).vectorsExplicit).toBe(
      false,
    );
  });

  it("resolves --vectors to a DIRECTORY url, so the manifest resolves inside the tree", () => {
    const { vectors } = parseCliArgs(
      argv("--vectors", "/tmp/corpus"),
      DEFAULTS,
    );
    expect(vectors.href.endsWith("/tmp/corpus/")).toBe(true);
    // Without the trailing slash `new URL("conformance/…", vectors)` would resolve to /tmp/ —
    // reading a manifest BESIDE the named tree rather than in it.
    expect(new URL("conformance/corpus-manifest.json", vectors).pathname).toBe(
      "/tmp/corpus/conformance/corpus-manifest.json",
    );
  });

  it("takes --phase over the wired default", () => {
    expect(parseCliArgs(argv("--phase", "P1"), DEFAULTS).phase).toBe("P1");
    expect(parseCliArgs(argv("--phase", "P1"), DEFAULTS).vectors).toBe(
      DEFAULTS.vectors,
    );
  });

  it.each([
    ["--vectors", /--vectors requires a path/],
    ["--phase", /--phase requires a value/],
  ])(
    "%s with no value FAILS LOUD instead of quietly using the default",
    (flag, complaint) => {
      expect(() => parseCliArgs(argv(flag), DEFAULTS)).toThrow(complaint);
    },
  );

  it("reads both flags together, in either order", () => {
    const both = parseCliArgs(
      argv("--phase", "P3", "--vectors", "/tmp/corpus"),
      DEFAULTS,
    );
    expect(both.phase).toBe("P3");
    expect(both.vectors.href.endsWith("/tmp/corpus/")).toBe(true);
  });
});
