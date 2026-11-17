// The oracle of the Tempo split-memo vectors: stock `mppx` 0.17.6's Tempo charge client paying a challenge lcp placed,
// signing with the published Anvil development key #0. Nothing reaches a network: the viem client's transport answers
// the few JSON-RPC calls the client makes (chain id, fees, gas) with fixed values, and on push it takes the signed
// transaction the client sends and answers with a receipt for it. The clock and viem's random `validAfter` are fixed
// while the client runs, so its output is reproducible.
import { Credential } from "mppx";
import { tempo } from "mppx/client";
import { concat, createClient, custom, keccak256, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { tempoModerato } from "viem/chains";
import { Transaction } from "viem/tempo";

/** Anvil's development key #0 (its address 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266), published by Foundry. */
export const DEV_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

/** A challenge as lcp places it: its members as the `WWW-Authenticate` header carries them. */
export interface WireChallenge {
  readonly id: string;
  readonly realm: string;
  readonly method: string;
  readonly intent: string;
  readonly request: string;
  readonly expires?: string;
  readonly opaque?: string;
}

/** What the stock client gave: the credential as its `Authorization` header carries it, decoded, and on push the bytes it sent. */
export interface Paid {
  readonly credential: { challenge: Record<string, unknown>; payload: Record<string, unknown>; source?: string };
  /** The `Authorization` header value the client returned. */
  readonly authorization: string;
  readonly sent?: Hex;
}

const decode = (b64: string): unknown => JSON.parse(Buffer.from(b64, "base64url").toString("utf8"));

/** Runs `f` with `Date.now()` at `nowSeconds` and every random byte 0x11. */
async function fixed<T>(nowSeconds: number, f: () => Promise<T>): Promise<T> {
  const now = Date.now;
  const random = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
  Date.now = () => nowSeconds * 1000;
  globalThis.crypto.getRandomValues = (<A extends ArrayBufferView | null>(a: A): A => {
    if (a !== null) new Uint8Array(a.buffer, a.byteOffset, a.byteLength).fill(0x11);
    return a;
  }) as typeof globalThis.crypto.getRandomValues;
  try {
    return await f();
  } finally {
    Date.now = now;
    globalThis.crypto.getRandomValues = random;
  }
}

/** The stock client's credential for `challenge`, on `mode`, at `nowSeconds`, signed with `key` (development key #0 by default). */
export async function mppxPays(challenge: WireChallenge, mode: "pull" | "push", nowSeconds: number, key: Hex = DEV_KEY): Promise<Paid> {
  let sent: Hex | undefined;
  const request = async ({ method, params }: { method: string; params?: unknown }): Promise<unknown> => {
    switch (method) {
      case "eth_chainId":
        return `0x${tempoModerato.id.toString(16)}`;
      case "eth_estimateGas":
        return "0x30000";
      case "eth_maxPriorityFeePerGas":
        return "0x0";
      case "eth_gasPrice":
        return "0x4a817c800";
      case "eth_getBlockByNumber":
        return { number: "0x10", baseFeePerGas: "0x4a817c800", timestamp: `0x${nowSeconds.toString(16)}`, transactions: [] };
      case "eth_getTransactionCount":
        return "0x0";
      case "eth_sendRawTransactionSync": {
        sent = (params as Hex[])[0]!;
        const hash = keccak256(sent);
        return {
          transactionHash: hash,
          blockHash: `0x${"22".repeat(32)}`,
          blockNumber: "0x11",
          transactionIndex: "0x0",
          from: privateKeyToAccount(key).address,
          to: null,
          status: "0x1",
          logs: [],
          logsBloom: `0x${"00".repeat(256)}`,
          cumulativeGasUsed: "0x30000",
          gasUsed: "0x30000",
          effectiveGasPrice: "0x4a817c800",
          type: "0x76",
          contractAddress: null,
        };
      }
      default:
        throw new Error(`the oracle's transport answers no ${method}`);
    }
  };
  const client = createClient({ chain: tempoModerato, transport: custom({ request }) });
  const method = tempo.charge({ account: privateKeyToAccount(key), getClient: () => client, mode });
  const header = await fixed(nowSeconds, () =>
    method.createCredential({
      challenge: { ...challenge, request: decode(challenge.request) } as never,
      context: { mode },
    } as never),
  );
  const credential = decode(String(header).replace(/^Payment /, "")) as Paid["credential"];
  // The credential parses as mppx's own reader takes it.
  Credential.deserialize(String(header));
  const authorization = String(header);
  return sent === undefined ? { credential, authorization } : { credential, authorization, sent };
}

// ── The vector file, vectors/mpp-charge-tempo-split-memo.json, as the oracle writes it.

/** H: SHA-256 of the ATR "abc" (FIPS 180-2, B.1). */
export const H = "0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" as const;
/** The clock the client runs at, 2026-09-21T14:13:20Z, and the challenges' `expires`, five minutes on. */
export const NOW = 1_790_000_000;
const EXPIRES = "2026-09-21T14:18:20Z";
const RECIPIENT = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";
/** pathUSD, Tempo's TIP-20 at its fixed address. */
const CURRENCY = "0x20c0000000000000000000000000000000000000";
const LINK = "https://seller.example/atr";

const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString("base64url");

/** A seller's offer: a Tempo charge challenge as issued, before H. */
export function offer(feePayer: boolean, modes: readonly string[], extra: Record<string, unknown> = {}): WireChallenge {
  return {
    realm: "api.seller.example",
    method: "tempo",
    intent: "charge",
    expires: EXPIRES,
    request: b64({ amount: "10000", currency: CURRENCY, recipient: RECIPIENT, methodDetails: { chainId: 42431, feePayer, supportedModes: modes, ...extra } }),
  } as WireChallenge;
}

/**
 * The offer as the profile places it, built here from the profile's rule 1 and `mpp/charge` rules 1 and 2, not by lcp:
 * the id H's base64url and the position 0, `opaque` the RFC 8785 map of `legalContext` and `legalContextUrl`, and the
 * split `{recipient, amount: "1", memo: H}` appended to `methodDetails.splits` of the request, written in RFC 8785.
 */
export function placedByProfile(o: WireChallenge): WireChallenge {
  const request = JSON.parse(Buffer.from(o.request, "base64url").toString("utf8")) as { methodDetails: Record<string, unknown> };
  const md = request.methodDetails;
  const splits = [...((md["splits"] as unknown[] | undefined) ?? []), { amount: "1", memo: H, recipient: RECIPIENT }];
  const jcs = (v: unknown): string =>
    Array.isArray(v)
      ? `[${v.map(jcs).join(",")}]`
      : typeof v === "object" && v !== null
        ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${jcs((v as Record<string, unknown>)[k])}`).join(",")}}`
        : JSON.stringify(v);
  return {
    ...o,
    id: `${Buffer.from(H.slice(2), "hex").toString("base64url")}.0`,
    opaque: Buffer.from(jcs({ legalContext: `lcp:sha256:${H}`, legalContextUrl: LINK })).toString("base64url"),
    request: Buffer.from(jcs({ ...request, methodDetails: { ...md, splits } })).toString("base64url"),
  };
}


/** The members viem 2.57.4's Tempo reader (`Transaction.deserialize`) gives of a signed transaction. */
export function viemRead(wire: Hex): { type: string; nonceKey: string; validBefore: string; calls: { to: string; data: string }[] } {
  const t = Transaction.deserialize(wire as never) as unknown as {
    nonceKey: bigint;
    validBefore: number;
    calls: { to: string; data: string }[];
  };
  return { type: wire.slice(0, 4), nonceKey: String(t.nonceKey), validBefore: String(t.validBefore), calls: t.calls };
}

const PULL = "mpp/charge/tempo/split-memo";
const PUSH = "mpp/charge/tempo/split-memo/push";
const PAYER = privateKeyToAccount(DEV_KEY).address;

/** The vector file's content: the stock client's credentials under the profile's placement, and the profile's answers. */
export async function splitVectors(): Promise<Record<string, unknown>> {
  const forms: Record<string, unknown> = {};
  for (const [name, feePayer, mode] of [
    ["pullSponsored", true, "pull"],
    ["pullPayerPays", false, "pull"],
    ["push", false, "push"],
  ] as const) {
    const o = offer(feePayer, [mode]);
    const placed = placedByProfile(o);
    const paid = await mppxPays(placed, mode, NOW);
    const wire = (paid.sent ?? paid.credential.payload["signature"]) as Hex;
    const read = viemRead(wire);
    forms[name] = {
      pairing: mode === "pull" ? PULL : PUSH,
      offer: o,
      placed,
      authorization: paid.authorization,
      ...(paid.sent === undefined
        ? {}
        : { fetched: { transaction: keccak256(paid.sent), blockNumber: "17", logs: [], raw: paid.sent } }),
      viem: read,
      expect: {
        bound: H,
        reference: {
          network: "eip155:42431",
          payer: PAYER.toLowerCase(),
          payee: RECIPIENT.toLowerCase(),
          currency: CURRENCY,
          h: H,
          validBefore: read.validBefore,
          nonce: { key: read.nonceKey, value: "0" },
          ...(paid.sent === undefined ? {} : { named: keccak256(paid.sent) }),
        },
      },
    };
  }
  const both = [PULL, PUSH];
  const challenges = [
    { case: "supportedModes [\"pull\"] names the pull form alone", offer: offer(true, ["pull"]), expect: [PULL] },
    { case: "supportedModes [\"push\"] names the push form alone", offer: offer(false, ["push"]), expect: [PUSH] },
    { case: "supportedModes absent names both forms; feePayer true takes nothing away", offer: withDetails({ supportedModes: undefined }), expect: both },
    { case: "methodDetails.zones is refused", offer: withDetails({ zones: [{ zoneId: 1 }] }), expect: { refused: true, code: "mpp/zones-not-served" } },
    { case: "machineTokenEnabled true is refused", offer: withDetails({ machineTokenEnabled: true }), expect: { refused: true, code: "mpp/machine-token-enabled" } },
    { case: "methodDetails.memo is the carrier taken", offer: withDetails({ memo: `0x${"00".repeat(32)}` }), expect: { refused: true, code: "mpp/carrier-taken" } },
    { case: "an amount of zero names no pairing", offer: withRequest({ amount: "0" }), expect: [] },
    { case: "chainId absent is refused", offer: withDetails({ chainId: undefined }), expect: { refused: true, code: "mpp/chain-id-required" } },
    { case: "ten splits of the seller's own leave no room for H's", offer: withDetails({ splits: tenSplits() }), expect: { refused: true, code: "mpp/splits-malformed" } },
    { case: "a primary of nothing beside H's split is refused", offer: withRequest({ amount: "1" }), expect: { refused: true, code: "mpp/input-malformed" } },
  ];
  return {
    about:
      "Vectors for mpp/charge/tempo/split-memo and mpp/charge/tempo/split-memo/push (profile mpp-charge-tempo-split-memo.md). " +
      "Oracle: stock mppx 0.17.6's Tempo charge client (mppx/client tempo.charge) paying each placed challenge with the " +
      "published Anvil development key #0, at the fixed clock `now` with viem's random validAfter bytes fixed at 0x11, " +
      "through a transport that answers chain id, fees and gas and, on push, takes the sent transaction " +
      "(test/eip155-tempo-mpp-split-oracle.ts, which rebuilds this file whole); `authorization` is the Authorization header value " +
      "the client returned, its credential the base64url JSON after \"Payment \"; `viem` is viem 2.57.4's Tempo reader of the " +
      "signed bytes, which names the split call carrying H. `placed` is the profile's rule 1 applied by that module, not by " +
      "lcp: the split {recipient, amount: \"1\", memo: H} appended in RFC 8785 form. H is SHA-256 of \"abc\" (FIPS 180-2 B.1). " +
      "`challenges` are pairingsOf's answers the profile's rules 2 to 4 state.",
    fixed: { H, now: NOW, link: LINK, payer: PAYER },
    ...forms,
    challenges,
    boundChallenge: {
      about:
        "Each row presents the credential its pointer names (RFC 6901) under its placed challenge with one member changed, which " +
        "the pairing's filter refuses, so bound and reference refuse with the code pairingsOf gives.",
      rows: [
        { case: "the pull credential under its challenge with methodDetails.zones added", pairing: PULL, credential: "/buyer/rows/1/input/presented", challenge: changedPlaced("pullSponsored", { zones: [{ zoneId: 1 }] }), expect: "mpp/zones-not-served" },
        { case: "the push credential under its challenge with machineTokenEnabled set", pairing: PUSH, credential: "/buyer/rows/3/input/presented", challenge: changedPlaced("push", { machineTokenEnabled: true }), expect: "mpp/machine-token-enabled" },
      ],
    },
    buyer: {
      about:
        "The buyer gate's rows for this file's pairings, in the form of buyer.json's rows. B2 is the plant: the document advertises H, the " +
        "hash of the ATR in B6's first check, and the link serves the planted ATR, abd; the gate declines hash-mismatch and never calls " +
        "the signer. B6 is the pairing's bound check over the payment this file holds: check(abc) gives H, check(abd) declines signed-not-bound.",
      rows: [PULL, PUSH].flatMap((pairing) => {
        const f = forms[pairing === PULL ? "pullSponsored" : "push"] as { placed: WireChallenge; authorization: string; fetched?: unknown };
        const credential = JSON.parse(Buffer.from(f.authorization.replace(/^Payment /, ""), "base64url").toString("utf8"));
        return [
          {
            name: "B2",
            pairing,
            plant: true,
            input: { doc: [f.placed], servesHex: "616264", account: `eip155:42431:${PAYER}`, now: NOW, signer: "counting" },
            advertised: H,
            servedHash: "0xa52d159f262b2c6ddb724a61840befc36eb30c88877a4030b65cbe86298449c9",
            expect: { decline: "hash-mismatch", signCalls: 0 },
          },
          {
            name: "B6",
            pairing,
            input: { presented: credential, ...(f.fetched === undefined ? {} : { fetched: f.fetched }), check: [{ bytesHex: "616263" }, { bytesHex: "616264" }] },
            expect: [{ h: H }, { decline: "signed-not-bound" }],
          },
        ];
      }),
    },
  };

  function changedPlaced(name: string, details: Record<string, unknown>): WireChallenge {
    const p = (forms[name] as { placed: WireChallenge }).placed;
    const r = JSON.parse(Buffer.from(p.request, "base64url").toString("utf8")) as { methodDetails: Record<string, unknown> };
    return { ...p, request: b64({ ...r, methodDetails: { ...r.methodDetails, ...details } }) };
  }
}

function withDetails(changes: Record<string, unknown>): WireChallenge {
  const o = offer(true, ["pull"]);
  const r = JSON.parse(Buffer.from(o.request, "base64url").toString("utf8")) as { methodDetails: Record<string, unknown> };
  for (const [k, v] of Object.entries(changes)) {
    if (v === undefined) delete r.methodDetails[k];
    else r.methodDetails[k] = v;
  }
  return { ...o, request: b64(r) };
}

function withRequest(changes: Record<string, unknown>): WireChallenge {
  const o = offer(true, ["pull"]);
  return { ...o, request: b64({ ...JSON.parse(Buffer.from(o.request, "base64url").toString("utf8")), ...changes }) };
}

function tenSplits(): unknown[] {
  return Array.from({ length: 10 }, (_, i) => ({ recipient: `0x${(i + 1).toString(16).padStart(40, "0")}`, amount: "1" }));
}
