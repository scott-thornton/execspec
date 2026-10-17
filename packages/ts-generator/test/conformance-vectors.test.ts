/**
 * Consumes the language-neutral conformance corpus directly from
 * vectors/conformance.json. The float64, base64, int64, and JSON rules
 * here are the platform primitives (native Number/String, Buffer, the
 * normative regex) - not @execspec/core's implementations.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { strictParseJSON, StrictJSONError } from "../src/runtime/strict-json.js";

interface Corpus {
  readonly jsonParser: { readonly accept: readonly { text: string }[]; readonly reject: readonly string[] };
  readonly int64Spelling: { readonly accept: readonly string[]; readonly reject: readonly string[] };
  readonly float64Spelling: {
    readonly pairs: readonly { of: number | string; spelling: string }[];
    readonly reject: readonly string[];
  };
  readonly bytesBase64: {
    readonly accept: readonly { spelling: string; hex: string }[];
    readonly reject: readonly string[];
  };
  readonly digestVectors: readonly { domain: string; canonical: string; digest: string }[];
}

const corpusPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../vectors/conformance.json",
);
const corpus: Corpus = JSON.parse(readFileSync(corpusPath, "utf8"));

function toNumber(of: number | string): number {
  if (typeof of === "number") return of;
  if (of === "NaN") return Number.NaN;
  if (of === "Infinity") return Number.POSITIVE_INFINITY;
  if (of === "-Infinity") return Number.NEGATIVE_INFINITY;
  return Number(of);
}

test("json parser vectors", () => {
  for (const entry of corpus.jsonParser.accept) {
    assert.doesNotThrow(() => strictParseJSON(entry.text), entry.text);
  }
  for (const text of corpus.jsonParser.reject) {
    assert.throws(() => strictParseJSON(text), StrictJSONError, text);
  }
});

test("int64 spelling vectors", () => {
  const canonical = (spelling: string) =>
    /^-?(0|[1-9][0-9]*)$/.test(spelling) && spelling !== "-0";
  for (const spelling of corpus.int64Spelling.accept) {
    assert.equal(canonical(spelling), true, spelling);
  }
  for (const spelling of corpus.int64Spelling.reject) {
    assert.equal(canonical(spelling), false, spelling);
  }
});

test("float64 spelling vectors (native ECMAScript ToString)", () => {
  for (const pair of corpus.float64Spelling.pairs) {
    const value = toNumber(pair.of);
    assert.equal(String(value), pair.spelling, `of ${String(pair.of)}`);
    const parsed = Number(pair.spelling);
    assert.ok(
      (Number.isNaN(parsed) && pair.spelling === "NaN") || String(parsed) === pair.spelling,
      pair.spelling,
    );
  }
  for (const spelling of corpus.float64Spelling.reject) {
    const parsed = Number(spelling);
    const canonical = (Number.isNaN(parsed) && spelling === "NaN") || String(parsed) === spelling;
    assert.equal(canonical, false, spelling);
  }
});

test("bytes base64 vectors (native Buffer)", () => {
  for (const entry of corpus.bytesBase64.accept) {
    const decoded = Buffer.from(entry.spelling, "base64");
    assert.equal(decoded.toString("hex"), entry.hex, entry.spelling);
    assert.equal(decoded.toString("base64"), entry.spelling, entry.spelling);
  }
  for (const spelling of corpus.bytesBase64.reject) {
    const decoded = Buffer.from(spelling, "base64");
    assert.notEqual(decoded.toString("base64"), spelling, spelling);
  }
});

test("digest vectors (domain-separated sha256)", () => {
  for (const vector of corpus.digestVectors) {
    assert.equal(vector.domain, "execspec-semantic-1");
    const manual = createHash("sha256")
      .update(Buffer.concat([
        Buffer.from(vector.domain, "utf8"),
        Buffer.from([0x00]),
        Buffer.from(vector.canonical, "utf8"),
      ]))
      .digest("hex");
    assert.equal(manual, vector.digest);
  }
});
