import { profilesFile, textResponse } from "@/lib/llms-files";

export const dynamic = "force-static";

/** `/profiles/llms-full.txt`: every profile, whole, in one file. */
export function GET() {
  return textResponse(profilesFile());
}
