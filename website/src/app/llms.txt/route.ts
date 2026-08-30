import { orderedPages } from "@/lib/llms";
import { description, packages } from "@/lib/packages";
import { absoluteUrl, siteConfig } from "@/lib/site";
import { packageVersion } from "@/lib/version";

// Required for route handlers under `output: export`.
export const dynamic = "force-static";

/**
 * `/llms.txt` — the index an AI crawler reads first (https://llmstxt.org). Generated from
 * the live page tree, in sidebar order, with absolute URLs, so it cannot list a page that
 * does not exist or omit one that does. The bodies are at `/llms-full.txt`.
 */
export function GET() {
  const lines: string[] = [
    `# ${siteConfig.name}`,
    "",
    `> ${description}`,
    "",
    `${packages.length} Apache-2.0 packages, all published to npm under \`${siteConfig.npmScope}\` at \`${packageVersion}\`, implementing the ${siteConfig.standard.name} (${siteConfig.standard.short}): ${siteConfig.standard.specUrl}. This site documents the implementation; the specification is published separately.`,
    "",
    `- Full documentation as one Markdown file: ${siteConfig.url}/llms-full.txt`,
    `- Source: ${siteConfig.githubUrl}`,
  ];

  let section: string | undefined;
  for (const { section: s, page } of orderedPages()) {
    if (s !== section) {
      section = s;
      lines.push("", `## ${section ?? "Overview"}`, "");
    }
    const description = page.data.description
      ? `: ${page.data.description}`
      : "";
    lines.push(
      `- [${page.data.title}](${absoluteUrl(page.url)})${description}`,
    );
  }

  return new Response(`${lines.join("\n")}\n`, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
