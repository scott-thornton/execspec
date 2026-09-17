/**
 * Branded identifier types and their grammars (docs/specification.md §4).
 *
 * `$`-prefixed user names are prohibited because `$` is reserved for
 * wire-level encodings; the grammars below admit no `$` at all.
 */

declare const __typeId: unique symbol;
declare const __operationId: unique symbol;
declare const __scenarioId: unique symbol;

export type TypeId = string & { readonly [__typeId]: true };
export type OperationId = string & { readonly [__operationId]: true };
export type ScenarioId = string & { readonly [__scenarioId]: true };

export const TYPE_ID_GRAMMAR = "^[A-Z][A-Za-z0-9]*$";
export const DOTTED_ID_GRAMMAR = "^[a-z][a-z0-9]*(\\.[a-z][a-z0-9-]*)+$";
export const MEMBER_NAME_GRAMMAR = "^[a-z][A-Za-z0-9]*$";

const TYPE_ID_PATTERN = /^[A-Z][A-Za-z0-9]*$/;
const DOTTED_ID_PATTERN = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*)+$/;
const MEMBER_NAME_PATTERN = /^[a-z][A-Za-z0-9]*$/;

function parse(value: string, pattern: RegExp, grammar: string, kind: string): string {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(
      `Invalid ${kind} ${JSON.stringify(value)}: expected grammar ${grammar}`,
    );
  }
  return value;
}

export function parseTypeId(value: string): TypeId {
  return parse(value, TYPE_ID_PATTERN, TYPE_ID_GRAMMAR, "type ID") as TypeId;
}

export function parseOperationId(value: string): OperationId {
  return parse(value, DOTTED_ID_PATTERN, DOTTED_ID_GRAMMAR, "operation ID") as OperationId;
}

export function parseScenarioId(value: string): ScenarioId {
  return parse(value, DOTTED_ID_PATTERN, DOTTED_ID_GRAMMAR, "scenario ID") as ScenarioId;
}

export function parseMemberName(value: string): string {
  return parse(value, MEMBER_NAME_PATTERN, MEMBER_NAME_GRAMMAR, "member name");
}

export function isTypeId(value: string): boolean {
  return TYPE_ID_PATTERN.test(value);
}

export function isOperationId(value: string): boolean {
  return DOTTED_ID_PATTERN.test(value);
}

export function isScenarioId(value: string): boolean {
  return DOTTED_ID_PATTERN.test(value);
}

export function isMemberName(value: string): boolean {
  return MEMBER_NAME_PATTERN.test(value);
}
