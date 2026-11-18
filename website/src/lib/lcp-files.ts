import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { brief } from "@/lib/llms";
import { siteConfig } from "@/lib/site";

/**
 * A file of lcp/profiles/ or lcp/vectors/, which the site serves byte for byte at `/profiles/<name>` and
 * `/vectors/<name>`, from the commit it is built from, so an agent reads the normative profiles and the shared vectors
 * as Markdown and JSON. Server only: it reads the filesystem at build time.
 */
export interface LcpFile {
  /** The file's name, in the repository and on the site. */
  name: string;
  /** Its address on the site. */
  path: string;
  /** Its bytes, as the repository holds them. */
  bytes: Buffer;
  /** The line an index lists it with. */
  description: string;
}

/** `next build` runs in website/; the package is its sibling. */
const LCP = join(process.cwd(), "..", "lcp");

function filesOf(folder: "profiles" | "vectors", ext: string): Array<{ name: string; bytes: Buffer }> {
  return readdirSync(join(LCP, folder))
    .filter((name) => name.endsWith(ext))
    .sort()
    .map((name) => ({ name, bytes: readFileSync(join(LCP, folder, name)) }));
}

/** Every profile, `lcp/profiles/*.md`, described by its opening sentence (`**LCP profile `x`: …**`). */
export function profiles(): LcpFile[] {
  return filesOf("profiles", ".md").map(({ name, bytes }) => {
    const text = bytes.toString("utf8");
    const opening = /^\*\*(.+?)\*\*/.exec(text)?.[1] ?? text.split(/\n\s*\n/)[0] ?? name;
    return { name, path: `/profiles/${name}`, bytes, description: brief(opening.replace(/\.$/, "")) };
  });
}

/** Every vector file, `lcp/vectors/*.json`, described by the first sentence of its `about`. */
export function vectorFiles(): LcpFile[] {
  return filesOf("vectors", ".json").map(({ name, bytes }) => {
    const about: unknown = (JSON.parse(bytes.toString("utf8")) as { about?: unknown }).about;
    if (typeof about !== "string" || about.length === 0) throw new Error(`lcp/vectors/${name} has no about`);
    const first = /^.+?(?<!\b(?:e\.g|i\.e|etc|vs))[.!?](?=\s|$)/s.exec(about.trim())?.[0] ?? about;
    return { name, path: `/vectors/${name}`, bytes, description: brief(first) };
  });
}

/** An index of files, in llms.txt's form, at `<folder>/llms.txt`. */
export function indexOf(title: string, summary: string, prose: string[], files: LcpFile[]): string {
  return `${[
    `# ${title}`,
    "",
    `> ${summary}`,
    "",
    ...prose,
    "",
    "## Files",
    "",
    ...files.map((f) => `- [${f.name}](${siteConfig.url}${f.path}): ${f.description}`),
  ].join("\n")}\n`;
}
