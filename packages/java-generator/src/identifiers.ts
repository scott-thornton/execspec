/** Java naming transformation. */

const JAVA_KEYWORDS = new Set([
  "abstract", "assert", "boolean", "break", "byte", "case", "catch",
  "char", "class", "const", "continue", "default", "do", "double",
  "else", "enum", "extends", "final", "finally", "float", "for", "goto",
  "if", "implements", "import", "instanceof", "int", "interface", "long",
  "native", "new", "package", "private", "protected", "public", "return",
  "short", "static", "strictfp", "super", "switch", "synchronized",
  "this", "throw", "throws", "transient", "try", "void", "volatile",
  "while", "true", "false", "null", "var", "record", "sealed", "permits",
  "yield",
]);

export function javaTypeName(typeId: string): string {
  return typeId;
}

export function javaPropertyName(name: string): string {
  return JAVA_KEYWORDS.has(name) ? `${name}_` : name;
}

export function javaMethodName(operationId: string): string {
  const words = operationId.split(/[.-]/);
  const first = words[0] ?? "";
  const rest = words
    .slice(1)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
  return javaPropertyName(`${first}${rest}`);
}

export function javaSpecificationPrefix(specificationName: string): string {
  const segments = specificationName.split(/[^A-Za-z0-9]+/).filter((s) => s.length > 0);
  return segments
    .map((segment, index) => {
      if (index === 0 && segment.length <= 4 && segment === segment.toLowerCase()) {
        return segment.toUpperCase();
      }
      return segment.charAt(0).toUpperCase() + segment.slice(1);
    })
    .join("");
}
