import { llmsIndex, textResponse } from "@/lib/llms-files";

export const dynamic = "force-static";

/** `/llms.txt`: the site's index for language models (https://llmstxt.org); `llmsIndex` writes it. */
export async function GET() {
  return textResponse(await llmsIndex());
}
