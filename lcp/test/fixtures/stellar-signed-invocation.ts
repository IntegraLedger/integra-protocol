// Builds Soroban `transfer` envelopes with @stellar/stellar-sdk 17.1.0: the XDR codec encodes them and `authorizeEntry`
// computes the payer's HashIDPreimage and signs it. Each case starts from x402-exact-stellar.json's simulated envelope
// (the unsigned V2 form) and sets the operation's `transfer` and the invocation the payer's entry signs.
import { Keypair, Networks, authorizeEntry, xdr } from "@stellar/stellar-sdk";
import type { ScValWire, SorobanAuthorizedInvocationWire, TransactionEnvelopeWire } from "@stellar/stellar-sdk/xdr";

export interface TransferArgs {
  to: ScValWire;
  amount: bigint;
}

export interface Case {
  operation: TransferArgs;
  signed: TransferArgs;
  subInvocation?: boolean;
}

/** A plain account address as an SCVal. */
export const account = (ed25519: Uint8Array): ScValWire => ({ type: 18, address: { type: 0, accountId: { type: 0, ed25519 } } });

/** A muxed account address as an SCVal (CAP-67: the id and the key). */
export const muxed = (ed25519: Uint8Array, id: bigint): ScValWire => ({ type: 18, address: { type: 2, muxedAccount: { id, ed25519 } } });

const i128 = (v: bigint): ScValWire => ({ type: 10, i128: { hi: 0n, lo: v } });

function decode(simulatedXdr: string): TransactionEnvelopeWire {
  return xdr.TransactionEnvelope.fromXdr(simulatedXdr, "base64").toXdrObject();
}

function shape(simulatedXdr: string, c: Case) {
  const env = decode(simulatedXdr);
  if (env.type !== 2) throw new Error("not a v1 envelope");
  const body = env.v1.tx.operations[0]!.body;
  if (body.type !== 24 || body.invokeHostFunctionOp.hostFunction.type !== 0) throw new Error("not an invocation");
  const opArgs = body.invokeHostFunctionOp.hostFunction.invokeContract.args;
  opArgs[1] = c.operation.to;
  opArgs[2] = i128(c.operation.amount);
  const entry = body.invokeHostFunctionOp.auth[0]!;
  const root: SorobanAuthorizedInvocationWire = entry.rootInvocation;
  if (root.function.type !== 0) throw new Error("not a contract call");
  root.function.contractFn.args[1] = c.signed.to;
  root.function.contractFn.args[2] = i128(c.signed.amount);
  if (c.subInvocation === true) {
    const fn = root.function.contractFn;
    root.subInvocations = [
      { function: { type: 0, contractFn: { contractAddress: fn.contractAddress, functionName: fn.functionName, args: [...fn.args] } }, subInvocations: [] },
    ];
  }
  return { env, body };
}

/** The envelope as the buyer's simulation returns it: the entry unsigned. */
export function simulated(simulatedXdr: string, c: Case): string {
  return xdr.TransactionEnvelope.fromXdrObject(shape(simulatedXdr, c).env).toXdr("base64");
}

/** The envelope with the payer's entry signed by `authorizeEntry` for `expiration` on testnet. */
export async function signed(simulatedXdr: string, c: Case, payerSeed: Uint8Array, expiration: number): Promise<string> {
  const { env, body } = shape(simulatedXdr, c);
  const auth = body.invokeHostFunctionOp.auth;
  const entry = xdr.SorobanAuthorizationEntry.fromXdrObject(auth[0]!);
  const done = await authorizeEntry(entry, Keypair.fromRawEd25519Seed(payerSeed), expiration, Networks.TESTNET);
  auth[0] = done.toXdrObject();
  return xdr.TransactionEnvelope.fromXdrObject(env).toXdr("base64");
}
