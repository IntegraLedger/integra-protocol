/**
 * The Casper module for `x402/exact/casper` on each configured network: `@x402/casper` 2.31.0's facilitator class,
 * registered unchanged. The payer signs a CEP-3009 `TransferWithAuthorization` whose 32-byte nonce is H (on an
 * agreement, the agreement's own value of H); the seller's key sends the transaction that calls the token package's
 * `transfer_with_authorization` with it, and pays its gas (`extra.key` `relayer`). The key reaches the module as the
 * `FacilitatorCasperSigner` the class takes. The class reads the token's state before it settles from the node its
 * signer names, so that node must be the one the configuration names, the seller's: the module does not start where the
 * signer names another, as `@x402/casper`'s signer does for a network its configuration leaves out, falling back to a
 * public node. Where the signer names a node for speculative execution, the class has the key sign a deploy of the
 * payer's authorization at every check and sends it there, so that node too must be the configured one. lcp's checks of
 * the pairing come first and name the instrument; lcp's read goes through the same node. Every transaction the key
 * submits is counted in the network's fee budget as it is submitted, one the class's answer does not name included.
 * The module serves `casper:casper-test` and does not start on `casper:casper`, where no token has yet been shown to
 * execute `transfer_with_authorization`.
 */
import { fromLegalContext, isRefusal, type Act, type AtrHash, type Refusal } from "@integraledger/lcp";
import {
  exactCasper,
  type CasperBlockPage,
  type CasperCall,
  type CasperCursor,
  type CasperHead,
  type CasperNetwork,
  type CasperReader,
  type CasperRef,
} from "@integraledger/lcp/casper";
import type { PaymentRequirements as LcpOption } from "@integraledger/lcp/x402";
import type { Network, SchemeNetworkFacilitator } from "@x402/core/types";
import { isObject } from "../../answers.js";
import { NODE_TIMEOUT_MS, NodeError, postJson, site } from "../../http.js";
import {
  outcomeOf,
  type Charged,
  type FeeMeter,
  type Instrumented,
  type Module,
  type ModuleStarter,
  type Refused,
  type Registration,
  type X402Payment,
} from "../../module.js";

/**
 * `@x402/casper`'s `FacilitatorCasperSigner`: the seller's key as the published class takes it, which its own
 * `toFacilitatorCasperSigner` makes from a casper-js-sdk `PrivateKey`.
 */
export interface CasperSigner {
  getNetworkConfig(network: Network): Promise<{ readonly chainName: string; readonly rpcUrl: string }>;
  getAddresses(network: Network): string[];
  getPublicKeyHex(network: Network): string;
  getSpeculativeRpcUrl(network: Network): string | undefined;
  signTransaction(transaction: unknown, network: Network): Promise<void>;
  putTransaction(network: Network, transaction: unknown): Promise<string>;
  waitForTransaction(network: Network, transactionHash: string): Promise<void>;
}

/**
 * The parts of casper-js-sdk 5.1.1 the reader uses, typed here: the module loads `@x402/casper` and casper-js-sdk by
 * names the compiler does not resolve, since casper-js-sdk ships TypeScript sources beside its declarations
 * (`dist/@types/*.ts`, which `dist/index.d.ts` reaches before their `.d.ts`), and a compiler that resolves its types
 * reads them as this package's own sources and refuses them under `verbatimModuleSyntax` (TS1287).
 */
interface Decimal {
  toString(): string;
}
interface Cl {
  readonly key?: { readonly account?: { toHex(): string }; readonly hash?: { toHex(): string } };
  readonly ui8?: Decimal;
  readonly ui64?: Decimal;
  readonly ui256?: Decimal;
  readonly list?: { readonly elements: readonly Cl[] };
  readonly byteArray?: { bytes(): Uint8Array };
}
/** casper-js-sdk's `InfoGetTransactionResult`, as `fromJSON` gives it from a `Version1` transaction or a `Deploy`. */
interface Parsed {
  readonly transaction: {
    readonly args: { getByName(name: string): Cl | undefined };
    readonly target: { readonly stored?: { readonly id: { readonly byPackageHash?: { readonly addr: { toHex(): string } } } } };
    readonly entryPoint: { readonly customEntryPoint?: string };
  };
  readonly executionInfo?: { readonly blockHeight: number; readonly executionResult?: { readonly errorMessage?: string } };
}
/** casper-js-sdk's parse of `info_get_transaction`'s result. */
export type ParseTransaction = (json: unknown) => Parsed | null;

const load = (name: string): Promise<Record<string, unknown>> => import(name);

/** The published class and casper-js-sdk's parse, loaded once a configuration names a Casper network. */
async function published(): Promise<{
  readonly Scheme: new (signer: CasperSigner, config: { limitedPaymentMotes?: number }) => SchemeNetworkFacilitator;
  readonly defaultMotes: number;
  readonly parse: ParseTransaction;
}> {
  const [facilitator, x402, sdk] = await Promise.all([load("@x402/casper/exact/facilitator"), load("@x402/casper"), load("casper-js-sdk")]);
  const result = (sdk["InfoGetTransactionResult"] ?? (sdk["default"] as Record<string, unknown>)["InfoGetTransactionResult"]) as {
    fromJSON(json: unknown): Parsed | null;
  };
  return {
    Scheme: facilitator["ExactCasperScheme"] as never,
    defaultMotes: x402["DEFAULT_PAYMENT_MOTES"] as number,
    parse: (json) => result.fromJSON(json),
  };
}

export interface CasperConfig {
  /**
   * The network, exactly one: `casper:casper-test`. x402's Casper scheme also names `casper:casper`, which the module
   * does not start on until a token there is shown to execute `transfer_with_authorization`.
   */
  readonly network: CasperNetwork;
  /**
   * The seller's key, as `@x402/casper`'s facilitator class takes it: it signs and sends the transaction that executes
   * the payer's authorization, and pays its gas. Its `getNetworkConfig` must name `rpc` for `network`, and its
   * `getSpeculativeRpcUrl` none or `rpc`.
   */
  readonly signer: CasperSigner;
  /** The seller's node, its JSON-RPC URL: the class's reads, lcp's read and the fee count. */
  readonly rpc: string;
  /**
   * The most the settlement transaction can pay, in motes, which the class offers as its payment; `@x402/casper`'s
   * default (2.5 CSPR) where left out.
   */
  readonly paymentMotes?: number;
}

/** Casper mainnet, on which no token has yet been shown to execute `transfer_with_authorization`. */
const CASPER_MAINNET = "casper:casper";
/** The dictionary in which the token package keeps a used nonce, by the profile `x402/exact/casper`, rule 10. */
const USED_NONCES = "used_nonces";
/** The transactions of a block one page of `blockCalls` reads. */
const PAGE = 64;
/** The node's error codes the reader tells apart (casper-node's JSON-RPC codes, as casper-js-sdk names them). */
const NO_SUCH_BLOCK = -32001;
const QUERY_FAILED = -32003;
const NO_SUCH_STATE_ROOT = -32012;
const NO_SUCH_TRANSACTION = -32014;

/** The x402 reason for one of lcp's refusals: the version, the option, or else the payload. */
function reasonOf(r: Refusal): string {
  if (r.code === "x402/not-v2") return "invalid_x402_version";
  if (r.code.startsWith("x402/option") || r.code === "casper/option-malformed") return "invalid_payment_requirements";
  return "invalid_payload";
}

/** A payment as lcp reads it: its read keys, the act it is, and H. */
interface Checked {
  readonly ref: CasperRef;
  readonly act: Act;
  readonly h: AtrHash;
}

/**
 * lcp's checks of the payment, which read neither the chain nor the clock, and its read keys; or the refusal. A payment
 * signs H as its nonce. An agreement signs the agreement's own value of H, so where the nonce is not the H the payment
 * echoes, it is the agreement's when it is that H's agreement value (the profile, rule 4).
 */
async function checked(p: X402Payment): Promise<Checked | Refusal> {
  const bound = await exactCasper.bound(p.payload);
  if (isRefusal(bound)) return bound;
  // The requirements arrive as JSON, which lcp's option type names.
  const option = p.requirements as LcpOption;
  const ref = await exactCasper.reference(p.payload, option);
  if (!isRefusal(ref)) return { ref, act: "payment", h: ref.nonce };
  if (ref.code !== "casper/nonce-not-bound") return ref;
  const echoed = isObject(p.payload.extensions) ? p.payload.extensions["legalContext"] : undefined;
  const lc = fromLegalContext({ legalContext: isObject(echoed) ? echoed["info"] : undefined } as never);
  if (lc === null) return ref;
  const agreed = await exactCasper.reference(p.payload, option, { act: "agreement", h: lc.h });
  return isRefusal(agreed) ? ref : { ref: agreed, act: "agreement", h: lc.h };
}

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

/** A decimal the node wrote as a number or a string, as a bigint. */
function whole(v: unknown, what: string): bigint {
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return BigInt(v);
  if (typeof v === "string" && /^\d+$/.test(v)) return BigInt(v);
  throw new NodeError("malformed", true, what);
}

/** A block as the reader needs it: its height, its own timestamp, its state root and its transactions in its order. */
interface Block {
  readonly height: bigint;
  readonly timestamp: bigint;
  readonly stateRoot: string;
  readonly transactions: readonly { readonly hash: string; readonly tag: "Version1" | "Deploy" }[];
}

/** `chain_get_block`'s block, a `Version2` block or a `Version1` one. */
function blockOf(r: unknown): Block {
  const signed = isObject(r) ? r["block_with_signatures"] : undefined;
  const wrapped = isObject(signed) ? signed["block"] : undefined;
  const v2 = isObject(wrapped) ? wrapped["Version2"] : undefined;
  const v1 = isObject(wrapped) ? wrapped["Version1"] : undefined;
  const block = isObject(v2) ? v2 : isObject(v1) ? v1 : undefined;
  const header = isObject(block) ? block["header"] : undefined;
  const body = isObject(block) ? block["body"] : undefined;
  if (!isObject(header) || !isObject(body)) throw new NodeError("malformed", true, "a block");
  const time = typeof header["timestamp"] === "string" ? Date.parse(header["timestamp"]) : Number.NaN;
  const root = header["state_root_hash"];
  if (!Number.isSafeInteger(time) || typeof root !== "string") throw new NodeError("malformed", true, "a block header");
  const transactions: { hash: string; tag: "Version1" | "Deploy" }[] = [];
  if (isObject(v2)) {
    // A Version2 block holds its transactions by lane; its order is the lanes' in their ids' order.
    const lanes = isObject(body["transactions"]) ? body["transactions"] : {};
    for (const lane of Object.keys(lanes).sort((a, b) => Number(a) - Number(b))) {
      const list = lanes[lane];
      for (const t of Array.isArray(list) ? list : []) {
        const tag = isObject(t) && typeof t["Version1"] === "string" ? "Version1" : isObject(t) && typeof t["Deploy"] === "string" ? "Deploy" : undefined;
        if (tag === undefined) throw new NodeError("malformed", true, "a block's transaction");
        transactions.push({ hash: (t as Record<string, string>)[tag]!.toLowerCase(), tag });
      }
    }
  } else {
    for (const key of ["deploy_hashes", "transfer_hashes"]) {
      const list = body[key];
      for (const t of Array.isArray(list) ? list : []) {
        if (typeof t !== "string") throw new NodeError("malformed", true, "a block's deploy");
        transactions.push({ hash: t.toLowerCase(), tag: "Deploy" });
      }
    }
  }
  return { height: whole(header["height"], "a block height"), timestamp: BigInt(time), stateRoot: root, transactions };
}

/** An argument's account hash or package hash, as lcp spells an address: its tag, `00` or `01`, then 32 bytes. */
function addressOf(v: Cl | undefined): string | undefined {
  const key = v?.key;
  if (key?.account !== undefined) return `00${key.account.toHex()}`.toLowerCase();
  if (key?.hash !== undefined) return `01${key.hash.toHex()}`.toLowerCase();
  return undefined;
}

function numberOf(v: Cl | undefined): bigint | undefined {
  const n = v?.ui256 ?? v?.ui64;
  const s = n?.toString();
  return s !== undefined && /^\d+$/.test(s) ? BigInt(s) : undefined;
}

/** A `List<U8>` or a byte array, as bytes. */
function bytesOf(v: Cl | undefined): Uint8Array | undefined {
  if (v?.byteArray !== undefined) return v.byteArray.bytes();
  const elements = v?.list?.elements;
  if (elements === undefined) return undefined;
  const out = elements.map((e) => Number(e.ui8?.toString()));
  return out.every((b) => Number.isInteger(b) && b >= 0 && b <= 255) ? Uint8Array.from(out) : undefined;
}

/** One executed transaction's call, as lcp's reader reports it, from `info_get_transaction`'s answer. */
function callOf(r: Parsed): CasperCall {
  const t = r.transaction;
  const info = r.executionInfo;
  const result = info?.executionResult;
  const args = t.args;
  const arg = (name: string) => args.getByName(name);
  const from = addressOf(arg("from")) ?? addressOf(arg("authorizer"));
  const to = addressOf(arg("to"));
  const value = numberOf(arg("value"));
  const validAfter = numberOf(arg("valid_after"));
  const validBefore = numberOf(arg("valid_before"));
  const nonce = bytesOf(arg("nonce"));
  return {
    executed: result !== undefined,
    blockHeight: info === undefined || result === undefined ? null : BigInt(info.blockHeight),
    error: result?.errorMessage ? result.errorMessage : null,
    packageHash: t.target.stored?.id.byPackageHash?.addr.toHex().toLowerCase() ?? null,
    entryPoint: t.entryPoint.customEntryPoint ?? null,
    args: {
      ...(from === undefined ? {} : { from }),
      ...(to === undefined ? {} : { to }),
      ...(value === undefined ? {} : { value }),
      ...(validAfter === undefined ? {} : { validAfter }),
      ...(validBefore === undefined ? {} : { validBefore }),
      ...(nonce === undefined ? {} : { nonce }),
    },
  };
}

/** lcp's reader over the node's JSON-RPC at `url`, its calls ending by `deadline`. */
export function casperReader(network: CasperNetwork, url: string, deadline: number, parse: ParseTransaction): CasperReader {
  let id = 0;
  async function rpc(method: string, params?: unknown): Promise<{ result?: unknown; code?: number; message?: string }> {
    const body = { jsonrpc: "2.0", id: ++id, method, ...(params === undefined ? {} : { params }) };
    const a = await postJson(url, body, deadline - performance.now());
    if (!isObject(a)) throw new NodeError("malformed", true, method);
    const e = a["error"];
    if (isObject(e)) return { code: typeof e["code"] === "number" ? e["code"] : 0, message: String(e["message"] ?? "") };
    return { result: a["result"] };
  }
  async function answered(method: string, params?: unknown): Promise<unknown> {
    const a = await rpc(method, params);
    if (a.code !== undefined) throw new NodeError("http-status", true, `${method} at ${site(url)}: ${a.code} ${a.message}`);
    return a.result;
  }
  /** The block at `height`, or null where the node does not serve it. */
  async function blockAt(height: bigint): Promise<Block | null> {
    const a = await rpc("chain_get_block", { block_identifier: { Height: Number(height) } });
    if (a.code === NO_SUCH_BLOCK) return null;
    if (a.code !== undefined) throw new NodeError("http-status", true, `chain_get_block: ${a.code} ${a.message}`);
    return blockOf(a.result);
  }
  /** The newest enabled contract of the token package, at `stateRoot`. */
  async function activeContract(asset: string, stateRoot: string): Promise<string> {
    const r = await answered("query_global_state", { state_identifier: { StateRootHash: stateRoot }, key: `hash-${asset}`, path: [] });
    const stored = isObject(r) ? r["stored_value"] : undefined;
    const pkg = isObject(stored) ? stored["ContractPackage"] : undefined;
    if (!isObject(pkg) || !Array.isArray(pkg["versions"])) throw new NodeError("malformed", true, "a contract package");
    const disabled = new Set((Array.isArray(pkg["disabled_versions"]) ? pkg["disabled_versions"] : []).map((d) => JSON.stringify(d)));
    let best: { version: number; hash: string } | undefined;
    for (const v of pkg["versions"]) {
      if (!isObject(v) || typeof v["contract_hash"] !== "string" || !Number.isSafeInteger(v["contract_version"])) continue;
      if (disabled.has(JSON.stringify([v["protocol_version_major"], v["contract_version"]]))) continue;
      if (best === undefined || (v["contract_version"] as number) > best.version) best = { version: v["contract_version"] as number, hash: v["contract_hash"] };
    }
    if (best === undefined) throw new NodeError("malformed", true, "a contract package with no enabled version");
    return `hash-${best.hash.replace(/^(contract-|hash-)/, "")}`;
  }
  /** A transaction by its hash, as a `Version1` transaction and then as a `Deploy`; null where the node knows neither. */
  async function transaction(hash: string, tags: readonly ("Version1" | "Deploy")[] = ["Version1", "Deploy"]): Promise<CasperCall | null> {
    for (const tag of tags) {
      const a = await rpc("info_get_transaction", { transaction_hash: { [tag]: hash }, finalized_approvals: false });
      if (a.code === NO_SUCH_TRANSACTION) continue;
      if (a.code !== undefined) throw new NodeError("http-status", true, `info_get_transaction: ${a.code} ${a.message}`);
      const parsed = parse(a.result);
      if (parsed === null) throw new NodeError("malformed", true, "a transaction");
      return callOf(parsed);
    }
    return null;
  }
  return {
    network,
    transaction: (hash) => transaction(hash.toLowerCase()),
    async head(): Promise<CasperHead> {
      const b = blockOf(await answered("chain_get_block"));
      return { height: b.height, timestamp: b.timestamp };
    },
    async lowest() {
      const r = await answered("info_get_status");
      const range = isObject(r) ? r["available_block_range"] : undefined;
      return whole(isObject(range) ? range["low"] : undefined, "available_block_range");
    },
    async nonceUsed(asset, from, nonce, height) {
      const block = await blockAt(height);
      if (block === null) return null;
      const contract = await activeContract(asset, block.stateRoot);
      // The item's key: the payer's key as the token serializes it, its tag and 32 bytes, then the nonce's 32 bytes.
      const item = Buffer.concat([Buffer.from(from, "hex"), Buffer.from(nonce)]).toString("base64");
      const a = await rpc("state_get_dictionary_item", {
        state_root_hash: block.stateRoot,
        dictionary_identifier: { ContractNamedKey: { key: contract, dictionary_name: USED_NONCES, dictionary_item_key: item } },
      });
      // The node answers a dictionary item it does not hold with its query's failure; a state root it does not serve
      // with its own code.
      if (a.code === QUERY_FAILED) return false;
      if (a.code === NO_SUCH_STATE_ROOT || a.code === NO_SUCH_BLOCK) return null;
      if (a.code !== undefined) throw new NodeError("http-status", true, `state_get_dictionary_item: ${a.code} ${a.message}`);
      const stored = isObject(a.result) ? a.result["stored_value"] : undefined;
      const cl = isObject(stored) ? stored["CLValue"] : undefined;
      if (!isObject(cl) || typeof cl["parsed"] !== "boolean") throw new NodeError("malformed", true, "a used nonce");
      return cl["parsed"];
    },
    async blockCalls(height, start): Promise<CasperBlockPage | null> {
      const block = await blockAt(height);
      if (block === null) return null;
      const calls = [];
      for (const t of block.transactions.slice(start, start + PAGE)) {
        const c = await transaction(t.hash, [t.tag]);
        if (c === null) throw new NodeError("malformed", true, "a transaction of a block the node serves");
        calls.push({ ...c, transaction: t.hash });
      }
      return { calls, next: start + PAGE < block.transactions.length ? start + PAGE : null };
    },
  };
}

/**
 * What a transaction the key sent counts in the fee budget: the cost the node shows it paid once executed; until then,
 * or where the node cannot be read, the payment it offered, its bound.
 */
async function chargedOf(url: string, hash: string, bound: bigint, deadline: number): Promise<Charged> {
  const cost = await costOf(url, hash, deadline).catch(() => undefined);
  return cost === undefined ? { fee: bound, included: false } : { fee: cost, included: true };
}

/** A casper-js-sdk transaction's own hash, known before it is sent. */
function hashOf(transaction: unknown): string | undefined {
  try {
    const h = (transaction as { hash?: { toHex?(): unknown } } | null)?.hash?.toHex?.();
    return typeof h === "string" && /^[0-9a-fA-F]{64}$/.test(h) ? h.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The seller's signer object as the class takes it, each transaction it submits given to the network's fee meter once
 * the submission ends, every other member unchanged. x402's class answers a submission that threw naming no
 * transaction, though the node may have taken it; its hash is known before it is sent, so the meter counts it.
 */
function counted(signer: CasperSigner, meter: FeeMeter, shown: (transaction: string) => Promise<Charged>): CasperSigner {
  return new Proxy(signer, {
    get(inner, member) {
      const value: unknown = Reflect.get(inner, member);
      if (typeof value !== "function") return value;
      if (member === "putTransaction") {
        return async (network: Network, transaction: unknown) => {
          const hash = hashOf(transaction);
          try {
            return await value.call(inner, network, transaction);
          } finally {
            if (hash !== undefined) meter.sent(hash, () => shown(hash));
          }
        };
      }
      return value.bind(inner);
    },
  });
}

/** The fee a transaction paid, in motes, where the node shows it executed: its execution result's `cost`. */
async function costOf(url: string, hash: string, deadline: number): Promise<bigint | undefined> {
  const a = await postJson(
    url,
    { jsonrpc: "2.0", id: 1, method: "info_get_transaction", params: { transaction_hash: { Version1: hash }, finalized_approvals: false } },
    deadline - performance.now(),
  );
  const r = isObject(a) ? a["result"] : undefined;
  const info = isObject(r) ? r["execution_info"] : undefined;
  const result = isObject(info) ? info["execution_result"] : undefined;
  if (!isObject(result)) return undefined;
  const v2 = result["Version2"];
  if (isObject(v2)) return whole(v2["cost"], "an execution's cost");
  const v1 = isObject(result["Version1"]) ? result["Version1"] : undefined;
  const outcome = isObject(v1) ? (v1["Success"] ?? v1["Failure"]) : undefined;
  return isObject(outcome) ? whole(outcome["cost"], "an execution's cost") : undefined;
}

/**
 * The module of `x402/exact/casper` on the configured network, over the published class and casper-js-sdk's parse.
 * With `meter`, the network's fee meter, every transaction the class submits is counted.
 */
export function casperModule(c: CasperConfig, p: Awaited<ReturnType<typeof published>>, meter?: FeeMeter): Module {
  const network = c.network as Network;
  const bound = BigInt(c.paymentMotes ?? p.defaultMotes);
  const reader = (deadline: number) => casperReader(c.network, c.rpc, deadline, p.parse);
  const signer =
    meter === undefined ? c.signer : counted(c.signer, meter, (hash) => chargedOf(c.rpc, hash, bound, performance.now() + NODE_TIMEOUT_MS));
  return {
    // x402's Casper settler refuses a zero amount, so the kind does not take zero (the profile, rule 24).
    descriptor: { name: "casper", key: "relayer", pairings: [exactCasper.id], acceptsZero: [] },
    network,
    facilitator: new p.Scheme(signer, c.paymentMotes === undefined ? {} : { limitedPaymentMotes: c.paymentMotes }),
    record: {
      async instrument(p): Promise<Instrumented | Refused> {
        const k = await checked(p);
        if (isRefusal(k)) return { refused: reasonOf(k), message: k.code };
        // An authorization the payee signed is no payment and no agreement (the profile, rule 5): nothing is sent for it.
        if (k.ref.from === k.ref.payee.toLowerCase()) return { refused: "invalid_payload" };
        return {
          pairing: exactCasper.id,
          // The token keeps a used nonce by (from, nonce) in its own package (the profile, rule 10); an agreement's nonce
          // is its own value of H, so one payer's agreement and payment under one H are two instruments.
          instrument: { by: "single-use", network, signer: k.ref.from, scope: k.ref.asset, value: k.ref.nonce },
          nonce: exactCasper.data.nonce,
          // The authorization can no longer land at or past validBefore, which the payer signed, in Unix seconds.
          keep: { until: "lapse", at: Math.min(k.ref.settleBy * 1000, Number.MAX_SAFE_INTEGER) },
        };
      },
      async position(_p, at) {
        return (await reader(at.deadline).head()).height;
      },
      async read(p, at) {
        const k = await checked(p);
        if (isRefusal(k)) return outcomeOf({ state: "unreadable", reason: "unparseable", foreign: [] });
        const search = at.search as CasperCursor | undefined;
        const after = at.from as bigint | undefined;
        return outcomeOf(
          await exactCasper.status({ ...k.ref, h: k.h }, reader(at.deadline), {
            act: k.act,
            finality: "finalized",
            ...(search === undefined ? {} : { search }),
            ...(after === undefined ? {} : { after }),
          }),
        );
      },
    },
    fees: {
      // The seller's key sends every settlement transaction and pays its gas.
      paysFee: () => true,
      payerBroadcast: () => false,
      charged: (_p, sent) => chargedOf(c.rpc, sent.transaction, bound, sent.deadline),
    },
  };
}

/**
 * The module's registration, once the network is one it serves and the signer is shown to name the configured node,
 * for its reads and for any speculative execution, and the network's chain.
 */
export async function casperRegistration(c: CasperConfig, p: Awaited<ReturnType<typeof published>>, meter?: FeeMeter): Promise<Registration> {
  if (c.network === CASPER_MAINNET) {
    throw new Error(`casper on ${c.network}: not served, since no token there has yet been shown to execute transfer_with_authorization`);
  }
  const named = await c.signer.getNetworkConfig(c.network as Network);
  if (named.rpcUrl !== c.rpc) {
    throw new Error(`casper on ${c.network}: the signer reads ${site(named.rpcUrl)}, not the configured node ${site(c.rpc)}`);
  }
  const speculative = c.signer.getSpeculativeRpcUrl(c.network as Network);
  if (speculative && speculative !== c.rpc) {
    throw new Error(`casper on ${c.network}: the signer's speculative execution goes to ${site(speculative)}, not the configured node ${site(c.rpc)}`);
  }
  if (`casper:${named.chainName}` !== c.network) {
    throw new Error(`casper on ${c.network}: the signer names the chain ${named.chainName}`);
  }
  return { network: c.network as Network, module: casperModule(c, p, meter), own: [] };
}

/** The module's start: one registration of `exact` per configured network, its submissions counted by its fee meter. */
export const starter: ModuleStarter<readonly CasperConfig[]> = {
  name: "casper",
  async start(config, core) {
    if (config.length === 0) return { registrations: [] };
    const p = await published();
    return { registrations: await Promise.all(config.map((c) => casperRegistration(c, p, core.meter(c.network as Network)))) };
  },
};
