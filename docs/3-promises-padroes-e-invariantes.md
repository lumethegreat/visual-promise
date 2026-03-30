# Padrões, Invariantes e Casos de Teste para Promises

## Objetivo

Este documento serve como base para:
- testes automáticos;
- validação do simulador;
- prompts de IA que expliquem a ordem correta.

---

## Invariantes fortes

### Invariante 1
Código síncrono do turno atual termina antes de qualquer microtask.

### Invariante 2
Microtasks correm FIFO.

### Invariante 3
Cada `await` adiciona uma nova fronteira assíncrona.

### Invariante 4
Uma `async function` corre imediatamente até ao primeiro `await`.

### Invariante 5
Uma `async function` devolve sempre promise.

### Invariante 6
Se um handler devolver promise, a chain seguinte não avança imediatamente.

### Invariante 7
Se uma microtask cria novas microtasks, elas entram no fim da fila.

---

## Padrão A — `.then(syncHandler).then(next)`

```js
Promise.resolve().then(() => {
  console.log("A");
}).then(() => {
  console.log("B");
});
```

### Regra
- primeiro corre o handler do primeiro `.then`
- só depois fica elegível o segundo

### Ordem esperada
```text
A
B
```

---

## Padrão B — `.then(asyncHandler).then(next)`

```js
Promise.resolve().then(async () => {
  console.log("A");
}).then(() => {
  console.log("B");
});
```

### Regra
- o primeiro handler devolve promise
- o segundo `.then` não avança logo
- há jobs internos de resolução / adoção

### Ordem estrutural
- `A` sai antes de `B`
- a elegibilidade de `B` é atrasada em relação ao caso síncrono

---

## Padrão C — inner async sem await

```js
const inner = async () => {
  await Promise.resolve();
  console.log("X");
};

Promise.resolve().then(async () => {
  inner();
}).then(() => {
  console.log("Y");
});
```

### Regra
- `inner()` começa já
- depois as continuações de `inner` competem com a chain principal

### Consequência
- `X` pode sair antes ou depois de `Y`, dependendo de quantas continuações existirem e de quando `Y` ficar elegível

---

## Padrão D — inner async com await

```js
const inner = async () => {
  await Promise.resolve();
  console.log("X");
};

Promise.resolve().then(async () => {
  await inner();
}).then(() => {
  console.log("Y");
});
```

### Regra
- `Y` não pode correr antes de `inner` terminar
- a chain fica estruturalmente atrás

### Consequência
- `X` sai antes de `Y`

---

## Padrão E — callback `.then(...)` dentro de função async

```js
const inner = async () => {
  await Promise.resolve();
  Promise.resolve().then(() => console.log("A"));
  await Promise.resolve();
  console.log("B");
};
```

### Regra
- o callback do `.then(...)` entra na fila no ponto exato em que essa linha é executada
- a sua posição relativa depende do que já estava na fila nesse momento

---

## Padrão F — `return Promise.resolve().then(...)`

```js
const task = async () => {
  return Promise.resolve().then(() => console.log("A"));
};
```

### Regra
- a promise devolvida por `task` só assenta depois do callback interno correr

### Consequência
- qualquer chain seguinte fica atrás de `A`

---

## Padrão G — erro lançado em handler

```js
Promise.resolve()
  .then(() => {
    throw new Error("boom");
  })
  .catch(() => console.log("caught"));
```

### Regra
- o erro rejeita a promise derivada
- `.catch(...)` fica elegível como reação dessa rejeição

### Ordem esperada
```text
caught
```

---

## Padrão H — `finally`

```js
Promise.resolve("x")
  .finally(() => console.log("F"))
  .then(v => console.log(v));
```

### Regra
- `finally` corre como reaction job
- depois a chain continua com o valor original, salvo erro lançado por `finally`

---

## Checklist para prever outputs

Ao analisar um snippet, responder sempre a estas perguntas:

1. Quais são os outputs síncronos?
2. Quais as promises já assentes que tornam `.then/.catch/.finally` elegíveis?
3. Que `async function`s foram chamadas?
4. Em cada uma, onde está o primeiro `await`?
5. Que continuações de `await` entram na fila?
6. Algum handler devolve valor simples?
7. Algum handler devolve promise / thenable?
8. Alguma chain seguinte fica bloqueada por adoção?
9. Que microtasks já estavam na fila antes de as novas serem enfileiradas?
10. Qual a ordem FIFO final?

---

## Heurística curta para IA

```text
- Executa todo o síncrono primeiro.
- Cada .then/.catch/.finally elegível cria um PromiseReactionJob.
- Cada await suspende a função e cria uma continuação futura.
- Async function chamada sem await corre já até ao primeiro await.
- Se um handler devolver Promise, o próximo .then espera.
- Microtasks correm FIFO.
- Microtasks novas entram no fim da fila.
```

---

## Recomendação de validação

Ao explicar um output, a IA deve produzir:
1. output final previsto;
2. snapshots da microtask queue em checkpoints críticos;
3. justificação específica para cada inversão de ordem.

A IA não deve dizer apenas "porque é assíncrono".
Deve dizer exatamente:
- que job entrou na fila;
- quando entrou;
- por que ficou antes ou depois de outro.

---

## Fontes primárias e de apoio

- ECMAScript specification:
  - Promise reaction jobs
  - thenable adoption
  - async functions
  - await
- MDN:
  - `await`
  - `Promise.prototype.then()`
  - Using promises
  - JavaScript execution model