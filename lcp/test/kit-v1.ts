// The version-1 message (SIMD-0385) of a recorded wire's instructions, written by @solana/kit 8.4.0 alone: the wire's
// message decoded and decompiled (getTransactionDecoder, getCompiledTransactionMessageDecoder,
// decompileTransactionMessage), its Compute Budget instructions dropped, and the rest compiled as a version-1 message
// with the same fee payer and blockhash whose header carries the budget through kit's own setters
// (setTransactionMessageComputeUnitLimit, setTransactionMessagePriorityFeeLamports,
// setTransactionMessageLoadedAccountsDataSizeLimit), then encoded (compileTransactionMessage,
// getCompiledTransactionMessageEncoder). No code of this package runs. `kitWire` is @solana/kit 8.4.0's wire for a
// message and one signer's signature (getTransactionEncoder), the other signers' slots zero.
import {
  appendTransactionMessageInstructions,
  compileTransactionMessage,
  createTransactionMessage,
  decompileTransactionMessage,
  getCompiledTransactionMessageDecoder,
  getCompiledTransactionMessageEncoder,
  getTransactionDecoder,
  getTransactionEncoder,
  pipe,
  setTransactionMessageComputeUnitLimit,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  setTransactionMessageLoadedAccountsDataSizeLimit,
  setTransactionMessagePriorityFeeLamports,
  type Blockhash,
  type SignatureBytes,
  type Transaction,
} from "@solana/kit";

const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";

/** The header's budget: the compute unit limit, the priority fee in lamports (absent: none), and the data limit. */
export interface KitV1Header {
  computeUnitLimit: number;
  priorityFeeLamports?: bigint;
  loadedAccountsDataSizeLimit: number;
}

/** The version-1 message bytes of `wireBase64`'s instructions, without its Compute Budget instructions, under `h`. */
export function kitV1Message(wireBase64: string, h: KitV1Header): Uint8Array {
  const wire = Uint8Array.from(Buffer.from(wireBase64, "base64"));
  const compiled = getCompiledTransactionMessageDecoder().decode(getTransactionDecoder().decode(wire).messageBytes);
  const old = decompileTransactionMessage(compiled);
  const lifetime = old.lifetimeConstraint;
  if (!("blockhash" in lifetime)) throw new Error("the recorded wire has no blockhash lifetime");
  const instructions = old.instructions.filter((ix) => ix.programAddress !== COMPUTE_BUDGET);
  const base = pipe(
    createTransactionMessage({ version: 1 }),
    (m) => setTransactionMessageFeePayer(old.feePayer.address, m),
    (m) =>
      setTransactionMessageLifetimeUsingBlockhash(
        { blockhash: lifetime.blockhash as Blockhash, lastValidBlockHeight: 0n },
        m,
      ),
    (m) => appendTransactionMessageInstructions(instructions, m),
    (m) => setTransactionMessageComputeUnitLimit(h.computeUnitLimit, m),
    (m) => setTransactionMessageLoadedAccountsDataSizeLimit(h.loadedAccountsDataSizeLimit, m),
  );
  const message = h.priorityFeeLamports === undefined ? base : setTransactionMessagePriorityFeeLamports(h.priorityFeeLamports, base);
  return Uint8Array.from(getCompiledTransactionMessageEncoder().encode(compileTransactionMessage(message)));
}

/** @solana/kit's wire for `message` signed by `signer` alone: each other signer's signature is absent. */
export function kitWire(message: Uint8Array, signer: string, signature: Uint8Array): Uint8Array {
  const compiled = getCompiledTransactionMessageDecoder().decode(message);
  const signers = compiled.staticAccounts.slice(0, compiled.header.numSignerAccounts);
  const signatures = Object.fromEntries(signers.map((a) => [a, a === signer ? (signature as SignatureBytes) : null]));
  return Uint8Array.from(getTransactionEncoder().encode({ messageBytes: message, signatures } as unknown as Transaction));
}
