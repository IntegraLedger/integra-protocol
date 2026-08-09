import { spawn } from "node:child_process";
import type { Subject, SubjectRequest, SubjectResponse } from "../subject.js";

/** Drives any executable that reads a JSON SubjectRequest on stdin and writes a JSON SubjectResponse on stdout. */
export class CliSubject implements Subject {
  // Declared-and-assigned, not `private readonly` constructor parameters: parameter properties are
  // TypeScript-only syntax that cannot be erased, and the workspace compiles under `erasableSyntaxOnly`.
  private readonly cmd: string;
  private readonly args: string[];

  constructor(cmd: string, args: string[] = []) {
    this.cmd = cmd;
    this.args = args;
  }
  handle(req: SubjectRequest): Promise<SubjectResponse> {
    return new Promise((resolve, reject) => {
      const p = spawn(this.cmd, this.args, {
        stdio: ["pipe", "pipe", "inherit"],
      });
      let out = "";
      p.stdout.on("data", (d) => {
        out += d;
      });
      p.on("error", reject);
      p.on("close", () => {
        try {
          resolve(JSON.parse(out) as SubjectResponse);
        } catch (e) {
          reject(e);
        }
      });
      p.stdin.write(`${JSON.stringify(req)}\n`);
      p.stdin.end();
    });
  }
}
