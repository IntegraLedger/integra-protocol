// x402-request-commitment.json: the request an x402 challenge commits to, over HTTP (requestCommitment), with the header
// fields a resource server names, and over MCP (toolCallCommitment), and tie's slot holding either. Every expected value
// is the file's.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import canonicalize from "canonicalize";
import { describe, expect, it } from "vitest";
import * as root from "../src/index.js";
import { requestCommitment, tie, toolCallCommitment, type HeaderFields, type ToolCall } from "../src/x402.js";
import { rowsOf } from "./rows.js";

const V = JSON.parse(readFileSync(new URL("../vectors/x402-request-commitment.json", import.meta.url), "utf8"));

describe("x402-request-commitment.json", () => {
  for (const row of rowsOf(V.http, "x402-request-commitment.json http", { exact: 4 })) {
    it(`HTTP: ${row.case}`, async () => {
      const { method, target, bodyUtf8 } = row.request;
      expect(await requestCommitment({ method, target, body: new TextEncoder().encode(bodyUtf8) })).toEqual(row.expect);
    });
  }
  for (const row of rowsOf(V.httpRefusals, "x402-request-commitment.json httpRefusals", { exact: 15 })) {
    it(`HTTP refuses ${row.case}`, async () => {
      let request = row.request;
      if (typeof request === "object" && request !== null) {
        const { bodyUtf8, ...rest } = request;
        request = bodyUtf8 === undefined ? rest : { ...rest, body: new TextEncoder().encode(bodyUtf8) };
        if (row.fill?.member === "target") request.target = "/" + row.fill.char.repeat(row.fill.length - 1);
        if (row.fill?.member === "body") request.body = new TextEncoder().encode(row.fill.char.repeat(row.fill.length));
      }
      expect(await requestCommitment(request)).toEqual(row.expect);
    });
  }
  for (const row of rowsOf(V.httpHeaders, "x402-request-commitment.json httpHeaders", { exact: 10 })) {
    it(`HTTP header fields: ${row.case}`, async () => {
      const { method, target, bodyUtf8, headers } = row.request;
      const c = await requestCommitment({ method, target, body: new TextEncoder().encode(bodyUtf8), headers }, row.fields);
      expect(c).toEqual(row.expect);
      expect("headers" in (c as object)).toBe(row.fields.length > 0);
      expect(tie([], row.expect)).toEqual(["x402", { accepts: [], request: row.expect }]);
    });
  }
  for (const row of rowsOf(V.httpHeaderRefusals, "x402-request-commitment.json httpHeaderRefusals", { exact: 14 })) {
    it(`HTTP header fields: refuses ${row.case}`, async () => {
      const { method, target, bodyUtf8 } = row.request;
      let headers = row.request.headers as HeaderFields;
      if (row.fill !== undefined) {
        const line = row.fill.char.repeat(row.fill.length);
        headers = { [row.fill.name]: Array.from({ length: row.fill.lines ?? 1 }, () => line) };
      }
      expect(await requestCommitment({ method, target, body: new TextEncoder().encode(bodyUtf8), headers }, row.fields)).toEqual(row.expect);
    });
  }
  it("the bound on what a commitment reads is exported once, and the refusal rows sit one byte past it", () => {
    expect((root as Record<string, unknown>)[V.bound.name]).toBe(V.bound.bytes);
    const fills = V.httpHeaderRefusals.filter((r: { fill?: unknown }) => r.fill !== undefined);
    const joined = (r: { fill: { length: number; lines?: number } }): number => {
      const lines = r.fill.lines ?? 1;
      return r.fill.length * lines + 2 * (lines - 1);
    };
    for (const r of fills) expect(joined(r)).toBeGreaterThan(V.bound.bytes);
    expect(fills.some((r: { fill: { length: number; lines?: number } }) => joined(r) === V.bound.bytes + 1)).toBe(true);
  });
  it("HTTP header fields: a value of exactly 1 MiB, its lines joined, is read", async () => {
    const line = "a".repeat(524_287);
    const c = await requestCommitment({ method: "GET", target: "/", body: new Uint8Array(), headers: { "x-tier": [line, line] } }, ["x-tier"]);
    expect(c).toMatchObject({ headers: [{ name: "x-tier" }] });
  });
  for (const row of rowsOf(V.mcp, "x402-request-commitment.json mcp", { exact: 7 })) {
    it(`MCP: ${row.case}`, async () => {
      const c = await toolCallCommitment(row.call as ToolCall);
      expect(c).toEqual(row.expect);
      expect(tie([], row.expect)).toEqual(["x402", { accepts: [], request: row.expect }]);
    });
  }
  it("MCP: each row's digest is SHA-256 over canonicalize 5.1.0's RFC 8785 form of its arguments, absent read as {}", () => {
    for (const row of rowsOf(V.mcp, "x402-request-commitment.json mcp", { exact: 7 })) {
      const text = canonicalize(row.call.arguments ?? {}) as string;
      expect(`0x${createHash("sha256").update(text, "utf8").digest("hex")}`).toBe(row.expect.argumentsDigest);
    }
  });
  for (const row of rowsOf(V.mcpRefusals, "x402-request-commitment.json mcpRefusals", { exact: 8 })) {
    it(`MCP refuses ${row.case}`, async () => {
      const call = row.fill === undefined ? row.call : { ...row.call, arguments: { a: row.fill.repeat(row.fillLength) } };
      expect(await toolCallCommitment(call as ToolCall)).toEqual(row.expect);
    });
  }
});
