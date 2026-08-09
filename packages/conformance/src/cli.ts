#!/usr/bin/env node
import { InProcessSubject } from "./adapters/inprocess.js";
import { parseCliArgs } from "./args.js";
import { runCorpus } from "./runner.js";
import { summarize } from "./summary.js";

// The highest phase whose behavioral dispatch is wired into InProcessSubject. Bumped in the SAME
// commit that adds a dispatch case — the manifest is never edited to lie.
// Raised to P3 once EVERY phase:"P3" area had an owner: carrier (binding-core) + legalContext
// (discovery). A bump before both were wired would run an unwired area → unknown-class (the ordering
// rule).
// Raised to P4 on the same rule: BOTH phase:"P4" areas are owned in the commit that bumps this —
// verify.classLadder (verifyClass) and verify.recourse (recourse), the class ladder and RCS-1/2/4
// promoted out of verify's private tests into the cross-party corpus.
// Raised to P8 on 2026-08-02, LATE — the contract above was broken once. The P8 dispatch arms landed
// with the protocol-surface work (all 14 phase:"P8" areas owned: the nine placements plus
// placement.dispatch, placement.manifestSchema, vocabulary.protocolId, verify.referencePlacement and
// discovery.capability), but this constant was never touched. Every bare `lcp-conformance` run in
// between certified roughly half the corpus and printed the other 14 areas as `skipped` — loud, never
// silent, but a green nobody had asked for. Hence the floor is pinned to the top phase and MUST move
// with the corpus, in the same commit that wires it.
// P5/P6 exist on the ladder in runner.ts and own no areas; P8 is therefore the whole corpus today.
const WIRED_PHASE = "P8";

const { vectors, phase, vectorsExplicit } = parseCliArgs(process.argv, {
  // Default: the tree packaged with this build, whose identity is the seal's root digest.
  vectors: new URL("../vectors/", import.meta.url),
  phase: WIRED_PHASE,
});
const report = await runCorpus(new InProcessSubject(), { vectors, phase });

// The shell does nothing but move the result to the process. Everything that DECIDES anything — the corpus
// identity line, the refusal, the exit code — is in `summary.ts`, because this file cannot be imported by a
// test: it is top-level await that runs a whole corpus on load, so every line here is unreachable by the
// suite. Logic that decides whether a conformance run passes does not belong somewhere nothing can check it.
const { out, err, exitCode } = summarize(report, vectorsExplicit);
for (const line of out) console.log(line);
for (const line of err) console.error(line);
process.exit(exitCode);
