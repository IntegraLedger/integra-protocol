import { vectorFiles } from "@/lib/lcp-files";
import { textResponse } from "@/lib/llms-files";

export const dynamic = "force-static";
export const dynamicParams = false;

/** `/vectors/<name>.json`: each vector file of lcp/vectors/, byte for byte. */
export function generateStaticParams() {
  return vectorFiles().map((f) => ({ name: f.name }));
}

export async function GET(_request: Request, context: { params: Promise<{ name: string }> }) {
  const { name } = await context.params;
  const file = vectorFiles().find((f) => f.name === name);
  if (file === undefined) return new Response("not found", { status: 404 });
  return textResponse(file.bytes, "application/json");
}
