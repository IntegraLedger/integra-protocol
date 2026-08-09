import { createInterface } from "node:readline";
import { InProcessSubject } from "../../dist/adapters/inprocess.js";

const subject = new InProcessSubject();
for await (const line of createInterface({ input: process.stdin })) {
  process.stdout.write(`${JSON.stringify(await subject.handle(JSON.parse(line)))}\n`);
}
