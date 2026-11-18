import { readFileSync } from "node:fs";
import { join } from "node:path";

interface Manifest {
  version?: unknown;
  engines?: { node?: unknown };
  peerDependencies?: Record<string, unknown>;
}

/** A package's manifest, read at build time. `next build` runs in website/; the packages are its siblings. */
function manifest(folder: string): Manifest {
  return JSON.parse(readFileSync(join(process.cwd(), "..", folder, "package.json"), "utf8")) as Manifest;
}

function text(value: unknown, what: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${what} is missing`);
  return value;
}

const lcp = manifest("lcp");
const settler = manifest("settler");

/**
 * The version of the package these pages document, read from its manifest at build time.
 * Server components only: it reads the filesystem.
 */
export const packageVersion: string = text(lcp.version, "../lcp/package.json's version");

/** The Node.js versions lcp runs on: its manifest's `engines.node`. */
export const nodeRange: string = text(lcp.engines?.node, "../lcp/package.json's engines.node");

/** The version of the settler, @integraledger/profile-facilitator, from its manifest. */
export const settlerVersion: string = text(settler.version, "../settler/package.json's version");

/** The Node.js versions the settler runs on: its manifest's `engines.node`. */
export const settlerNodeRange: string = text(settler.engines?.node, "../settler/package.json's engines.node");

/**
 * The range of lcp the settler's published manifest asks for. Its manifest names lcp `workspace:~` (or `^`, or `*`),
 * which pnpm publishes as that range of lcp's version.
 */
export const settlerPeerRange: string = (() => {
  const spec = text(settler.peerDependencies?.["@integraledger/lcp"], "../settler/package.json's peer @integraledger/lcp");
  const workspace = /^workspace:([~^*]?)$/.exec(spec);
  if (workspace === null) return spec;
  return workspace[1] === "*" ? packageVersion : `${workspace[1]}${packageVersion}`;
})();

/** What these pages document, as llms.txt and every Markdown copy name it. */
export const documents = `@integraledger/lcp ${packageVersion} and @integraledger/profile-facilitator ${settlerVersion}`;
