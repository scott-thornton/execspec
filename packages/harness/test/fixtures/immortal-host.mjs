// Fixture host: ignores stdin close and keeps running (shutdown proof).
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
  }
});
setInterval(() => {
  process.stderr.write("still alive\n");
}, 200);
