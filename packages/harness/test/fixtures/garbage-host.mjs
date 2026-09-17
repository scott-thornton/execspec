// Fixture host: handshakes, then writes a non-JSON line.
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
  process.stdout.write("this is not json\n");
});
rl.on("close", () => process.exit(0));
