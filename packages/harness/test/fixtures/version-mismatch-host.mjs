#!/usr/bin/env node
// Fixture host: acknowledges with the wrong protocol version.
import readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.kind === "hello") {
    process.stdout.write(JSON.stringify({
      kind: "helloAck",
      protocolVersion: 2,
      specificationDigest: message.specificationDigest,
      target: "swift",
    }) + "\n");
    return;
  }
  process.exit(4);
});
