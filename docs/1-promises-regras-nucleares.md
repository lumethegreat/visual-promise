# Regras Nucleares da Execução de Promises em JavaScript

## Objetivo

Este documento define regras operacionais para prever corretamente a ordem de execução de código com:

- `Promise.resolve(...)`
- `.then(...)`, `.catch(...)`, `.finally(...)`
- `async function`
- `await`
- funções `async` chamadas com e sem `await`
- retorno de valores simples
- retorno de `Promise` / thenable
- erros e rejeições

O foco é a **ordem observável** dos efeitos, como `console.log(...)`.

---

## Modelo mental base

### Regra 1 — Primeiro corre o código síncrono
Todo o código síncrono do turno atual corre antes de qualquer microtask.

Consequência prática:
- `console.log(...)` síncronos aparecem primeiro.
- handlers de `.then(...)` e continuações de `await` só aparecem depois.

---

### Regra 2 — `.then(...)`, `.catch(...)` e `.finally(...)` enfileiram microtasks quando a promise correspondente assenta
Quando a promise observada por `.then(...)` / `.catch(...)` / `.finally(...)` fica fulfilled ou rejected, o respetivo handler não corre imediatamente na mesma stack; corre através de um **PromiseReactionJob** (microtask).

Consequência prática:
- "Promise resolveu" não significa "handler corre já".
- significa "o handler ficou elegível para entrar na fila de microtasks".

---

### Regra 3 — `await` pausa sempre a função
`await expr` nunca continua "já", mesmo que `expr` já esteja fulfilled.

O que acontece:
1. a expressão é avaliada;
2. a função `async` fica suspensa;
3. a continuação da função entra numa microtask futura.

Consequência prática:
- cada `await` cria uma fronteira assíncrona;
- cada `await` acrescenta pelo menos mais uma continuação a disputar a fila.

---

### Regra 4 — Uma `async function` começa a correr imediatamente
Quando chamas `fnAsync()`, ela **não** vai toda para a fila.
Ela começa logo a executar de forma síncrona até encontrar o primeiro `await` ou até terminar.

Consequência prática:
- código antes do primeiro `await` corre "já";
- se a função for chamada sem `await`, essa parte inicial ainda assim corre dentro da stack / microtask atual.

---

### Regra 5 — Toda a `async function` devolve uma `Promise`
Mesmo que não tenha `await`, mesmo que devolva `undefined`, mesmo que só faça `console.log(...)`.

Consequência prática:
- usar uma `async function` como handler de `.then(...)` muda a semântica da chain;
- o próximo `.then(...)` fica dependente da `Promise` devolvida por esse handler.

---

### Regra 6 — Se o handler de `.then(...)` devolver valor simples, a chain avança mais depressa
Se o handler devolver:
- `undefined`
- número
- string
- objeto não-thenable

então a promise derivada pode ser resolvida sem adoção de outra promise.

Consequência prática:
- normalmente o próximo `.then(...)` fica elegível mais cedo do que no caso em que o handler devolve uma `Promise`.

---

### Regra 7 — Se o handler devolver uma `Promise` / thenable, a chain não avança logo
Se o handler devolver uma `Promise` ou thenable:
- a promise derivada da chain tem de **adotar** o estado dessa promise;
- isso introduz jobs internos extra de resolução / adoção;
- o próximo `.then(...)` só pode avançar depois.

Consequência prática:
- existem atrasos subtis entre "o handler terminou" e "o próximo `.then(...)` entrou na fila";
- esses atrasos explicam muitos casos contraintuitivos.

---

### Regra 8 — Microtasks correm FIFO
A fila de microtasks é drenada por ordem de entrada.

Consequência prática:
- quem entra primeiro corre primeiro;
- microtasks novas entram no fim da fila;
- não "saltam à frente" de microtasks já presentes.

---

### Regra 9 — Microtasks criadas dentro de uma microtask entram no fim da fila
Se, ao correr uma microtask, fores criando outras microtasks:
- elas entram atrás das que já estavam em espera.

Consequência prática:
- uma continuação de `await` pode ser ultrapassada por outra microtask que já estivesse na fila;
- ou pode ficar à frente de algo que só é enfileirado depois.

---

### Regra 10 — `innerAsync()` sem `await` corre "ao lado" da chain principal
Se fizeres:

```js
p.then(async () => {
  innerAsync();   // sem await
}).then(next)
```

então há dois fluxos a competir:
1. a chain principal (`next`);
2. as continuações internas de `innerAsync`.

Consequência prática:
- dependendo do número e posição dos `await`s, `innerAsync` pode imprimir antes ou depois de `next`.

---

### Regra 11 — `await innerAsync()` cola a chain ao destino de `innerAsync`
Se fizeres:

```js
p.then(async () => {
  await innerAsync();
}).then(next)
```

então `next` só pode avançar depois de:
1. `innerAsync` terminar;
2. a função exterior retomar depois do `await`;
3. a função exterior terminar;
4. a promise devolvida por essa função assentar.

Consequência prática:
- deixa de haver "corrida real" entre `innerAsync` e `next`;
- `next` fica estruturalmente atrás.

---

### Regra 12 — `Promise.resolve().then(...)` dentro de uma função cria outra microtask independente
Se estiveres dentro de `inner()` e fizeres:

```js
Promise.resolve().then(() => console.log("X"));
```

essa callback entra na fila no exato ponto em que essa linha é executada.

Consequência prática:
- a posição relativa dessa callback depende da ordem exata em que a linha foi alcançada;
- pode ficar antes ou depois de continuações de `await`, conforme o caso.

---

### Regra 13 — `return Promise.resolve().then(...)` prolonga a chain
Se um handler retornar:

```js
return Promise.resolve().then(...)
```

então:
- o handler devolve uma `Promise` pendente;
- a chain seguinte fica atrás dela;
- o próximo `.then(...)` só avança depois desse callback correr.

Consequência prática:
- `task3` pode ficar atrás de `return task2`.

---

### Regra 14 — Exceções num handler rejeitam a promise derivada
Se um handler de `.then(...)` ou uma continuação de `await` lançar erro:
- a promise derivada fica rejected;
- isso ativa `.catch(...)` ou o ramo de rejeição seguinte.

Consequência prática:
- `throw` dentro de handler assíncrono não é "sincrónico para fora";
- altera o estado da promise derivada.

---

### Regra 15 — `catch` e `finally` seguem a mesma lógica de microtasks
`.catch(...)` e `.finally(...)` também entram como PromiseReactionJobs quando a promise correspondente assenta.

Consequência prática:
- devem ser tratados pelo mesmo modelo base da fila de microtasks.

---

## Regras operacionais resumidas

1. Corre tudo o que é síncrono.
2. Sempre que vires `.then/.catch/.finally` em promise elegível, pensa "entra microtask de reação".
3. Sempre que vires `await`, pensa "a função pára aqui e a continuação entra em microtask".
4. Sempre que vires `asyncFn()` sem `await`, pensa "corre já até ao primeiro `await`".
5. Se um handler devolver `Promise`, pensa "a chain seguinte não avança já".
6. Drena a fila de microtasks por ordem FIFO.
7. Cada microtask pode adicionar mais microtasks no fim.

---

## Fontes primárias e de apoio

- ECMAScript specification:
  - `PromiseReactionJob`
  - `NewPromiseResolveThenableJob`
  - async functions
  - await
- MDN:
  - `await`
  - `Promise.prototype.then()`
  - Using promises
  - JavaScript execution model
