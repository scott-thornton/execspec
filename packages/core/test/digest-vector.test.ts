
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalJSONStringify,
  specificationDigest,
  structDeclaration,
  int64Type,
  float64Type,
  refType,
  structValue,
  int64Value,
  float64Value,
  serializeSemanticIR,
  SEMANTIC_DIGEST_DOMAIN,
} from "../src/index.js";
import type { SemanticIR } from "../src/index.js";

interface DigestVector {
  readonly domain: string;
  readonly canonical: string;
  readonly digest: string;
}

const corpusPath = join(dirname(fileURLToPath(import.meta.url)), "../../../../vectors/conformance.json");
const corpus = JSON.parse(readFileSync(corpusPath, "utf8")) as { digestVectors: readonly DigestVector[] };

const fixture: SemanticIR = {
  specificationName: "vector",
  specificationVersion: "1.0.0",
  types: [structDeclaration("Pair", [
    { name: "left", type: int64Type(), optional: false },
    { name: "right", type: float64Type(), optional: false },
  ])],
  operations: [
    { id: "vector.echo" as never, input: refType("Pair"), output: refType("Pair") },
  ],
  scenarios: [{
    id: "vector.echo.once" as never,
    description: "echo",
    steps: [{
      kind: "call",
      binding: "echo",
      operationId: "vector.echo" as never,
      input: {
        kind: "literal",
        value: structValue("Pair", new Map<string, import("../src/index.js").SemanticValue>([
          ["left", int64Value(7n)],
          ["right", float64Value(0.5)],
        ])),
      },
    }],
  }],
};

test("digest vectors pin the domain-separated algorithm", () => {
  assert.equal(SEMANTIC_DIGEST_DOMAIN, "execspec-semantic-1");
  for (const vector of corpus.digestVectors) {
    assert.equal(vector.domain, SEMANTIC_DIGEST_DOMAIN);
    assert.equal(serializeSemanticIR(fixture), vector.canonical);
    assert.equal(specificationDigest(fixture), vector.digest);
    const reparsed = canonicalJSONStringify(JSON.parse(vector.canonical) as import("../src/canonical-json.js").JSONValue);
    assert.equal(reparsed, vector.canonical, "canonical bytes are stable under parse/print");
  }
});
