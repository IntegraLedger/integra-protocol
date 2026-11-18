import { DOCUMENTS } from "@/lib/lcp-documents";
import { indexOf, profiles, vectorFiles } from "@/lib/lcp-files";
import {
  brief,
  markdownUrl,
  orderedPages,
  type PageFacts,
  pagesFile,
  SECTION_FILES,
  sectionHeading,
  sectionPages,
  sizeOf,
} from "@/lib/llms";
import { absoluteUrl, siteConfig } from "@/lib/site";
import {
  documents,
  nodeRange,
  packageVersion,
  settlerNodeRange,
  settlerPeerRange,
  settlerVersion,
} from "@/lib/version";

// The text of the site's files for language models (https://llmstxt.org), each served by a route of its own. Server
// only: the versions and the LCP files are read from the filesystem at build time.

const FACTS: PageFacts = { versions: documents };

/** The facts every Markdown copy states: the versions the pages document. */
export const pageFacts = FACTS;

/** `/llms-full.txt`: every page, in sidebar order. */
export async function fullFile(): Promise<string> {
  return pagesFile(
    [
      `# ${siteConfig.name}`,
      "",
      `> ${siteConfig.description}`,
      "",
      `Every page of ${siteConfig.url}, in the order of its index, ${siteConfig.url}/llms.txt. They document ${documents}. ` +
        "This file is larger than most context windows: the index lists each section's own file, and each page.",
    ],
    orderedPages().map(({ page }) => page),
    FACTS,
  );
}

/** `<path>/llms-full.txt`: the pages of one section of `/llms.txt`. */
export async function sectionFile(path: string): Promise<string> {
  const file = SECTION_FILES.find((f) => f.path === path);
  const pages = sectionPages(path);
  return pagesFile(
    [
      `# ${siteConfig.name}: ${sectionHeading(file?.section)}`,
      "",
      `> The ${pages.length} pages of the section ${sectionHeading(file?.section)} of ${siteConfig.url}/llms.txt, in its order. ` +
        `They document ${documents}.`,
    ],
    pages,
    FACTS,
  );
}

/** `/profiles/llms-full.txt`: every profile, whole, as lcp/profiles/ holds it. */
export function profilesFile(): string {
  const list = profiles();
  const header = [
    `# ${siteConfig.name}: the LCP profiles`,
    "",
    `> The ${list.length} profiles of ${siteConfig.package.name} ${packageVersion}, each the normative rules of a pairing ` +
      `or a document, as lcp/profiles/ holds them. Index: ${siteConfig.url}/profiles/llms.txt.`,
  ].join("\n");
  const bodies = list.map((f) => `# ${f.name}\n\nSource: ${siteConfig.url}${f.path}\n\n${f.bytes.toString("utf8").trim()}`);
  return `${header}\n\n${bodies.join("\n\n---\n\n")}\n`;
}

/** `/profiles/llms.txt`: every profile, with its opening sentence. */
export function profilesIndex(): string {
  const list = profiles();
  return indexOf(
    `${siteConfig.name}: the LCP profiles`,
    `The normative rules of each pairing ${siteConfig.package.name} ${packageVersion} implements, and of the documents ` +
      "it publishes, one Markdown file each, as lcp/profiles/ holds them.",
    [
      "Each profile states the rules of one pairing (where H, the ATR hash, rides in its payment, what is checked and " +
        "refused, and what the read of a landed payment answers), or of a part several pairings share, such as " +
        `read-status.md and x402-request-commitment.md. The pairing registry (${siteConfig.url}/reference/pairings.md) ` +
        "names each pairing's profile and export.",
      "",
      `Every profile in one file: ${siteConfig.url}/profiles/llms-full.txt (${sizeOf(profilesFile())}).`,
    ],
    list,
  );
}

/** `/vectors/llms.txt`: every vector file, with the first sentence of its `about`. */
export function vectorsIndex(): string {
  const list = vectorFiles();
  return indexOf(
    `${siteConfig.name}: the LCP vector files`,
    `The shared test vectors of ${siteConfig.package.name} ${packageVersion}: the inputs and expected outputs that fix ` +
      "each rule byte for byte, for any implementation in any language, one JSON file each.",
    [
      "Each file's `about` member states what it covers and where its expected values come from. How to run them: " +
        `${siteConfig.url}/concepts/vectors.md. Every file's \`about\`, whole: ${siteConfig.url}/reference/vectors.md.`,
    ],
    list,
  );
}

/**
 * `/llms.txt`: what the pages document, the rules they rely on, then every page in sidebar order as Markdown, each
 * section led by the file of all its pages with its size, the LCP documents, profiles and vectors, and, under
 * Optional, the whole site in one file and the project's links.
 */
export async function llmsIndex(): Promise<string> {
  const pages = orderedPages();
  const updated = pages
    .map(({ page }) => page.data.lastModified?.toISOString().slice(0, 10))
    .filter((d) => d !== undefined)
    .sort()
    .at(-1);
  const node =
    nodeRange === settlerNodeRange ? `both on Node.js ${nodeRange}` : `on Node.js ${nodeRange} and ${settlerNodeRange}`;
  const lines: string[] = [
    `# ${siteConfig.name}`,
    "",
    `> ${siteConfig.description}`,
    "",
    `These pages document ${siteConfig.package.name} ${packageVersion} and its x402 settler, ${siteConfig.settler.name} ` +
      `${settlerVersion} (peer ${siteConfig.package.name} ${settlerPeerRange}), ${node}.` +
      `${updated === undefined ? "" : ` Pages last updated ${updated}.`} Under 0.x a minor release may change the API: ` +
      `these pages hold for these versions (\`npm install ${siteConfig.package.name}@${packageVersion}\`).`,
    "",
    "This site is for sellers, settlers and implementers of the Legal Context Protocol (LCP). An agent that pays a " +
      `seller uses the buyer gate packages, documented at ${siteConfig.termsUrl}/llms.txt.`,
    "",
    "Rules these pages rely on:",
    "- H, the ATR hash, is SHA-256 over the ATR's bytes exactly as the seller serves them: pass those bytes to `hash` " +
      "(a `Uint8Array`; it rejects any other value, a string included), never a parsed and re-serialized ATR, and " +
      "compare two hashes with `hashEquals`.",
    "- Failures are values: a function whose type carries a refusal returns `{ refused: true, code }` and does not " +
      "throw; test the result with `isRefusal` and handle each code (Refusal codes, below). Only `hash`, which " +
      "rejects, and the writers that encode a value you supply throw, on an argument outside their type.",
    "- A pairing whose registry row says Confirmed `no` has not been shown by anything outside lcp (Pairing registry, " +
      "below). Its profile, under LCP documents, states its rules.",
    `- To pay a seller from an agent, use the buyer gate packages (${siteConfig.termsUrl}/llms.txt) rather than ` +
      "assembling the gate from these pieces.",
    "",
    "Each page link below is the page as Markdown; the same address without `.md` is the HTML page, and a request " +
      "there whose Accept header ranks `text/markdown` at least as high as `text/html` gets the Markdown. A section's " +
      "first link is all of its pages in one file. Sizes in tokens are estimates, at 4 bytes a token.",
  ];

  let section: string | undefined;
  let first = true;
  for (const { section: s, page } of pages) {
    if (first || s !== section) {
      section = s;
      first = false;
      lines.push("", `## ${sectionHeading(section)}`, "");
      const file = SECTION_FILES.find((f) => f.section === section);
      if (file !== undefined) {
        const count = sectionPages(file.path).length;
        const what = section === "API" ? "Generated from the source of each entry point; " : "";
        lines.push(
          `- [The ${count} ${sectionHeading(section)} pages in one file](${siteConfig.url}${file.path}/llms-full.txt): ` +
            `${what}${sizeOf(await sectionFile(file.path))}.`,
        );
      }
    }
    const description = page.data.description ? `: ${brief(page.data.description)}` : "";
    lines.push(`- [${page.data.title}](${absoluteUrl(markdownUrl(page.url))})${description}`);
  }

  lines.push(
    "",
    "## LCP documents",
    "",
    ...DOCUMENTS.map((d) => `- [${d.title}](${siteConfig.url}${d.path}): ${d.description}`),
    `- [Pairing profiles](${siteConfig.url}/profiles/llms.txt): The index of the ${profiles().length} profiles, the ` +
      "normative rules of each pairing and document, one Markdown file each.",
    `- [Every profile in one file](${siteConfig.url}/profiles/llms-full.txt): ${sizeOf(profilesFile())}.`,
    `- [Vector files](${siteConfig.url}/vectors/llms.txt): The index of the ${vectorFiles().length} shared test ` +
      "vector files, one JSON file each, with what each one fixes.",
    "",
    "## Optional",
    "",
    `- [Every page in one file](${siteConfig.url}/llms-full.txt): ${sizeOf(await fullFile())}; larger than most ` +
      "context windows, so prefer a section's file.",
    `- [Source](${siteConfig.githubUrl}): The repository.`,
    `- [${siteConfig.package.name} on npm](${siteConfig.package.npm})`,
    `- [${siteConfig.settler.name} on npm](${siteConfig.settler.npm})`,
    `- [${siteConfig.spec.name}](${siteConfig.spec.url}): The protocol's specification.`,
    `- [Security policy](${siteConfig.githubUrl}/blob/main/SECURITY.md)`,
    `- [License, ${siteConfig.license.name}](${siteConfig.githubUrl}/blob/main/LICENSE)`,
  );
  return `${lines.join("\n")}\n`;
}

/** A route's answer: `text` as plain text, or as the Markdown it is. */
export function textResponse(text: string | Buffer, type = "text/plain; charset=utf-8"): Response {
  return new Response(typeof text === "string" ? text : new Uint8Array(text), { headers: { "content-type": type } });
}
