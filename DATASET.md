# Timeline Simulation — Dataset de Exemplos

## Convenção

Cada Tn representa o estado **ANTES** de executar o evento.

---

# Caso 1 — Async/Await Example

## Código

```js
async function example() {
  console.log("start");
  const result = await Promise.resolve(42);
  console.log(result);
  return result;
}

example();
```

---

## Timeline

```text
T0
Call Stack        | Microtask Queue     | Evento
──────────────────┼─────────────────────┼────────────────────────────
[]                | []                  | chamar example()


T1
Call Stack        | Microtask Queue     | Evento
──────────────────┼─────────────────────┼────────────────────────────
[ example ]       | []                  | console.log("start")

Output: start


T2
Call Stack        | Microtask Queue     | Evento
──────────────────┼─────────────────────┼────────────────────────────
[ example ]       | []                  | await Promise.resolve(42)
                                      | → suspende função
                                      | → agenda continuação


T3
Call Stack        | Microtask Queue     | Evento
──────────────────┼─────────────────────┼────────────────────────────
[]                | [ resume(example) ] | dequeue microtask


T4
Call Stack        | Microtask Queue     | Evento
──────────────────┼─────────────────────┼────────────────────────────
[ example ]       | []                  | retoma após await
                                      | console.log(42)

Output: 42


T5
Call Stack        | Microtask Queue     | Evento
──────────────────┼─────────────────────┼────────────────────────────
[]                | []                  | return 42
                                      | → resolve promise
```

---

# Caso 2 — Await vs Then

## Código

```js
async function example() {
  await Promise.resolve();
  console.log("A");
}

example();
Promise.resolve().then(() => console.log("B"));
```

---

## Timeline

```text
T0
Call Stack        | Microtask Queue     | Evento
──────────────────┼─────────────────────┼────────────────────────────
[]                | []                  | chamar example()


T1
Call Stack        | Microtask Queue     | Evento
──────────────────┼─────────────────────┼────────────────────────────
[ example ]       | []                  | await Promise.resolve()
                                      | → suspende função
                                      | → agenda continuação


T2
Call Stack        | Microtask Queue     | Evento
──────────────────┼─────────────────────┼────────────────────────────
[]                | [ resume(example) ] | Promise.resolve().then(...)
                                      | → agenda reaction(B)


T3
Call Stack        | Microtask Queue     | Evento
──────────────────┼─────────────────────┼────────────────────────────
[]                | [ resume(example),  | dequeue microtask
                  |   reaction(B) ]     |


T4
Call Stack        | Microtask Queue     | Evento
──────────────────┼─────────────────────┼────────────────────────────
[ example ]       | [ reaction(B) ]     | retoma após await
                                      | console.log("A")

Output: A


T5
Call Stack        | Microtask Queue     | Evento
──────────────────┼─────────────────────┼────────────────────────────
[]                | [ reaction(B) ]     | dequeue microtask


T6
Call Stack        | Microtask Queue     | Evento
──────────────────┼─────────────────────┼────────────────────────────
[ then callback ] | []                  | console.log("B")

Output: B


T7
Call Stack        | Microtask Queue     | Evento
──────────────────┼─────────────────────┼────────────────────────────
[]                | []                  | fim
```

---

# Caso 3 — Then Chain Síncrona

## Código

```js
Promise.resolve()
  .then(() => {
    console.log("A");
  })
  .then(() => {
    console.log("B");
  });
```

---

## Timeline

```text
T0
Call Stack        | Microtask Queue     | Evento
──────────────────┼─────────────────────┼────────────────────────────
[]                | []                  | Promise.resolve().then(...)
                                      | → agenda reaction(then1)


T1
Call Stack        | Microtask Queue     | Evento
──────────────────┼─────────────────────┼────────────────────────────
[]                | [ reaction(then1) ] | anexar segundo .then
                                      | → fica pendente da promise derivada


T2
Call Stack        | Microtask Queue     | Evento
──────────────────┼─────────────────────┼────────────────────────────
[]                | [ reaction(then1) ] | dequeue microtask


T3
Call Stack        | Microtask Queue     | Evento
──────────────────┼─────────────────────┼────────────────────────────
[ then1 ]         | []                  | console.log("A")

Output: A


T4
Call Stack        | Microtask Queue     | Evento
──────────────────┼─────────────────────┼────────────────────────────
[]                | []                  | then1 termina
                                      | → resolve promise derivada
                                      | → agenda reaction(then2)


T5
Call Stack        | Microtask Queue     | Evento
──────────────────┼─────────────────────┼────────────────────────────
[]                | [ reaction(then2) ] | dequeue microtask


T6
Call Stack        | Microtask Queue     | Evento
──────────────────┼─────────────────────┼────────────────────────────
[ then2 ]         | []                  | console.log("B")

Output: B


T7
Call Stack        | Microtask Queue     | Evento
──────────────────┼─────────────────────┼────────────────────────────
[]                | []                  | fim
```

---

# Caso 4 — Then com Handler Async

## Código

```js
Promise.resolve()
  .then(async () => {
    console.log("A");
  })
  .then(() => {
    console.log("B");
  });
```

---

## Timeline

```text
T0
Call Stack        | Microtask Queue     | Evento
──────────────────┼─────────────────────┼────────────────────────────
[]                | []                  | Promise.resolve().then(...)
                                      | → agenda reaction(asyncThen1)


T1
Call Stack        | Microtask Queue     | Evento
──────────────────┼─────────────────────┼────────────────────────────
[]                | [ reaction(asyncThen1) ]
                                      | anexar segundo .then
                                      | → fica pendente da promise derivada


T2
Call Stack        | Microtask Queue     | Evento
──────────────────┼─────────────────────┼────────────────────────────
[]                | [ reaction(asyncThen1) ] | dequeue microtask


T3
Call Stack        | Microtask Queue     | Evento
──────────────────┼─────────────────────┼────────────────────────────
[ asyncThen1 ]    | []                  | console.log("A")

Output: A


T4
Call Stack        | Microtask Queue     | Evento
──────────────────┼─────────────────────┼────────────────────────────
[]                | []                  | asyncThen1 termina
                                      | → devolve Promise fulfilled
                                      | → agenda resolve-derived


T5
Call Stack        | Microtask Queue     | Evento
──────────────────┼─────────────────────┼────────────────────────────
[]                | [ resolve-derived ] | dequeue microtask


T6
Call Stack        | Microtask Queue     | Evento
──────────────────┼─────────────────────┼────────────────────────────
[ resolve-derived ] | []                | resolve promise derivada
                                      | → agenda reaction(then2)


T7
Call Stack        | Microtask Queue     | Evento
──────────────────┼─────────────────────┼────────────────────────────
[]                | [ reaction(then2) ] | dequeue microtask


T8
Call Stack        | Microtask Queue     | Evento
──────────────────┼─────────────────────┼────────────────────────────
[ then2 ]         | []                  | console.log("B")

Output: B


T9
Call Stack        | Microtask Queue     | Evento
──────────────────┼─────────────────────┼────────────────────────────
[]                | []                  | fim
```

---

# Caso 5 — Múltiplos Awaits

## Código

```js
async function f() {
  console.log("A");
  await Promise.resolve();
  console.log("B");
  await Promise.resolve();
  console.log("C");
}

f();
```

---

## Timeline

```text
T0
Call Stack        | Microtask Queue     | Evento
──────────────────┼─────────────────────┼────────────────────────────
[]                | []                  | chamar f()


T1
Call Stack        | Microtask Queue     | Evento
──────────────────┼─────────────────────┼────────────────────────────
[ f ]             | []                  | console.log("A")

Output: A


T2
Call Stack        | Microtask Queue     | Evento
──────────────────┼─────────────────────┼────────────────────────────
[ f ]             | []                  | await Promise.resolve()
                                      | → suspende função
                                      | → agenda resume#1


T3
Call Stack        | Microtask Queue     | Evento
──────────────────┼─────────────────────┼────────────────────────────
[]                | [ resume#1 ]        | dequeue microtask


T4
Call Stack        | Microtask Queue     | Evento
──────────────────┼─────────────────────┼────────────────────────────
[ f ]             | []                  | retoma após await
                                      | console.log("B")

Output: B


T5
Call Stack        | Microtask Queue     | Evento
──────────────────┼─────────────────────┼────────────────────────────
[ f ]             | []                  | await Promise.resolve()
                                      | → suspende função
                                      | → agenda resume#2


T6
Call Stack        | Microtask Queue     | Evento
──────────────────┼─────────────────────┼────────────────────────────
[]                | [ resume#2 ]        | dequeue microtask


T7
Call Stack        | Microtask Queue     | Evento
──────────────────┼─────────────────────┼────────────────────────────
[ f ]             | []                  | retoma após await
                                      | console.log("C")

Output: C


T8
Call Stack        | Microtask Queue     | Evento
──────────────────┼─────────────────────┼────────────────────────────
[]                | []                  | fim
```

---

# Caso 6 — Inner Async sem Await Externo

## Código

```js
const inner = async () => {
  await Promise.resolve();
  console.log("X");
};

Promise.resolve()
  .then(async () => {
    inner();
  })
  .then(() => {
    console.log("Y");
  });
```

---

## Timeline

```text
T0
Call Stack        | Microtask Queue     | Evento
──────────────────┼─────────────────────┼────────────────────────────
[]                | []                  | Promise.resolve().then(...)
                                      | → agenda reaction(then1)


T1
Call Stack        | Microtask Queue     | Evento
──────────────────┼─────────────────────┼────────────────────────────
[]                | [ reaction(then1) ] | dequeue microtask


T2
Call Stack        | Microtask Queue     | Evento
──────────────────┼─────────────────────┼────────────────────────────
[ then1 ]         | []                  | chamar inner()


T3
Call Stack        | Microtask Queue     | Evento
──────────────────┼─────────────────────┼────────────────────────────
[ then1, inner ]  | []                  | await Promise.resolve()
                                      | → suspende inner
                                      | → agenda resume(inner)


T4
Call Stack        | Microtask Queue     | Evento
──────────────────┼─────────────────────┼────────────────────────────
[]                | [ resume(inner),    | then1 termina
                  |   resolve-derived ] | → devolve Promise fulfilled


T5
Call Stack        | Microtask Queue     | Evento
──────────────────┼─────────────────────┼────────────────────────────
[]                | [ resume(inner),    | dequeue microtask
                  |   resolve-derived ] |


T6
Call Stack        | Microtask Queue     | Evento
──────────────────┼─────────────────────┼────────────────────────────
[ inner ]         | [ resolve-derived ] | retoma após await
                                      | console.log("X")

Output: X


T7
Call Stack        | Microtask Queue     | Evento
──────────────────┼─────────────────────┼────────────────────────────
[]                | [ resolve-derived ] | dequeue microtask


T8
Call Stack        | Microtask Queue     | Evento
──────────────────┼─────────────────────┼────────────────────────────
[ resolve-derived ] | []                | resolve promise derivada
                                      | → agenda reaction(then2)


T9
Call Stack        | Microtask Queue     | Evento
──────────────────┼─────────────────────┼────────────────────────────
[]                | [ reaction(then2) ] | dequeue microtask


T10
Call Stack        | Microtask Queue     | Evento
──────────────────┼─────────────────────┼────────────────────────────
[ then2 ]         | []                  | console.log("Y")

Output: Y


T11
Call Stack        | Microtask Queue     | Evento
──────────────────┼─────────────────────┼────────────────────────────
[]                | []                  | fim
```
