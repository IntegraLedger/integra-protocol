import { profilesIndex, textResponse } from "@/lib/llms-files";

export const dynamic = "force-static";

/** `/profiles/llms.txt`: the index of the profiles, each with its opening sentence. */
export function GET() {
  return textResponse(profilesIndex());
}
