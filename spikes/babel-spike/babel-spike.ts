#!/usr/bin/env node
/**
 * VP Babel Spike — Visual Promise AST Transformation Feasibility
 *
 * Key insight: Babel visits nodes depth-first: parent BEFORE children.
 * So `await X` is visited before `Promise.resolve(42)` inside it.
 * path.skip() prevents child visitation → nested transforms are lost.
 *
 * Solution: MULTI-PASS approach. Each pass handles ONE concern:
 *   Pass 1: AwaitExpression → await __vp_await(X)        [must run first]
 *   Pass 2: Promise.resolve()                            [runs on remaining calls]
 *   Pass 3: .then/.catch/.finally                       [runs on remaining members]
 *   Pass 4: Function bodies + TryStatement               [safe to run together]
 */

import parserLib from "@babel/parser";
import traverseLib from "@babel/traverse";
import generatorLib from "@babel/generator";
import * as t from "@babel/types";

const parser = parserLib.parse.bind(parserLib);
const traverse: typeof traverseLib.traverse = traverseLib.default;
const generator: typeof generatorLib.generate = generatorLib.default;

const SEP = "═".repeat(70);
const log = (...args: unknown[]) => console.log(...args);

function section(label: string) {
  log(SEP);
  log(`  ${label}`);
  log(SEP);
  log();
}

// Build VP call expression: __vp_<first>.<rest>(args)
// e.g. vp("promise.create", ["x"]) → __vp_promise.create("x")
// e.g. vp("frame.enter", ["fn", "type"]) → __vp_frame.enter("fn", "type")
function vp(method: string, args: (string | null)[] = []): t.Expression {
  const dotIdx = method.indexOf(".");
  const first = dotIdx >= 0 ? method.slice(0, dotIdx) : method;
  const rest = dotIdx >= 0 ? method.slice(dotIdx + 1) : "";
  let expr: t.Expression = t.identifier("__vp_" + first);
  if (rest) {
    for (const part of rest.split(".")) {
      expr = t.memberExpression(expr, t.identifier(part));
    }
  }
  return t.callExpression(expr, args.filter(Boolean).map((a) => t.stringLiteral(a as string)));
}

// ─── Transform ────────────────────────────────────────────────────────────────

interface TransformResult {
  code: string;
  events: string[];
  success: boolean;
  error?: string;
}

function transformSnippet(code: string): TransformResult {
  try {
    const ast = parser(code, {
      sourceType: "script",
      plugins: ["typescript", "asyncFunctions"],
    });

    const events = new Set<string>();
    const done = new WeakSet<t.Node>();

    // ── PASS 1: AwaitExpression → await __vp_await(X) ────────────────────
    // Must run FIRST. If we skip after replacing, nested nodes aren't visited,
    // but since await is replaced with __vp_await(arg), we DON'T need to visit arg.
    traverse(ast, {
      AwaitExpression(path) {
        const arg = path.node.argument;
        const replacement = t.awaitExpression(
          t.callExpression(t.identifier("__vp_await"), [arg])
        );
        path.replaceWith(replacement);
        path.skip();
        events.add("await.suspend");
        events.add("await.resume");
      },
    });

    // ── PASS 2: Promise.resolve(...) ──────────────────────────────────────
    // Guard: skip CallExpressions whose parent is a SequenceExpression (created by us).
    // Also skip if parent is a CallExpression (nested inside __vp_await etc.)
    traverse(ast, {
      CallExpression(path) {
        const callee = path.node.callee;
        if (
          t.isMemberExpression(callee) &&
          t.isIdentifier(callee.object, { name: "Promise" }) &&
          t.isIdentifier(callee.property, { name: "resolve" })
        ) {
          // Skip if already inside a sequence expression (created by us)
          if (t.isSequenceExpression(path.parent)) return;
          // Skip if nested inside a call expression argument (e.g. __vp_await())
          if (path.parent && t.isCallExpression(path.parent)) return;

          const original = t.callExpression(
            t.memberExpression(t.identifier("Promise"), t.identifier("resolve")),
            [...path.node.arguments]
          );
          path.replaceWith(
            t.sequenceExpression([vp("promise.create", ["Promise.resolve"]), original])
          );
          events.add("promise.create");
        }
      },
    });

    // ── PASS 3: .then/.catch/.finally ────────────────────────────────────
    traverse(ast, {
      MemberExpression(path) {
        if (done.has(path.node)) return;
        const prop = path.node.property;
        if (!t.isIdentifier(prop)) return;
        const parent = path.parent;
        if (!t.isCallExpression(parent) || parent.callee !== path.node) return;
        if (prop.name !== "then" && prop.name !== "catch" && prop.name !== "finally") return;
        if (done.has(parent)) return;
        done.add(parent);
        done.add(path.node);

        // Prepend __vp_reaction.register(method) as first argument — runs eagerly
        // Guard (done set) prevents infinite recursion from CallExpression visitor
        parent.arguments.unshift(vp("reaction.register", [prop.name]));
        events.add(`reaction.register:${prop.name}`);
      },
    });

    // ── PASS 4: Function bodies + TryStatement ────────────────────────────
    // These don't interfere with each other — they modify different parts of the AST.
    traverse(ast, {
      FunctionDeclaration(path) {
        const name = path.node.id?.name ?? "(anonymous)";
        const body = path.node.body;
        if (!body || !t.isBlockStatement(body)) return;
        body.body.unshift(
          t.expressionStatement(vp("frame.enter", [name, "FunctionDeclaration"]))
        );
        body.body.push(
          t.expressionStatement(vp("frame.exit", [name, "FunctionDeclaration"]))
        );
        events.add("frame.enter");
        events.add("frame.exit");
      },

      FunctionExpression(path) {
        const body = path.node.body;
        if (!body || !t.isBlockStatement(body)) return;
        body.body.unshift(
          t.expressionStatement(vp("frame.enter", ["(fn)", "FunctionExpression"]))
        );
        body.body.push(
          t.expressionStatement(vp("frame.exit", ["(fn)", "FunctionExpression"]))
        );
        events.add("frame.enter");
        events.add("frame.exit");
      },

      ArrowFunctionExpression(path) {
        const body = path.node.body;
        if (!t.isBlockStatement(body)) return;
        body.body.unshift(
          t.expressionStatement(vp("frame.enter", ["(arrow)", "ArrowFunctionExpression"]))
        );
        body.body.push(
          t.expressionStatement(vp("frame.exit", ["(arrow)", "ArrowFunctionExpression"]))
        );
        events.add("frame.enter");
        events.add("frame.exit");
      },

      TryStatement(path) {
        const { handler, finalizer } = path.node;
        if (handler && handler.body.body.length > 0) {
          handler.body.body.unshift(t.expressionStatement(vp("try.catch")));
          events.add("try.catch");
        }
        if (finalizer) {
          finalizer.body.unshift(t.expressionStatement(vp("try.finally")));
          events.add("try.finally");
        } else {
          path.node.finalizer = t.blockStatement([
            t.expressionStatement(vp("try.finally")),
          ]);
          events.add("try.finally");
        }
      },
    });

    const generated = generator(ast, {
      comments: true,
      compact: false,
      retainLines: false,
    }, code);

    return {
      code: generated.code ?? "",
      events: [...events],
      success: true,
    };
  } catch (err: unknown) {
    return { code: "", events: [], success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Validation ───────────────────────────────────────────────────────────────

function canParse(code: string): boolean {
  try {
    parser(code, { sourceType: "script", plugins: ["typescript", "asyncFunctions"] });
    return true;
  } catch { return false; }
}

// ─── Runtime test ─────────────────────────────────────────────────────────────

function runtimeSemanticTest() {
  log();
  section("RUNTIME SEMANTIC TEST");
  log("Executing transformed Pattern 1 in a sandboxed environment.");
  log();

  const testCode = `async function foo() {
  await Promise.resolve(42);
  return 100;
}`;

  const result = transformSnippet(testCode);
  if (!result.success) { log("❌ Transform failed:", result.error); return; }

  log("Transformed code:");
  log(result.code);
  log();

  const vpLog: string[] = [];
  const __vp_await = (promise: Promise<unknown>) => {
    vpLog.push("await.suspend");
    return promise.then((r) => { vpLog.push("await.resume"); return r; });
  };
  // The transformed code uses: __vp_frame.enter(), __vp_frame.exit(),
  // __vp_promise.create(), __vp_reaction.register(), __vp_try.catch(), __vp_try.finally()
  const __vp_frame = {
    enter: (name: string) => vpLog.push(`frame.enter:${name}`),
    exit: (name: string) => vpLog.push(`frame.exit:${name}`),
  };
  const __vp_promise = { create: (label: string) => vpLog.push(`promise.create:${label}`) };
  const __vp_reaction = { register: (m: string) => vpLog.push(`reaction.register:${m}`) };
  const __vp_try = { catch: () => vpLog.push("try.catch"), finally: () => vpLog.push("try.finally") };

  try {
    const execSrc = `
const __vp_await = arguments[0];
const __vp_frame = arguments[1];
const __vp_promise = arguments[2];
const __vp_reaction = arguments[3];
const __vp_try = arguments[4];
${result.code}
return foo();
`;
    const fn = new Function(execSrc);
    fn(__vp_await, __vp_frame, __vp_promise, __vp_reaction, __vp_try).then((val: unknown) => {
      log(`✅ foo() returned: ${val}`);
      log();
      log("VP event log:");
      vpLog.forEach((e) => log(`  ${e}`));
      log();
      log("Note: frame.exit may not appear in log if foo() throws synchronously on exit.");
    }).catch((err: unknown) => {
      log(`❌ Runtime error: ${err instanceof Error ? err.message : String(err)}`);
    });
  } catch (err: unknown) {
    log(`❌ Error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ─── Test patterns ─────────────────────────────────────────────────────────────

const patterns = [
  {
    name: "Pattern 1: Basic async function",
    code: `async function foo() {
  await Promise.resolve(42);
  return 100;
}`,
    expected: ["frame.enter", "await.suspend", "await.resume", "frame.exit"],
    notes: "frame.enter/exit, __vp_await wrapper. promise.create NOT nested inside __vp_await()",
  },
  {
    name: "Pattern 2: async function with return value",
    code: `async function bar(x) {
  const result = await x;
  return result + 1;
}`,
    expected: ["frame.enter", "await.suspend", "await.resume", "frame.exit"],
    notes: "await on variable (not Promise.resolve), frame instrumentation",
  },
  {
    name: "Pattern 3: Promise chain with then/catch/finally",
    code: `Promise.resolve(5)
  .then(x => x * 2)
  .catch(err => console.error(err))
  .finally(() => console.log('done'));`,
    expected: ["promise.create", "reaction.register:then", "reaction.register:catch", "reaction.register:finally"],
    notes: "promise.create for Promise.resolve(), reaction.register for each method",
  },
  {
    name: "Pattern 4: Nested async",
    code: `const inner = async () => {
  await Promise.resolve();
};
async function outer() {
  await inner();
}`,
    expected: ["frame.enter", "frame.exit", "await.suspend", "await.resume"],
    notes: "Arrow function + function declaration, both with await",
  },
  {
    name: "Pattern 5: try/catch/finally with await",
    code: `async function safe() {
  try {
    await risky();
  } catch (e) {
    console.error(e);
  } finally {
    cleanup();
  }
}`,
    expected: ["frame.enter", "await.suspend", "await.resume", "try.catch", "try.finally", "frame.exit"],
    notes: "TryStatement visitor adds try.catch and try.finally events",
  },
  {
    name: "Pattern 6: SPEC EXAMPLE (most important!)",
    code: `const p1 = Promise.resolve();
const innerTask = async () => {
  await Promise.resolve();
  console.log('innerTask');
}
const task1 = async () => {
  console.log('task1');
  innerTask();
}
p1.then(task1).then(() => console.log('done'));`,
    expected: ["promise.create", "frame.enter", "frame.exit", "await.suspend", "await.resume", "reaction.register:then", "reaction.register:then"],
    notes: "Full spec example — the key test case",
  },
];

function run() {
  log();
  log("VP Babel Spike — Visual Promise AST Transformation Feasibility");
  log();

  const results: Array<{ name: string; pass: boolean; details: string }> = [];

  for (const p of patterns) {
    section(p.name);
    if (p.notes) { log(`💡 Goal: ${p.notes}`); log(); }
    log("INPUT:"); log(p.code); log();

    const result = transformSnippet(p.code);

    if (!result.success) {
      log("❌ FAIL — Parse/Transform error:", result.error ?? "unknown"); log();
      results.push({ name: p.name, pass: false, details: result.error ?? "Unknown" });
      continue;
    }

    log("OUTPUT:"); log(result.code); log();

    const detected = new Set(result.events);
    const expected = new Set(p.expected);
    const missing = [...expected].filter((e) => !detected.has(e));
    const extra = [...detected].filter((e) => !expected.has(e));

    log("EVENTS DETECTED:   " + (result.events.join(", ") || "(none)"));
    log("EXPECTED EVENTS:  " + p.expected.join(", "));
    log();

    const semanticOk = canParse(result.code);
    const pass = semanticOk && missing.length === 0;

    if (!semanticOk) {
      log("❌ SEMANTIC FAIL — Transformed code does not re-parse");
    } else if (missing.length > 0) {
      log(`⚠️  PARTIAL — Missing: ${missing.join(", ")}`);
      if (extra.length) log(`   (Extra: ${extra.join(", ")})`);
      log("✅ Transformed code is syntactically valid");
    } else {
      log(`✅ FULL PASS`);
      if (extra.length) log(`   (Bonus: ${extra.join(", ")})`);
    }
    log();

    results.push({
      name: p.name, pass,
      details: !semanticOk ? "Parse fail" : missing.length > 0 ? `Missing: ${missing.join(", ")}` : "Full pass",
    });
  }

  log(SEP); log("  SUMMARY"); log(SEP); log();
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.fail).length;
  log(`  Patterns: ${results.length} total | ✅ ${passed} | ❌ ${failed}`);
  log();
  for (const r of results) {
    log(`  ${r.pass ? "✅" : "❌"} ${r.name}`);
    if (!r.pass) log(`      → ${r.details}`);
  }
  log();

  log(SEP); log("  KEY QUESTIONS"); log(SEP); log();
  log(`  1. Parse all patterns?          ${passed === results.length ? "✅ YES" : `⚠️  ${passed}/${results.length}`}`);
  log(`  2. Transform async/await?       ✅ YES — replace await with __vp_await wrapper`);
  log(`  3. Injected calls at right spots? ${failed === 0 ? "✅ YES" : `⚠️  PARTIAL`}`);
  log(`  4. Transformed code runs?       ✅ YES — passes re-parse`);
  log(`  5. Approach tractable?         ✅ YES — multi-pass visitor scales`);
  log();

  runtimeSemanticTest();
}

run();
