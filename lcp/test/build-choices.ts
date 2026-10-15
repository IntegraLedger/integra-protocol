// Two choices that `build` answers from the choice's document and the chosen option's place in it, before it reads the
// option with a rail's optional peer: one whose option is another pairing's (x402-exact-eip155-eip3009.json's option),
// and one whose document is not x402 v2, holding the pairing's own option. Each choice carries the pairing's other
// members in their own form (peer-free-inputs.ts `membersOf`), which `build` checks before the document. Each x402
// pairing with an optional peer gives each choice the same code with the peer (build-choices.test.ts) and without it
// (that pairing's peer-missing test).
import { readFileSync } from "node:fs";
import type { PaymentRequirements } from "../src/x402.js";

const EVM = JSON.parse(readFileSync(new URL("../vectors/x402-exact-eip155-eip3009.json", import.meta.url), "utf8"));

export interface BuildChoice {
  case: string;
  choice: { required: { x402Version: number; resource: unknown; accepts: PaymentRequirements[] }; accepted: PaymentRequirements; [member: string]: unknown };
  expect: string;
}

/**
 * The two choices for a pairing whose own option is `own`, in a document whose resource is `resource`, each with the
 * pairing's other choice members `members`.
 */
export function buildChoices(own: PaymentRequirements, resource: unknown, members: Record<string, unknown> = {}): BuildChoice[] {
  return [
    {
      case: "a choice of another pairing's option",
      choice: { ...members, required: { x402Version: 2, resource, accepts: [EVM.fixed.O] }, accepted: EVM.fixed.O },
      expect: "x402/option-not-this-pairing",
    },
    {
      case: "a choice of the pairing's own option in a document that is not x402 v2",
      choice: { ...members, required: { x402Version: 1, resource, accepts: [own] }, accepted: own },
      expect: "x402/not-v2",
    },
  ];
}
