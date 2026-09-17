import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const docsRoot = resolve(process.cwd(), "../../docs");

interface DocExpectation {
  readonly file: string;
  readonly versionHeader: string;
}

const expectations: readonly DocExpectation[] = [
  { file: "specification.md", versionHeader: "normative for execspec v0.1" },
  { file: "semantic-model.md", versionHeader: "normative for execspec v0.1" },
  { file: "ir-v1.md", versionHeader: "IR Version: 1" },
  { file: "protocol-v1.md", versionHeader: "Protocol Version: 1" },
  { file: "autonomous-loop.md", versionHeader: "normative for agent behavior" },
];

test("all normative documentation files exist with declared version headers", () => {
  for (const expectation of expectations) {
    const path = resolve(docsRoot, expectation.file);
    assert.equal(existsSync(path), true, `${expectation.file} must exist`);
    const contents = readFileSync(path, "utf8");
    assert.ok(contents.length > 0, `${expectation.file} must not be empty`);
    assert.ok(
      contents.includes(expectation.versionHeader),
      `${expectation.file} must contain "${expectation.versionHeader}"`,
    );
  }
});
