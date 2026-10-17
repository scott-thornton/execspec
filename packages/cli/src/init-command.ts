/**
 * `execspec init`: scaffold a self-contained specification package so a
 * new contract starts at `npm install && npm test` green.
 */

import { mkdir, writeFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { CliIO } from "./index.js";

const COMPILER_OPTIONS = `    "target": "ES2024",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "useUnknownInCatchVariables": true,
    "verbatimModuleSyntax": true,
    "declaration": true,
    "sourceMap": true,
    "types": ["node"]`;

const TSCONFIG_MAIN = `{
  "compilerOptions": {
${COMPILER_OPTIONS}
  },
  "compilerOptionsPlaceholder": null
}
`;

export const TSCONFIG_MAIN_TEMPLATE = `{
  "compilerOptions": {
${COMPILER_OPTIONS}
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*.ts"]
}
`;

export const TSCONFIG_TEST_TEMPLATE = `{
  "compilerOptions": {
${COMPILER_OPTIONS}
    "rootDir": ".",
    "outDir": "dist-test",
    "declaration": false,
    "sourceMap": false
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
`;

export function scaffoldPackageJson(name: string): string {
  return JSON.stringify(
    {
      name,
      version: "0.1.0",
      private: true,
      type: "module",
      scripts: {
        build: "tsc -p tsconfig.json",
        typecheck: "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.test.json --noEmit",
        test: "npm run build && tsc -p tsconfig.test.json && node --test 'dist-test/test/*.test.js'",
      },
      dependencies: {
        "@execspec/dsl": "^0.3.0",
        "@execspec/compiler": "^0.3.0",
      },
      devDependencies: {
        typescript: "^7.0.2",
        "@types/node": "^22.20.3",
      },
    },
    null,
    2,
  ) + "\n";
}

export const SPEC_TEMPLATE = `import {
  specification, string, unit, operation, scenario, literal, binding,
} from "@execspec/dsl";

const spec = specification({ name: "demo", version: "0.1.0" });

spec.operation(operation("demo.echo", { input: string(), output: string() }));

spec.scenario(
  scenario("demo.echo.roundtrip", "an echoed string survives")
    .call("echo", "demo.echo", literal("hello"))
    .expectEqual(binding("echo"), literal("hello"))
    .build(),
);

export default spec.build();
`;

export const TEST_TEMPLATE = `import { test } from "node:test";
import assert from "node:assert/strict";

import graph from "../src/spec.js";
import { compileSpecification } from "@execspec/compiler";

test("the specification compiles", () => {
  const result = compileSpecification(graph);
  if (!result.ok) {
    assert.fail(result.diagnostics.map((d) => d.message).join("\\n"));
  }
  assert.match(result.digest, /^[0-9a-f]{64}$/);
});
`;

export const README_TEMPLATE = `# specification

An executable specification authored with [execspec](https://github.com/scott-thornton/execspec).

## Work on the contract

\`\`\`bash
npm install
npm test
\`\`\`

## Compile and generate implementation targets

\`\`\`bash
npm run build
npx execspec compile --module ./dist/spec.js --out ./build/demo.execspec.json
npx execspec generate typescript --ir ./build/demo.execspec.json --out ./targets/ts/KVGenerated
npx execspec generate swift --ir ./build/demo.execspec.json --out ./targets/swift/Sources/Generated
\`\`\`

Implement the generated contract and verify any host:

\`\`\`bash
npx execspec test --ir ./build/demo.execspec.json --host <path-to-host>
\`\`\`

See the execspec getting-started guide for the full walkthrough.
`;

export async function initCommand(args: readonly string[], io: CliIO): Promise<number> {
  const nameIndex = args.indexOf("--name");
  const outIndex = args.indexOf("--out");
  const name = nameIndex >= 0 ? args[nameIndex + 1] : undefined;
  const outDirRaw = outIndex >= 0 ? args[outIndex + 1] : undefined;
  if (name === undefined || outDirRaw === undefined) {
    io.writeErr("init: missing required flags: --name <package-name> --out <directory>\n");
    return 2;
  }
  if (!/^(?:@[a-z0-9-]+\/)?[a-z0-9-]+$/.test(name)) {
    io.writeErr(`init: invalid package name ${JSON.stringify(name)}\n`);
    return 2;
  }
  const outDir = resolve(outDirRaw);
  try {
    await mkdir(resolve(outDir, "src"), { recursive: true });
    await mkdir(resolve(outDir, "test"), { recursive: true });
    const existing = await readdir(outDir);
    if (existing.length > 2) {
      io.writeErr(`init: ${outDirRaw} is not empty\n`);
      return 1;
    }
  } catch (error) {
    io.writeErr(`init: cannot create ${outDirRaw}: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }

  const files = new Map<string, string>([
    ["package.json", scaffoldPackageJson(name)],
    ["tsconfig.json", TSCONFIG_MAIN_TEMPLATE],
    ["tsconfig.test.json", TSCONFIG_TEST_TEMPLATE],
    ["README.md", README_TEMPLATE],
    ["src/spec.ts", SPEC_TEMPLATE],
    ["test/spec.test.ts", TEST_TEMPLATE],
  ]);
  for (const [path, contents] of files) {
    await writeFile(resolve(outDir, path), contents, "utf8");
  }
  io.writeOut(`scaffolded ${outDirRaw}\nnext: cd ${outDirRaw} && npm install && npm test\n`);
  return 0;
}
