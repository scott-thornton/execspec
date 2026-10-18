/**
 * OpenAPI → execspec importer. Maps OpenAPI 3.x schemas to execspec
 * types and operations, generating a compilable TypeScript spec module
 * with scenarios empty (the user adds behavioral scenarios).
 */

interface OpenAPISchema {
  readonly type?: string;
  readonly format?: string;
  readonly properties?: Record<string, OpenAPISchema>;
  readonly required?: readonly string[];
  readonly items?: OpenAPISchema;
  readonly $ref?: string;
  readonly enum?: readonly string[];
  readonly oneOf?: readonly OpenAPISchema[];
  readonly anyOf?: readonly OpenAPISchema[];
  readonly nullable?: boolean;
  readonly additionalProperties?: boolean | OpenAPISchema;
}

interface OpenAPIParameter {
  readonly name: string;
  readonly in: string;
  readonly required?: boolean;
  readonly schema?: OpenAPISchema;
}

interface OpenAPIOperation {
  readonly operationId?: string;
  readonly summary?: string;
  readonly parameters?: readonly OpenAPIParameter[];
  readonly requestBody?: {
    readonly content?: Record<string, { readonly schema?: OpenAPISchema }>;
  };
  readonly responses?: Record<string, {
    readonly content?: Record<string, { readonly schema?: OpenAPISchema }>;
  }>;
}

interface OpenAPISpec {
  readonly openapi?: string;
  readonly info?: { readonly title?: string; readonly version?: string };
  readonly paths?: Record<string, Record<string, OpenAPIOperation | unknown>>;
  readonly components?: {
    readonly schemas?: Record<string, OpenAPISchema>;
  };
}

export interface ImportResult {
  readonly specSource: string;
  readonly warnings: readonly string[];
  readonly typeCount: number;
  readonly operationCount: number;
}

export function importOpenAPI(input: unknown): ImportResult {
  const spec = input as OpenAPISpec;
  const warnings: string[] = [];
  const schemas = spec.components?.schemas ?? {};
  const types: string[] = [];
  const operations: string[] = [];
  const nameToTypeId = new Map<string, string>();

  // Sanitize schema names to PascalCase TypeId grammar
  for (const [name, schema] of Object.entries(schemas)) {
    const typeId = toPascalCase(name);
    nameToTypeId.set(name, typeId);
  }

  // Map schemas to type declarations
  for (const [name, schema] of Object.entries(schemas)) {
    const typeId = nameToTypeId.get(name) ?? toPascalCase(name);
    const source = mapSchemaToType(typeId, name, schema, nameToTypeId, warnings);
    if (source !== undefined) {
      types.push(source);
    }
  }

  // Map paths to operations
  const paths = spec.paths ?? {};
  for (const [path, pathItem] of Object.entries(paths)) {
    if (typeof pathItem !== "object" || pathItem === null) continue;
    for (const method of ["get", "post", "put", "delete", "patch"] as const) {
      const op = (pathItem as Record<string, unknown>)[method] as OpenAPIOperation | undefined;
      if (op === undefined) continue;
      const source = mapOperation(path, method, op, nameToTypeId, warnings);
      if (source !== undefined) {
        operations.push(source);
      }
    }
  }

  // Generate the TypeScript spec module
  const specName = toCamelCase(spec.info?.title ?? "imported");
  const specVersion = spec.info?.version ?? "1.0.0";
  const lines: string[] = [];
  lines.push(`import {`);
  lines.push(`  specification, struct, union, enumeration, string, int64, float64, boolean, unit, list, optional, ref,`);
  lines.push(`  operation,`);
  lines.push(`} from "@execspec/dsl";`);
  lines.push(``);
  lines.push(`const spec = specification({ name: "${specName}", version: "${specVersion}" });`);
  lines.push(``);
  lines.push(`// --- Types (imported from OpenAPI schemas) ---`);
  lines.push(``);
  for (const type of types) {
    lines.push(type);
    lines.push(``);
  }
  lines.push(`// --- Operations (imported from OpenAPI paths) ---`);
  lines.push(``);
  for (const op of operations) {
    lines.push(op);
    lines.push(``);
  }
  lines.push(`// TODO: Add behavioral scenarios. The types and operations above are`);
  lines.push(`// structural only; scenarios are what make the specification executable.`);
  lines.push(``);
  lines.push(`export default spec.build();`);

  return {
    specSource: lines.join("\n"),
    warnings,
    typeCount: types.length,
    operationCount: operations.length,
  };
}

// --- Schema mapping ---

function mapSchemaType(
  schema: OpenAPISchema,
  nameToTypeId: Map<string, string>,
  warnings: string[],
  fieldName: string,
): string | undefined {
  // $ref
  if (schema.$ref !== undefined) {
    const refName = schema.$ref.split("/").pop() ?? "";
    const typeId = nameToTypeId.get(refName);
    if (typeId === undefined) {
      warnings.push(`unresolved $ref: ${schema.$ref} (field ${fieldName})`);
      return undefined;
    }
    return `ref("${typeId}")`;
  }

  // enum
  if (schema.enum !== undefined && schema.enum.length > 0) {
    // Enums inline in fields are promoted to named types via oneOf/anyOf handling
    // or handled at the schema level. For field-level, we can't create types here.
    warnings.push(`inline enum in field ${fieldName}: [${schema.enum.join(", ")}] - not supported, using string`);
    return `string()`;
  }

  switch (schema.type) {
    case "string":
      return `string()`;
    case "integer":
      return `int64()`;
    case "number":
      return `float64()`;
    case "boolean":
      return `boolean()`;
    case "array": {
      if (schema.items === undefined) {
        warnings.push(`array without items in field ${fieldName}`);
        return undefined;
      }
      const element = mapSchemaType(schema.items, nameToTypeId, warnings, fieldName);
      return element === undefined ? undefined : `list(${element})`;
    }
    case "object": {
      if (schema.additionalProperties !== undefined) {
        warnings.push(`free-form object (additionalProperties) in field ${fieldName} - not supported`);
        return undefined;
      }
      warnings.push(`inline object in field ${fieldName} - not supported (must be a named schema)`);
      return undefined;
    }
    default:
      if (schema.oneOf !== undefined || schema.anyOf !== undefined) {
        warnings.push(`inline oneOf/anyOf in field ${fieldName} - not supported (must be a named schema)`);
        return undefined;
      }
      warnings.push(`unknown type in field ${fieldName}: ${schema.type ?? "no type"}`);
      return undefined;
  }
}

function mapSchemaToType(
  typeId: string,
  originalName: string,
  schema: OpenAPISchema,
  nameToTypeId: Map<string, string>,
  warnings: string[],
): string | undefined {
  // Enum
  if (schema.enum !== undefined && schema.enum.length > 0) {
    const cases = schema.enum.map((c) => `"${c}"`).join(", ");
    return `spec.type(enumeration("${typeId}", [${cases}]));`;
  }

  // OneOf → union
  if (schema.oneOf !== undefined && schema.oneOf.length > 0) {
    const cases: string[] = [];
    let allRefs = true;
    for (let i = 0; i < schema.oneOf.length; i++) {
      const variant = schema.oneOf[i];
      if (variant === undefined) continue;
      if (variant.$ref !== undefined) {
        const refName = variant.$ref.split("/").pop() ?? "";
        const refTypeId = nameToTypeId.get(refName);
        if (refTypeId !== undefined) {
          cases.push(`  v${i + 1}: ref("${refTypeId}")`);
        } else {
          allRefs = false;
        }
      } else {
        allRefs = false;
      }
    }
    if (allRefs && cases.length === schema.oneOf.length) {
      warnings.push(`${originalName}: oneOf with all refs - union cases are named v1, v2, etc. (OpenAPI doesn't name variants)`);
      return `spec.type(union("${typeId}", {\n${cases.join(",\n")}\n}));`;
    }
    warnings.push(`${originalName}: oneOf with non-ref variants - not supported`);
    return undefined;
  }

  // Object with additionalProperties → not supported
  if (schema.type === "object" && schema.properties === undefined && schema.additionalProperties !== undefined) {
    warnings.push(`${originalName}: free-form object (additionalProperties) - not supported`);
    return undefined;
  }

  // Object → struct
  if (schema.type === "object" && schema.properties !== undefined) {
    const required = new Set(schema.required ?? []);
    const fields: string[] = [];
    for (const [propName, propSchema] of Object.entries(schema.properties)) {
      const mapped = mapSchemaType(propSchema, nameToTypeId, warnings, propName);
      if (mapped === undefined) {
        // Skip unsupported fields but add a warning
        continue;
      }
      const isOptional = !required.has(propName);
      fields.push(`  ${toCamelCase(propName)}: ${isOptional ? `optional(${mapped})` : mapped}`);
    }
    return `spec.type(struct("${typeId}", {\n${fields.join(",\n")}\n}));`;
  }

  warnings.push(`schema ${originalName}: unsupported type ${schema.type ?? "none"} - skipped`);
  return undefined;
}

// --- Operation mapping ---

function mapOperation(
  path: string,
  method: string,
  op: OpenAPIOperation,
  nameToTypeId: Map<string, string>,
  warnings: string[],
): string | undefined {
  // Derive operation ID
  const opId = op.operationId ?? deriveOperationId(path, method);
  // Convert camelCase to dot-separated: getUserByName → user.get-by-name
  const execspecOpId = camelToDotted(opId, path);
  if (execspecOpId === undefined) {
    warnings.push(`cannot derive valid operation ID from ${method} ${path} (${opId})`);
    return undefined;
  }

  // Build input type
  const inputFields: string[] = [];

  // Path parameters
  const params = op.parameters ?? [];
  for (const param of params) {
    if (param.in === "path" || param.in === "query") {
      const schema = param.schema;
      if (schema !== undefined) {
        const mapped = mapSchemaType(schema, nameToTypeId, warnings, param.name);
        if (mapped !== undefined) {
          const isOptional = param.in === "query" && param.required !== true;
          inputFields.push(`  ${toCamelCase(param.name)}: ${isOptional ? `optional(${mapped})` : mapped}`);
        }
      }
    }
  }

  // Request body
  const bodyContent = op.requestBody?.content?.["application/json"];
  if (bodyContent?.schema !== undefined) {
    const bodySchema = bodyContent.schema;
    if (bodySchema.$ref !== undefined) {
      const refName = bodySchema.$ref.split("/").pop() ?? "";
      const typeId = nameToTypeId.get(refName);
      if (typeId !== undefined) {
        inputFields.push(`  body: ref("${typeId}")`);
      }
    } else if (bodySchema.type === "object" && bodySchema.properties !== undefined) {
      // Inline body object - add properties directly
      const required = new Set(bodySchema.required ?? []);
      for (const [propName, propSchema] of Object.entries(bodySchema.properties)) {
        const mapped = mapSchemaType(propSchema, nameToTypeId, warnings, propName);
        if (mapped !== undefined) {
          const isOptional = !required.has(propName);
          inputFields.push(`  ${toCamelCase(propName)}: ${isOptional ? `optional(${mapped})` : mapped}`);
        }
      }
    }
  }

  // Build output type
  const response200 = op.responses?.["200"] ?? op.responses?.["201"];
  const responseContent = response200?.content?.["application/json"];
  let outputType = "unit()";
  if (responseContent?.schema !== undefined) {
    const mapped = mapSchemaType(responseContent.schema, nameToTypeId, warnings, "response");
    if (mapped !== undefined) {
      outputType = mapped;
    }
  }

  // Build input type expression
  let inputType: string;
  if (inputFields.length === 0) {
    inputType = "unit()";
  } else if (inputFields.length === 1 && inputFields[0]?.trim().startsWith("body:")) {
    // Single ref body - use the ref directly
    inputType = inputFields[0].trim().replace("body: ", "");
  } else {
    // Multiple fields - create an inline struct (needs a named type)
    // For v1, we generate a named type declaration
    const inputTypeId = `${toPascalCase(opId)}Request`;
    warnings.push(`${execspecOpId}: input has ${inputFields.length} fields - generating named type ${inputTypeId}`);
    // We'll add this as a type declaration
    // (handled by the caller via a separate types list)
    inputType = `ref("${inputTypeId}")`;
    // Store the input type for the caller
    inputTypeDeclarations.push(
      `spec.type(struct("${inputTypeId}", {\n${inputFields.join(",\n")}\n}));`,
    );
  }

  return `spec.operation(operation("${execspecOpId}", {\n  input: ${inputType},\n  output: ${outputType},\n}));`;
}

// Accumulate input type declarations (module-level, reset per import)
let inputTypeDeclarations: string[] = [];

export function resetInputTypes(): void {
  inputTypeDeclarations = [];
}

export function getInputTypeDeclarations(): readonly string[] {
  return [...inputTypeDeclarations];
}

// --- Naming helpers ---

function toPascalCase(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .split(" ")
    .filter((s) => s.length > 0)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("")
    .replace(/^[a-z]/, (c) => c.toUpperCase());
}

function toCamelCase(name: string): string {
  const pascal = toPascalCase(name);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

function camelToDotted(opId: string, path: string): string | undefined {
  // Try to derive a valid execspec operation ID from the OpenAPI operationId and path
  // e.g., "getPetById" + "/pet/{petId}" → "pet.get-pet-by-id" or "pets.get-by-id"

  // Extract path segments (skip params)
  const segments = path.split("/").filter((s) => s.length > 0 && !s.startsWith("{"));
  if (segments.length === 0) {
    // Root-level operations
    const words = camelCaseToWords(opId);
    if (words.length >= 2) return `${words[0]}.${words.slice(1).join("-")}`;
    return undefined;
  }

  // Use first path segment as namespace, operationId words as the rest
  const namespace = segments[0] ?? "api";
  const words = camelCaseToWords(opId);
  if (words.length === 0) return undefined;

  // Remove the namespace word from the operation if it's the first word
  const restWords = words[0] === namespace ? words.slice(1) : words;
  if (restWords.length === 0) {
    // Just the namespace - need at least 2 segments
    return `${namespace}.get`;
  }

  return `${namespace}.${restWords.join("-")}`;
}

function camelCaseToWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]/g, " ")
    .split(" ")
    .filter((s) => s.length > 0)
    .map((s) => s.toLowerCase());
}

function deriveOperationId(path: string, method: string): string {
  const segments = path.split("/").filter((s) => s.length > 0 && !s.startsWith("{"));
  const resource = segments[0] ?? "root";
  return `${method}${resource.charAt(0).toUpperCase()}${resource.slice(1)}`;
}
