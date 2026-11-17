// A Solana payment whose signed message is of a version its option does not admit is no answer to that option: `bound`
// and `reference` refuse it `svm/version-not-admitted` on the x402 Solana pairings and on the MPP Solana charges. The
// oracle is @x402/svm 2.31.0's own facilitator check, exported from the package this one pins as a devDependency:
// `peekWireTransactionVersion` reads the presented wire's version and `isAcceptedTransactionVersion` admits it against
// the option's list, the list absent being `[0]` (`resolveTransactionVersion`). The payments are the vector files' own:
// x402-exact-solana.json's buyer payment (version 0) and its stock version-1 payment (transactionV1), x402-upto-solana.json's
// stock version-1 opening, and mpp-charge-solana.json's buyer credential (version 0), each presented under its option
// with `transactionVersions` absent, [0], [1] and [0, 1].
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isAcceptedTransactionVersion, peekWireTransactionVersion } from "@x402/svm";
import { chargeSolana } from "../src/mpp-solana.js";
import { exactSvm } from "../src/x402-exact-solana.js";
import { uptoSvm } from "../src/x402-upto-solana.js";
import type { PaymentRequirements } from "../src/x402.js";

const load = (f: string) => JSON.parse(readFileSync(new URL(`../vectors/${f}`, import.meta.url), "utf8"));
const E = load("x402-exact-solana.json");
const U = load("x402-upto-solana.json");
const M = load("mpp-charge-solana.json");

/** A version-0 wire with no lookups, re-laid as a legacy message: its version prefix and its empty lookup list removed. */
function legacyOf(wireBase64: string): string {
  const wire = Buffer.from(wireBase64, "base64");
  const signatures = wire[0]!;
  if (signatures >= 0x80) throw new Error("more signatures than one compact-u16 byte holds");
  const at = 1 + 64 * signatures;
  if (wire[at] !== 0x80 || wire[wire.length - 1] !== 0) throw new Error("not a version-0 message with no lookups");
  return Buffer.concat([wire.subarray(0, at), wire.subarray(at + 1, wire.length - 1)]).toString("base64");
}

const LISTS: readonly (readonly number[] | undefined)[] = [undefined, [0], [1], [0, 1]];
const name = (list: readonly number[] | undefined): string => (list === undefined ? "absent" : `[${list.join(", ")}]`);

/** The stock facilitator's verdict on a wire under a list: admitted, or not. */
function stockAdmits(wireBase64: string, list: readonly number[] | undefined): boolean {
  const version = peekWireTransactionVersion(wireBase64);
  if (version === undefined) throw new Error("the stock reader reads no version from the wire");
  return isAcceptedTransactionVersion(version, list ?? [0]);
}

/** An x402 payment with its accepted option's `extra.transactionVersions` as `list` gives it. */
function x402Under(presented: { accepted: PaymentRequirements }, list: readonly number[] | undefined) {
  const { transactionVersions: _, ...extra } = presented.accepted.extra ?? {};
  const accepted = { ...presented.accepted, extra: { ...extra, ...(list === undefined ? {} : { transactionVersions: list }) } };
  return { ...presented, accepted } as typeof presented;
}

/** An MPP credential whose echoed challenge's `methodDetails.transactionVersions` is as `list` gives it. */
function mppUnder(credential: { challenge: { request: string } }, list: readonly number[] | undefined) {
  const request = JSON.parse(Buffer.from(credential.challenge.request, "base64url").toString("utf8"));
  const { transactionVersions: _, ...details } = request.methodDetails;
  request.methodDetails = { ...details, ...(list === undefined ? {} : { transactionVersions: list }) };
  const challenge = { ...credential.challenge, request: Buffer.from(JSON.stringify(request)).toString("base64url") };
  return { ...credential, challenge };
}

const x402Payments = [
  { what: "x402/exact/solana, the buyer's version-0 payment", codec: exactSvm, presented: E.buyer.rows[1].input.presented, wire: (p: { payload: { transaction: string } }) => p.payload.transaction },
  { what: "x402/exact/solana, the stock version-1 payment", codec: exactSvm, presented: E.transactionV1.presented, wire: (p: { payload: { transaction: string } }) => p.payload.transaction },
  { what: "x402/upto/solana, the stock version-1 opening", codec: uptoSvm, presented: U.transactionV1.presented, wire: (p: { payload: { openTransaction: string } }) => p.payload.openTransaction },
] as const;

describe("a Solana payment of a version its option does not admit", () => {
  for (const p of x402Payments) {
    for (const list of LISTS) {
      const admitted = stockAdmits(p.wire(p.presented as never), list);
      it(`${p.what}, transactionVersions ${name(list)}: ${admitted ? "bound gives H" : "refused svm/version-not-admitted"}, as the stock facilitator admits it or not`, async () => {
        const presented = x402Under(p.presented, list);
        const bound = await p.codec.bound(presented);
        const reference = await p.codec.reference(presented, presented.accepted);
        if (admitted) {
          expect(bound).toBe(E.fixed.H);
          expect("refused" in (reference as object)).toBe(false);
        } else {
          expect(bound).toEqual({ refused: true, code: "svm/version-not-admitted" });
          expect(reference).toEqual({ refused: true, code: "svm/version-not-admitted" });
        }
      });
    }
  }

  // On MPP the server that writes `methodDetails.transactionVersions`, a release later than @solana/mpp 0.7.0, refuses a
  // legacy message whatever the list holds (solana-foundation/pay-kit 86400da, typescript/packages/mpp/src/utils/
  // transaction-versions.ts:218-226, applied before it co-signs at src/server/Charge.ts:424-433 and to a pushed
  // signature at :1077-1081). 0.7.0 writes no list and checks no version (src/server/Charge.ts:339-350), so with the
  // list absent a legacy message is admitted, as version 0 is. The legacy credential is the buyer's version-0 one with
  // its version prefix and its empty lookup list removed, the same instructions in the legacy layout.
  const legacy = { ...M.buyer.rows[1].input.presented, payload: { ...M.buyer.rows[1].input.presented.payload, transaction: legacyOf(M.buyer.rows[1].input.presented.payload.transaction) } };
  for (const list of LISTS) {
    const admitted = list === undefined;
    it(`mpp/charge/solana, the buyer's credential as a legacy message, methodDetails.transactionVersions ${name(list)}: ${admitted ? "bound gives H" : "refused"}`, async () => {
      const presented = mppUnder(legacy, list);
      expect(await chargeSolana.bound(presented)).toEqual(admitted ? M.fixed.H : { refused: true, code: "svm/version-not-admitted" });
      const reference = await chargeSolana.reference(presented, presented.challenge as never);
      expect("refused" in (reference as object) ? reference : "read keys").toEqual(admitted ? "read keys" : { refused: true, code: "svm/version-not-admitted" });
    });
  }

  const credential = M.buyer.rows[1].input.presented;
  for (const list of LISTS) {
    const admitted = stockAdmits(credential.payload.transaction, list);
    it(`mpp/charge/solana, the buyer's version-0 credential, methodDetails.transactionVersions ${name(list)}: ${admitted ? "bound gives H" : "refused"}`, async () => {
      const presented = mppUnder(credential, list);
      const bound = await chargeSolana.bound(presented);
      expect(bound).toEqual(admitted ? M.fixed.H : { refused: true, code: "svm/version-not-admitted" });
    });
  }
});
