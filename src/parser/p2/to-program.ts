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
 * P2.2 (subset): converte um snippet para Program P1.
 *
 * v2: suporta múltiplas statements top-level (sequenciais).
 *
 * Suporte actual:
 * - Promise.resolve()/Promise.reject() chains (then/catch/finally)
 * - async function declarations + calls (sem await no topo)
 * - await Promise.resolve(...) dentro de async functions
 * - console.log("...") dentro de handlers e async functions
 * - throw dentro de handlers
 */
export function toP1ProgramFromCode(code: string): P1Program {
  const ast = parseJs(code);

  const functions: Record<string, FunctionDef> = {};
  const topLevel: P1Program['topLevel'] = [];

  let chainCounter = 0;

  const addChainFromExpr = (expr: t.Expression) => {
    const chain = unwrapChain(expr);
    if (!chain) throw new Error('P2.2: expressão não reconhecida como chain Promise.resolve/reject.');

    chainCounter += 1;
    const prefix = `c${chainCounter}`;

    const stageLabels = chain.stages.map((s, i) => {
      const base = s.kind === 'then' ? `then${i + 1}` : s.kind === 'catch' ? `catch${i + 1}` : `finally${i + 1}`;
      return `${prefix}.${base}`;
    });

    // Build function defs
    chain.stages.forEach((stage, i) => {
      const lbl = stageLabels[i];
      functions[lbl] = buildFunctionFromHandler(lbl, stage.handler);
    });

    const mkStageReaction = (i: number, trigger: 'fulfilled' | 'rejected'): EnqueueSpec => {
      const stage = chain.stages[i];
      const lbl = stageLabels[i];

      const onFulfilledHandler = stage.kind === 'then' || stage.kind === 'finally' ? lbl : undefined;
      const onRejectedHandler = stage.kind === 'catch' || stage.kind === 'finally' ? lbl : undefined;

      const nextIfFulfilled = i + 1 < chain.stages.length ? [mkStageReaction(i + 1, 'fulfilled')] : [];
      const nextIfRejected = i + 1 < chain.stages.length ? [mkStageReaction(i + 1, 'rejected')] : [];

      const handlerIsAsync =
        (t.isArrowFunctionExpression(stage.handler) || t.isFunctionExpression(stage.handler)) && !!stage.handler.async;

      let onFulfilled: EnqueueSpec[] = nextIfFulfilled;
      if (handlerIsAsync && onFulfilledHandler) {
        onFulfilled = [resolveDerived('resolve-derived', 'resolve promise derivada', nextIfFulfilled)];
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

    topLevel.push({
      kind: 'promiseThenStart',
      text: chain.root === 'resolve' ? 'Promise.resolve() chain' : 'Promise.reject() chain',
      enqueue: startReaction,
    });
  };

  const addAsyncFunctionDecl = (name: string, fn: t.FunctionDeclaration | t.ArrowFunctionExpression) => {
    if (!fn.async) return;

    const body = t.isBlockStatement(fn.body) ? fn.body.body : [t.expressionStatement(fn.body as t.Expression)];

    const instrs: Instr[] = [];
    let awaitCounter = 0;

    for (const st of body) {
      // console.log("...")
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

      // await Promise.resolve(...)
      if (t.isExpressionStatement(st) && t.isAwaitExpression(st.expression) && isPromiseResolveCall(st.expression.argument)) {
        awaitCounter += 1;
        instrs.push({
          kind: 'awaitResolved',
          text: 'await Promise.resolve()\n→ suspende função\n→ agenda continuação',
          resumeLabel: `resume(${name})#${awaitCounter}`,
        });
        continue;
      }

      // const x = await Promise.resolve(42)
      if (t.isVariableDeclaration(st) && st.declarations.length === 1) {
        const d = st.declarations[0];
        if (d.init && t.isAwaitExpression(d.init) && isPromiseResolveCall(d.init.argument)) {
          awaitCounter += 1;
          instrs.push({
            kind: 'awaitResolved',
            text: 'await Promise.resolve(...)\n→ suspende função\n→ agenda continuação',
            resumeLabel: `resume(${name})#${awaitCounter}`,
          });
          continue;
        }
      }

      // ignore return
      if (t.isReturnStatement(st)) {
        instrs.push({ kind: 'end', text: 'return\n→ resolve promise', suppressSnapshot: true });
        break;
      }

      // ignore empty
      if (t.isEmptyStatement(st)) continue;

      throw new Error(`P2.2: statement não suportada em async function ${name}: ${st.type}`);
    }

    if (instrs.length === 0 || instrs[instrs.length - 1].kind !== 'end') {
      instrs.push({ kind: 'end', text: 'fim', suppressSnapshot: true });
    }

    functions[name] = { label: name, body: instrs };
  };

  // Pass 1: collect async function decls and async arrow const decls
  for (const node of ast.program.body) {
    if (t.isFunctionDeclaration(node) && node.id?.name && node.async) {
      addAsyncFunctionDecl(node.id.name, node);
    }

    if (t.isVariableDeclaration(node)) {
      for (const d of node.declarations) {
        if (!t.isIdentifier(d.id) || !d.init) continue;
        if (t.isArrowFunctionExpression(d.init) && d.init.async) {
          addAsyncFunctionDecl(d.id.name, d.init);
        }
      }
    }
  }

  // Pass 2: emit top-level actions in order
  for (const node of ast.program.body) {
    // ignore declarations (already collected)
    if (t.isFunctionDeclaration(node)) continue;
    if (t.isVariableDeclaration(node)) continue;

    if (!t.isExpressionStatement(node)) {
      throw new Error(`P2.2: top-level statement não suportada: ${node.type}`);
    }

    const expr = node.expression;

    // call async function: example();
    if (t.isCallExpression(expr) && t.isIdentifier(expr.callee)) {
      const name = expr.callee.name;
      if (!functions[name]) {
        throw new Error(`P2.2: chamada a função desconhecida: ${name}()`);
      }
      topLevel.push({ kind: 'callAsync', text: `chamar ${name}()`, fn: name });
      continue;
    }

    // promise chain
    if (t.isCallExpression(expr)) {
      addChainFromExpr(expr);
      continue;
    }

    throw new Error(`P2.2: expressão top-level não suportada: ${expr.type}`);
  }

  if (topLevel.length === 0) {
    throw new Error('P2.2: não há nada para simular (top-level vazio).');
  }

  return { topLevel, functions };
}
