/**
 * Visual Promise — Capability Checker
 * ====================================
 *
 * Walks the Babel AST of a snippet and classifies every construct against
 * the capability matrix (docs/capability-matrix.md).
 *
 * Each check function returns a list of CapabilityFinding objects.
 * The findings are NOT typed as ValidationMessage yet — that aggregation
 * happens in validator.ts so the same findings can be rendered differently
 * depending on context.
 *
 * Design notes:
 * - Parse-only: we use @babel/parser (estree mode) and @babel/traverse.
 *   We NEVER call Babel's transform APIs.
 * - No runtime execution — everything is static analysis.
 * - The checker is stateless: all mutable tracking (depth counters, etc.)
 *   is carried in a mutable State object passed through the visitor.
 */

import { parse } from "@babel/parser";
import traverse, { type NodePath } from "@babel/traverse";
import * as t from "@babel/types";

// ─── Finding types ───────────────────────────────────────────────────────────

/**
 * A raw finding from the capability checker.
 * Converted to ValidationMessage in validator.ts.
 */
export interface CapabilityFinding {
  severity: "error" | "warning";
  code: string;
  message: string;
  /** Source location, 1-indexed. */
  line: number;
  column: number;
  /** The offending source text. */
  snippet: string;
}

// ─── Source extraction helper ──────────────────────────────────────────────────

/**
 * Extracts the source text of a node from the original source using its location.
 * Falls back to a location string if extraction fails.
 */
function extractSourceText(node: t.Node, source: string): string {
  try {
    const loc = node.loc;
    if (!loc || !source) return loc ? `line ${loc.start.line}:${loc.start.column}` : "(no location)";

    const lines = source.split("\n");
    const startLine = loc.start.line - 1; // 0-indexed
    const endLine = loc.end.line - 1;
    const startCol = loc.start.column;
    const endCol = loc.end.column;

    if (startLine === endLine) {
      return lines[startLine]?.slice(startCol, endCol) ?? "(unknown)";
    }

    // Multi-line node
    const firstLine = lines[startLine]?.slice(startCol) ?? "";
    const lastLine = lines[endLine]?.slice(0, endCol) ?? "";
    const middleLines = lines.slice(startLine + 1, endLine);
    return [firstLine, ...middleLines, lastLine].join("\n");
  } catch {
    return "(unknown)";
  }
}

// ─── Internal state carried through the AST traversal ────────────────────────

interface TraversalState {
  /** Depth of nested async functions (for DEEP_NESTING check). */
  asyncDepth: number;
  /** Whether we are inside a Promise executor body. */
  insideExecutor: boolean;
  /** Whether we are at module top-level (for top-level await check). */
  atModuleTopLevel: boolean;
  /**
   * Whether we are inside a .finally() handler body.
   * Used to detect return statements inside finally blocks.
   */
  insideFinallyHandler: boolean;
  /**
   * Whether the current return statement is inside a .finally() handler.
   * (Different from insideFinallyHandler — set only when we detect the return.)
   */
  finallyReturnFound: boolean;
  /** Accumulated findings. */
  findings: CapabilityFinding[];
  /**
   * Whether the current executor body contains a call that is NOT
   * resolve/reject. Used to detect foreign callbacks in executors.
   */
  executorHasForeignCall: boolean;
  /**
   * Tracks whether we've seen top-level await.
   * @see https://babeljs.io/docs/babel-parser#top-level-await
   */
  hasTopLevelAwait: boolean;
  /** The original source code string (for extracting node text). */
  source: string;
}

// ─── Helper: extract source snippet from a node ───────────────────────────────

/**
 * Returns the source text of a node by re-generating it from the AST node.
 * This is safe because Babel preserves the original source during parsing.
 */
function nodeToSnippet(node: t.Node, source: string): string {
  return extractSourceText(node, source);
}

/**
 * Recursively walks an AST subtree and counts foreign callback calls
 * (calls that are NOT resolve() or reject()).
 * Used to detect unsupported patterns inside Promise executor bodies.
 */
function findForeignCalls(nodes: t.Statement[]): number {
  let count = 0;
  for (const stmt of nodes) {
    if (t.isExpressionStatement(stmt)) {
      const expr = stmt.expression;
      if (t.isCallExpression(expr)) {
        if (
          t.isIdentifier(expr.callee) &&
          expr.callee.name !== "resolve" &&
          expr.callee.name !== "reject"
        ) {
          count++;
        }
      }
    }
    if (t.isIfStatement(stmt)) {
      count += findForeignCalls(stmt.consequent ? [stmt.consequent] : []);
      count += findForeignCalls(stmt.alternate ? [stmt.alternate] : []);
    }
    if (t.isWhileStatement(stmt)) {
      count += findForeignCalls([stmt.body]);
    }
    if (t.isForStatement(stmt)) {
      count += findForeignCalls([stmt.body]);
    }
    if (t.isForInStatement(stmt) || t.isForOfStatement(stmt)) {
      count += findForeignCalls([stmt.body]);
    }
    if (t.isSwitchStatement(stmt)) {
      for (const c of stmt.cases) {
        count += findForeignCalls(c.consequent);
      }
    }
    if (t.isTryStatement(stmt)) {
      count += findForeignCalls(stmt.block.body);
      if (stmt.handler?.param) {
        count += findForeignCalls(stmt.handler.body.body);
      }
      if (stmt.finalizer) {
        count += findForeignCalls(stmt.finalizer.body);
      }
    }
  }
  return count;
}

// ─── Individual check functions ───────────────────────────────────────────────

/**
 * checkUnsupportedCalls — detects all hard-blocked APIs.
 *
 * Blocked categories:
 * - Timer APIs: setTimeout, setInterval, setImmediate, requestAnimationFrame
 * - Network APIs: fetch, XMLHttpRequest, WebSocket, EventSource
 * - Module APIs: import, export, require, import()
 * - Meta-programming: eval, Function, new Function
 * - DOM globals: document, window, navigator, location, history
 * - Misc: Symbol (for well-known symbols access), Proxy, Reflect (partial)
 */
function checkUnsupportedCalls(
  path: NodePath,
  state: TraversalState,
): void {
  const node = path.node;
  const loc = node.loc;

  // Helper to push a finding
  const fail = (code: string, message: string, snippet: string) => {
    state.findings.push({
      severity: "error",
      code,
      message,
      line: loc?.start.line ?? 0,
      column: loc?.start.column ?? 0,
      snippet,
    });
  };

  // ── NewExpression: new Foo() ─────────────────────────────────────────────
  if (t.isNewExpression(node)) {
    const callee = node.callee;

    // new XMLHttpRequest() — treat as network API
    if (t.isIdentifier(callee, { name: "XMLHttpRequest" })) {
      fail(
        "NETWORK_NOT_SUPPORTED",
        "XMLHttpRequest is not supported in this sandboxed environment. Use Promise.resolve() to simulate responses.",
        nodeToSnippet(node, state.source),
      );
      return;
    }

    // new WebSocket() — treat as network API
    if (t.isIdentifier(callee, { name: "WebSocket" })) {
      fail(
        "NETWORK_NOT_SUPPORTED",
        "WebSocket is not supported in this sandboxed environment.",
        nodeToSnippet(node, state.source),
      );
      return;
    }

    // new Promise(executor) — check for foreign callbacks inside executor body
    if (t.isIdentifier(callee, { name: "Promise" })) {
      const executor = node.arguments[0];
      if (
        (t.isFunctionExpression(executor) || t.isArrowFunctionExpression(executor)) &&
        t.isBlockStatement(executor.body)
      ) {
        // Walk the executor body directly (no Babel traverse scope needed)
        // to detect non-resolve/reject calls
        const body = executor.body.body;
        const foreignCalls = findForeignCalls(body);
        if (foreignCalls > 0) {
          fail(
            "FOREIGN_CALLBACK_IN_EXECUTOR",
            "The Promise executor calls a function other than resolve() or reject(). Only direct resolve() / reject() calls are supported inside Promise executors.",
            nodeToSnippet(node, state.source),
          );
        }
      }
    }
  }

  // ── CallExpression: foo() ───────────────────────────────────────────────
  if (t.isCallExpression(node)) {
    const callee = node.callee;

    // getTimeout / getInterval are sometimes used — treat as timer too
    const TIMER_NAMES = new Set([
      "setTimeout",
      "setInterval",
      "setImmediate",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "cancelIdleCallback",
    ]);

    // Network / platform APIs
    const NETWORK_NAMES = new Set([
      "fetch",
      "XMLHttpRequest",
      "WebSocket",
      "EventSource",
      "fetchEventSource",
    ]);

    // Meta-programming
    const META_NAMES = new Set(["eval", "Function"]);

    // Check direct identifier calls: foo()
    if (t.isIdentifier(callee)) {
      const name = callee.name;

      if (TIMER_NAMES.has(name)) {
        fail(
          "TIMER_NOT_SUPPORTED",
          "Timer APIs (setTimeout, setInterval, requestAnimationFrame) are not supported. Use `await` to express asynchrony instead of timers.",
          nodeToSnippet(node, state.source),
        );
        return;
      }

      if (NETWORK_NAMES.has(name)) {
        fail(
          "NETWORK_NOT_SUPPORTED",
          "Network APIs (fetch, XMLHttpRequest, WebSocket) are not supported in this sandboxed environment. Use Promise.resolve() to simulate responses.",
          nodeToSnippet(node, state.source),
        );
        return;
      }

      if (META_NAMES.has(name)) {
        fail(
          "META_PROGRAMMING_NOT_SUPPORTED",
          "Dynamic code generation (eval, Function) is not supported. All code must be statically analyzable.",
          nodeToSnippet(node, state.source),
        );
        return;
      }
    }

    // Member call: obj.method()
    if (t.isMemberExpression(callee)) {
      const obj = callee.object;
      const prop = callee.property;

      const getPropName = () =>
        t.isIdentifier(prop) ? prop.name : t.isStringLiteral(prop) ? prop.value : null;

      // document.getElementById, window.fetch, etc.
      if (t.isIdentifier(obj, { name: "document" }) && getPropName()) {
        fail(
          "DOM_NOT_SUPPORTED",
          "DOM APIs (document, window, navigator) are not available in this sandboxed environment.",
          nodeToSnippet(node, state.source),
        );
      }

      // window.location, window.fetch, etc.
      if (t.isIdentifier(obj, { name: "window" }) && getPropName()) {
        fail(
          "DOM_NOT_SUPPORTED",
          "DOM APIs (document, window, navigator) are not available in this sandboxed environment.",
          nodeToSnippet(node, state.source),
        );
      }

      if (t.isIdentifier(obj, { name: "navigator" })) {
        fail(
          "DOM_NOT_SUPPORTED",
          "The navigator API is not available in this sandboxed environment.",
          nodeToSnippet(node, state.source),
        );
      }

      // console.* — most methods are allowed
      if (t.isIdentifier(obj, { name: "console" })) {
        const method = getPropName();
        if (method && !["log", "info", "warn", "error", "debug", "table"].includes(method)) {
          fail(
            "CONSOLE_METHOD_NOT_SUPPORTED",
            `console.${method} is not supported. Only console.log, console.info, console.warn, console.error are available.`,
            nodeToSnippet(node, state.source),
          );
        }
      }
    }

    // Dynamic import(): import('foo') — callee is `import` (a special keyword)
    if (t.isImport(node.callee)) {
      fail(
        "IMPORT_EXPORT_NOT_SUPPORTED",
        "Dynamic import() is not supported. All code must be self-contained in the snippet.",
        nodeToSnippet(node, state.source),
      );
    }
  }

  // ── NewExpression: new Function() — meta-programming ───────────────────────
  if (t.isNewExpression(node)) {
    if (t.isIdentifier(node.callee, { name: "Function" })) {
      fail(
        "META_PROGRAMMING_NOT_SUPPORTED",
        "new Function() is not supported. All code must be statically analyzable.",
        nodeToSnippet(node, state.source),
      );
    }
  }

  // ── ImportDeclaration: import foo from 'bar' ─────────────────────────────
  if (t.isImportDeclaration(node)) {
    fail(
      "IMPORT_EXPORT_NOT_SUPPORTED",
      "ES module imports are not supported. All code must be self-contained in the snippet.",
      nodeToSnippet(node, state.source),
    );
    return;
  }

  // ── ExportDeclaration: export const x = ... ─────────────────────────────
  if (
    t.isExportNamedDeclaration(node) ||
    t.isExportDefaultDeclaration(node) ||
    t.isExportAllDeclaration(node)
  ) {
    fail(
      "IMPORT_EXPORT_NOT_SUPPORTED",
      "ES module exports are not supported. All code must be self-contained in the snippet.",
      nodeToSnippet(node, state.source),
    );
    return;
  }

  // ── Require call: require('foo') ────────────────────────────────────────
  if (t.isCallExpression(node) && t.isIdentifier(node.callee, { name: "require" })) {
    fail(
      "IMPORT_EXPORT_NOT_SUPPORTED",
      "CommonJS require() is not supported. Use ES module imports inside a bundler instead.",
      nodeToSnippet(node, state.source),
    );
    return;
  }

  // ── Identifier — accessing well-known globals ───────────────────────────
  if (t.isIdentifier(node)) {
    // Skip if this identifier is the callee of a NewExpression (handled there)
    if (
      t.isNewExpression(path.parent) &&
      (path.parent as t.NewExpression).callee === node
    ) {
      // NewExpression handler takes care of this
      return;
    }

    const UNSUPPORTED_GLOBALS = new Set([
      "ActiveXObject",
      "webkitRequestAnimationFrame",
    ]);
    if (UNSUPPORTED_GLOBALS.has(node.name)) {
      fail(
        "UNSUPPORTED_GLOBAL",
        `The global "${node.name}" is not supported.`,
        nodeToSnippet(node, state.source),
      );
    }
  }

  // ── VariableDeclarator — checking for self-referential promises ─────────
  // Handled in a separate pass (see checkSelfReferentialPromise)
}

/**
 * checkFinallyReturn — detects return statements inside .finally() handlers.
 * Uses parent-chain walking to avoid timing issues with visitor enter/exit.
 */
function checkFinallyReturn(path: NodePath, source: string): CapabilityFinding | null {
  if (!t.isReturnStatement(path.node)) return null;

  // Walk up: ReturnStatement → BlockStatement → ArrowFunctionExpression → CallExpression(.finally)
  const parent1 = path.parentPath;
  if (!parent1 || !t.isBlockStatement(parent1.node)) return null;

  const parent2 = parent1.parentPath;
  if (!parent2 || !t.isArrowFunctionExpression(parent2.node)) return null;

  const parent3 = parent2.parentPath;
  if (!parent3 || !t.isCallExpression(parent3.node)) return null;

  const callee = parent3.node.callee;
  if (!t.isMemberExpression(callee)) return null;
  if (!t.isIdentifier(callee.property, { name: "finally" })) return null;

  const loc = path.node.loc;
  return {
    severity: "warning",
    code: "FINALLY_RETURN",
    message:
      "Returning inside a .finally() handler is legal JavaScript but can be confusing. The return value of .finally() does NOT become the new promise value — the original settlement passes through unchanged. Consider removing the return.",
    line: loc?.start.line ?? 0,
    column: loc?.start.column ?? 0,
    snippet: extractSourceText(path.node, source),
  };
}

/**
 * checkPromiseCombinators — detects static Promise combinator calls.
 *
 * Hard-blocked:
 * - Promise.all, Promise.race, Promise.allSettled, Promise.any
 */
function checkPromiseCombinators(
  path: NodePath,
  state: TraversalState,
): void {
  const node = path.node;

  if (!t.isCallExpression(node)) return;
  const callee = node.callee;

  if (!t.isMemberExpression(callee)) return;
  if (!t.isIdentifier(callee.object, { name: "Promise" })) return;
  if (!t.isIdentifier(callee.property)) return;

  const COMBINATORS = new Set([
    "all",
    "race",
    "allSettled",
    "any",
  ]);

  const method = callee.property.name;

  if (COMBINATORS.has(method)) {
    const loc = node.loc;
    state.findings.push({
      severity: "error",
      code: "PROMISE_COMBINATOR_NOT_SUPPORTED",
      message:
        "Promise combinators (Promise.all, Promise.race, Promise.allSettled, Promise.any) are not supported in M1. Rewrite sequentially using `await` instead:\n\n    const a = await p;\n    const b = await q;\n    // instead of: await Promise.all([p, q])",
      line: loc?.start.line ?? 0,
      column: loc?.start.column ?? 0,
      snippet: nodeToSnippet(node, state.source),
    });
  }
}

/**
 * checkSelfReferentialPromise — detects patterns where a promise resolves
 * with itself or creates an infinite reference chain.
 *
 * Pattern:
 *   new Promise(resolve => resolve(resolve))  // ← self-ref
 *   let p;
 *   new Promise(r => { p = new Promise(r2 => { r(p); }); });  // ← cyclic
 *
 * For M1 we do a shallow check: any CallExpression where the callee is
 * `resolve` or `reject` and one of the arguments is the Promise being
 * constructed. Full detection of cyclic references requires building a
 * dependency graph, deferred to M2.
 */
function checkSelfReferentialPromise(
  path: NodePath,
  state: TraversalState,
): void {
  if (!t.isCallExpression(path.node)) return;
  if (!t.isIdentifier(path.node.callee)) return;
  const calleeName = path.node.callee.name;
  if (calleeName !== "resolve" && calleeName !== "reject") return;
  if (path.node.arguments.length === 0) return;

  // Shallow check: if the argument is `new Promise(...)` or a reference
  // to a variable that holds a promise — we flag it conservatively.
  const arg = path.node.arguments[0];
  const loc = path.node.loc;

  // Check for `resolve(resolve)` — self-reference via shadowing
  if (t.isIdentifier(arg) && arg.name === calleeName) {
    state.findings.push({
      severity: "error",
      code: "SELF_REFERENTIAL_PROMISE",
      message:
        "A promise cannot resolve with itself. This creates an unresolvable state — the promise would need to be fulfilled before it can be fulfilled.\n\nRemove the self-reference and try again.",
      line: loc?.start.line ?? 0,
      column: loc?.start.column ?? 0,
      snippet: nodeToSnippet(path.node, state.source),
    });
    return;
  }

  // Check for `resolve(new Promise(...))` — nested promise (not self-ref but
  // could create a self-referential chain depending on usage)
  // We flag it as a warning for now since it's edge-case territory.
  if (t.isNewExpression(arg) && t.isIdentifier(arg.callee, { name: "Promise" })) {
    state.findings.push({
      severity: "warning",
      code: "NESTED_PROMISE_IN_RESOLVE",
      message:
        "Passing a new Promise as the argument to resolve() is unusual. This may create a self-referential chain that never settles.\n\nIf you intended to wrap the value, use Promise.resolve() directly instead.",
      line: loc?.start.line ?? 0,
      column: loc?.start.column ?? 0,
      snippet: nodeToSnippet(path.node, state.source),
    });
  }
}

/**
 * checkPromiseChain — detects Promise chains (.then/.catch/.finally)
 * and flags async handlers for partial-support warnings.
 *
 * Supported patterns:
 * - p.then(fn), p.catch(fn), p.finally(fn)
 * - Chained: p.then(fn).then(fn)
 *
 * Partial/warning patterns:
 * - p.then(async fn) — async handler
 * - Nested callbacks in .then()
 */
function checkPromiseChain(
  path: NodePath,
  state: TraversalState,
): void {
  const node = path.node;

  if (!t.isCallExpression(node)) return;

  // Only interested in .then / .catch / .finally calls
  if (!t.isMemberExpression(node.callee)) return;
  const member = node.callee;
  if (!t.isIdentifier(member.property)) return;

  const methodName = member.property.name;
  if (!["then", "catch", "finally"].includes(methodName)) return;

  const loc = node.loc;
  const getSnippet = () => nodeToSnippet(node, state.source);

  // Check the handler argument (first argument for .then/.catch,
  // first argument for .finally)
  const handlerArg = node.arguments[0];

  // .finally() handler — mark that we're inside one
  if (methodName === "finally" && handlerArg) {
    if (t.isFunctionExpression(handlerArg) || t.isArrowFunctionExpression(handlerArg)) {
      // We'll handle the return-in-finally check at the statement level
      // (see checkFinallyReturn visitor)
    }
  }

  // .then(async fn) — async handler warning
  if (methodName === "then" && handlerArg) {
    const fn = handlerArg;
    const isAsync =
      (t.isFunctionExpression(fn) && fn.async) ||
      (t.isArrowFunctionExpression(fn) && fn.async);

    if (isAsync) {
      state.findings.push({
        severity: "warning",
        code: "ASYNC_HANDLER_PARTIAL",
        message:
          "This snippet passes an async function to .then(). The outer chain is fully visualized, but calls to functions defined outside this snippet cannot be traced.\n\nConsider defining helper functions within the snippet, or use a regular (non-async) function.",
        line: loc?.start.line ?? 0,
        column: loc?.start.column ?? 0,
        snippet: getSnippet(),
      });
    }
  }

  // .catch(async fn) — also partial
  if (methodName === "catch" && handlerArg) {
    const fn = handlerArg;
    const isAsync =
      (t.isFunctionExpression(fn) && fn.async) ||
      (t.isArrowFunctionExpression(fn) && fn.async);

    if (isAsync) {
      state.findings.push({
        severity: "warning",
        code: "ASYNC_HANDLER_PARTIAL",
        message:
          "This snippet passes an async function to .catch(). The error path is visualized, but nested awaits cannot be traced if they call external functions.",
        line: loc?.start.line ?? 0,
        column: loc?.start.column ?? 0,
        snippet: getSnippet(),
      });
    }
  }
}

// ─── Supported pattern detection ─────────────────────────────────────────────

/**
 * detectSupportedPatterns — scans the AST for well-known supported patterns.
 * These are tracked for the `supportedPatterns` field in ValidationResult
 * and for the SnippetCategory classification.
 */
function detectSupportedPatterns(ast: t.File): string[] {
  const patterns: string[] = [];

  traverse(ast, {
    CallExpression(path) {
      const node = path.node;

      // Promise.resolve / Promise.reject
      if (
        t.isMemberExpression(node.callee) &&
        t.isIdentifier(node.callee.object, { name: "Promise" }) &&
        t.isIdentifier(node.callee.property)
      ) {
        if (node.callee.property.name === "resolve") {
          patterns.push("Promise.resolve");
        } else if (node.callee.property.name === "reject") {
          patterns.push("Promise.reject");
        }
      }

      // .then / .catch / .finally
      if (
        t.isMemberExpression(node.callee) &&
        t.isIdentifier(node.callee.property)
      ) {
        const method = node.callee.property.name;
        if (["then", "catch", "finally"].includes(method)) {
          patterns.push(`.${method}()`);
        }
      }

      // console.log / console.error / console.warn / etc.
      if (
        t.isMemberExpression(node.callee) &&
        t.isIdentifier(node.callee.object, { name: "console" }) &&
        t.isIdentifier(node.callee.property)
      ) {
        patterns.push(`console.${node.callee.property.name}`);
      }
    },

    FunctionDeclaration(path) {
      patterns.push(path.node.async ? "async function" : "function");
    },

    // Detect new Promise() using a NewExpression visitor
    NewExpression(path) {
      const node = path.node;
      if (
        t.isIdentifier(node.callee, { name: "Promise" }) &&
        node.arguments.length > 0
      ) {
        const executor = node.arguments[0];
        if (
          t.isFunctionExpression(executor) ||
          t.isArrowFunctionExpression(executor)
        ) {
          patterns.push("Promise executor");
        }
      }
    },

    AwaitExpression() {
      patterns.push("await");
    },

    TryStatement() {
      patterns.push("try/catch");
    },
  });

  // Deduplicate
  return [...new Set(patterns)];
}

// ─── Top-level await check (after parsing) ──────────────────────────────────

/**
 * checkTopLevelAwait — detects top-level await by inspecting the AST.
 *
 * In Babel's estree mode, top-level await produces an AwaitExpression
 * whose parent is the Program node (i.e., it's not inside any function body).
 */
function checkTopLevelAwait(ast: t.File, source: string): CapabilityFinding | null {
  let found = false;

  traverse(ast, {
    AwaitExpression(path) {
      // Walk up the parent chain. If we never hit a function, it's top-level.
      let current: NodePath | null = path;
      while (current) {
        const parent = current.parent;
        if (!parent) break;
        if (
          t.isFunction(parent) ||
          t.isArrowFunctionExpression(parent)
        ) {
          found = false;
          return; // await is inside a function — not top-level
        }
        if (t.isProgram(parent)) {
          // We reached the program node without finding a function parent
          found = true;
          return;
        }
        current = current.parentPath;
      }
    },
  });

  if (!found) return null;

  // Get the line of the top-level await
  let line = 0;
  let column = 0;
  let snippet = "await ...";

  traverse(ast, {
    AwaitExpression(path) {
      if (line !== 0) return; // Only report the first one
      let current: NodePath | null = path;
      while (current) {
        const parent = current.parent;
        if (!parent) break;
        if (
          t.isFunction(parent) ||
          t.isArrowFunctionExpression(parent)
        ) {
          return;
        }
        if (t.isProgram(parent)) {
          line = path.node.loc?.start.line ?? 0;
          column = path.node.loc?.start.column ?? 0;
          snippet = nodeToSnippet(path.node, source);
          return;
        }
        current = current.parentPath;
      }
    },
  });

  return {
    severity: "error",
    code: "TOP_LEVEL_AWAIT",
    message:
      "Top-level `await` is not supported. `await` can only be used inside `async` functions.\n\nWrap your code in an async function:\n\n    async function main() {\n      // your code here\n    }\n    main();",
    line,
    column,
    snippet,
  };
}

// ─── Main exported function ──────────────────────────────────────────────────

/**
 * checkCapabilities
 *
 * Parses the snippet with Babel (estree mode) and traverses the AST,
 * collecting all capability findings.
 *
 * @param code — the snippet source string
 * @returns A list of CapabilityFinding objects (may be empty)
 */
export function checkCapabilities(code: string): CapabilityFinding[] {
  let ast: t.File;
  try {
    ast = parse(code, {
      sourceType: "module",
      plugins: ["estree"],
      errorRecovery: true, // Parse what we can, don't throw on recoverable errors
    });
  } catch {
    // Babel parse failed — this shouldn't happen for valid JS,
    // but we return a parse error finding so the UI can report it.
    return [
      {
        severity: "error",
        code: "PARSE_ERROR",
        message: "Could not parse the code. Please check for syntax errors.",
        line: 0,
        column: 0,
        snippet: code.slice(0, 80),
      },
    ];
  }

  const state: TraversalState = {
    asyncDepth: 0,
    insideExecutor: false,
    atModuleTopLevel: true,
    insideFinallyHandler: false,
    finallyReturnFound: false,
    findings: [],
    executorHasForeignCall: false,
    hasTopLevelAwait: false,
    source: code,
  };

  // ── Run top-level await check first ────────────────────────────────────
  const topLevelAwaitFinding = checkTopLevelAwait(ast, code);
  if (topLevelAwaitFinding) {
    state.findings.push(topLevelAwaitFinding);
  }

  // ── Main traversal ───────────────────────────────────────────────────────
  traverse(ast, {
    // Track async function depth
    enter(path) {
      const node = path.node;
      const loc = node.loc;

      // Helper to push a finding
      const fail = (code: string, message: string, snippet: string, severity: "error" | "warning" = "warning") => {
        state.findings.push({
          severity,
          code,
          message,
          line: loc?.start.line ?? 0,
          column: loc?.start.column ?? 0,
          snippet,
        });
      };

      // Check and track async function depth
      if (
        t.isFunctionDeclaration(node) ||
        t.isFunctionExpression(node) ||
        t.isArrowFunctionExpression(node)
      ) {
        const fn = node;

        // async function* — not supported (generators in general)
        if (fn.async && fn.generator) {
          fail(
            "ASYNC_GENERATOR_NOT_SUPPORTED",
            "Async generators (async function*) are not supported in M1. This tool focuses on Promise/async-await patterns. Consider using a regular async function instead.",
            nodeToSnippet(node, state.source),
            "error",
          );
          return; // Don't increment depth for unsupported patterns
        }

        if (!fn.async) return;

        state.asyncDepth++;

        // Warn if nested beyond 2 levels
        if (state.asyncDepth > 2) {
          fail(
            "DEEP_NESTING",
            `Nested async functions beyond 2 levels of depth are detected (current depth: ${state.asyncDepth}). Visualization of deeply nested async calls may be incomplete.`,
            nodeToSnippet(node, state.source),
          );
        }
      }

      // Promise executor — mark the scope
      if (
        t.isFunctionExpression(node) &&
        t.isNewExpression(path.parent) &&
        t.isIdentifier(path.parent.callee, { name: "Promise" }) &&
        path.parent.arguments[0] === node
      ) {
        state.insideExecutor = true;
        state.executorHasForeignCall = false;
      }

      // .finally() handler body
      if (
        (t.isFunctionExpression(node) || t.isArrowFunctionExpression(node)) &&
        t.isCallExpression(path.parent) &&
        t.isMemberExpression(path.parent.callee) &&
        t.isIdentifier(path.parent.callee.property, { name: "finally" })
      ) {
        state.insideFinallyHandler = true;
      }
    },

    exit(path) {
      const node = path.node;

      // Exit async function — decrement depth
      if (
        (t.isFunctionDeclaration(node) ||
          t.isFunctionExpression(node) ||
          t.isArrowFunctionExpression(node)) &&
        (node as t.Function).async &&
        !(node as t.Function).generator // Don't decrement for unsupported patterns
      ) {
        state.asyncDepth = Math.max(0, state.asyncDepth - 1);
      }

      // Exit Promise executor
      if (
        t.isFunctionExpression(node) &&
        t.isNewExpression(path.parent) &&
        t.isIdentifier(path.parent.callee, { name: "Promise" }) &&
        path.parent.arguments[0] === node
      ) {
        // Check if the executor had foreign calls
        if (state.executorHasForeignCall) {
          // Find the NewExpression node for the snippet
          state.findings.push({
            severity: "error",
            code: "FOREIGN_CALLBACK_IN_EXECUTOR",
            message:
              "The Promise executor calls a function other than resolve() or reject(). The app cannot trace execution inside external callbacks.\n\nOnly direct resolve() / reject() calls are supported inside Promise executors.",
            line: path.parent.loc?.start.line ?? 0,
            column: path.parent.loc?.start.column ?? 0,
            snippet: nodeToSnippet(path.parent, state.source),
          });
        }
        state.insideExecutor = false;
        state.executorHasForeignCall = false;
      }

      // Exit .finally() handler
      if (
        (t.isFunctionExpression(node) || t.isArrowFunctionExpression(node)) &&
        t.isCallExpression(path.parent) &&
        t.isMemberExpression(path.parent.callee) &&
        t.isIdentifier(path.parent.callee.property, { name: "finally" })
      ) {
        state.insideFinallyHandler = false;
      }

      // ── Run checks at each node ──────────────────────────────────────
      checkUnsupportedCalls(path, state);
      checkPromiseCombinators(path, state);
      checkPromiseChain(path, state);
      checkSelfReferentialPromise(path, state);
      const finallyFinding = checkFinallyReturn(path, state.source);
      if (finallyFinding) state.findings.push(finallyFinding);
    },
  });

  // ── Detect supported patterns (separate pass) ───────────────────────────
  // (done separately to avoid double-counting in the state machine)

  return state.findings;
}

/**
 * detectSupportedPatternsExport — wraps the internal detectSupportedPatterns
 * for external use (exported so validator.ts can use it).
 */
export { detectSupportedPatterns };
