// x402-request-commitment.json: the request an x402 challenge commits to, over HTTP (requestCommitment) and over MCP
// (toolCallCommitment), and tie's slot holding either. Every expected value is the file's.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { requestCommitment, tie, toolCallCommitment, type ToolCall } from "../src/x402.js";
import { rowsOf } from "./rows.js";

const V = JSON.parse(readFileSync(new URL("../vectors/x402-request-commitment.json", import.meta.url), "utf8"));

describe("x402-request-commitment.json", () => {
  for (const row of rowsOf(V.http, "x402-request-commitment.json http", { exact: 3 })) {
    it(`HTTP: ${row.case}`, async () => {
      const { method, target, bodyUtf8 } = row.request;
      expect(await requestCommitment({ method, target, body: new TextEncoder().encode(bodyUtf8) })).toEqual(row.expect);
    });
  }
  for (const row of rowsOf(V.mcp, "x402-request-commitment.json mcp", { exact: 6 })) {
    it(`MCP: ${row.case}`, async () => {
      const c = await toolCallCommitment(row.call as ToolCall);
      expect(c).toEqual(row.expect);
      expect(tie([], row.expect)).toEqual(["x402", { accepts: [], request: row.expect }]);
    });
  }
  for (const row of rowsOf(V.mcpRefusals, "x402-request-commitment.json mcpRefusals", { exact: 7 })) {
    it(`MCP refuses ${row.case}`, async () => {
      const call = row.fill === undefined ? row.call : { ...row.call, arguments: { a: row.fill.repeat(row.fillLength) } };
      expect(await toolCallCommitment(call as ToolCall)).toEqual(row.expect);
    });
  }
});
