import traverse from '@babel/traverse';
import * as t from '@babel/types';
import type { DatasetCaseId } from '../engine/dataset/expected';
import { parseJs } from './ast';
import {
  isAwaitPromiseResolve,
  isCallExprStmt,
  isConsoleLogExpr,
  isPromiseResolveCall,
  isPromiseResolveThenChainExpr,
} from './matchers';

export type IdentifyResult =
  | { ok: true; caseId: DatasetCaseId }
  | { ok: false; reason: string };

function getBodyStmts(fnBody: t.BlockStatement | t.Expression): t.Statement[] {
  if (t.isBlockStatement(fnBody)) return fnBody.body;
  // arrow expr bodies don't appear in dataset cases we detect (except inner), but keep safe
  return [t.expressionStatement(fnBody as t.Expression)];
}

export function identifyDatasetCase(code: string): IdentifyResult {
  const ast = parseJs(code);

  // Collect top-level statements, plus some function defs.
  const programBody = ast.program.body;

  const asyncFnDecls = new Map<string, t.FunctionDeclaration>();
  const asyncArrowDecls = new Map<string, t.ArrowFunctionExpression>();

  for (const stmt of programBody) {
    if (t.isFunctionDeclaration(stmt) && stmt.id?.name && stmt.async) {
      asyncFnDecls.set(stmt.id.name, stmt);
    }

    // const inner = async () => {...}
    if (t.isVariableDeclaration(stmt)) {
      for (const d of stmt.declarations) {
        if (!t.isIdentifier(d.id)) continue;
        if (!d.init || !t.isArrowFunctionExpression(d.init)) continue;
        if (!d.init.async) continue;
        asyncArrowDecls.set(d.id.name, d.init);
      }
    }
  }

  const hasCallExample = programBody.some((s) => isCallExprStmt(s as t.Statement, 'example'));
  const hasCallF = programBody.some((s) => isCallExprStmt(s as t.Statement, 'f'));

  // Detect Promise.resolve().then(...).then(...) that may be split across lines.
  // In Babel AST, that becomes multiple ExpressionStatements, where only the LAST one
  // is a CallExpression (because of the leading-dot chaining).
  const promiseResolveThenStmts = programBody
    .flatMap((s) => {
      if (!t.isExpressionStatement(s)) return [];
      const e = s.expression;
      if (t.isSequenceExpression(e)) return e.expressions;
      return [e];
    })
    .filter((e): e is t.Expression => !!e)
    .filter((e) => isPromiseResolveThenChainExpr(e));

  // CASE 1
  {
    const fn = asyncFnDecls.get('example');
    if (fn && hasCallExample) {
      const b = fn.body.body;
      const ok =
        b.length === 4 &&
        t.isExpressionStatement(b[0]) &&
        isConsoleLogExpr(b[0].expression, 'start') &&
        isAwaitPromiseResolve(b[1], 42) &&
        t.isExpressionStatement(b[2]) &&
        // console.log(result)
        t.isCallExpression(b[2].expression) &&
        t.isMemberExpression(b[2].expression.callee) &&
        t.isIdentifier(b[2].expression.callee.object, { name: 'console' }) &&
        t.isIdentifier(b[2].expression.callee.property, { name: 'log' }) &&
        t.isReturnStatement(b[3]);

      if (ok) return { ok: true, caseId: 1 };
    }
  }

  // CASE 2
  {
    const fn = asyncFnDecls.get('example');
    const hasPromiseResolveThenB = programBody.some((s) => {
      if (!t.isExpressionStatement(s)) return false;
      const e = s.expression;
      if (!t.isCallExpression(e)) return false;
      if (!t.isMemberExpression(e.callee)) return false;
      if (!t.isIdentifier(e.callee.property, { name: 'then' })) return false;
      if (!t.isCallExpression(e.callee.object)) return false;
      if (!isPromiseResolveCall(e.callee.object)) return false;
      // then(() => console.log("B"))
      if (e.arguments.length !== 1) return false;
      const cb = e.arguments[0];
      if (!t.isArrowFunctionExpression(cb)) return false;
      const cbStmts = getBodyStmts(cb.body);
      return cbStmts.length === 1 && t.isExpressionStatement(cbStmts[0]) && isConsoleLogExpr(cbStmts[0].expression, 'B');
    });

    if (fn && hasCallExample && hasPromiseResolveThenB) {
      const b = fn.body.body;
      const ok =
        b.length === 2 &&
        isAwaitPromiseResolve(b[0]) &&
        t.isExpressionStatement(b[1]) &&
        isConsoleLogExpr(b[1].expression, 'A');
      if (ok) return { ok: true, caseId: 2 };
    }
  }

  // CASE 5
  {
    const fn = asyncFnDecls.get('f');
    if (fn && hasCallF) {
      const b = fn.body.body;
      const ok =
        b.length === 5 &&
        t.isExpressionStatement(b[0]) &&
        isConsoleLogExpr(b[0].expression, 'A') &&
        isAwaitPromiseResolve(b[1]) &&
        t.isExpressionStatement(b[2]) &&
        isConsoleLogExpr(b[2].expression, 'B') &&
        isAwaitPromiseResolve(b[3]) &&
        t.isExpressionStatement(b[4]) &&
        isConsoleLogExpr(b[4].expression, 'C');
      if (ok) return { ok: true, caseId: 5 };
    }
  }

  // CASE 3 / 4 (then chain)
  {
    // we expect exactly one Promise.resolve().then(...).then(...)
    if (promiseResolveThenStmts.length === 1) {
      const chain = promiseResolveThenStmts[0];
      // Walk chain calls from rightmost to leftmost, gather handlers.
      const handlers: t.Expression[] = [];
      let cur: t.Expression = chain;
      while (t.isCallExpression(cur) && t.isMemberExpression(cur.callee) && t.isIdentifier(cur.callee.property, { name: 'then' })) {
        handlers.push(cur.arguments[0] as t.Expression);
        cur = cur.callee.object as t.Expression;
      }
      handlers.reverse();

      const has2 = handlers.length === 2;
      if (has2) {
        const h1 = handlers[0];
        const h2 = handlers[1];

        const isLogA = (h: t.Expression) => {
          if (!t.isArrowFunctionExpression(h) && !t.isFunctionExpression(h)) return false;
          const stmts = getBodyStmts(h.body);
          return stmts.length === 1 && t.isExpressionStatement(stmts[0]) && isConsoleLogExpr(stmts[0].expression, 'A');
        };
        const isLogB = (h: t.Expression) => {
          if (!t.isArrowFunctionExpression(h) && !t.isFunctionExpression(h)) return false;
          const stmts = getBodyStmts(h.body);
          return stmts.length === 1 && t.isExpressionStatement(stmts[0]) && isConsoleLogExpr(stmts[0].expression, 'B');
        };

        if (isLogA(h1) && isLogB(h2)) {
          const h1Async = (t.isArrowFunctionExpression(h1) || t.isFunctionExpression(h1)) && !!h1.async;
          return { ok: true, caseId: h1Async ? 4 : 3 };
        }
      }
    }
  }

  // CASE 6 (inner async + then(async()=>inner()) + then(console.log("Y")))
  {
    const inner = asyncArrowDecls.get('inner');
    if (inner && promiseResolveThenStmts.length === 1) {
      const b = getBodyStmts(inner.body);
      const innerOk =
        b.length === 2 &&
        isAwaitPromiseResolve(b[0]) &&
        t.isExpressionStatement(b[1]) &&
        isConsoleLogExpr(b[1].expression, 'X');

      if (innerOk) {
        const chain = promiseResolveThenStmts[0];
        // parse handlers
        const handlers: t.Expression[] = [];
        let cur: t.Expression = chain;
        while (t.isCallExpression(cur) && t.isMemberExpression(cur.callee) && t.isIdentifier(cur.callee.property, { name: 'then' })) {
          handlers.push(cur.arguments[0] as t.Expression);
          cur = cur.callee.object as t.Expression;
        }
        handlers.reverse();

        if (handlers.length === 2) {
          const h1 = handlers[0];
          const h2 = handlers[1];

          const h2Ok =
            (t.isArrowFunctionExpression(h2) || t.isFunctionExpression(h2)) &&
            getBodyStmts(h2.body).length === 1 &&
            t.isExpressionStatement(getBodyStmts(h2.body)[0]) &&
            isConsoleLogExpr((getBodyStmts(h2.body)[0] as t.ExpressionStatement).expression, 'Y');

          const h1Ok =
            (t.isArrowFunctionExpression(h1) || t.isFunctionExpression(h1)) &&
            !!h1.async &&
            (() => {
              const s = getBodyStmts(h1.body);
              return s.length === 1 && isCallExprStmt(s[0], 'inner');
            })();

          if (h1Ok && h2Ok) return { ok: true, caseId: 6 };
        }
      }
    }
  }

  // Fallback
  return {
    ok: false,
    reason:
      'Não reconheci este snippet como nenhum dos 6 casos do dataset (modo P2.1).',
  };
}
