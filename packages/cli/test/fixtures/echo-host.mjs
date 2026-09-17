#!/usr/bin/env node
// Fixture protocol host: echoes kv.echo inputs.
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
  process.stdout.write(JSON.stringify({ kind: "response", id: message.id, output: message.input }) + "\n");
});
rl.on("close", () => process.exit(0));
