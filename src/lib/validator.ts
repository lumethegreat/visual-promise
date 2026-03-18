/**
 * Visual Promise — Snippet Validator
 * ==================================
 *
 * Entry point for snippet validation. Provides `validateSnippet(code)` which
 * returns a `ValidationResult` — the single contract between the validator
 * and the UI.
 *
 * The validator is parse-only (no execution). It uses @babel/parser in estree
 * mode to produce an AST, then runs the capability checker to collect findings,
 * aggregates them into a ValidationResult, and classifies the snippet category.
 *
 * Performance target: < 10ms for typical snippets (< 200 lines).
 */

import { checkCapabilities, detectSupportedPatterns } from "./capability-checker";
import { parse as babelParse } from "@babel/parser";
import type { ValidationResult, ValidationMessage, ValidationLevel, SnippetCategory } from "./validation-result";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Classifies the snippet's intent from its AST patterns.
 * Used for UX copy and example matching.
 */
function classifySnippetCategory(
  code: string,
  supportedPatterns: string[],
  unsupportedPatterns: string[],
): SnippetCategory {
  const trimmed = code.trim();

  if (!trimmed) return "empty";
  if (trimmed === "{}" || trimmed === ";") return "empty";

  // Static factory
  if (
    supportedPatterns.includes("Promise.resolve") ||
    supportedPatterns.includes("Promise.reject")
  ) {
    if (supportedPatterns.length === 1) return "static-factory";
  }

  // Promise executor (manual promise)
  if (
    supportedPatterns.includes("Promise executor") &&
    !unsupportedPatterns.some((p) =>
      ["setTimeout", "setInterval", "fetch", "XMLHttpRequest"].includes(p),
    )
  ) {
    return "manual-promise";
  }

  // Async function — check before promise chain so snippets with both are classified as "mixed"
  if (supportedPatterns.includes("async function")) {
    return "async-function";
  }

  // Promise chain
  if (
    supportedPatterns.includes(".then()") ||
    supportedPatterns.includes(".catch()") ||
    supportedPatterns.includes(".finally()")
  ) {
    return "promise-chain";
  }

  return "mixed";
}

// ─── Main API ────────────────────────────────────────────────────────────────

/**
 * validateSnippet
 *
 * Validates a JavaScript snippet against the Visual Promise capability matrix.
 *
 * Steps:
 * 1. Parse with Babel (estree mode)
 * 2. Run capability checker → CapabilityFinding[]
 * 3. Convert findings → ValidationMessage[]
 * 4. Classify into ValidationResult (level, category, patterns)
 *
 * @param code — the raw source string to validate
 * @returns A ValidationResult ready for consumption by the UI
 */
export function validateSnippet(code: string): ValidationResult {
  // ── Step 1: Capability check ────────────────────────────────────────────
  const findings = checkCapabilities(code);

  // ── Step 2: Convert findings to ValidationMessages ─────────────────────────
  const messages: ValidationMessage[] = findings.map((f) => ({
    level: f.severity,
    code: f.code,
    message: f.message,
    line: f.line,
    column: f.column,
    snippet: f.snippet,
  }));

  // ── Step 3: Compute level ─────────────────────────────────────────────────
  const hasError = messages.some((m) => m.level === "error");
  const hasWarning = messages.some((m) => m.level === "warning");

  let level: ValidationLevel;
  if (hasError) {
    level = "error";
  } else if (hasWarning) {
    level = "warning";
  } else {
    level = "ok";
  }

  // ── Step 4: Detect patterns ───────────────────────────────────────────────
  let ast: ReturnType<typeof babelParse> | null = null;
  try {
    ast = babelParse(code, {
      sourceType: "module",
      plugins: ["estree"],
      errorRecovery: true,
    });
  } catch {
    // If we can't parse, pattern detection is skipped
  }

  const supportedPatterns = ast ? detectSupportedPatterns(ast) : [];

  // More precise unsupported pattern extraction
  const unsupportedCodes = findings
    .filter((f) => f.severity === "error")
    .map((f) => f.code);

  const partialPatterns = findings
    .filter((f) => f.severity === "warning")
    .map((f) => f.code);

  // ── Step 5: Classify category ──────────────────────────────────────────────
  const category = classifySnippetCategory(code, supportedPatterns, unsupportedCodes);

  return {
    level,
    messages,
    category,
    supportedPatterns,
    unsupportedPatterns: [...new Set(unsupportedCodes)],
    partialPatterns: [...new Set(partialPatterns)],
  };
}

// ─── Re-export types ─────────────────────────────────────────────────────────
export type { ValidationResult, ValidationMessage, ValidationLevel, SnippetCategory } from "./validation-result";
