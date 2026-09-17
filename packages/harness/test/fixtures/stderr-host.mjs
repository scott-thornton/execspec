// Fixture host: chatty stderr that must never corrupt stdout protocol.
import readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.kind === "hello") {
    process.stderr.write("booting fixture\n");
    process.stdout.write(JSON.stringify({
      kind: "helloAck",
      protocolVersion: 1,
      specificationDigest: message.specificationDigest,
      target: "swift",
    }) + "\n");
    process.stderr.write("handshake done\n");
    return;
  }
  process.stderr.write(`handling ${message.operation}\n`);
  process.stdout.write(JSON.stringify({ kind: "response", id: message.id, output: message.input }) + "\n");
});
rl.on("close", () => process.exit(0));
