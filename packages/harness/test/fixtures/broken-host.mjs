// Fixture host: correct protocol but kv.get always returns "first",
// breaking the overwrite expectation.
import readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin });
const write = (message) => process.stdout.write(JSON.stringify(message) + "\n");

rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.kind === "hello") {
    write({
      kind: "helloAck",
      protocolVersion: 1,
      specificationDigest: message.specificationDigest,
      target: "swift",
    });
    return;
  }
  if (message.kind !== "request") {
    return;
  }
  if (message.operation === "kv.put") {
    write({ kind: "response", id: message.id, output: {} });
  } else if (message.operation === "kv.get") {
    write({ kind: "response", id: message.id, output: { $case: "found", value: "first" } });
  } else {
    write({ kind: "failure", id: message.id, category: "invalidRequest", message: "unknown op" });
  }
});
rl.on("close", () => process.exit(0));
