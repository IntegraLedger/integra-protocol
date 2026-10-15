// A vector blob signed again by its payer, the key of Ed25519 entropy 01x16 by xrpl.org's Ed25519 Key Derivation
// (docs/concepts/accounts/cryptographic-keys.md L162-176 at XRPLF/xrpl-dev-portal 1a22a493: the private key is the
// SHA-512Half of the entropy): @noble/curves' Ed25519 signature over ripple-binary-codec's encodeForSigning of the
// blob's fields, with `NetworkID` set where one is given, then ripple-binary-codec's encode.
import { createHash } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import { decode, encode, encodeForSigning } from "ripple-binary-codec";

const SECRET = createHash("sha512").update(new Uint8Array(16).fill(1)).digest().subarray(0, 32);
const upper = (b: Uint8Array) => Buffer.from(b).toString("hex").toUpperCase();

/** `blob`'s fields, `NetworkID` set to `networkId` where it is given, signed by the payer of Ed25519 entropy 01x16. */
export function resigned(blob: string, networkId?: number): string {
  const { TxnSignature: _, ...fields } = decode(blob) as Record<string, unknown>;
  const signing = networkId === undefined ? fields : { ...fields, NetworkID: networkId };
  if (signing["SigningPubKey"] !== `ED${upper(ed25519.getPublicKey(SECRET))}`) throw new Error("the blob is not this payer's");
  const signature = upper(ed25519.sign(Buffer.from(encodeForSigning(signing as never), "hex"), SECRET));
  return encode({ ...signing, TxnSignature: signature } as never);
}
