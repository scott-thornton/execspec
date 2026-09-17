import { test } from "node:test";
import assert from "node:assert/strict";

import { coreVersion } from "../src/index.js";

test("core package builds and imports", () => {
  assert.equal(coreVersion, "0.1.0");
});
