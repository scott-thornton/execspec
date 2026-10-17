#!/usr/bin/env node
// Always returns a fixed wrong output to guarantee disagreement.
import readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.kind === "hello") {
    process.stdout.write(JSON.stringify({
      kind: "helloAck",
      protocolVersion: 1,
      specificationDigest: message.specificationDigest,
      target: "swift",
    }) + "\n");
    return;
  }
  if (message.kind !== "request") return;
  // Return something completely different from the input
  // For kv.get (unit input → GetResult output), return "found" instead of echoing
  // For kv.echo (EchoRequest → EchoResult), return zeros instead of echoing
  if (message.operation === "kv.get") {
    process.stdout.write(JSON.stringify({
      kind: "response", id: message.id,
      output: { $case: "found", value: "DELIBERATELY_WRONG" },
    }) + "\n");
  } else {
    // kv.echo: return revision=0 instead of echoing
    process.stdout.write(JSON.stringify({
      kind: "response", id: message.id,
      output: { revision: { $i64: "0" } },
    }) + "\n");
  }
});
rl.on("close", () => process.exit(0));
