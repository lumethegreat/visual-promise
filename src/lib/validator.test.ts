/**
 * Visual Promise — Validator Tests
 * ==================================
 *
 * Basic unit tests for the snippet validator.
 * Tests the happy path, all error cases, and warning cases from the
 * capability matrix.
 */

import { describe, it, expect } from "vitest";
import { validateSnippet } from "./validator";

describe("validateSnippet", () => {
  // ── Supported snippets → ok ───────────────────────────────────────────────

  it("returns ok for a fully supported snippet: Promise.resolve + .then", () => {
    const result = validateSnippet(`
      Promise.resolve(42)
        .then(x => x + 1)
        .then(console.log);
    `);
    expect(result.level).toBe("ok");
    expect(result.messages).toHaveLength(0);
    expect(result.supportedPatterns).toContain("Promise.resolve");
    expect(result.supportedPatterns).toContain(".then()");
  });

  it("returns ok for a simple async function", () => {
    const result = validateSnippet(`
      async function greet() {
        const x = await Promise.resolve(1);
        console.log(x);
        return x + 1;
      }
    `);
    expect(result.level).toBe("ok");
    expect(result.messages).toHaveLength(0);
    expect(result.category).toBe("async-function");
  });

  it("returns ok for a new Promise with sync executor", () => {
    const result = validateSnippet(`
      new Promise((resolve, reject) => {
        resolve(5);
      }).then(console.log);
    `);
    expect(result.level).toBe("ok");
    expect(result.messages).toHaveLength(0);
    expect(result.category).toBe("manual-promise");
  });

  it("returns ok for try/catch/finally with await", () => {
    const result = validateSnippet(`
      async function f() {
        try {
          await Promise.resolve(1);
        } catch (e) {
          console.error(e);
        } finally {
          console.log("done");
        }
      }
    `);
    expect(result.level).toBe("ok");
    expect(result.messages).toHaveLength(0);
    expect(result.supportedPatterns).toContain("try/catch");
  });

  it("returns ok for .catch() on a rejected promise", () => {
    const result = validateSnippet(`
      Promise.reject(new Error("boom"))
        .catch(err => console.log(err.message));
    `);
    expect(result.level).toBe("ok");
    expect(result.messages).toHaveLength(0);
    expect(result.category).toBe("promise-chain");
  });

  it("returns ok for .finally() with no return", () => {
    const result = validateSnippet(`
      Promise.resolve(1).finally(() => console.log("cleanup"));
    `);
    expect(result.level).toBe("ok");
    expect(result.messages).toHaveLength(0);
    expect(result.supportedPatterns).toContain(".finally()");
  });

  it("returns ok for a chained promise chain", () => {
    const result = validateSnippet(`
      Promise.resolve(1)
        .then(x => x * 2)
        .then(x => x + 10)
        .catch(err => -1)
        .finally(() => console.log("done"));
    `);
    expect(result.level).toBe("ok");
    expect(result.messages).toHaveLength(0);
  });

  // ── Errors → blocked ──────────────────────────────────────────────────────

  it("returns error for setTimeout", () => {
    const result = validateSnippet(`setTimeout(() => console.log("later"), 100);`);
    expect(result.level).toBe("error");
    expect(result.messages.length).toBeGreaterThan(0);
    expect(result.messages[0]?.code).toBe("TIMER_NOT_SUPPORTED");
    expect(result.messages[0]?.snippet?.toLowerCase()).toContain("settimeout");
  });

  it("returns error for setInterval", () => {
    const result = validateSnippet(`setInterval(() => {}, 100);`);
    expect(result.level).toBe("error");
    expect(result.messages[0]?.code).toBe("TIMER_NOT_SUPPORTED");
  });

  it("returns error for requestAnimationFrame", () => {
    const result = validateSnippet(`requestAnimationFrame(() => {});`);
    expect(result.level).toBe("error");
    expect(result.messages[0]?.code).toBe("TIMER_NOT_SUPPORTED");
  });

  it("returns error for fetch", () => {
    const result = validateSnippet(`fetch("https://example.com");`);
    expect(result.level).toBe("error");
    expect(result.messages[0]?.code).toBe("NETWORK_NOT_SUPPORTED");
  });

  it("returns error for XMLHttpRequest", () => {
    const result = validateSnippet(`new XMLHttpRequest();`);
    expect(result.level).toBe("error");
    expect(result.messages[0]?.code).toBe("NETWORK_NOT_SUPPORTED");
  });

  it("returns error for import statement", () => {
    const result = validateSnippet(`import { readFile } from "fs/promises";`);
    expect(result.level).toBe("error");
    expect(result.messages[0]?.code).toBe("IMPORT_EXPORT_NOT_SUPPORTED");
  });

  it("returns error for export statement", () => {
    const result = validateSnippet(`export const x = 1;`);
    expect(result.level).toBe("error");
    expect(result.messages[0]?.code).toBe("IMPORT_EXPORT_NOT_SUPPORTED");
  });

  it("returns error for require()", () => {
    const result = validateSnippet(`const fs = require("fs");`);
    expect(result.level).toBe("error");
    expect(result.messages[0]?.code).toBe("IMPORT_EXPORT_NOT_SUPPORTED");
  });

  it("returns error for Promise.all", () => {
    const result = validateSnippet(`Promise.all([p, q]);`);
    expect(result.level).toBe("error");
    expect(result.messages[0]?.code).toBe("PROMISE_COMBINATOR_NOT_SUPPORTED");
    expect(result.messages[0]?.snippet?.toLowerCase()).toContain("promise.all");
  });

  it("returns error for Promise.race", () => {
    const result = validateSnippet(`Promise.race([p, q]);`);
    expect(result.level).toBe("error");
    expect(result.messages[0]?.code).toBe("PROMISE_COMBINATOR_NOT_SUPPORTED");
  });

  it("returns error for Promise.allSettled", () => {
    const result = validateSnippet(`Promise.allSettled([p, q]);`);
    expect(result.level).toBe("error");
    expect(result.messages[0]?.code).toBe("PROMISE_COMBINATOR_NOT_SUPPORTED");
  });

  it("returns error for Promise.any", () => {
    const result = validateSnippet(`Promise.any([p, q]);`);
    expect(result.level).toBe("error");
    expect(result.messages[0]?.code).toBe("PROMISE_COMBINATOR_NOT_SUPPORTED");
  });

  it("returns error for top-level await", () => {
    const result = validateSnippet(`const x = await Promise.resolve(1);`);
    expect(result.level).toBe("error");
    expect(result.messages[0]?.code).toBe("TOP_LEVEL_AWAIT");
  });

  it("returns error for document API", () => {
    const result = validateSnippet(`document.getElementById("app");`);
    expect(result.level).toBe("error");
    expect(result.messages[0]?.code).toBe("DOM_NOT_SUPPORTED");
  });

  it("returns error for window API", () => {
    const result = validateSnippet(`window.alert("hello");`);
    expect(result.level).toBe("error");
    expect(result.messages[0]?.code).toBe("DOM_NOT_SUPPORTED");
  });

  it("returns error for eval()", () => {
    const result = validateSnippet(`eval("console.log(1)");`);
    expect(result.level).toBe("error");
    expect(result.messages[0]?.code).toBe("META_PROGRAMMING_NOT_SUPPORTED");
  });

  it("returns error for new Function()", () => {
    const result = validateSnippet(`new Function("return 1")();`);
    expect(result.level).toBe("error");
    expect(result.messages[0]?.code).toBe("META_PROGRAMMING_NOT_SUPPORTED");
  });

  it("returns error for async generators (yield)", () => {
    const result = validateSnippet(`async function* f() { yield 1; }`);
    expect(result.level).toBe("error");
    // Async generators are flagged as unsupported via TIMER_NOT_SUPPORTED
    // or another path — the key is they're blocked
    expect(result.level).toBe("error");
  });

  it("returns error for self-referential promise resolve(resolve)", () => {
    const result = validateSnippet(`
      new Promise(resolve => resolve(resolve));
    `);
    expect(result.level).toBe("error");
    expect(result.messages[0]?.code).toBe("SELF_REFERENTIAL_PROMISE");
  });

  it("blocks execution when setTimeout is inside Promise executor", () => {
    const result = validateSnippet(`
      new Promise((resolve) => {
        setTimeout(() => resolve(1), 0);
      });
    `);
    expect(result.level).toBe("error");
    expect(result.messages.some((m) => m.code === "TIMER_NOT_SUPPORTED")).toBe(true);
  });

  // ── Warnings → partial support ─────────────────────────────────────────────

  it("returns warning for nested async 3 levels deep", () => {
    const result = validateSnippet(`
      async function outer() {
        async function middle() {
          async function inner() {
            await Promise.resolve(1);
          }
          await inner();
        }
        await middle();
      }
    `);
    expect(result.level).toBe("warning");
    expect(result.messages.some((m) => m.code === "DEEP_NESTING")).toBe(true);
    expect(result.messages.some((m) => m.level === "warning")).toBe(true);
  });

  it("returns warning for async handler passed to .then()", () => {
    const result = validateSnippet(`
      Promise.resolve(1).then(async (x) => {
        await someCall(x);
        return x + 1;
      });
    `);
    expect(result.level).toBe("warning");
    expect(result.messages.some((m) => m.code === "ASYNC_HANDLER_PARTIAL")).toBe(true);
  });

  it("returns warning for async handler in .catch()", () => {
    const result = validateSnippet(`
      Promise.reject(1).catch(async (err) => {
        await log(err);
        return -1;
      });
    `);
    expect(result.level).toBe("warning");
    expect(result.messages.some((m) => m.code === "ASYNC_HANDLER_PARTIAL")).toBe(
      true,
    );
  });

  it("returns warning for return inside .finally() handler", () => {
    const result = validateSnippet(`
      Promise.resolve(1).finally(() => {
        return 42; // ← this return is flagged
      });
    `);
    expect(result.level).toBe("warning");
    expect(result.messages.some((m) => m.code === "FINALLY_RETURN")).toBe(true);
  });

  // ── Category classification ──────────────────────────────────────────────

  it("classifies 'static-factory' for Promise.resolve alone", () => {
    const result = validateSnippet(`Promise.resolve(42);`);
    expect(result.category).toBe("static-factory");
  });

  it("classifies 'async-function' for async function declarations", () => {
    const result = validateSnippet(`async function f() { await Promise.resolve(1); }`);
    expect(result.category).toBe("async-function");
  });

  it("classifies 'manual-promise' for new Promise with sync executor", () => {
    const result = validateSnippet(`new Promise((resolve) => resolve(1));`);
    expect(result.category).toBe("manual-promise");
  });

  it("classifies 'promise-chain' for .then() chains", () => {
    const result = validateSnippet(`Promise.resolve(1).then(x => x).then(x => x);`);
    expect(result.category).toBe("promise-chain");
  });

  it("classifies 'empty' for blank or trivial input", () => {
    const result = validateSnippet(`   `);
    expect(result.category).toBe("empty");
    expect(result.level).toBe("ok");
  });

  it("classifies 'mixed' for snippets that don't fit a single category", () => {
    // A truly "mixed" snippet: uses a bare variable and a promise chain
    // that don't match any single primary category
    const result = validateSnippet(`
      const x = Promise.resolve(1);
      const y = 42;
      console.log(x, y);
    `);
    expect(result.category).toBe("mixed");
  });

  // ── Location info ─────────────────────────────────────────────────────────

  it("includes line and column in error messages", () => {
    const result = validateSnippet(`
      setTimeout(() => {}, 100);
    `);
    const msg = result.messages[0];
    expect(msg?.line).toBeGreaterThan(0);
    expect(msg?.column).toBeGreaterThanOrEqual(0);
    expect(msg?.snippet).toBeTruthy();
  });

  it("includes location for top-level await error", () => {
    const result = validateSnippet(`const x = await Promise.resolve(1);`);
    expect(result.messages[0]?.line).toBe(1);
    expect(result.messages[0]?.code).toBe("TOP_LEVEL_AWAIT");
  });

  // ── Multiple findings ─────────────────────────────────────────────────────

  it("reports multiple errors when multiple unsupported patterns are present", () => {
    const result = validateSnippet(`
      import { foo } from "bar";
      setTimeout(() => {}, 100);
      await Promise.resolve(1);
    `);
    const errorMessages = result.messages.filter((m) => m.level === "error");
    expect(errorMessages.length).toBeGreaterThanOrEqual(2);
    expect(result.level).toBe("error");
  });

  it("can have both errors and warnings in the same snippet", () => {
    const result = validateSnippet(`
      setTimeout(() => {}, 100);
      Promise.resolve(1).then(async (x) => { await foo(); });
    `);
    expect(result.messages.some((m) => m.level === "error")).toBe(true);
    expect(result.messages.some((m) => m.level === "warning")).toBe(true);
    expect(result.level).toBe("error"); // errors take precedence
  });

  // ── Pattern tracking ─────────────────────────────────────────────────────

  it("populates supportedPatterns", () => {
    const result = validateSnippet(`
      async function f() {
        const x = await Promise.resolve(1);
        console.log(x);
        return x;
      }
    `);
    expect(result.supportedPatterns).toContain("async function");
    expect(result.supportedPatterns).toContain("await");
    expect(result.supportedPatterns).toContain("Promise.resolve");
    expect(result.supportedPatterns).toContain("console.log");
  });

  it("populates unsupportedPatterns", () => {
    const result = validateSnippet(`setTimeout(() => {}, 100);`);
    expect(result.unsupportedPatterns).toContain("TIMER_NOT_SUPPORTED");
  });

  it("populates partialPatterns", () => {
    const result = validateSnippet(`Promise.resolve(1).then(async (x) => { await foo(); });`);
    expect(result.partialPatterns).toContain("ASYNC_HANDLER_PARTIAL");
  });
});
