import * as t from '@babel/types';

export function isConsoleLogExpr(node: t.Node | null | undefined, text?: string): node is t.CallExpression {
  if (!node || !t.isCallExpression(node)) return false;
  if (!t.isMemberExpression(node.callee)) return false;
  if (!t.isIdentifier(node.callee.object, { name: 'console' })) return false;
  if (!t.isIdentifier(node.callee.property, { name: 'log' })) return false;

  if (text === undefined) return true;
  if (node.arguments.length !== 1) return false;
  const arg = node.arguments[0];
  return t.isStringLiteral(arg, { value: text });
}

export function isPromiseResolveCall(node: t.Node | null | undefined, value?: number): node is t.CallExpression {
  if (!node || !t.isCallExpression(node)) return false;
  if (!t.isMemberExpression(node.callee)) return false;
  if (!t.isIdentifier(node.callee.object, { name: 'Promise' })) return false;
  if (!t.isIdentifier(node.callee.property, { name: 'resolve' })) return false;

  if (value === undefined) return true;
  if (node.arguments.length !== 1) return false;
  const arg = node.arguments[0];
  return t.isNumericLiteral(arg, { value });
}

export function isPromiseRejectCall(node: t.Node | null | undefined): node is t.CallExpression {
  if (!node || !t.isCallExpression(node)) return false;
  if (!t.isMemberExpression(node.callee)) return false;
  if (!t.isIdentifier(node.callee.object, { name: 'Promise' })) return false;
  if (!t.isIdentifier(node.callee.property, { name: 'reject' })) return false;
  return true;
}

export function isAwaitPromiseResolve(stmt: t.Statement | null | undefined, value?: number): boolean {
  if (!stmt || !t.isVariableDeclaration(stmt) && !t.isExpressionStatement(stmt)) return false;

  // Case1: const result = await Promise.resolve(42);
  if (t.isVariableDeclaration(stmt)) {
    if (stmt.declarations.length !== 1) return false;
    const decl = stmt.declarations[0];
    if (!decl.init || !t.isAwaitExpression(decl.init)) return false;
    return isPromiseResolveCall(decl.init.argument, value);
  }

  // Case2/5: await Promise.resolve();
  if (t.isExpressionStatement(stmt)) {
    if (!t.isAwaitExpression(stmt.expression)) return false;
    return isPromiseResolveCall(stmt.expression.argument, value);
  }

  return false;
}

export function isCallExprStmt(stmt: t.Statement | null | undefined, calleeName: string): boolean {
  if (!stmt || !t.isExpressionStatement(stmt)) return false;
  const e = stmt.expression;
  return t.isCallExpression(e) && t.isIdentifier(e.callee, { name: calleeName });
}

export function isPromiseResolveThenChainExpr(expr: t.Expression | null | undefined): expr is t.CallExpression {
  if (!expr || !t.isCallExpression(expr)) return false;
  if (!t.isMemberExpression(expr.callee)) return false;

  // expr.callee = <something>.then
  const callee = expr.callee;
  if (!t.isIdentifier(callee.property, { name: 'then' })) return false;

  // <something> should be a CallExpression like Promise.resolve() or another .then(...)
  // For our dataset-first detector, we only require the chain starts at Promise.resolve().
  // We'll check that by walking left until we find the root.
  let cur: t.Expression | t.V8IntrinsicIdentifier = callee.object;
  while (t.isCallExpression(cur) && t.isMemberExpression(cur.callee)) {
    const prop = cur.callee.property;
    if (!t.isIdentifier(prop)) break;
    const name = prop.name;
    // only traverse promise-chain calls, NOT Promise.resolve itself
    if (name !== 'then' && name !== 'catch' && name !== 'finally') break;
    cur = cur.callee.object;
  }

  return t.isCallExpression(cur) && isPromiseResolveCall(cur);
}

export function isThenCall(node: t.Node | null | undefined): node is t.CallExpression {
  if (!node || !t.isCallExpression(node)) return false;
  if (!t.isMemberExpression(node.callee)) return false;
  return t.isIdentifier(node.callee.property, { name: 'then' });
}

export function isFinallyCall(node: t.Node | null | undefined): node is t.CallExpression {
  if (!node || !t.isCallExpression(node)) return false;
  if (!t.isMemberExpression(node.callee)) return false;
  return t.isIdentifier(node.callee.property, { name: 'finally' });
}

export function unwrapExprStmt(stmt: t.Statement): t.Expression | null {
  return t.isExpressionStatement(stmt) ? stmt.expression : null;
}
