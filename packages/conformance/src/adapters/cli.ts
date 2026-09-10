import { spawn } from "node:child_process";
import type { Subject, SubjectRequest, SubjectResponse } from "../subject.js";

/**
 * How long one subject invocation may take before it is killed and the case REFUSED.
 *
 * `spawn` was unbounded, and this adapter's own tests already name the failure it guards: a promise that
 * never settles hangs the whole corpus run "with no output — the worst failure mode for a gate that other
 * implementations depend on". Those tests cover the subject that cannot be spawned and the one that
 * answers with garbage; the subject that answers with SILENCE — a foreign implementation blocked on a
 * socket, waiting on stdin it never reads, or simply looping — had no gate at all, and the corpus run
 * waits forever rather than naming which case did it.
 *
 * 30 seconds is far past any deterministic case (the whole 865-case CLI corpus runs in about a minute of
 * process spawns) and short enough that a hung subject is reported rather than discovered. `timeoutMs` on
 * the constructor overrides it for a subject with a slow cold start.
 */
export const CLI_SUBJECT_TIMEOUT_MS = 30_000;

/** Drives any executable that reads a JSON SubjectRequest on stdin and writes a JSON SubjectResponse on stdout. */
export class CliSubject implements Subject {
  // Declared-and-assigned, not `private readonly` constructor parameters: parameter properties are
  // TypeScript-only syntax that cannot be erased, and the workspace compiles under `erasableSyntaxOnly`.
  private readonly cmd: string;
  private readonly args: string[];
  private readonly timeoutMs: number;

  constructor(
    cmd: string,
    args: string[] = [],
    timeoutMs: number = CLI_SUBJECT_TIMEOUT_MS,
  ) {
    this.cmd = cmd;
    this.args = args;
    this.timeoutMs = timeoutMs;
  }
  handle(req: SubjectRequest): Promise<SubjectResponse> {
    return new Promise((resolve, reject) => {
      const p = spawn(this.cmd, this.args, {
        stdio: ["pipe", "pipe", "inherit"],
      });
      let out = "";
      // SIGKILL, not SIGTERM: the subject this exists for is one that is not responding, and a handler it
      // may have installed for the polite signal is exactly the thing that would swallow it. The timer is
      // cleared on every settling path, so a fast subject leaves nothing behind holding the event loop.
      const timer = setTimeout(() => {
        p.kill("SIGKILL");
        reject(
          new Error(
            `subject \`${this.cmd}\` did not answer within ${this.timeoutMs}ms and was killed`,
          ),
        );
      }, this.timeoutMs);
      p.stdout.on("data", (d) => {
        out += d;
      });
      p.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      p.on("close", () => {
        clearTimeout(timer);
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
