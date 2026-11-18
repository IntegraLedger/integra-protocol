import { fullFile, textResponse } from "@/lib/llms-files";

export const dynamic = "force-static";

/** `/llms-full.txt`: every documentation page as Markdown, in sidebar order. */
export async function GET() {
  return textResponse(await fullFile());
}
