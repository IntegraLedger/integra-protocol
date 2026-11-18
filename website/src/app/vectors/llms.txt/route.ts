import { textResponse, vectorsIndex } from "@/lib/llms-files";

export const dynamic = "force-static";

/** `/vectors/llms.txt`: the index of the vector files, each with the first sentence of its `about`. */
export function GET() {
  return textResponse(vectorsIndex());
}
