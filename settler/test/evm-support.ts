// Test support for the `evm` and `erc7710` modules: lcp's vector files, read as the files lcp ships them; a gas key
// made the way an operator makes one, a viem client over the node composed by x402's `toFacilitatorEvmSigner`; and the
// settler started with the settler's own module list, which loads only the modules a test configures, each call made
// over its HTTP surface with the credential a deployment whose modules hold a key requires.
import { readFileSync } from "node:fs";
import type { PaymentPayload, PaymentRequirements, SettleResponse, SupportedResponse, VerifyResponse } from "@x402/core/types";
import { toFacilitatorEvmSigner, type FacilitatorEvmSigner } from "@x402/evm";
import { createWalletClient, defineChain, http, publicActions, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { serveSettler, type SettlerConfig } from "../src/core.js";
import type { Erc7710Config } from "../src/modules/erc7710/index.js";
import type { EvmConfig } from "../src/modules/evm/index.js";
import { MODULES } from "../src/modules/index.js";
import { freshDatabase, onLockedPort } from "./support.js";

/**
 * One of lcp's vector files, by its name, as parsed JSON: from lcp's own folder, or from the folder `LCP_VECTORS` names,
 * where a plant puts a copy with one member changed.
 */
export function lcpVector(name: string): unknown {
  const planted = process.env["LCP_VECTORS"];
  const file = planted === undefined ? new URL(`../../lcp/vectors/${name}.json`, import.meta.url) : `${planted}/${name}.json`;
  return JSON.parse(readFileSync(file, "utf8")) as unknown;
}

/** The value a JSON Pointer (RFC 6901) names in `doc`, typed as the caller reads it; undefined where it names none. */
export function pointer<T>(doc: unknown, path: string): T {
  let v: unknown = doc;
  for (const k of path.split("/").slice(1).map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"))) {
    v = typeof v === "object" && v !== null ? (v as Record<string, unknown>)[k] : undefined;
  }
  return v as T;
}

/**
 * A gas key over the node at `url`: `key` where the vector fixes the facilitator's account, else one generated here,
 * which holds nothing on any network. The receipt wait is short, so a withheld receipt ends the settle.
 */
export function gasKey(url: string, key: Hex = generatePrivateKey()): FacilitatorEvmSigner & { readonly address: Hex } {
  const account = privateKeyToAccount(key);
  const chain = defineChain({
    id: 84532,
    name: "stub",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [url] } },
  });
  const client = createWalletClient({ account, chain, transport: http(url, { retryCount: 0 }), pollingInterval: 20 }).extend(publicActions);
  const signer = toFacilitatorEvmSigner(
    {
      address: account.address,
      getCode: (a) => client.getCode(a),
      readContract: (a) => client.readContract({ ...a, args: a.args ?? [] } as never),
      verifyTypedData: (a) => client.verifyTypedData(a as never),
      writeContract: (a) => client.writeContract({ ...a, args: a.args ?? [] } as never),
      sendTransaction: (a) => client.sendTransaction(a as never),
      waitForTransactionReceipt: (a) => client.waitForTransactionReceipt(a) as never,
      simulateCalls: (a) => client.simulateCalls(a as never) as never,
    },
    { confirmationTimeoutMs: 400 },
  );
  return Object.assign(signer, { address: account.address });
}

const CREDENTIAL = "ZXZtLXNldHRsZXItdGVzdA";

/** A row of the settler's record, as its table holds it. */
export interface RecordRow {
  network: string;
  key: string;
  pairing: string;
  final: boolean;
  transaction: string | null;
  keep_until: string | null;
}

/** The settler, started for one test on its own database, and its calls. */
export interface Settler {
  verify(payload: PaymentPayload, requirements?: PaymentRequirements): Promise<VerifyResponse>;
  settle(payload: PaymentPayload, requirements?: PaymentRequirements): Promise<SettleResponse>;
  supported(): Promise<SupportedResponse>;
  /** The record's rows, in the order they were claimed. */
  rows(): Promise<RecordRow[]>;
  /** The fee count's rows. */
  fees(): Promise<{ transaction: string; fee: string; included: boolean }[]>;
  /** What the modules' durable state holds. */
  state(): Promise<{ module: string; key: string; value: unknown }[]>;
  close(): Promise<void>;
}

/**
 * The settler with the `evm` and `erc7710` members `modules` gives, on a fresh database; a call's requirements are the
 * payment's `accepted` where none is given.
 */
export async function settlerOf(
  modules: { readonly evm?: readonly EvmConfig[]; readonly erc7710?: readonly Erc7710Config[] },
  more: Partial<SettlerConfig> = {},
): Promise<Settler> {
  const db = await freshDatabase();
  let started: { port: number; server: { close(): Promise<void> } };
  try {
    started = await onLockedPort((port) =>
      serveSettler(
        { listen: `127.0.0.1:${port}`, store: { url: db.url }, settleWaitMs: 5_000, credential: CREDENTIAL, operatorLog: () => {}, ...more, ...modules },
        MODULES,
      ),
    );
  } catch (e) {
    await db.drop();
    throw e;
  }
  const base = `http://127.0.0.1:${started.port}`;
  const headers = { "content-type": "application/json", authorization: `Bearer ${CREDENTIAL}` };
  const post = async (path: string, payload: PaymentPayload, requirements = payload.accepted) => {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ x402Version: 2, paymentPayload: payload, paymentRequirements: requirements }),
    });
    return (await res.json()) as never;
  };
  return {
    verify: (payload, requirements) => post("/verify", payload, requirements),
    settle: (payload, requirements) => post("/settle", payload, requirements),
    async supported() {
      return (await (await fetch(`${base}/supported`, { headers })).json()) as SupportedResponse;
    },
    async rows() {
      return (
        await db.pool.query<RecordRow>("SELECT network, key, pairing, final, transaction, keep_until::text FROM instrument ORDER BY claimed, key")
      ).rows;
    },
    async fees() {
      return (await db.pool.query<{ transaction: string; fee: string; included: boolean }>("SELECT transaction, fee::text, included FROM fee ORDER BY at")).rows;
    },
    async state() {
      return (await db.pool.query<{ module: string; key: string; value: unknown }>("SELECT module, key, value FROM module_state ORDER BY module, key")).rows;
    },
    async close() {
      await started.server.close();
      await db.drop();
    },
  };
}
