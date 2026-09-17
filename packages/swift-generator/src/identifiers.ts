/**
 * Swift naming transformation (plan Task 22). Deterministic mapping;
 * collisions after escaping are generator errors.
 */

/** Keywords and reserved words through Swift 6.x (lowercase set is what
 *  member names can collide with; the full set keeps types safe too). */
const SWIFT_KEYWORDS: ReadonlySet<string> = new Set([
  "associatedtype", "class", "deinit", "enum", "extension", "fileprivate",
  "func", "import", "init", "inout", "internal", "let", "open", "operator",
  "private", "precedencegroup", "protocol", "public", "rethrows", "static",
  "struct", "subscript", "typealias", "var",
  "break", "case", "catch", "continue", "default", "defer", "do", "else",
  "fallthrough", "for", "guard", "if", "in", "repeat", "return", "throw",
  "switch", "where", "while",
  "as", "any", "false", "is", "nil", "self", "Self", "super", "throws",
  "true", "try", "await", "async", "actor", "some", "each", "borrow",
  "consuming", "mutating", "nonmutating", "indirect", "lazy", "optional",
  "override", "final", "required", "convenience", "dynamic", "infix",
  "postfix", "prefix", "get", "set", "willSet", "didSet", "unowned",
  "weak", "left", "right", "none", "Type",
]);

export function swiftTypeName(typeId: string): string {
  return escapeKeyword(typeId);
}

export function swiftPropertyName(name: string): string {
  return escapeKeyword(name);
}

export function swiftEnumCaseName(name: string): string {
  return escapeKeyword(name);
}

function escapeKeyword(name: string): string {
  return SWIFT_KEYWORDS.has(name) ? `${name}_` : name;
}

/** `kv.put` → `kvPut`; `user.get-by-id` → `userGetById`. */
export function swiftMethodName(operationId: string): string {
  const words = operationId.split(/[.-]/);
  const first = words[0] ?? "";
  const rest = words
    .slice(1)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
  return escapeKeyword(`${first}${rest}`);
}

/** `kv` → `KV…`; `userManagement` → `UserManagement…`; `todo-list` → `TODOList…`. */
export function swiftSpecificationPrefix(specificationName: string): string {
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

/** Throws when distinct source names collide after Swift escaping. */
export function assertNoEscapedCollisions(
  names: readonly string[],
  scope: string,
  escape: (name: string) => string,
): void {
  const seen = new Map<string, string>();
  for (const name of names) {
    const escaped = escape(name);
    const existing = seen.get(escaped);
    if (existing !== undefined && existing !== name) {
      throw new Error(
        `Swift identifier collision in ${scope}: '${existing}' and '${name}' both escape to '${escaped}'`,
      );
    }
    seen.set(escaped, name);
  }
}
