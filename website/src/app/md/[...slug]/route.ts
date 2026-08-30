import { pageMarkdown } from "@/lib/llms";
import { absoluteUrl } from "@/lib/site";
import { source } from "@/lib/source";

// Required for route handlers under `output: export`.
export const dynamic = "force-static";

/**
 * `/md/<page>.md` — one documentation page as plain Markdown, the file the page's
 * "copy Markdown" and "open in …" actions point at. Same renderer as `/llms-full.txt`.
 *
 * The site root has no path segment of its own and is served as `/md/index.md`, matching
 * `markdownPath` in `src/lib/llms.ts`.
 */
const ROOT_SLUG = "index";

export async function generateStaticParams() {
  return source.getPages().map((page) => {
    const slug = page.url.split("/").filter(Boolean);
    if (slug.length === 0) return { slug: [`${ROOT_SLUG}.md`] };
    const last = slug[slug.length - 1];
    return { slug: [...slug.slice(0, -1), `${last}.md`] };
  });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string[] }> },
) {
  const { slug } = await context.params;
  const last = slug.at(-1);
  if (last === undefined || !last.endsWith(".md")) {
    return new Response("not found", { status: 404 });
  }
  const stem = last.slice(0, -3);
  const pageSlug =
    slug.length === 1 && stem === ROOT_SLUG ? [] : [...slug.slice(0, -1), stem];
  const page = source.getPage(pageSlug);
  if (!page) return new Response("not found", { status: 404 });

  const body = await pageMarkdown(page);
  const text = [
    `# ${page.data.title}`,
    "",
    ...(page.data.description ? [`> ${page.data.description}`, ""] : []),
    `Source: ${absoluteUrl(page.url)}`,
    "",
    body,
  ].join("\n");
  return new Response(text, {
    headers: { "content-type": "text/markdown; charset=utf-8" },
  });
}
