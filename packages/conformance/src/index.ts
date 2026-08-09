export { CliSubject } from "./adapters/cli.js";
export { InProcessSubject } from "./adapters/inprocess.js";
export { CORPUS_ROOT } from "./corpus-root.js";
export { type Report, type RunOptions, runCorpus } from "./runner.js";
// `CorpusProvenance` is reachable from `Report.corpus`, so it has to be nameable — the exports map offers
// only ".", and a type a consumer can receive but cannot write down is not a public type.
//
// The rest of the seal surface is exported on purpose rather than incidentally. This package's whole claim
// is that a third party can check our work without asking us; `verifyCorpusSeal` and `CORPUS_ROOT` are that
// same claim applied to the corpus itself, so someone can verify the tree we shipped against the digest we
// compiled in — independently, with our own code or their own reading of it.
export {
  type CorpusProvenance,
  type CorpusReader,
  type CorpusSeal,
  computeRoot,
  verifyCorpusSeal,
} from "./seal.js";
export type { Subject, SubjectRequest, SubjectResponse } from "./subject.js";
