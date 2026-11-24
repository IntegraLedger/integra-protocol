/**
 * The seller's Sui node, over Sui's GraphQL RPC (the schema `@mysten/sui` 2.35.0 ships,
 * `src/graphql/generated/schema.graphql`): the reads, the simulation and the execution the module makes, and the reader
 * lcp's `x402/exact/sui` read takes. Every call is bounded by the node bound of `../../http.js` and by its deadline.
 */
import { fromBase64, toBase64 } from "@mysten/sui/utils";
import type { SuiNetwork, SuiPage, SuiReader } from "@integraledger/lcp/sui";
import { isObject } from "../../answers.js";
import { NodeError, postJson } from "../../http.js";

/** The node answered the request with GraphQL errors: it reached the node, which refused it. */
export class GraphqlFault extends Error {
  constructor(readonly messages: readonly string[]) {
    super(messages.join("; "));
  }
}

/** One owner's net change in one coin type, as the effects' `balanceChangesJson` states it. */
export interface BalanceChange {
  owner: string;
  coinType: string;
  amount: bigint;
}

/** A transaction's effects as the module reads them. */
export interface Effects {
  status: "SUCCESS" | "FAILURE";
  /** The checkpoint that holds them, or null for a transaction executed and not yet in one. */
  checkpoint: bigint | null;
  balanceChanges: BalanceChange[];
  /** What the gas owner paid: computation and storage less the storage rebate, never below zero. */
  fee: bigint;
}

/** An executed transaction: its bytes as the node holds them, and its effects. */
export interface Executed {
  bytes: Uint8Array;
  effects: Effects;
}

/** The newest checkpoint the node serves, its epoch and that epoch's reference gas price. */
export interface Latest {
  checkpoint: bigint;
  epoch: bigint;
  referenceGasPrice: bigint;
}

/** An owned or immutable object a transaction names at one version, as its signed bytes give it. */
export interface ObjectRef {
  objectId: string;
  version: bigint;
  /** Base58, as the bytes and the node state it. */
  digest: string;
}

/**
 * The most bytes one objects request's body carries. Sui GraphQL's `maxQueryPayloadSize`, 5000 on the public testnet and
 * mainnet endpoints, counts the whole body, variables included: about 26 references fit, and a wallet may pay gas with up
 * to 256 coins. Under it, each request is far below `maxMultiGetSize` (200).
 */
const OBJECTS_PAYLOAD_BYTES = 4800;
const OBJECTS_QUERY = `query($at: [ObjectKey!]!, $now: [ObjectKey!]!) { at: multiGetObjects(keys: $at) { version digest } now: multiGetObjects(keys: $now) { version } }`;
const objectsBody = (part: readonly ObjectRef[]) => ({
  at: part.map((r) => ({ address: r.objectId, version: Number(r.version) })),
  now: part.map((r) => ({ address: r.objectId })),
});

/** `refs` in order, in parts whose request body stays within `OBJECTS_PAYLOAD_BYTES`. */
function objectParts(refs: readonly ObjectRef[]): ObjectRef[][] {
  const parts: ObjectRef[][] = [];
  let part: ObjectRef[] = [];
  for (const ref of refs) {
    const next = [...part, ref];
    if (part.length > 0 && JSON.stringify({ query: OBJECTS_QUERY, variables: objectsBody(next) }).length > OBJECTS_PAYLOAD_BYTES) {
      parts.push(part);
      part = [ref];
    } else part = next;
  }
  if (part.length > 0) parts.push(part);
  return parts;
}

export interface SuiNode {
  readonly network: SuiNetwork;
  /** The transaction with `digest`, or null where the node holds none, and the newest checkpoint. */
  transaction(digest: string, deadline: number): Promise<{ executed: Executed | null; latest: Latest }>;
  /**
   * The first of `refs` the node can no longer take as an input, or null where it shows none: the node holds the
   * version named and that version's digest is another, or the object is now at a later version or no longer live
   * (deleted or wrapped). An object or version the node's index does not yet hold shows nothing.
   */
  unavailable(refs: readonly ObjectRef[], deadline: number): Promise<ObjectRef | null>;
  /** Simulates the transaction with Sui's checks, its signatures apart. */
  simulate(bytes: Uint8Array, deadline: number): Promise<Effects>;
  /** Executes the transaction with its signatures; its effects, the checkpoint where the node states one. */
  execute(bytes: Uint8Array, signatures: readonly string[], deadline: number): Promise<Effects>;
  /** Whether the node's `verifySignature` accepts `signature` by `author` over the transaction bytes. */
  verifySignature(bytes: Uint8Array, signature: string, author: string, deadline: number): Promise<boolean>;
  /** lcp's reader over this node, its calls ending by `deadline`. */
  reader(deadline: number): SuiReader;
}

const EFFECTS = `status checkpoint { sequenceNumber } balanceChangesJson
  gasEffects { gasSummary { computationCost storageCost storageRebate } }`;
const LATEST = `checkpoint { sequenceNumber epoch { epochId referenceGasPrice } }`;

export function suiNode(network: SuiNetwork, url: string): SuiNode {
  async function query(text: string, variables: Record<string, unknown>, deadline: number): Promise<Record<string, unknown>> {
    const answer = await postJson(url, { query: text, variables }, deadline - performance.now());
    if (!isObject(answer)) throw new NodeError("malformed", true, "not an object");
    const errors = answer["errors"];
    if (Array.isArray(errors) && errors.length > 0) {
      throw new GraphqlFault(errors.map((e) => (isObject(e) && typeof e["message"] === "string" ? e["message"] : "error")));
    }
    const data = answer["data"];
    if (!isObject(data)) throw new NodeError("malformed", true, "no data");
    return data;
  }
  const malformed = (what: string) => new NodeError("malformed", true, what);
  const u53 = (v: unknown, what: string): bigint => {
    if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return BigInt(v);
    if (typeof v === "string" && /^[0-9]{1,20}$/.test(v)) return BigInt(v);
    throw malformed(what);
  };

  function changesOf(json: unknown): BalanceChange[] {
    if (!Array.isArray(json)) throw malformed("balanceChangesJson");
    return json.map((c) => {
      if (!isObject(c) || typeof c["address"] !== "string" || typeof c["coinType"] !== "string") throw malformed("balance change");
      const amount = c["amount"];
      if (typeof amount !== "string" || !/^-?[0-9]{1,40}$/.test(amount)) throw malformed("balance change amount");
      return { owner: c["address"].toLowerCase(), coinType: c["coinType"], amount: BigInt(amount) };
    });
  }

  function effectsOf(e: unknown): Effects {
    if (!isObject(e) || (e["status"] !== "SUCCESS" && e["status"] !== "FAILURE")) throw malformed("effects");
    const cp = e["checkpoint"];
    const gas = isObject(e["gasEffects"]) ? e["gasEffects"]["gasSummary"] : undefined;
    if (!isObject(gas)) throw malformed("gasSummary");
    const fee = u53(gas["computationCost"], "computationCost") + u53(gas["storageCost"], "storageCost") - u53(gas["storageRebate"], "storageRebate");
    return {
      status: e["status"],
      checkpoint: isObject(cp) ? u53(cp["sequenceNumber"], "sequenceNumber") : null,
      balanceChanges: changesOf(e["balanceChangesJson"]),
      fee: fee > 0n ? fee : 0n,
    };
  }

  function latestOf(data: Record<string, unknown>): Latest {
    const cp = data["checkpoint"];
    const epoch = isObject(cp) ? cp["epoch"] : undefined;
    if (!isObject(cp) || !isObject(epoch)) throw malformed("checkpoint");
    const price = epoch["referenceGasPrice"];
    return {
      checkpoint: u53(cp["sequenceNumber"], "sequenceNumber"),
      epoch: u53(epoch["epochId"], "epochId"),
      referenceGasPrice: u53(price, "referenceGasPrice"),
    };
  }

  /** A reader answer's transaction, its members renamed and left as the node gave them for lcp to judge. */
  function looseExecuted(t: Record<string, unknown>): Record<string, unknown> {
    const effects = isObject(t["effects"]) ? t["effects"] : {};
    const cp = effects["checkpoint"];
    const json = effects["balanceChangesJson"];
    let bcs: unknown = t["transactionBcs"];
    if (typeof bcs === "string") {
      try {
        bcs = fromBase64(bcs);
      } catch {
        // Left as given: lcp reads it as out of the reader's form.
      }
    }
    return {
      transactionBcs: bcs,
      status: effects["status"],
      checkpoint: isObject(cp) ? looseBig(cp["sequenceNumber"]) : cp === null || cp === undefined ? null : cp,
      balanceChanges: Array.isArray(json)
        ? json.map((c) =>
            isObject(c)
              ? { owner: c["address"], coinType: c["coinType"], amount: typeof c["amount"] === "string" && /^-?[0-9]{1,40}$/.test(c["amount"]) ? BigInt(c["amount"]) : c["amount"] }
              : c,
          )
        : json,
    };
  }

  const node: SuiNode = {
    network,
    async transaction(digest, deadline) {
      const data = await query(
        `query($d: String!) { transaction(digest: $d) { transactionBcs effects { ${EFFECTS} } } ${LATEST} }`,
        { d: digest },
        deadline,
      );
      const t = data["transaction"];
      let executed: Executed | null = null;
      if (isObject(t) && isObject(t["effects"])) {
        if (typeof t["transactionBcs"] !== "string") throw malformed("transactionBcs");
        executed = { bytes: fromBase64(t["transactionBcs"]), effects: effectsOf(t["effects"]) };
      }
      return { executed, latest: latestOf(data) };
    },
    async unavailable(refs, deadline) {
      // A version past 2^53 - 1 is beyond the schema's UInt53: such a reference shows nothing.
      const named = refs.filter((r) => r.version <= BigInt(Number.MAX_SAFE_INTEGER));
      for (const part of objectParts(named)) {
        // One request reads both lists from one view of the index: the version named, and the object's latest.
        const data = await query(OBJECTS_QUERY, objectsBody(part), deadline);
        const at = data["at"], now = data["now"];
        if (!Array.isArray(at) || !Array.isArray(now) || at.length !== part.length || now.length !== part.length) throw malformed("multiGetObjects");
        for (const [k, ref] of part.entries()) {
          const held = at[k], latest = now[k];
          // The version named is not in the index (not yet, never or pruned): nothing shown.
          if (held === null) continue;
          if (!isObject(held) || typeof held["digest"] !== "string") throw malformed("object");
          if (held["digest"] !== ref.digest) return ref;
          if (latest === null) return ref;
          if (!isObject(latest)) throw malformed("object");
          if (u53(latest["version"], "version") > ref.version) return ref;
        }
      }
      return null;
    },
    async simulate(bytes, deadline) {
      const data = await query(
        `query($t: JSON!) { simulateTransaction(transaction: $t, checksEnabled: true) { effects { ${EFFECTS} } } }`,
        { t: { bcs: { value: toBase64(bytes) } } },
        deadline,
      );
      const r = data["simulateTransaction"];
      return effectsOf(isObject(r) ? r["effects"] : undefined);
    },
    async execute(bytes, signatures, deadline) {
      const data = await query(
        `mutation($b: Base64!, $s: [Base64!]!) { executeTransaction(transactionDataBcs: $b, signatures: $s) { effects { ${EFFECTS} } } }`,
        { b: toBase64(bytes), s: signatures },
        deadline,
      );
      const r = data["executeTransaction"];
      return effectsOf(isObject(r) ? r["effects"] : undefined);
    },
    async verifySignature(bytes, signature, author, deadline) {
      try {
        const data = await query(
          `query($m: Base64!, $s: Base64!, $a: SuiAddress!) { verifySignature(message: $m, signature: $s, intentScope: TRANSACTION_DATA, author: $a) { success } }`,
          { m: toBase64(bytes), s: signature, a: author },
          deadline,
        );
        const r = data["verifySignature"];
        return isObject(r) && r["success"] === true;
      } catch (e) {
        // The schema answers an invalid signature with an error naming why: no valid signature.
        if (e instanceof GraphqlFault) return false;
        throw e;
      }
    },
    reader(deadline) {
      return {
        network,
        async read(digest) {
          const data = await query(
            `query($d: String!) { transaction(digest: $d) { transactionBcs effects { status checkpoint { sequenceNumber } balanceChangesJson } }
              checkpoint { epoch { epochId } }
              serviceConfig { availableRange(type: "Query", field: "transaction") { first { sequenceNumber } }
                sender: availableRange(type: "Query", field: "transactions", filters: ["sentAddress"]) { first { sequenceNumber } last { sequenceNumber epoch { epochId } } } } }`,
            { d: digest },
            deadline,
          );
          const t = data["transaction"];
          const cp = data["checkpoint"];
          const config = isObject(data["serviceConfig"]) ? data["serviceConfig"] : {};
          const range = isObject(config["availableRange"]) ? config["availableRange"]["first"] : undefined;
          const sender = isObject(config["sender"]) ? config["sender"] : undefined;
          const first = isObject(sender) && isObject(sender["first"]) ? sender["first"]["sequenceNumber"] : undefined;
          const last = isObject(sender) && isObject(sender["last"]) ? sender["last"] : undefined;
          return {
            tx: isObject(t) ? (looseExecuted(t) as never) : null,
            epoch: looseBig(isObject(cp) && isObject(cp["epoch"]) ? cp["epoch"]["epochId"] : undefined) as never,
            firstCheckpoint: (isObject(range) ? looseBig(range["sequenceNumber"]) : null) as never,
            searchRange:
              first === undefined || last === undefined
                ? null
                : ({ first: looseBig(first), last: looseBig(last["sequenceNumber"]), epoch: looseBig(isObject(last["epoch"]) ? last["epoch"]["epochId"] : undefined) } as never),
          };
        },
        async search(sender, after, before, cursor): Promise<SuiPage> {
          const data = await query(
            `query($s: SuiAddress!, $a: UInt53!, $b: UInt53!, $c: String) {
              transactions(first: 50, after: $c, filter: { sentAddress: $s, afterCheckpoint: $a, beforeCheckpoint: $b }) {
                pageInfo { hasNextPage endCursor }
                nodes { digest transactionBcs effects { status checkpoint { sequenceNumber } balanceChangesJson } } } }`,
            { s: sender, a: Number(after), b: Number(before), c: cursor },
            deadline,
          );
          const c = data["transactions"];
          if (!isObject(c) || !isObject(c["pageInfo"]) || !Array.isArray(c["nodes"])) throw malformed("transactions");
          return {
            transactions: c["nodes"].map((n) => {
              if (!isObject(n)) return n;
              const t = looseExecuted(n);
              return { ...t, digest: n["digest"], checkpoint: t["checkpoint"] };
            }) as never,
            hasNextPage: c["pageInfo"]["hasNextPage"] as never,
            endCursor: c["pageInfo"]["endCursor"] as never,
          };
        },
      };
    },
  };
  return node;
}

/** A whole number as a bigint where it is one, else the value as given. */
function looseBig(v: unknown): unknown {
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return BigInt(v);
  if (typeof v === "string" && /^[0-9]{1,20}$/.test(v)) return BigInt(v);
  return v;
}
