import * as t from '@babel/types';
import type { Program as P1Program, FunctionDef, Instr, EnqueueSpec } from '../../engine/p1/types';
import { parseJs } from '../ast';
import { isConsoleLogExpr, isPromiseRejectCall, isPromiseResolveCall } from '../matchers';

type ChainStage =
  | { kind: 'then'; handler: t.Expression }
  | { kind: 'catch'; handler: t.Expression }
  | { kind: 'finally'; handler: t.Expression };

function handlerReturnsKnownAsyncPromise(handler: t.Expression, knownAsyncFns: Set<string>): boolean {
  if (!t.isArrowFunctionExpression(handler) && !t.isFunctionExpression(handler)) return false;

  const exprBody = !t.isBlockStatement(handler.body) ? (handler.body as t.Expression) : null;
  const stmts = t.isBlockStatement(handler.body) ? handler.body.body : [];

  const checkExpr = (expr: t.Expression | null | undefined): boolean => {
    if (!expr) return false;

    // inner2()
    if (t.isCallExpression(expr) && t.isIdentifier(expr.callee) && knownAsyncFns.has(expr.callee.name)) {
      return true;
    }

    // inner2().then(...)
    if (
      t.isCallExpression(expr) &&
      t.isMemberExpression(expr.callee) &&
      t.isIdentifier(expr.callee.property) &&
      expr.callee.property.name === 'then'
    ) {
      const obj = expr.callee.object;
      if (t.isCallExpression(obj) && t.isIdentifier(obj.callee) && knownAsyncFns.has(obj.callee.name)) {
        return true;
      }
    }

    return false;
  };

  // Arrow expression body implies an implicit return.
  if (exprBody) return checkExpr(exprBody);

  // Block body: look for `return <expr>`.
  for (const st of stmts) {
    if (t.isReturnStatement(st)) return checkExpr(st.argument as t.Expression | null | undefined);
  }

  return false;
}

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

function buildFunctionFromHandler(
  label: string,
  handler: t.Expression,
  knownAsyncFns: Set<string>,
  opts?: {
    onEndEnqueueAfterSnapshot?: EnqueueSpec[];
    onThrowEnqueueAfterSnapshot?: EnqueueSpec[];
  },
  registerFn?: (label: string, handler: t.Expression) => void
): FunctionDef {
  // Only support arrow/function expressions.
  if (!t.isArrowFunctionExpression(handler) && !t.isFunctionExpression(handler)) {
    throw new Error('Unsupported handler type (expected function): ' + handler.type);
  }

  const bodyStmts: t.Statement[] = t.isBlockStatement(handler.body)
    ? handler.body.body
    : [t.returnStatement(handler.body as t.Expression)];

  const instrs: Instr[] = [];
  let awaitCounter = 0;
  let thenCbCounter = 0;

  for (const st of bodyStmts) {
    // return ...
    if (t.isReturnStatement(st)) {
      // return; (end handler)
      if (!st.argument) {
        instrs.push({
          kind: 'end',
          text: 'return\n→ resolve promise',
          suppressSnapshot: true,
          enqueueAfterSnapshot: opts?.onEndEnqueueAfterSnapshot,
        });
        break;
      }

      // return console.log(...)
      if (isConsoleLogExpr(st.argument)) {
        const call = st.argument;
        const arg0 = call.arguments[0];
        instrs.push({
          kind: 'log',
          text: `console.log(${arg0 ? textOfConsoleArg(arg0) : ''})`,
          output: arg0 ? outputValueFromConsoleArg(arg0) : '',
        });
        instrs.push({
          kind: 'end',
          text: 'return\n→ resolve promise',
          suppressSnapshot: true,
          enqueueAfterSnapshot: opts?.onEndEnqueueAfterSnapshot,
        });
        break;
      }

      // return await inner2();  (await async fn declared at top-level)
      if (
        t.isAwaitExpression(st.argument) &&
        t.isCallExpression(st.argument.argument) &&
        t.isIdentifier(st.argument.argument.callee)
      ) {
        const callee = st.argument.argument.callee.name;
        if (!knownAsyncFns.has(callee)) {
          throw new Error(`P2.2: return await de função não suportada dentro de handler: ${callee}()`);
        }
        awaitCounter += 1;
        instrs.push({
          kind: 'awaitCallAsync',
          text: `return await ${callee}()\n→ suspende handler\n→ só termina quando ${callee} termina`,
          callee,
          resumeLabel: `resume(${label})#returnawait${awaitCounter}`,
        });
        instrs.push({
          kind: 'end',
          text: 'return\n→ resolve promise',
          suppressSnapshot: true,
          enqueueAfterSnapshot: opts?.onEndEnqueueAfterSnapshot,
        });
        break;
      }

      // return inner2().then(() => ...)
      if (
        t.isCallExpression(st.argument) &&
        t.isMemberExpression(st.argument.callee) &&
        t.isIdentifier(st.argument.callee.property) &&
        st.argument.callee.property.name === 'then'
      ) {
        const obj = st.argument.callee.object;
        const thenHandler = st.argument.arguments[0] as t.Expression | undefined;
        if (!thenHandler) {
          throw new Error('P2.2: return <promise>.then(...) requer 1 handler.');
        }
        if (!t.isArrowFunctionExpression(thenHandler) && !t.isFunctionExpression(thenHandler)) {
          throw new Error('P2.2: handler de .then(...) não suportado (esperado function): ' + thenHandler.type);
        }

        // object must be inner2()
        if (!t.isCallExpression(obj) || !t.isIdentifier(obj.callee)) {
          throw new Error('P2.2: apenas suportamos return innerAsync().then(...) dentro de handler.');
        }
        const callee = obj.callee.name;
        if (!knownAsyncFns.has(callee)) {
          throw new Error(`P2.2: return de .then em função não suportada dentro de handler: ${callee}()`);
        }

        if (!registerFn) {
          throw new Error('P2.2: internal error — missing registerFn for nested .then handler');
        }

        thenCbCounter += 1;
        const cbLabel = `${label}.thenret${thenCbCounter}`;
        registerFn(cbLabel, thenHandler);

        awaitCounter += 1;
        instrs.push({
          kind: 'awaitCallAsync',
          text: `return ${callee}().then(...)\n→ espera ${callee}()\n→ corre handler de then`,
          callee,
          resumeLabel: `resume(${label})#returnthen${awaitCounter}`,
        });

        const thenIsAsync =
          (t.isArrowFunctionExpression(thenHandler) || t.isFunctionExpression(thenHandler)) && !!thenHandler.async;

        if (thenIsAsync) {
          awaitCounter += 1;
          instrs.push({
            kind: 'awaitCallAsync',
            text: `.then(async handler)\n→ espera handler terminar`,
            callee: cbLabel,
            resumeLabel: `resume(${label})#thenasync${awaitCounter}`,
          });
        } else {
          instrs.push({ kind: 'callAsync', text: `.then(handler)`, callee: cbLabel });
        }

        instrs.push({
          kind: 'end',
          text: 'return\n→ resolve promise',
          suppressSnapshot: true,
          enqueueAfterSnapshot: opts?.onEndEnqueueAfterSnapshot,
        });
        break;
      }

      // return inner2();  (async fn declared at top-level)
      if (t.isCallExpression(st.argument) && t.isIdentifier(st.argument.callee)) {
        const callee = st.argument.callee.name;
        if (!knownAsyncFns.has(callee)) {
          throw new Error(`P2.2: return de função não suportada dentro de handler: ${callee}()`);
        }
        awaitCounter += 1;
        instrs.push({
          kind: 'awaitCallAsync',
          text: `return ${callee}()\n→ async retorna promise\n→ só termina quando ${callee} termina`,
          callee,
          resumeLabel: `resume(${label})#return${awaitCounter}`,
        });
        instrs.push({
          kind: 'end',
          text: 'return\n→ resolve promise',
          suppressSnapshot: true,
          enqueueAfterSnapshot: opts?.onEndEnqueueAfterSnapshot,
        });
        break;
      }

      throw new Error(`P2.2: return não suportado dentro de handler: ${st.argument.type}`);
    }

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

    // await Promise.resolve(...)
    if (t.isExpressionStatement(st) && t.isAwaitExpression(st.expression) && isPromiseResolveCall(st.expression.argument)) {
      awaitCounter += 1;
      instrs.push({
        kind: 'awaitResolved',
        text: 'await Promise.resolve()\n→ suspende função\n→ agenda continuação',
        resumeLabel: `resume(${label})#awaitpr${awaitCounter}`,
      });
      continue;
    }

    // await inner();  (await async fn declared at top-level)
    if (
      t.isExpressionStatement(st) &&
      t.isAwaitExpression(st.expression) &&
      t.isCallExpression(st.expression.argument) &&
      t.isIdentifier(st.expression.argument.callee)
    ) {
      const callee = st.expression.argument.callee.name;
      if (!knownAsyncFns.has(callee)) {
        throw new Error(`P2.2: await a função não suportada dentro de handler: ${callee}()`);
      }
      awaitCounter += 1;
      instrs.push({
        kind: 'awaitCallAsync',
        text: `await ${callee}()\n→ suspende handler\n→ retoma quando ${callee} termina`,
        callee,
        resumeLabel: `resume(${label})#await${awaitCounter}`,
      });
      continue;
    }

    // inner().then(cb)  (fire-and-forget)
    if (
      t.isExpressionStatement(st) &&
      t.isCallExpression(st.expression) &&
      t.isMemberExpression(st.expression.callee) &&
      t.isIdentifier(st.expression.callee.property) &&
      st.expression.callee.property.name === 'then'
    ) {
      const obj = st.expression.callee.object;
      const thenHandler = st.expression.arguments[0] as t.Expression | undefined;
      if (!thenHandler) throw new Error('P2.2: inner().then(...) requer 1 handler.');

      // object must be inner2()
      if (!t.isCallExpression(obj) || !t.isIdentifier(obj.callee)) {
        throw new Error('P2.2: apenas suportamos innerAsync().then(...) como statement dentro de handler.');
      }

      const callee = obj.callee.name;
      if (!knownAsyncFns.has(callee)) {
        throw new Error(`P2.2: .then em função não suportada dentro de handler: ${callee}()`);
      }

      if (!registerFn) {
        throw new Error('P2.2: internal error — missing registerFn for nested .then handler');
      }

      if (!t.isArrowFunctionExpression(thenHandler) && !t.isFunctionExpression(thenHandler)) {
        throw new Error('P2.2: handler de .then(...) não suportado (esperado function): ' + thenHandler.type);
      }

      thenCbCounter += 1;
      const cbLabel = `${label}.then${thenCbCounter}`;
      registerFn(cbLabel, thenHandler);

      instrs.push({ kind: 'callAsyncThen', text: `${callee}().then(...)`, callee, thenHandler: cbLabel });
      continue;
    }

    // inner();  (call async fn declared at top-level)
    if (t.isExpressionStatement(st) && t.isCallExpression(st.expression) && t.isIdentifier(st.expression.callee)) {
      const callee = st.expression.callee.name;
      if (!knownAsyncFns.has(callee)) {
        throw new Error(`P2.2: chamada a função não suportada dentro de handler: ${callee}()`);
      }
      instrs.push({ kind: 'callAsync', text: `chamar ${callee}()`, callee });
      continue;
    }

    // throw ...
    if (t.isThrowStatement(st)) {
      instrs.push({ kind: 'throw', text: 'throw ...', enqueueAfterSnapshot: opts?.onThrowEnqueueAfterSnapshot });
      continue;
    }

    // ignore empty
    if (t.isEmptyStatement(st)) continue;

    throw new Error('Unsupported statement inside handler: ' + st.type);
  }

  // ensure explicit end
  if (instrs.length === 0 || instrs[instrs.length - 1].kind !== 'end') {
    instrs.push({
      kind: 'end',
      text: 'fim',
      suppressSnapshot: true,
      enqueueAfterSnapshot: opts?.onEndEnqueueAfterSnapshot,
    });
  }

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

  // Track only top-level declared async functions (inner helpers callable from handlers).
  const declaredAsyncFns = new Set<string>();

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

    // For calls/awaits inside handlers, only top-level declared async fns are allowed.
    const knownAsyncFns = new Set(declaredAsyncFns);

    const registerFn = (lbl: string, h: t.Expression) => {
      if (functions[lbl]) return;
      functions[lbl] = buildFunctionFromHandler(lbl, h, knownAsyncFns, undefined, registerFn);
    };

    const mkStageReaction = (i: number, trigger: 'fulfilled' | 'rejected'): EnqueueSpec => {
      const stage = chain.stages[i];
      const baseLbl = stageLabels[i];

      const nextIfFulfilled = i + 1 < chain.stages.length ? [mkStageReaction(i + 1, 'fulfilled')] : [];
      const nextIfRejected = i + 1 < chain.stages.length ? [mkStageReaction(i + 1, 'rejected')] : [];

      const handlerIsAsync =
        (t.isArrowFunctionExpression(stage.handler) || t.isFunctionExpression(stage.handler)) && !!stage.handler.async;

      const handlerReturnsPromise = handlerReturnsKnownAsyncPromise(stage.handler, knownAsyncFns);

      // Async (or promise-returning) finally needs distinct handler labels per trigger, because normal completion preserves the trigger.
      const splitFinally = stage.kind === 'finally' && (handlerIsAsync || handlerReturnsPromise);
      const fulfilledLbl = splitFinally ? `${baseLbl}.fulfilled` : baseLbl;
      const rejectedLbl = splitFinally ? `${baseLbl}.rejected` : baseLbl;

      const onFulfilledHandler = stage.kind === 'then' || stage.kind === 'finally' ? fulfilledLbl : undefined;
      const onRejectedHandler = stage.kind === 'catch' || stage.kind === 'finally' ? rejectedLbl : undefined;

      // The handler that will actually run (if any) for this microtask trigger.
      const handlerLabel = trigger === 'fulfilled' ? onFulfilledHandler : onRejectedHandler;
      const hasHandler = !!handlerLabel;

      // Normal completion follow-ups (note: finally preserves trigger on normal completion)
      const normalFollowUps: EnqueueSpec[] =
        stage.kind === 'finally' && trigger === 'rejected' ? nextIfRejected : nextIfFulfilled;

      const throwFollowUps: EnqueueSpec[] = nextIfRejected;

      // A handler can defer the continuation either by being `async` or by returning a Promise (adoption).
      const defersContinuation = hasHandler && (handlerIsAsync || handlerReturnsPromise);

      // Build handler function def lazily (only if needed).
      if (handlerLabel && !functions[handlerLabel]) {
        const onEndEnqueueAfterSnapshot = defersContinuation
          ? [resolveDerived('resolve-derived', 'resolve promise derivada', normalFollowUps)]
          : undefined;

        const onThrowEnqueueAfterSnapshot = defersContinuation
          ? [resolveDerived('resolve-derived', 'reject promise derivada', throwFollowUps)]
          : undefined;

        functions[handlerLabel] = buildFunctionFromHandler(
          handlerLabel,
          stage.handler,
          knownAsyncFns,
          {
            onEndEnqueueAfterSnapshot,
            onThrowEnqueueAfterSnapshot,
          },
          registerFn
        );
      }

      // Passthrough follow-ups (when no handler applies)
      const passthroughFulfilled = nextIfFulfilled;
      const passthroughRejected = nextIfRejected;

      // If the handler defers continuation, it will enqueue the derived resolution/rejection on end/throw.
      const onFulfilled = defersContinuation ? [] : handlerLabel ? normalFollowUps : passthroughFulfilled;
      const onRejected = defersContinuation ? [] : handlerLabel ? throwFollowUps : passthroughRejected;

      return reaction(
        `reaction(${baseLbl})`,
        trigger,
        { onFulfilledHandler, onRejectedHandler },
        onFulfilled,
        onRejected
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
    declaredAsyncFns.add(name);
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
