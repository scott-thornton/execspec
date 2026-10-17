#!/usr/bin/env node
// Returns incorrect values to test disagreement detection.
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
  // Always return a corrupted version of the input
  if (typeof message.input === "object" && message.input !== null) {
    const corrupted = { ...message.input };
    for (const key of Object.keys(corrupted)) {
      if (typeof corrupted[key] === "string") {
        corrupted[key] = corrupted[key] + "_WRONG";
      } else if (typeof corrupted[key] === "number") {
        corrupted[key] = corrupted[key] + 1;
      }
    }
    process.stdout.write(JSON.stringify({ kind: "response", id: message.id, output: corrupted }) + "\n");
  } else {
    process.stdout.write(JSON.stringify({ kind: "response", id: message.id, output: message.input }) + "\n");
  }
});
rl.on("close", () => process.exit(0));
