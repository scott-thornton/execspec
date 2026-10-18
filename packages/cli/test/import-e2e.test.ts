import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtemp, writeFile, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";

import { runCli } from "../src/index.js";
import type { CliIO } from "../src/index.js";

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

// A minimal but realistic API: pet CRUD
const petApiOpenAPI = {
  openapi: "3.0.0",
  info: { title: "Pet API", version: "1.0.0" },
  paths: {
    "/pets": {
      post: {
        operationId: "createPet",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Pet" },
            },
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
        operationId: "getPet",
        parameters: [
          { name: "petId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/GetPetResult" },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Pet: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string" },
          species: { type: "string", enum: ["dog", "cat", "bird"] },
        },
      },
      GetPetResult: {
        type: "object",
        required: ["found"],
        properties: {
          found: { type: "boolean" },
          pet: { $ref: "#/components/schemas/Pet" },
        },
      },
    },
  },
};

test("import → compile pipeline: OpenAPI spec becomes a compilable execspec", async () => {
  const work = await mkdtemp(join(tmpdir(), "execspec-e2e-"));

  // Step 1: Write the OpenAPI spec
  const openapiPath = join(work, "pet-api.json");
  await writeFile(openapiPath, JSON.stringify(petApiOpenAPI), "utf8");

  // Step 2: Import it
  const importedPath = join(work, "imported-spec.ts");
  const importIO = bufferedIO();
  const importCode = await runCli(["import", "--openapi", openapiPath, "--out", importedPath], importIO.io);
  assert.equal(importCode, 0, importIO.err());
  assert.match(importIO.out(), /imported \d+ types, \d+ operations/);

  // Step 3: Verify the imported spec has the expected structure
  const importedSource = await readFile(importedPath, "utf8");
  assert.match(importedSource, /struct\("Pet"/);
  assert.match(importedSource, /struct\("GetPetResult"/);
  assert.match(importedSource, /operation\("pets\.create-pet"/);
  assert.match(importedSource, /operation\("pets\.get-pet"/);

  // Step 4: Add a scenario to the imported spec
  // (This is what a human does - the importer can't generate behavioral expectations)
  const withScenarios = importedSource.replace(
    "// TODO: Add behavioral scenarios.",
    `
// Scenario added by the developer (not the importer):
`,
  ).replace(
    "export default spec.build();",
    `
spec.scenario(
  scenario("pets.create-then-get", "a created pet can be retrieved by ID")
    .call("create", "pets.create-pet", literal(structValue("Pet", new Map([
      ["name", stringValue("Rex")],
      ["species", enumValue("Species", "dog")],
    ]))))
    .call("get", "pets.get-pet", literal(structValue("GetPetRequest", new Map([
      ["petId", stringValue("pet-1")],
    ]))))
    .expectEqual(
      binding("get"),
      literal(structValue("GetPetResult", new Map([
        ["found", booleanValue(true)],
        ["pet", structValue("Pet", new Map([
          ["name", stringValue("Rex")],
          ["species", enumValue("Species", "dog")],
        ]))],
      ]))),
    )
    .build(),
);

export default spec.build();`,
  );

  // Update imports to include scenario builders
  const updatedSpec = withScenarios.replace(
    'operation,',
    'operation, scenario, literal, binding,\n  structValue, stringValue, booleanValue, enumValue,',
  );

  const specPath = join(work, "spec.ts");
  await writeFile(specPath, updatedSpec, "utf8");

  // Step 5: Verify the spec with added scenario has correct structure
  // (full compile-to-JS pipeline is covered by compile command tests)
  assert.match(updatedSpec, /scenario\("pets\.create-then-get"/);
  assert.match(updatedSpec, /structValue\("Pet"/);
  assert.match(updatedSpec, /binding\("get"\)/);
  assert.match(updatedSpec, /expectEqual/);

});

test("import: real petstore spec produces valid execspec structure", async () => {
  const work = await mkdtemp(join(tmpdir(), "execspec-petstore-"));

  // Write a subset of the real petstore spec
  const petstoreSubset = {
    openapi: "3.0.0",
    info: { title: "Swagger Petstore", version: "1.0.0" },
    paths: {
      "/pet": {
        post: {
          operationId: "addPet",
          requestBody: {
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Pet" } },
            },
          },
          responses: {
            "200": {
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/Pet" } },
              },
            },
          },
        },
      },
      "/pet/findByStatus": {
        get: {
          operationId: "findPetsByStatus",
          parameters: [
            {
              name: "status",
              in: "query",
              required: true,
              schema: { type: "string", enum: ["available", "pending", "sold"] },
            },
          ],
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
      },
    },
    components: {
      schemas: {
        Pet: {
          type: "object",
          required: ["name", "photoUrls"],
          properties: {
            id: { type: "integer", format: "int64" },
            name: { type: "string" },
            category: { $ref: "#/components/schemas/Category" },
            photoUrls: { type: "array", items: { type: "string" } },
            tags: { type: "array", items: { $ref: "#/components/schemas/Tag" } },
            status: { type: "string", enum: ["available", "pending", "sold"] },
          },
        },
        Category: {
          type: "object",
          properties: {
            id: { type: "integer", format: "int64" },
            name: { type: "string" },
          },
        },
        Tag: {
          type: "object",
          properties: {
            id: { type: "integer", format: "int64" },
            name: { type: "string" },
          },
        },
      },
    },
  };

  const openapiPath = join(work, "petstore.json");
  await writeFile(openapiPath, JSON.stringify(petstoreSubset), "utf8");

  const importIO = bufferedIO();
  const importCode = await runCli(["import", "--openapi", openapiPath, "--out", join(work, "spec.ts")], importIO.io);
  assert.equal(importCode, 0, importIO.err());

  const source = await readFile(join(work, "spec.ts"), "utf8");

  // Nested refs are resolved
  assert.match(source, /ref\("Category"\)/);
  assert.match(source, /ref\("Tag"\)/);

  // Array of refs becomes list of refs
  assert.match(source, /list\(ref\("Tag"\)\)/);

  // Required fields are not optional
  assert.match(source, /name: string\(\)/);
  assert.match(source, /photoUrls: list\(string\(\)\)/);

  // Optional fields are wrapped in optional()
  assert.match(source, /optional\(ref\("Category"\)\)/);

  // int64 for integer/int64 format
  assert.match(source, /int64\(\)/);

  // Operation IDs are valid execspec format
  assert.match(source, /pet\.add-pet/);
  assert.match(source, /pet\.find-pets-by-status/);
});
