#!/usr/bin/env bash
# End-to-end acceptance (plan Task 42) plus negative conformance (43),
# digest staleness (44), and determinism proofs. Exit 0 = accepted.
set -euo pipefail
cd "$(dirname "$0")/.."

CLI="node packages/cli/dist/index.js"

echo "== clean build artifacts =="
rm -rf build

echo "== build TypeScript packages =="
npm run build

echo "== compile specification to IR =="
mkdir -p build
$CLI compile --module examples/kv-spec/dist/spec.js --out build/kv.execspec.json

echo "== generate Swift =="
$CLI generate swift --ir build/kv.execspec.json --out examples/kv-swift/Sources/KVGenerated

echo "== build the Swift host =="
swift build --package-path examples/kv-swift

echo "== conformance: Swift implementation must pass =="
$CLI test --ir build/kv.execspec.json --host examples/kv-swift/.build/debug/KVHost

echo "== conformance: TypeScript implementation must pass the same spec =="
$CLI test --ir build/kv.execspec.json --host examples/kv-ts/host.mjs

echo "== ordering example: one realistic spec, two language targets =="
$CLI compile --module examples/orders-spec/dist/spec.js --out build/orders.execspec.json
$CLI generate swift --ir build/orders.execspec.json --out examples/orders-swift/Sources/OrdersGenerated >/dev/null
$CLI generate typescript --ir build/orders.execspec.json --out examples/orders-ts/src/OrdersGenerated >/dev/null
swift build --package-path examples/orders-swift
$CLI test --ir build/orders.execspec.json --host examples/orders-swift/.build/debug/OrdersHost
$CLI test --ir build/orders.execspec.json --host examples/orders-ts/host.mjs

echo "== menu pricing example: modifier math, zone minimum, domain errors =="
$CLI compile --module examples/menu-spec/dist/spec.js --out build/menu.execspec.json
$CLI generate swift --ir build/menu.execspec.json --out examples/menu-swift/Sources/MenuGenerated >/dev/null
$CLI generate typescript --ir build/menu.execspec.json --out examples/menu-ts/src/MenuGenerated >/dev/null
swift build --package-path examples/menu-swift
$CLI test --ir build/menu.execspec.json --host examples/menu-swift/.build/debug/MenuHost
$CLI test --ir build/menu.execspec.json --host examples/menu-ts/host.mjs

echo "== determinism: second compile is byte-identical =="
$CLI compile --module examples/kv-spec/dist/spec.js --out build/kv.execspec.json.2
cmp build/kv.execspec.json build/kv.execspec.json.2

echo "== determinism: second generation is byte-identical =="
$CLI generate swift --ir build/kv.execspec.json --out build/gen2 >/dev/null
diff -r build/gen2 examples/kv-swift/Sources/KVGenerated
$CLI generate typescript --ir build/kv.execspec.json --out build/gen-ts >/dev/null
diff -r build/gen-ts examples/kv-ts/src/KVGenerated

echo "== negative conformance: broken implementation must fail =="
if $CLI test --ir build/kv.execspec.json --host examples/kv-swift/.build/debug/KVBrokenHost > build/broken.out 2>&1; then
  echo "ACCEPTANCE FAILURE: broken implementation passed" >&2
  exit 1
fi
grep -q 'expected: "second"' build/broken.out
grep -q 'actual:   "first"' build/broken.out

echo "== staleness: spec B against host A fails the digest handshake =="
cat > build/spec-b.mjs <<'MODULE'
// Specification B: A plus one semantically meaningful scenario.
import graph from "../examples/kv-spec/dist/spec.js";
export default {
  ...graph,
  scenarios: [
    ...graph.scenarios,
    {
      id: "kv.extra.probe",
      description: "added for the digest staleness proof",
      steps: [
        {
          kind: "call",
          binding: "get",
          operationId: "kv.get",
          input: {
            kind: "literal",
            value: {
              kind: "struct",
              typeId: "GetRequest",
              fields: new Map([["key", { kind: "string", value: "probe" }]]),
            },
          },
        },
      ],
    },
  ],
};
MODULE
$CLI compile --module build/spec-b.mjs --out build/kv-b.execspec.json
if $CLI test --ir build/kv-b.execspec.json --host examples/kv-swift/.build/debug/KVHost > build/stale.out 2>&1; then
  echo "ACCEPTANCE FAILURE: stale host passed" >&2
  exit 1
fi
grep -q "digest mismatch" build/stale.out
if grep -q "^step " build/stale.out; then
  echo "ACCEPTANCE FAILURE: operations were dispatched past the handshake" >&2
  exit 1
fi

echo "== process isolation: covered by kv.isolation-seed + kv.scenario-isolation in the suite =="

echo "ACCEPTANCE OK"
