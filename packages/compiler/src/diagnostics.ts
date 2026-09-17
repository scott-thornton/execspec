/** Compiler diagnostics: authoring and IR problems, never exceptions. */

export interface CompilerDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly scope: string;
}

export function formatDiagnostics(diagnostics: readonly CompilerDiagnostic[]): string {
  return diagnostics
    .map((diagnostic) => `${diagnostic.scope}: ${diagnostic.code}: ${diagnostic.message}`)
    .join("\n");
}
