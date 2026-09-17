// Fixture host: acknowledges with a different digest (staleness proof).
import readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.kind === "hello") {
    process.stdout.write(JSON.stringify({
      kind: "helloAck",
      protocolVersion: 1,
      specificationDigest: "0".repeat(64),
      target: "swift",
    }) + "\n");
    return;
  }
  process.exit(3);
});
