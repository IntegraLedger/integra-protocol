// The EVM profiles are shipped verbatim. Each expected text below is copied from the published profile text of the x402
// EIP-3009 pairing and of the EVM breadth pairings (Permit2, ERC-7710 salt, auth-capture); the breadth profiles take
// rules 1 and 2 from the EIP-3009 profile and their own rules after them.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (name: string) => readFileSync(new URL(`../profiles/${name}`, import.meta.url), "utf8");
const lines = (text: string) => text.split("\n").filter((l) => l.trim() !== "");

const EIP3009 = [
  "**LCP profile `x402/exact/eip155/eip3009`: the ATR hash as the EIP-3009 nonce.**",
  '1. The resource server\'s `PaymentRequired` carries `extensions.legalContext.info` = `{"type":"sha256","value":H,"legalContextUrl":L}`. H is the SHA-256 of the ATR\'s exact bytes, as `0x` lowercase hex, and L is an `https` URL that serves those bytes.',
  "2. The client fetches L, computes SHA-256 over the bytes received, and compares the result with H as 32 decoded bytes. On a mismatch it does not sign.",
  "3. On a match, the client signs `TransferWithAuthorization` for an `exact` option with `nonce` = H, and echoes `extensions` unchanged.",
  "4. The server refuses a payment whose `nonce` is not an H it issued for that request and has not seen claimed.",
  "5. H is on chain as `topics[2]` of `AuthorizationUsed(authorizer, nonce)`, emitted by the option's `asset` in the settlement transaction. A search by that topic can also return other authorizers' uses of the same value.",
  "6. x402 calls the nonce a *\"32-byte random nonce to prevent replay attacks\"*. H is unpredictable before issue and unique per ATR, because each ATR carries a random UUID, so the nonce keeps its replay role. A client that does not implement this profile draws a random nonce, and rule 4 refuses its payment.",
];

const PERMIT2 =
  "3. On a match, the client signs the scheme's `PermitWitnessTransferFrom` with `nonce` = H as a uint256 and echoes `extensions` unchanged. 4. The server refuses a payment whose nonce is not an H it issued for that request and has not seen claimed. 5. H is in the settlement transaction's calldata; Permit2 records its use as one bit of `nonceBitmap(owner, H >> 8)`, and no event carries it. 6. x402 states no Permit2 nonce derivation. H is unpredictable before issue and unique per ATR, so Permit2's single use of (owner, nonce) holds. A client that draws a random nonce is refused by rule 4.";
const ERC7710_SALT =
  "3. On a match, the client's delegation tooling creates the delegation it gives the facilitator for this payment, the leaf of `permissionContext`, with `salt` = H as a uint256, and echoes `extensions` unchanged. 4. The server refuses a payment whose leaf salt is not an H it issued for that request and has not seen claimed. A payment through any other delegation manager is served at the unsigned level, and its record says so. 5. H is on chain as data word 5 of the leaf's `RedeemedDelegation` event from the manager in the settlement transaction. 6. ERC-7710 defines no salt; the salt is the reference implementation's signed field, and H, unique per ATR, keeps each per-payment delegation's hash unique.";
const AUTH_CAPTURE =
  "3. On a match, the client uses H as its random 32 bytes: `salt` = H when `receiverAuthorizer` and `policy` are both zero; otherwise `saltNonce` = H and `salt` is the scheme's commitment over it. 4. The server refuses a payment whose salt or saltNonce is not an H it issued for that request, or whose signed nonce does not commit to it. 5. The salt is in the escrow's `PaymentAuthorized` or `PaymentCharged` data, and a holder of the ATR confirms H from it.";

describe("the EVM profiles, verbatim", () => {
  it("x402/exact/eip155/eip3009 is the published text, line for line", () => {
    expect(lines(read("x402-exact-eip155-eip3009.md"))).toEqual(EIP3009);
  });

  it.each([
    ["x402-exact-eip155-permit2.md", "x402/exact/eip155/permit2", PERMIT2],
    ["x402-upto-eip155-permit2.md", "x402/upto/eip155/permit2", PERMIT2],
    ["x402-exact-eip155-erc7710-salt.md", "x402/exact/eip155/erc7710-salt", ERC7710_SALT],
    ["x402-auth-capture-eip155.md", "x402/auth-capture/eip155", AUTH_CAPTURE],
  ])("%s: rules 1 and 2 are the EIP-3009 profile's, then its own rules", (file, id, own) => {
    const [title, ...rules] = lines(read(file));
    expect(title!.startsWith(`**LCP profile \`${id}\`: `)).toBe(true);
    expect(rules.slice(0, 2)).toEqual(EIP3009.slice(1, 3));
    expect(rules.slice(2).join(" ")).toBe(own);
  });
});
