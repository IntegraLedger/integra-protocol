// The form of the shared machinery: each case's facts given to `decide` as they stand.
import { decide } from "../../../src/internal/read.js";
import type { CaseMark, DeclaredForm } from "../form.js";
import { READ_STATUS } from "../harness.js";

const rank = (m: CaseMark): number => READ_STATUS.marks.indexOf(m);

export const forms: readonly DeclaredForm[] = [
  {
    form: {
      subject: "decide",
      arrange: (c, act) => ({
        run: async () =>
          decide(c.facts, { ...c.query, act }, {
            coverage: c.coverage,
            final: "final",
            markOrder: (a, b) => rank(a) - rank(b),
            positionOrder: (a, b) => a - b,
          }),
      }),
    },
    inapplicable: [],
  },
];
