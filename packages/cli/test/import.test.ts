import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";

import { runCli } from "../src/index.js";
import type { CliIO } from "../src/index.js";
import { importOpenAPI, resetInputTypes, getInputTypeDeclarations } from "../src/openapi-importer.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function bufferedIO(): { io: CliIO; out(): string; err(): string } {
  let out = "";
  let err = "";
  return {
    io: {
      writeOut(t: string) { out += t; },
      writeErr(t: string) { err += t; },
    },
    out: () => out,
    err: () => err,
  };
}

const petstoreSpec = {
  openapi: "3.0.0",
  info: { title: "Test API", version: "1.0.0" },
  paths: {
    "/pets": {
      get: {
        operationId: "listPets",
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: { type: "array", items: { $ref: "#/components/schemas/Pet" } },
              },
            },
          },
        },
      },
      post: {
        operationId: "createPet",
        requestBody: {
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/Pet" } },
          },
        },
        responses: {
          "201": {
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Pet" } },
            },
          },
        },
      },
    },
    "/pets/{petId}": {
      get: {
        operationId: "getPetById",
        parameters: [
          { name: "petId", in: "path", required: true, schema: { type: "integer", format: "int64" } },
        ],
        responses: {
          "200": {
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Pet" } },
            },
          },
        },
      },
      delete: {
        operationId: "deletePet",
        parameters: [
          { name: "petId", in: "path", required: true, schema: { type: "integer", format: "int64" } },
        ],
        responses: { "204": {} },
      },
    },
  },
  components: {
    schemas: {
      Pet: {
        type: "object",
        required: ["name"],
        properties: {
          id: { type: "integer", format: "int64" },
          name: { type: "string" },
          tag: { type: "string" },
        },
      },
      PetStatus: {
        type: "string",
        enum: ["available", "pending", "sold"],
      },
    },
  },
};

test("import: generates types and operations from OpenAPI", async () => {
  const work = await mkdtemp(join(tmpdir(), "execspec-import-"));
  const openapiPath = join(work, "spec.json");
  const outPath = join(work, "spec.ts");
  await writeFile(openapiPath, JSON.stringify(petstoreSpec), "utf8");

  const io = bufferedIO();
  const code = await runCli(["import", "--openapi", openapiPath, "--out", outPath], io.io);
  assert.equal(code, 0, io.err());
  assert.match(io.out(), /imported \d+ types, \d+ operations/);

  const source = await readFile(outPath, "utf8");
  // Types are generated
  assert.match(source, /struct\("Pet"/);
  assert.match(source, /enumeration\("PetStatus"/);
  // Operations use valid execspec ID grammar
  assert.match(source, /operation\("pets\.list-pets"/);
  assert.match(source, /operation\("pets\.create-pet"/);
  assert.match(source, /operation\("pets\.get-pet-by-id"/);
  assert.match(source, /operation\("pets\.delete-pet"/);
  // Required vs optional fields are correct
  assert.match(source, /name: string\(\)/);
  assert.match(source, /id: optional\(int64\(\)\)/);
  // Path parameters become input fields
  assert.match(source, /petId: int64\(\)/);
});

test("import: maps OpenAPI type formats correctly", () => {
  resetInputTypes();
  const result = importOpenAPI(petstoreSpec);
  assert.ok(result.typeCount >= 2);
  assert.ok(result.operationCount >= 4);
  // int64 for integer/int64 format
  assert.match(result.specSource, /int64\(\)/);
  // string for string type
  assert.match(result.specSource, /string\(\)/);
  // optional for non-required properties
  assert.match(result.specSource, /optional\(/);
  // enum becomes enumeration
  assert.match(result.specSource, /enumeration\(/);
});

test("import: warns on unsupported constructs", () => {
  resetInputTypes();
  const specWithUnsupported = {
    ...petstoreSpec,
    components: {
      schemas: {
        ...petstoreSpec.components.schemas,
        FreeForm: {
          type: "object",
          additionalProperties: true,
        },
      },
    },
  };
  const result = importOpenAPI(specWithUnsupported);
  assert.ok(result.warnings.some((w) => w.includes("additionalProperties")));
  assert.ok(result.warnings.some((w) => w.includes("FreeForm")));
});

test("import: handles $ref resolution across schemas", () => {
  resetInputTypes();
  const result = importOpenAPI(petstoreSpec);
  // Pet references should be resolved
  assert.match(result.specSource, /ref\("Pet"\)/);
  // No unresolved ref warnings for valid references
  const refWarnings = result.warnings.filter((w) => w.includes("unresolved"));
  assert.equal(refWarnings.length, 0);
});

test("import: missing flags exit 2", async () => {
  const io = bufferedIO();
  assert.equal(await runCli(["import"], io.io), 2);
  assert.equal(await runCli(["import", "--openapi", "/dev/null"], io.io), 2);
});

test("import: invalid JSON exits 1", async () => {
  const work = await mkdtemp(join(tmpdir(), "execspec-import-"));
  const badPath = join(work, "bad.json");
  await writeFile(badPath, "not json", "utf8");

  const io = bufferedIO();
  assert.equal(await runCli(["import", "--openapi", badPath, "--out", join(work, "out.ts")], io.io), 1);
  assert.match(io.err(), /invalid JSON/);
});
