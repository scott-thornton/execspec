/** Java type emission: records for structs, sealed interfaces for
 *  unions, enums for enums. Java 17+. */

import type { TypeDeclaration, ValueType } from "@execspec/core";
import { javaPropertyName, javaTypeName } from "./identifiers.js";

export function javaValueTypeName(type: ValueType): string {
  switch (type.kind) {
    case "unit": return "Unit";
    case "boolean": return "boolean";
    case "int64": return "long";
    case "float64": return "double";
    case "string": return "String";
    case "bytes": return "byte[]";
    case "ref": return javaTypeName(type.typeId);
    case "list": return `List<${javaValueTypeName(type.element)}>`;
    case "map": return `Map<${javaValueTypeName(type.key)}, ${javaValueTypeName(type.value)}>`;
  }
}

export function emitJavaTypes(types: readonly TypeDeclaration[]): string {
  const chunks: string[] = [];
  chunks.push(`final class Unit {
    private Unit() {}
    public static final Unit INSTANCE = new Unit();
}
`);
  for (const declaration of types) {
    if (declaration.kind === "struct") {
      const name = javaTypeName(declaration.id);
      const params = declaration.fields
        .map((field) => {
          const prop = javaPropertyName(field.name);
          const type = javaValueTypeName(field.type);
          return field.optional ? `@Nullable ${type} ${prop}` : `${type} ${prop}`;
        })
        .join(", ");
      const body = declaration.fields
        .map((field) => `        this.${javaPropertyName(field.name)} = ${javaPropertyName(field.name)};`)
        .join("\n");
      chunks.push(`final class ${name} {
    ${declaration.fields.map((f) => {
      const prop = javaPropertyName(f.name);
      const type = javaValueTypeName(f.type);
      return f.optional ? `private final ${boxIfPrimitive(type)} ${prop};` : `private final ${type} ${prop};`;
    }).join("\n    ")}

    public ${name}(${params}) {
${body}
    }

${declaration.fields.map((f) => {
  const prop = javaPropertyName(f.name);
  const type = javaValueTypeName(f.type);
  return `    public ${type} get${capitalize(prop)}() { return ${prop}; }`;
}).join("\n")}
}
`);
    } else if (declaration.kind === "enum") {
      const name = javaTypeName(declaration.id);
      chunks.push(`enum ${name} {
    ${declaration.cases.map((c) => javaPropertyName(c)).join(",\n    ")}
}
`);
    } else {
      const name = javaTypeName(declaration.id);
      const variants = declaration.cases.map((unionCase) => {
        const caseName = javaPropertyName(unionCase.name);
        if (unionCase.payload.kind === "unit") {
          return `    public final class ${capitalize(caseName)} implements ${name} {\n        public static final ${capitalize(caseName)} INSTANCE = new ${capitalize(caseName)}();\n        private ${capitalize(caseName)}() {}\n    }`;
        }
        const payloadType = javaValueTypeName(unionCase.payload);
        return `    public final class ${capitalize(caseName)} implements ${name} {\n        public final ${payloadType} value;\n        public ${capitalize(caseName)}(${payloadType} value) {\n            this.value = value;\n        }\n    }`;
      }).join("\n\n");
      chunks.push(`sealed interface ${name} {
${variants}
}\n`);
    }
  }
  return chunks.join("\n");
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function boxIfPrimitive(type: string): string {
  switch (type) {
    case "boolean": return "Boolean";
    case "long": return "Long";
    case "double": return "Double";
    default: return type;
  }
}
