// Reads fixtures/starknet-zero-transfer-sepolia.json: Starknet Sepolia's simulation of `transfer(payee, 0)` on STRK and
// on USDC, each emitting a `Transfer` of 0. On a token whose zero transfer emits its `Transfer`, the agreement's floor
// is 0 (the profile x402-exact-starknet.md, rule 24), and an option of amount "0" on it is this pairing's.
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { pairingOf } from "../src/index.js";
import { EVENT_TRANSFER, starknetFloor } from "../src/starknet.js";
import type { PaymentRequirements } from "../src/x402.js";

interface Invocation {
  contract_address: string;
  events?: { keys: string[]; data: string[] }[];
  calls?: Invocation[];
}
const F = JSON.parse(readFileSync(new URL("./fixtures/starknet-zero-transfer-sepolia.json", import.meta.url), "utf8")) as {
  network: "starknet:SN_SEPOLIA";
  account: string;
  payee: string;
  tokens: Record<string, string>;
  calls: { request: { params: { transactions: { calldata: string[] }[] } }; answer: { result: { transaction_trace: { execute_invocation: Invocation } }[] } }[];
};
const V = JSON.parse(readFileSync(new URL("../vectors/x402-exact-starknet.json", import.meta.url), "utf8"));

/** The events the token emitted anywhere in the trace. */
function emitted(inv: Invocation, token: bigint, out: { keys: string[]; data: string[] }[] = []) {
  if (BigInt(inv.contract_address) === token) out.push(...(inv.events ?? []));
  for (const c of inv.calls ?? []) emitted(c, token, out);
  return out;
}

it.each(Object.entries(F.tokens))("%s on Starknet Sepolia emits a Transfer of 0, so its floor is 0", (_name, token) => {
  const call = F.calls.find((c) => BigInt(c.request.params.transactions[0]!.calldata[1]!) === BigInt(token))!;
  const events = emitted(call.answer.result[0]!.transaction_trace.execute_invocation, BigInt(token));
  const transfer = events.find((e) => BigInt(e.keys[0]!) === BigInt(EVENT_TRANSFER));
  expect(transfer?.keys.slice(1).map(BigInt)).toEqual([BigInt(F.account), BigInt(F.payee)]);
  expect(transfer?.data.map(BigInt)).toEqual([0n, 0n]);
  expect(starknetFloor({ asset: token, network: F.network })).toBe(0n);
  const option: PaymentRequirements = { ...V.fixed.O, network: F.network, asset: token, amount: "0" };
  expect(pairingOf(option)).toBe("x402/exact/starknet");
});
