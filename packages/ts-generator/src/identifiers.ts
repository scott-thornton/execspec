/**
 * Target naming for generated TypeScript (mirrors the Swift rules).
 */

const RESERVED = new Set<string>([]); // TS has no member-name keywords to escape

export function tsTypeName(typeId: string): string {
  return typeId;
}

export function tsPropertyName(name: string): string {
  return RESERVED.has(name) ? `${name}_` : name;
}

/** `kv.put` → `kvPut`; `user.get-by-id` → `userGetById`. */
export function tsMethodName(operationId: string): string {
  const words = operationId.split(/[.-]/);
  const first = words[0] ?? "";
  const rest = words
    .slice(1)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
  return `${first}${rest}`;
}

export function tsSpecificationPrefix(specificationName: string): string {
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
