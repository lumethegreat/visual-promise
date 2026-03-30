# Algoritmo Operacional para Simular a Execução de Promises

## Objetivo

Este documento descreve um algoritmo passo a passo que um motor de IA pode seguir para:
- prever a ordem de `console.log(...)`;
- explicar a execução;
- alimentar uma simulação visual de call stack e microtask queue.

---

## Entidades mínimas a modelar

A simulação deve modelar, no mínimo:

- **Call stack / frame atual**
- **Código síncrono ainda por executar**
- **Microtask queue**
- **Promise states**
  - pending
  - fulfilled
  - rejected
- **Links de chain**
  - promise original
  - promise derivada do `.then/.catch/.finally`
- **Async continuations**
- **Jobs internos de adoção / resolução**
  - quando um handler devolve promise / thenable

---

## Tipos de trabalho observáveis

A simulação deve distinguir estes tipos:

1. **Sync step**
2. **PromiseReactionJob**
   - reação de `.then(...)`
   - reação de `.catch(...)`
   - reação de `.finally(...)`
3. **Await continuation**
4. **Promise adoption / resolution job**
   - job interno necessário quando um handler devolve promise / thenable

---

## Regras do algoritmo

### Fase A — Executar síncrono

Enquanto houver código síncrono no turno atual:

1. Executar a próxima instrução síncrona.
2. Se a instrução for `console.log(...)`, registar output.
3. Se a instrução criar uma promise já fulfilled/rejected e lhe associar `.then/.catch/.finally`, marcar o respetivo handler como **elegível para enfileiramento em microtask**.
4. Se a instrução chamar uma `async function`, executar imediatamente o corpo até:
   - ao primeiro `await`; ou
   - ao fim da função.
5. Se a `async function` atingir `await`, suspender a função e enfileirar uma **await continuation**.
6. Se a `async function` terminar sem atingir `await`, a promise devolvida por ela assenta.

Quando não houver mais síncrono por executar no turno atual, passar para a drenagem da microtask queue.

---

### Fase B — Drenar microtasks

Enquanto a microtask queue não estiver vazia:

1. Retirar a próxima microtask (FIFO).
2. Executá-la até ao fim.
3. Durante a execução dessa microtask, adicionar novas microtasks sempre **no fim da fila**.
4. Se a microtask produzir output observável, registar esse output.
5. Se a microtask resolver ou rejeitar uma promise, tornar elegíveis os reactions correspondentes.

---

## Semântica de `.then(...)`

Ao encontrar:

```js
p.then(onFulfilled, onRejected)
```

criar:
- a promise derivada `p2`;
- o registo de reação ligado a `p`.

Quando `p` assentar:
- enfileirar a reação apropriada como **PromiseReactionJob**.

### Ao executar o PromiseReactionJob

1. Escolher o handler adequado:
   - `onFulfilled` se `p` fulfilled
   - `onRejected` se `p` rejected
2. Se não houver handler apropriado:
   - propagar diretamente fulfillment / rejection para `p2`
3. Se houver handler:
   - executá-lo
   - observar o resultado

### Resultado do handler

#### Caso 1 — handler devolve valor simples
- resolver `p2` com esse valor

#### Caso 2 — handler lança erro
- rejeitar `p2` com esse erro

#### Caso 3 — handler devolve promise / thenable
- `p2` não assenta imediatamente
- enfileirar / ativar o mecanismo de adoção / resolução
- `p2` só assenta depois de a promise devolvida assentar

---

## Semântica de `await`

Ao encontrar:

```js
const x = await expr;
```

1. Avaliar `expr`.
2. Convertê-la conceptualmente para promise.
3. Suspender a `async function`.
4. Enfileirar uma continuação futura que:
   - retoma a função;
   - obtém o valor fulfilled; ou
   - lança a razão de rejection.

### Regras importantes
- mesmo que `expr` já esteja fulfilled, a continuação entra em microtask futura;
- `await` nunca continua no mesmo passo síncrono.

---

## Semântica de `async function`

Ao chamar:

```js
fnAsync()
```

1. Criar a promise devolvida por `fnAsync`.
2. Executar imediatamente o corpo até ao primeiro `await` ou até ao fim.
3. Se a função:
   - terminar com `return valor`, resolver a promise devolvida;
   - lançar erro, rejeitar a promise devolvida;
   - atingir `await`, suspender e continuar depois via microtask.

---

## Regra de interleaving

Quando existem vários fluxos concorrentes em microtasks, a ordem observável depende exclusivamente de:

1. **quando cada microtask foi enfileirada**
2. **a posição FIFO na fila**
3. **se uma microtask, ao correr, cria novas microtasks**
4. **se a chain seguinte está bloqueada por adoção de promise**

---

## Padrão especial: async handler numa chain

Exemplo:

```js
p.then(task1).then(task2)
```

onde `task1` é `async`.

### Regras
- `task1` é executada num PromiseReactionJob.
- como `task1` é `async`, devolve sempre promise.
- a promise derivada da chain não pode libertar `task2` imediatamente.
- antes disso pode haver jobs internos de adoção / resolução.

### Consequência
- `task2` pode entrar mais tarde do que a intuição sugere;
- isso explica inversões de ordem em exemplos com `innerTask()` e vários `await`s.

---

## Padrão especial: inner async sem await

Exemplo:

```js
const task1 = async () => {
  innerTask();   // sem await
}
```

### Regras
- `innerTask()` começa já;
- corre até ao primeiro `await`;
- cria as suas próprias continuações;
- `task1` pode terminar antes de `innerTask`;
- a chain principal e o fluxo interno passam a disputar a fila.

---

## Padrão especial: inner async com await

Exemplo:

```js
const task1 = async () => {
  await innerTask();
}
```

### Regras
- `task1` não pode terminar antes de `innerTask`;
- logo a chain seguinte também não pode avançar;
- o número de awaits dentro de `innerTask` já não muda a posição estrutural de `task2` em relação a `innerTask`.

---

## Padrão especial: handler retorna Promise explícita

Exemplo:

```js
const task2 = async () => {
  return Promise.resolve().then(...)
}
```

### Regras
- `task2` devolve promise;
- essa promise só assenta depois do callback interno correr;
- o próximo `.then(...)` fica atrás desse callback.

---

## Saída recomendada para a simulação

A cada passo, o motor deve conseguir produzir um snapshot com:

- passo n
- instrução / job executado
- call stack atual
- microtask queue atual
- promises que assentaram neste passo
- output produzido neste passo

Formato sugerido:

```text
STEP 07
Job executado: PromiseReactionJob for then(task2)
Call stack: [task2]
Microtask queue antes: [I4, R2]
Microtask queue depois: [I4, adoption(task2)]
Promises assentadas: none
Output: task2
```

---

## Fontes primárias e de apoio

- ECMAScript specification:
  - Promise jobs
  - thenable adoption
  - async functions
  - await
- MDN:
  - `await`
  - `Promise.prototype.then()`
  - Using promises
  - JavaScript execution model