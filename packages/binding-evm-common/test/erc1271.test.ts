import { readFileSync } from "node:fs";
import type { SignedAcceptance } from "@integraledger/lcp-authority";
import { hashTypedData, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it, vi } from "vitest";
import {
  buildAcceptanceTypedData,
  makeEvmAcceptanceVerifier,
  makeLocalEvmSigner,
  rfc3339ToUnixSeconds,
  verifyAcceptanceSignature,
} from "../src/erc1271.js";

type Case = {
  name: string;
  input: { atrHash: string; signedAt: string; chainId: number };
  expected: { digest: `0x${string}` };
};
const V = JSON.parse(
  readFileSync(
    new URL(
      "../../../vectors/binding/acceptance-envelope.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as { cases: Case[] };

// Anvil account #1 — a well-known deterministic test key (RFC 6979 ECDSA → stable signatures).
const KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const account = privateKeyToAccount(KEY);

describe("buildAcceptanceTypedData — the EIP-712 digest is pinned", () => {
  it.each(V.cases)("$name", ({ input, expected }) => {
    const td = buildAcceptanceTypedData({
      atrHash: input.atrHash,
      signedAt: BigInt(input.signedAt),
      chainId: input.chainId,
    });
    expect(hashTypedData(td)).toBe(expected.digest);
    // atrHash rides lowercased regardless of input case (ATR canon).
    expect(td.message.atrHash).toBe(input.atrHash.toLowerCase());
  });
});

describe("rfc3339ToUnixSeconds", () => {
  it("parses an RFC 3339 timestamp to unix seconds", () => {
    expect(rfc3339ToUnixSeconds("1970-01-01T00:00:00Z")).toBe(0n);
    expect(rfc3339ToUnixSeconds("2023-11-14T22:13:20Z")).toBe(1_700_000_000n);
  });
  it("fails loud on an unparseable timestamp", () => {
    expect(() => rfc3339ToUnixSeconds("not-a-date")).toThrow(/RFC 3339/);
  });
});

describe("verifyAcceptanceSignature — real EOA signatures, verified offline", () => {
  const atrHash =
    "0x7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069";
  const chainId = 84532;
  const signedAtRfc = "2025-11-13T04:53:20Z"; // → 1763000000

  it("accepts a valid eip712 acceptance-envelope signature (round-trip)", async () => {
    const td = buildAcceptanceTypedData({
      atrHash,
      signedAt: rfc3339ToUnixSeconds(signedAtRfc),
      chainId,
    });
    const signature = await account.signTypedData(td);
    const ok = await verifyAcceptanceSignature(
      {
        atrHash,
        signer: account.address,
        scheme: "evm:eip712",
        signature,
        signedAt: signedAtRfc,
        payloadType: "eip712-acceptance-envelope",
      },
      { chainId },
    );
    expect(ok).toBe(true);
  });

  it("rejects when the envelope binds a different atrHash", async () => {
    const td = buildAcceptanceTypedData({
      atrHash,
      signedAt: rfc3339ToUnixSeconds(signedAtRfc),
      chainId,
    });
    const signature = await account.signTypedData(td);
    const other =
      "0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    const ok = await verifyAcceptanceSignature(
      {
        atrHash: other,
        signer: account.address,
        scheme: "evm:eip712",
        signature,
        signedAt: signedAtRfc,
        payloadType: "eip712-acceptance-envelope",
      },
      { chainId },
    );
    expect(ok).toBe(false);
  });

  it("rejects when a different signer is claimed", async () => {
    const td = buildAcceptanceTypedData({
      atrHash,
      signedAt: rfc3339ToUnixSeconds(signedAtRfc),
      chainId,
    });
    const signature = await account.signTypedData(td);
    const ok = await verifyAcceptanceSignature(
      {
        atrHash,
        signer: "0x0000000000000000000000000000000000000001",
        scheme: "evm:eip712",
        signature,
        signedAt: signedAtRfc,
        payloadType: "eip712-acceptance-envelope",
      },
      { chainId },
    );
    expect(ok).toBe(false);
  });

  it("accepts a valid eip191 raw-atrHash signature (the common-by-policy EOA path)", async () => {
    const signature = await account.signMessage({ message: { raw: atrHash } });
    const ok = await verifyAcceptanceSignature({
      atrHash,
      signer: account.address,
      scheme: "evm:eip191",
      signature,
      signedAt: signedAtRfc,
      payloadType: "atrHash",
    });
    expect(ok).toBe(true);
  });

  it("fails loud when the envelope is requested without a chainId", async () => {
    await expect(
      verifyAcceptanceSignature({
        atrHash,
        signer: account.address,
        scheme: "evm:eip712",
        signature: "0xdead",
        signedAt: signedAtRfc,
        payloadType: "eip712-acceptance-envelope",
      }),
    ).rejects.toThrow(/chainId/);
  });

  it("makeLocalEvmSigner signs an envelope the verifier accepts (producer/verifier agree)", async () => {
    const signer = makeLocalEvmSigner(KEY);
    const td = buildAcceptanceTypedData({
      atrHash,
      signedAt: rfc3339ToUnixSeconds(signedAtRfc),
      chainId,
    });
    const signature = await signer.signTypedData(td);
    expect(signer.address).toBe(account.address);
    const ok = await verifyAcceptanceSignature(
      {
        atrHash,
        signer: signer.address,
        scheme: "evm:eip712",
        signature,
        signedAt: signedAtRfc,
        payloadType: "eip712-acceptance-envelope",
      },
      { chainId },
    );
    expect(ok).toBe(true);
  });

  it.each(["evm:erc1271", "evm:erc6492"] as const)(
    "fails loud on the %s smart-account scheme with no chain client (never a silent false)",
    async (scheme) => {
      await expect(
        verifyAcceptanceSignature(
          {
            atrHash,
            signer: account.address,
            scheme,
            signature: "0xdead",
            signedAt: signedAtRfc,
            payloadType: "eip712-acceptance-envelope",
          },
          { chainId },
        ),
      ).rejects.toThrow(/chain client/);
    },
  );

  it("fails loud on a smart-account scheme with no client on the RAW-atrHash payload too", async () => {
    // The raw path has its own isContract branch. Recovering a smart-account signature offline would
    // return a garbage EOA address and report `false` — an impeached, valid acceptance.
    await expect(
      verifyAcceptanceSignature({
        atrHash,
        signer: account.address,
        scheme: "evm:erc1271",
        signature: "0xdead",
        signedAt: signedAtRfc,
        payloadType: "atrHash",
      }),
    ).rejects.toThrow(/chain client/);
  });

  it("rejects an eip191 raw-atrHash signature when a different signer is claimed", async () => {
    const signature = await account.signMessage({ message: { raw: atrHash } });
    const ok = await verifyAcceptanceSignature({
      atrHash,
      signer: "0x0000000000000000000000000000000000000001",
      scheme: "evm:eip191",
      signature,
      signedAt: signedAtRfc,
      payloadType: "atrHash",
    });
    expect(ok).toBe(false);
  });
});

/**
 * The smart-account half (the production shape: a Coinbase Smart Wallet). viem's universal
 * `verifyTypedData`/`verifyMessage` do the ERC-1271 / ERC-6492 work on-chain, so what belongs here is
 * that the verifier ROUTES to the client — with the right typed data — instead of recovering offline.
 */
describe("verifyAcceptanceSignature — smart-account schemes verify through the client", () => {
  const atrHash =
    "0x7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069";
  const chainId = 84532;
  const signedAtRfc = "2025-11-13T04:53:20Z"; // → 1763000000
  const SMART_ACCOUNT = "0x5A2000000000000000000000000000000000dD10";
  const SIG = `0x${"ab".repeat(64)}1b`;

  function fakeClient(verdict: boolean) {
    const verifyTypedData = vi.fn(async () => verdict);
    const verifyMessage = vi.fn(async () => verdict);
    return {
      client: { verifyTypedData, verifyMessage } as unknown as PublicClient,
      verifyTypedData,
      verifyMessage,
    };
  }

  it.each(["evm:erc1271", "evm:erc6492"] as const)(
    "%s: routes the envelope to client.verifyTypedData and returns its verdict",
    async (scheme) => {
      const { client, verifyTypedData, verifyMessage } = fakeClient(true);
      const ok = await verifyAcceptanceSignature(
        {
          atrHash,
          signer: SMART_ACCOUNT,
          scheme,
          signature: SIG,
          signedAt: signedAtRfc,
          payloadType: "eip712-acceptance-envelope",
        },
        { chainId, client },
      );
      expect(ok).toBe(true);
      expect(verifyMessage).not.toHaveBeenCalled();
      expect(verifyTypedData).toHaveBeenCalledWith({
        address: SMART_ACCOUNT,
        ...buildAcceptanceTypedData({
          atrHash,
          signedAt: rfc3339ToUnixSeconds(signedAtRfc),
          chainId,
        }),
        signature: SIG,
      });
    },
  );

  it("returns the client's NEGATIVE verdict rather than assuming a contract signature is good", async () => {
    const { client } = fakeClient(false);
    await expect(
      verifyAcceptanceSignature(
        {
          atrHash,
          signer: SMART_ACCOUNT,
          scheme: "evm:erc6492",
          signature: SIG,
          signedAt: signedAtRfc,
          payloadType: "eip712-acceptance-envelope",
        },
        { chainId, client },
      ),
    ).resolves.toBe(false);
  });

  it("raw-atrHash payload: routes to client.verifyMessage with the 32 raw bytes", async () => {
    const { client, verifyMessage, verifyTypedData } = fakeClient(true);
    const ok = await verifyAcceptanceSignature(
      {
        atrHash: `0x${atrHash.slice(2).toUpperCase()}`,
        signer: SMART_ACCOUNT,
        scheme: "evm:erc1271",
        signature: SIG,
        signedAt: signedAtRfc,
        payloadType: "atrHash",
      },
      { client },
    );
    expect(ok).toBe(true);
    expect(verifyTypedData).not.toHaveBeenCalled();
    // The atrHash is normalized to lowercase before it reaches the chain, exactly as on the EOA path.
    expect(verifyMessage).toHaveBeenCalledWith({
      address: SMART_ACCOUNT,
      message: { raw: atrHash },
      signature: SIG,
    });
  });

  it("an on-chain call that throws is reported as false, not propagated (a verifier must not crash)", async () => {
    const client = {
      verifyTypedData: vi.fn(async () => {
        throw new Error("execution reverted");
      }),
    } as unknown as PublicClient;
    await expect(
      verifyAcceptanceSignature(
        {
          atrHash,
          signer: SMART_ACCOUNT,
          scheme: "evm:erc6492",
          signature: SIG,
          signedAt: signedAtRfc,
          payloadType: "eip712-acceptance-envelope",
        },
        { chainId, client },
      ),
    ).resolves.toBe(false);
  });
});

describe("makeEvmAcceptanceVerifier — the authority SignatureVerifier port", () => {
  it("verifies a real EOA acceptance through the port, opts bound at construction", async () => {
    const atrHash =
      "0x7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069";
    const chainId = 84532;
    const signedAt = "2025-11-13T04:53:20Z";
    const signature = await account.signTypedData(
      buildAcceptanceTypedData({
        atrHash,
        signedAt: rfc3339ToUnixSeconds(signedAt),
        chainId,
      }),
    );
    const verifier = makeEvmAcceptanceVerifier({ chainId });
    await expect(
      verifier.verify({
        atrHash,
        signer: account.address,
        scheme: "evm:eip712",
        signature,
        signedAt,
        payloadType: "eip712-acceptance-envelope",
      }),
    ).resolves.toBe(true);
    // The bound chainId is load-bearing: a verifier built without it cannot verify an envelope at all.
    await expect(
      makeEvmAcceptanceVerifier().verify({
        atrHash,
        signer: account.address,
        scheme: "evm:eip712",
        signature,
        signedAt,
        payloadType: "eip712-acceptance-envelope",
      }),
    ).rejects.toThrow(/chainId/);
  });
});

describe("verifyAcceptanceSignature — adversarial inputs report, never crash", () => {
  const base = {
    atrHash: `0x${"11".repeat(32)}`,
    signer: "0xb15d09250fA3d2eA1c4B5F7a90D8c3E6b17a0925",
    scheme: "evm:eip712" as const,
    signedAt: "2026-07-24T12:00:00Z",
    payloadType: "eip712-acceptance-envelope" as const,
  };

  it("a forged signature that cannot be recovered returns false (a verifier must report a forgery)", async () => {
    // This signature fails deep in the curve math ("Point is not on curve"). Before the fix it threw,
    // which crashed the whole verification walk on exactly the adversarial record it exists to catch.
    await expect(
      verifyAcceptanceSignature(
        { ...base, signature: `0x${"cd".repeat(64)}1c` },
        { chainId: 84532 },
      ),
    ).resolves.toBe(false);
  });

  it("a truncated signature returns false", async () => {
    await expect(
      verifyAcceptanceSignature(
        { ...base, signature: "0xdeadbeef" },
        { chainId: 84532 },
      ),
    ).resolves.toBe(false);
  });

  it("a MALFORMED RECORD still throws loud — a garbled signedAt is not a forgery", async () => {
    // The guard covers signature RECOVERY only. Collapsing a malformed timestamp into `false` would
    // report a record defect as a cryptographic forgery and hide the real problem — the exact failure
    // mode rfc3339ToUnixSeconds exists to prevent.
    await expect(
      verifyAcceptanceSignature(
        {
          ...base,
          signature: `0x${"ab".repeat(64)}1b`,
          signedAt: "not-a-timestamp",
        },
        { chainId: 84532 },
      ),
    ).rejects.toThrow(/not a parseable RFC 3339 timestamp/);
  });

  it("a malformed atrHash on the raw-payload path also throws loud", async () => {
    await expect(
      verifyAcceptanceSignature({
        ...base,
        payloadType: "atrHash",
        scheme: "evm:eip191",
        atrHash: "0xdead",
        signature: `0x${"ab".repeat(64)}1b`,
      }),
    ).rejects.toThrow();
  });

  it("but a CONFIGURATION error still throws loud (an integration bug, not a record fact)", async () => {
    await expect(
      verifyAcceptanceSignature({
        ...base,
        signature: `0x${"cd".repeat(64)}1c`,
      }),
    ).rejects.toThrow(/requires opts.chainId/);
  });
});

/**
 * The narrowing seam: `AcceptanceScheme` is an open, rail-neutral set and this port implements exactly
 * the four evm:* schemes. A record from another family reaching this port is a ROUTING bug — thrown
 * loud, never a silent false, because `false` would say "forged" about a signature this port never
 * examined (the configuration outcome of the three-outcomes doctrine in src/erc1271.ts).
 */
describe("makeEvmAcceptanceVerifier — the open set narrows loudly at this port's boundary", () => {
  const record: SignedAcceptance = {
    atrHash: `0x${"7f".repeat(32)}`,
    signer: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    scheme: "evm:eip191",
    signature: `0x${"ab".repeat(64)}1b`,
    signedAt: "2026-07-27T00:00:00Z",
    payloadType: "atrHash",
  };

  it("throws on a scheme from another family — route it, never impeach it", async () => {
    // The full joined list is asserted, not just the prefix: the message is the routing hint an
    // integrator acts on, so a mangled separator is a real regression, not a cosmetic one.
    await expect(
      makeEvmAcceptanceVerifier().verify({ ...record, scheme: "jose:ES256" }),
    ).rejects.toThrow(
      "not an EVM acceptance scheme (evm:eip191, evm:eip712, evm:erc1271, evm:erc6492)",
    );
  });

  it("throws on a payload type this port cannot reconstruct", async () => {
    await expect(
      makeEvmAcceptanceVerifier().verify({
        ...record,
        payloadType: "sd-jwt-envelope",
      }),
    ).rejects.toThrow(
      "not one this port reconstructs (atrHash, eip712-acceptance-envelope)",
    );
  });

  it("throws loud on a non-address signer — a malformed RECORD, not a forgery verdict", async () => {
    await expect(
      makeEvmAcceptanceVerifier().verify({
        ...record,
        signer: "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK",
      }),
    ).rejects.toThrow(/must be a 0x-address/);
  });
});
