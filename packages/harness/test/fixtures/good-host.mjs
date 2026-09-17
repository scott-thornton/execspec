// Fixture host: correct protocol v1 handshake plus a tiny in-memory KV.
import readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin });
const store = new Map();
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
  try {
    if (message.operation === "kv.put") {
      store.set(message.input.key, message.input.value);
      write({ kind: "response", id: message.id, output: {} });
    } else if (message.operation === "kv.get") {
      const value = store.get(message.input.key);
      write({
        kind: "response",
        id: message.id,
        output: value === undefined ? { $case: "missing" } : { $case: "found", value },
      });
    } else if (message.operation === "kv.echo") {
      write({ kind: "response", id: message.id, output: message.input });
    } else {
      write({ kind: "failure", id: message.id, category: "invalidRequest", message: `unknown op ${message.operation}` });
    }
  } catch (error) {
    write({ kind: "failure", id: message.id, category: "implementationException", message: String(error) });
  }
});
rl.on("close", () => process.exit(0));
