// A TypeDoc plugin for the API pages: each page gets YAML frontmatter (`title`, `description`)
// and a first heading naming its import specifier, and the output folder gets a `meta.json`
// listing the pages in the order of the package's `exports`.
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { RendererEvent } from "typedoc";
import { MarkdownPageEvent } from "typedoc-plugin-markdown";

const manifest = JSON.parse(readFileSync(new URL("../../lcp/package.json", import.meta.url), "utf8"));
const packageName = manifest.name;
// Page file names in `exports` order: "." is the entry module, written as index.md.
const order = Object.keys(manifest.exports).map((key) => (key === "." ? "index" : key.slice(2)));

/** The import specifier a page documents, from its file name. */
function specifierOf(file) {
  const name = basename(file, ".md");
  return name === "index" ? packageName : `${packageName}/${name}`;
}

/** @param {import("typedoc").Application} app */
export function load(app) {
  app.renderer.on(MarkdownPageEvent.END, (page) => {
    if (page.contents === undefined) return;
    const specifier = specifierOf(page.filename);
    const summary = page.model.comment?.summary?.map((part) => part.text).join("").trim() ?? "";
    const first = summary.split(/\n\s*\n/)[0]?.replace(/\s+/g, " ").trim() ?? "";
    const description = first.length > 0 ? first : `The exports of ${specifier}.`;
    const body = page.contents.replace(/^# .*\n/, "");
    page.contents = [
      "---",
      `title: ${JSON.stringify(specifier)}`,
      `description: ${JSON.stringify(description)}`,
      "---",
      "",
      `# ${specifier}`,
      "",
      body.replace(/^\n+/, ""),
    ].join("\n");
  });

  app.renderer.on(RendererEvent.END, (event) => {
    const meta = { title: "API", pages: order };
    writeFileSync(join(event.outputDirectory, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
  });
}
