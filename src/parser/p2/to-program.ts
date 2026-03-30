import * as t from '@babel/types';
import type { Program as P1Program, FunctionDef, Instr, EnqueueSpec } from '../../engine/p1/types';
import { parseJs } from '../ast';
import { isConsoleLogExpr, isPromiseRejectCall, isPromiseResolveCall } from '../matchers';

type ChainStage =
  | { kind: 'then'; handler: t.Expression }
  | { kind: 'catch'; handler: t.Expression }
  | { kind: 'finally'; handler: t.Expression };

function reaction(
  label: string,
  trigger: 'fulfilled' | 'rejected',
  handlers: { onFulfilledHandler?: string; onRejectedHandler?: string },
  onFulfilled: EnqueueSpec[] = [],
  onRejected: EnqueueSpec[] = []
): EnqueueSpec {
  return {
    kind: 'reaction',
    label,
    trigger,
    onFulfilledHandler: handlers.onFulfilledHandler,
    onRejectedHandler: handlers.onRejectedHandler,
    onFulfilled,
    onRejected,
  };
}

function resolveDerived(label: string, eventText: string, onRunEnqueue: EnqueueSpec[]): EnqueueSpec {
  return { kind: 'resolveDerived', label, eventText, onRunEnqueue };
}

function textOfConsoleArg(arg: t.Expression | t.SpreadElement | t.JSXNamespacedName | t.ArgumentPlaceholder): string {
  if (t.isStringLiteral(arg)) return JSON.stringify(arg.value);
  if (t.isNumericLiteral(arg)) return String(arg.value);
  if (t.isIdentifier(arg)) return arg.name;
  return '<expr>';
}

function outputValueFromConsoleArg(arg: t.Expression | t.SpreadElement | t.JSXNamespacedName | t.ArgumentPlaceholder): string {
  if (t.isStringLiteral(arg)) return arg.value;
  if (t.isNumericLiteral(arg)) return String(arg.value);
  if (t.isIdentifier(arg)) return arg.name;
  return '<expr>';
}

function buildFunctionFromHandler(label: string, handler: t.Expression): FunctionDef {
  // Only support arrow/function expressions.
  if (!t.isArrowFunctionExpression(handler) && !t.isFunctionExpression(handler)) {
    throw new Error('Unsupported handler type (expected function): ' + handler.type);
  }

  const bodyStmts: t.Statement[] = t.isBlockStatement(handler.body)
    ? handler.body.body
    : [t.expressionStatement(handler.body)];

  const instrs: Instr[] = [];

  for (const st of bodyStmts) {
    // console.log(...)
    if (t.isExpressionStatement(st) && isConsoleLogExpr(st.expression)) {
      const call = st.expression;
      const arg0 = call.arguments[0];
      instrs.push({
        kind: 'log',
        text: `console.log(${arg0 ? textOfConsoleArg(arg0) : ''})`,
        output: arg0 ? outputValueFromConsoleArg(arg0) : '',
      });
      continue;
    }

    // throw ...
    if (t.isThrowStatement(st)) {
      instrs.push({ kind: 'throw', text: 'throw ...' });
      continue;
    }

    // ignore empty
    if (t.isEmptyStatement(st)) continue;

    throw new Error('Unsupported statement inside handler: ' + st.type);
  }

  // ensure explicit end
  instrs.push({ kind: 'end', text: 'fim', suppressSnapshot: true });

  return { label, body: instrs };
}

function unwrapChain(expr: t.Expression): { root: 'resolve' | 'reject'; stages: ChainStage[] } | null {
  // Expect something like:
  // Promise.resolve().then(...).catch(...).finally(...)
  // represented as nested CallExpressions.

  const stages: ChainStage[] = [];
  let cur: t.Expression = expr;

  while (t.isCallExpression(cur) && t.isMemberExpression(cur.callee)) {
    const prop = cur.callee.property;
    if (!t.isIdentifier(prop)) break;

    const name = prop.name;
    if (name !== 'then' && name !== 'catch' && name !== 'finally') break;

    const handler = cur.arguments[0] as t.Expression | undefined;
    if (!handler) return null;

    stages.push({ kind: name as 'then' | 'catch' | 'finally', handler });
    cur = cur.callee.object as t.Expression;
  }

  // root must be Promise.resolve(...) or Promise.reject(...)
  if (!t.isCallExpression(cur)) return null;
  if (isPromiseResolveCall(cur)) return { root: 'resolve', stages: stages.reverse() };
  if (isPromiseRejectCall(cur)) return { root: 'reject', stages: stages.reverse() };

  return null;
}

/**
 * P2.2 (subset): converte um snippet simples (Promise chains) para Program P1.
 *
 * Suporte inicial:
 * - Promise.resolve()/Promise.reject()
 * - .then(fn) / .catch(fn) / .finally(fn)
 * - handlers com console.log("...") e/ou throw
 * - async handlers (introduz resolve-derived job)
 */
export function toP1ProgramFromCode(code: string): P1Program {
  const ast = parseJs(code);

  const exprStmts = ast.program.body.filter((n): n is t.ExpressionStatement => t.isExpressionStatement(n));
  if (exprStmts.length !== 1) {
    throw new Error('P2.2: por agora só suportamos 1 expressão top-level (uma chain).');
  }

  const expr = exprStmts[0].expression;
  if (!t.isCallExpression(expr)) {
    throw new Error('P2.2: esperado CallExpression.');
  }

  const chain = unwrapChain(expr);
  if (!chain) {
    throw new Error('P2.2: snippet não reconhecido como chain Promise.resolve/reject.');
  }

  const functions: Record<string, FunctionDef> = {};

  const stageLabels = chain.stages.map((s, i) => {
    const base = s.kind === 'then' ? `then${i + 1}` : s.kind === 'catch' ? `catch${i + 1}` : `finally${i + 1}`;
    return base;
  });

  // Build function defs
  chain.stages.forEach((stage, i) => {
    const lbl = stageLabels[i];
    functions[lbl] = buildFunctionFromHandler(lbl, stage.handler);
  });

  // Build reaction specs for each stage, for both triggers
  const mkStageReaction = (i: number, trigger: 'fulfilled' | 'rejected'): EnqueueSpec => {
    const stage = chain.stages[i];
    const lbl = stageLabels[i];

    // handler selection based on stage kind
    const onFulfilledHandler = stage.kind === 'then' || stage.kind === 'finally' ? lbl : undefined;
    const onRejectedHandler = stage.kind === 'catch' || stage.kind === 'finally' ? lbl : undefined;

    const nextIfFulfilled = i + 1 < chain.stages.length ? [mkStageReaction(i + 1, 'fulfilled')] : [];
    const nextIfRejected = i + 1 < chain.stages.length ? [mkStageReaction(i + 1, 'rejected')] : [];

    // async handler: insert resolve-derived between handler completion and next stage
    const handlerIsAsync =
      (t.isArrowFunctionExpression(stage.handler) || t.isFunctionExpression(stage.handler)) && !!stage.handler.async;

    let onFulfilled: EnqueueSpec[] = nextIfFulfilled;
    if (handlerIsAsync && onFulfilledHandler) {
      onFulfilled = [
        resolveDerived(
          'resolve-derived',
          'resolve promise derivada',
          nextIfFulfilled
        ),
      ];
    }

    return reaction(
      `reaction(${lbl})`,
      trigger,
      { onFulfilledHandler, onRejectedHandler },
      onFulfilled,
      nextIfRejected
    );
  };

  const startTrigger: 'fulfilled' | 'rejected' = chain.root === 'resolve' ? 'fulfilled' : 'rejected';

  const startReaction = mkStageReaction(0, startTrigger);

  return {
    topLevel: [
      {
        kind: 'promiseThenStart',
        text: chain.root === 'resolve' ? 'Promise.resolve() chain' : 'Promise.reject() chain',
        enqueue: startReaction,
      },
    ],
    functions,
  };
}
