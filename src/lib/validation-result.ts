/**
 * Visual Promise — Validation Result Types
 * =========================================
 *
 * These types define the contract between the snippet validator and the UI.
 * A ValidationResult is produced by the validator and consumed by the
 * CapabilityBanner, inline decorations, and the replay gate.
 */

// ─── Primitive enums ─────────────────────────────────────────────────────────

/**
 * ValidationLevel — the aggregated severity of a validation run.
 *
 * - `ok`:       no errors, no warnings → snippet runs freely
 * - `warning`:  at least one warning, no errors → snippet runs with caveats
 * - `error`:    at least one error → snippet is blocked
 */
export type ValidationLevel = "ok" | "warning" | "error";

/**
 * SnippetCategory — a UX-oriented classification of the snippet's intent.
 * Used to drive copy, examples, and microcopy in the UI.
 */
export type SnippetCategory =
  /** A single static factory: Promise.resolve() or Promise.reject() */
  | "static-factory"
  /** A new Promise with a synchronous executor */
  | "manual-promise"
  /** A chain of .then/.catch/.finally calls */
  | "promise-chain"
  /** An async function declaration or expression */
  | "async-function"
  /** Mixed patterns that don't fit a single category */
  | "mixed"
  /** Nothing recognizable — empty or unreadable input */
  | "empty";

// ─── Individual message ───────────────────────────────────────────────────────

/**
 * ValidationMessage — a single finding from the validator.
 * Each represents one error or warning with enough context for the UI to
 * render a precise message, inline decoration, and jump-to-line link.
 */
export interface ValidationMessage {
  /** 'error' blocks execution; 'warning' allows it with a caveat. */
  level: "error" | "warning";
  /**
   * Machine-readable error key.
   * Maps directly to a message in the error-messages library
   * (see docs/partial-support-ux.md Section 4).
   */
  code: string;
  /**
   * Human-readable message.
   * Should be pedagogical, not a raw AST dump.
   * Already contains a constructive suggestion where possible.
   */
  message: string;
  /** 1-indexed line where the issue was found. */
  line?: number;
  /** 1-indexed column where the issue was found. */
  column?: number;
  /**
   * The specific source snippet that triggered the finding.
   * Used by the UI to show context around the problematic code.
   */
  snippet?: string;
}

// ─── Aggregated result ───────────────────────────────────────────────────────

/**
 * ValidationResult — the complete output of validateSnippet().
 * Aggregates all findings into a single decision the UI can act on.
 */
export interface ValidationResult {
  /**
   * The overall severity level.
   * - 'ok'      → no errors, no warnings
   * - 'warning' → at least one warning, no errors
   * - 'error'   → at least one error
   */
  level: ValidationLevel;
  /**
   * All individual findings (errors + warnings) in the order they were found.
   * Empty array when level === 'ok'.
   */
  messages: ValidationMessage[];
  /**
   * UX-oriented category for the whole snippet.
   * Drives which copy/template the UI uses for the capability banner.
   */
  category: SnippetCategory;
  /**
   * Pattern tags that were detected and are fully supported.
   * Useful for analytics and example-matching in the UI.
   * @example ["Promise.resolve", "async function", "await"]
   */
  supportedPatterns: string[];
  /**
   * Pattern tags that were detected but are not supported.
   * @example ["setTimeout", "fetch", "import"]
   */
  unsupportedPatterns: string[];
  /**
   * Pattern tags that are supported but have caveats (partial support).
   * @example ["async handler in .then", "nested async >2 levels"]
   */
  partialPatterns: string[];
}
