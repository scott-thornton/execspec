#!/usr/bin/env node
// Fixture host: structurally invalid semantic output.
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
  if (message.operation === "kv.put") {
    process.stdout.write(JSON.stringify({ kind: "response", id: message.id, output: {} }) + "\n");
  } else {
    process.stdout.write(JSON.stringify({
      kind: "response",
      id: message.id,
      output: { $case: "nonexistent", value: 1 },
    }) + "\n");
  }
});
rl.on("close", () => process.exit(0));
