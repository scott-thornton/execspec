// Fixture host: handshakes, then exits nonzero on the first request.
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
  process.stderr.write("simulated crash\n");
  process.exit(1);
});
