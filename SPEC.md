# Visual Promise — Especificações do Projecto

## 1. Visão Geral

**Nome:** visual-promise
**Tipo:** Ferramenta didática web
**Stack:** Node.js + React + Vite
**Objectivo:** Permitir a um developer escrever código JavaScript com Promises e visualizar, passo a passo, a evolução da **Call Stack** e da **Microtask Queue** segundo a spec ECMAScript.

---

## 2. Modelo de Simulação

### 2.1 Conceito Central

O programa **NÃO executa o código real**. Em vez disso, **simula** o que o engine JS faria, gerando uma timeline determinística de estados.

Cada estado (`Tn`) representa o estado **ANTES** de executar o evento descrito.

### 2.2 Estrutura de um Step (Tn)

```
Tn
Call Stack        | Microtask Queue     | Evento
──────────────────┼─────────────────────┼────────────────────────────
[ items... ]      | [ items... ]        | descrição do que acontece

Output: <se houver console.log>
```

### 2.3 Tipos de Items na Call Stack

| Item | Significado |
|------|-------------|
| `example` | Função nomeada em execução |
| `then1` | Handler de .then() em execução |
| `asyncThen1` | Handler async de .then() em execução |
| `resolve-derived` | Processamento interno de resolução de promise derivada |
| `<anonymous>` | Função anónima |

### 2.4 Tipos de Items na Microtask Queue

| Item | Significado |
|------|-------------|
| `resume(fn)` | Continuação de async function após `await` |
| `reaction(thenN)` | Callback agendado por `.then()` / `.catch()` / `.finally()` |
| `resolve-derived` | Resolução de promise derivada (quando handler retorna Promise) |

### 2.5 Eventos do Motor

| Evento | Descrição |
|--------|-----------|
| `FUNCTION_ENTER` | Função entra na call stack |
| `FUNCTION_EXIT` | Função sai da call stack |
| `CONSOLE_LOG` | Saída de console.log |
| `AWAIT_SUSPEND` | `await` suspende a função, agenda continuação |
| `PROMISE_RESOLVE` | Promise é resolvida internamente |
| `THEN_REGISTER` | `.then()` regista um callback |
| `MICROTASK_ENQUEUE` | Item adicionado à microtask queue |
| `MICROTASK_DEQUEUE` | Item removido da microtask queue e colocado na call stack |
| `ASYNC_RETURN_PROMISE` | Handler async retorna Promise (causa tick extra) |

---

## 3. Regras do Simulador (ECMAScript Promise Semantics)

### 3.1 Regras Principais

1. **`Promise.resolve(value)`** — Cria uma promise já resolvida. Qualquer `.then()` anexado agenda uma microtask imediata.

2. **`.then(handler)`** — Se a promise já estiver resolvida, agenda `reaction(handler)` como microtask. Se pendente, fica registado para quando resolver.

3. **`await expr`** — Equivalente a:
   - Avaliar `expr`
   - Se `expr` já é Promise resolvida: agenda `resume(fn)` como microtask, suspende função
   - Se `expr` é Promise pendente: suspende, retoma quando resolver
   - **Nota:** `await` SEMPRE suspende, mesmo que o valor já esteja resolvido (adiciona 1 tick)

4. **Microtask Queue** — FIFO. O engine processa toda a queue antes de voltar ao "idle". Cada item da queue é processado um de cada vez.

5. **Handler síncrono em `.then()`** — Quando o handler retorna um valor normal (não-Promise):
   - A promise derivada resolve imediatamente
   - Qualquer `.then()` seguinte é agendado como nova microtask

6. **Handler async em `.then()`** — Quando o handler é `async` (retorna implicitamente uma Promise):
   - O handler executa até ao primeiro `await` ou `return`
   - Ao terminar, devolve uma Promise fulfilled
   - A promise derivada precisa de um tick extra (`resolve-derived`) para resolver
   - Isso adiciona +1 microtask antes do próximo `.then()` poder executar

7. **`async function` chamada sem `await`** — A função executa sincronamente até ao primeiro `await`. O chamador recebe uma Promise, mas a execução sincrona acontece na call stack do chamador.

### 3.2 Pseudocódigo do Loop de Simulação

```
enquanto (callStack.length > 0 OU microtaskQueue.length > 0):
    se callStack.length > 0:
        executar próximo passo da função no topo da stack
        se função faz await:
            suspender → agendar resume como microtask
            pop da call stack
        se função termina:
            pop da call stack
            se promise derivada precisa resolver:
                agendar resolve-derived como microtask

    senão se microtaskQueue.length > 0:
        dequeue primeiro item
        push na call stack
        executar
```

---

## 4. Arquitectura do Sistema

```
┌──────────────────────────────────────────────────────────────┐
│                         Frontend (React)                      │
│                                                                │
│  ┌──────────────────┐     ┌────────────────────────────────┐  │
│  │   Code Editor     │     │        Visualização            │  │
│  │   (Monaco)        │     │                                │  │
│  │                    │     │  ┌──────────────────────────┐ │  │
│  │  - Syntax highlight│     │  │      Call Stack          │ │  │
│  │  - Linha actual    │     │  │      (vertical, push/pop)│ │  │
│  │    destacada       │     │  └──────────────────────────┘ │  │
│  │                    │     │  ┌──────────────────────────┐ │  │
│  └────────┬───────────┘     │  │    Microtask Queue       │ │  │
│           │                  │  │    (horizontal, FIFO)    │ │  │
│           ▼                  │  └──────────────────────────┘ │  │
│  ┌──────────────────┐     │  ┌──────────────────────────┐ │  │
│  │   Parser / AST    │     │  │     Console Output       │ │  │
│  │   (@babel/parser) │     │  └──────────────────────────┘ │  │
│  └────────┬───────────┘     │  ┌──────────────────────────┐ │  │
│           │                  │  │     Event Log            │ │  │
│           ▼                  │  │     (descrição textual)  │ │  │
│  ┌──────────────────┐     │  └──────────────────────────┘ │  │
│  │   Simulator       │     └────────────────────────────────┘  │
│  │   Engine          │                                         │
│  │                    │     ┌────────────────────────────────┐  │
│  │  - Gera timeline   │     │        Controls               │  │
│  │  - Array de Tn     │     │  ▶ ⏸ ⏭ ⟲  Speed: [━━━●━━━]   │  │
│  └──────────────────┘     └────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### 4.1 Fluxo de Dados

```
Código do utilizador
       │
       ▼
  [AST Parser] ──→ Árvore sintáctica
       │
       ▼
  [AST Analyzer] ──→ Modelo intermédio (funções, promises, then-chains, awaits)
       │
       ▼
  [Simulator Engine] ──→ Timeline (array de Tn)
       │
       ▼
  [Visualizer] ──→ Animação passo a passo na UI
```

---

## 5. Componentes

### 5.1 Parser + Analyzer (`src/parser/`)

Responsabilidade: Converter código JS num modelo que o simulador entenda.

**Input:** String de código JavaScript
**Output:** Modelo intermédio

```typescript
interface SimModel {
  functions: SimFunction[];
  promiseOps: SimPromiseOp[];      // Promise.resolve, .then, etc.
  awaitPoints: SimAwait[];         // await expressions
  consoleCalls: SimConsole[];      // console.log
  topLevelStatements: SimStmt[];   // statement execution order
}

interface SimFunction {
  name: string;
  isAsync: boolean;
  body: SimStmt[];
}

interface SimPromiseOp {
  type: 'resolve' | 'reject' | 'then' | 'catch' | 'finally';
  chainId: number;        // qual then-chain
  position: number;       // posição na chain
  handler: SimFunction;   // callback
}
```

### 5.2 Simulator Engine (`src/engine/`)

Responsabilidade: Executar o modelo intermédio e gerar a timeline.

**Input:** SimModel
**Output:** `TimelineStep[]`

```typescript
interface TimelineStep {
  step: number;           // T0, T1, T2...
  callStack: string[];    // items na call stack
  microtaskQueue: string[]; // items na microtask queue
  event: string;          // descrição do evento
  output?: string;        // console.log output (se houver)
  codeHighlight?: {       // linha a destacar no editor
    startLine: number;
    endLine: number;
  };
}
```

### 5.3 Visualizer UI (`src/ui/`)

Responsabilidade: Renderizar a timeline com animações.

**Componentes React:**
- `<Editor>` — Monaco editor com syntax highlighting e highlight da linha actual
- `<CallStack>` — Stack vertical com animações push/pop
- `<MicrotaskQueue>` — Queue horizontal FIFO com animações enqueue/dequeue
- `<ConsoleOutput>` — Lista de outputs de console.log
- `<EventLog>` — Descrição textual do evento actual
- `<Timeline>` — Scrubber/progressbar da timeline
- `<Controls>` — Play, Pause, Step, Reset, Speed slider

---

## 6. Stack Tecnológica

| Componente | Tecnologia | Razão |
|-----------|-----------|-------|
| Runtime | Node.js | Requisito |
| Frontend framework | React 19 | Ecossistema, componentes |
| Bundler/Dev server | Vite | Rápido, HMR |
| Code Editor | Monaco Editor (`@monaco-editor/react`) | Syntax highlighting, API rica |
| AST Parser | `@babel/parser` + `@babel/traverse` | Suporte completo a syntax moderna |
| State management | Zustand | Leve, simples |
| Animações | Framer Motion | Animações declarativas |
| Styling | Tailwind CSS | Rápido prototyping |
| Testing | Vitest | Nativo com Vite |

---

## 7. Estrutura de Pastas

```
visual-promise/
├── src/
│   ├── parser/                  # AST parsing + análise
│   │   ├── parse.ts                # @babel/parser wrapper
│   │   ├── analyze.ts             # Converte AST → SimModel
│   │   └── types.ts               # Tipos do SimModel
│   ├── engine/                  # Motor de simulação
│   │   ├── simulator.ts           # Gera timeline a partir de SimModel
│   │   ├── promise-mechanics.ts   # Regras de resolução de promises
│   │   ├── microtask-queue.ts     # Lógica da queue FIFO
│   │   ├── call-stack.ts          # Lógica da call stack
│   │   └── types.ts               # Tipos da TimelineStep
│   ├── ui/                      # Componentes React
│   │   ├── App.tsx
│   │   ├── Editor.tsx             # Monaco editor wrapper
│   │   ├── CallStack.tsx          # Visualização da stack
│   │   ├── MicrotaskQueue.tsx     # Visualização da queue
│   │   ├── ConsoleOutput.tsx      # Output de console.log
│   │   ├── EventLog.tsx           # Descrição do evento
│   │   ├── Timeline.tsx           # Scrubber da timeline
│   │   ├── Controls.tsx           # Play/Pause/Step/Reset/Speed
│   │   └── Layout.tsx             # Layout principal
│   ├── state/                   # Estado global
│   │   └── store.ts               # Zustand store
│   ├── examples/                # Exemplos pré-definidos
│   │   ├── async-await-basic.ts
│   │   ├── await-vs-then.ts
│   │   ├── then-chain-sync.ts
│   │   ├── then-chain-async.ts
│   │   ├── multiple-awaits.ts
│   │   └── inner-async-no-await.ts
│   └── main.tsx                 # Entry point
├── public/
│   └── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.js
└── README.md
```

---

## 8. Funcionalidades por Prioridade

### P0 — MVP (primeira versão funcional)
- [ ] Parser AST para código Promise/async-await
- [ ] Analyzer que gera SimModel
- [ ] Simulator que gera Timeline (T0...Tn)
- [ ] Visualização da Call Stack com push/pop animado
- [ ] Visualização da Microtask Queue com enqueue/dequeue animado
- [ ] Editor de código com syntax highlighting
- [ ] Controles: Play, Pause, Step-forward, Reset
- [ ] Console output
- [ ] Event log textual
- [ ] 3 exemplos pré-definidos (Casos 1, 2, 3 do dataset)

### P1 — Melhorias
- [ ] Highlight da linha actual no editor
- [ ] Timeline scrubber (click para saltar a qualquer Tn)
- [ ] Speed control (slider)
- [ ] Suporte a `Promise.all()`, `Promise.race()`, `Promise.allSettled()`
- [ ] Suporte a `Promise.reject()`, `.catch()`, `try/catch`
- [ ] Todos os 6 exemplos do dataset
- [ ] Step-back (recuar na timeline)
- [ ] Modo "explicação" com tooltips didácticos

### P2 — Avançado
- [ ] Editor de exemplos — utilizador cria e guarda os seus próprios
- [ ] Modo challenge — "prevê o output antes de correr"
- [ ] Comparação lado-a-lado com callback style
- [ ] Exportar timeline como imagem/GIF
- [ ] Suporte a `setTimeout` + Task Queue (expandir para event loop completo)
- [ ] Embeddable widget para blogs/docs

---

## 9. Dataset de Teste

O projecto deve reproduzir exactamente os 6 casos do dataset fornecido:

| Caso | Nome | Conceito-chave |
|------|------|----------------|
| 1 | Async/Await Basic | await suspende, resume como microtask |
| 2 | Await vs Then | Ordem: resume vs reaction na mesma queue |
| 3 | Then Chain Síncrona | Chain .then() com handlers síncronos |
| 4 | Then com Handler Async | Handler async = tick extra (resolve-derived) |
| 5 | Múltiplos Awaits | Vários awaits em sequência |
| 6 | Inner Async sem Await | async function chamada sem await externo |

Cada caso deve ser um teste automatizado que valida que o simulator gera a timeline correcta.

---

## 10. Desafios Técnicos

1. **Parsing de async/await** — O Babel parseia nativamente, mas o analyzer precisa de entender a semântica de suspensão/retoma.

2. **Promise resolution semantics** — A regra "se handler retorna Promise → tick extra" é o pormenor mais subtio (Caso 3 vs Caso 4). O simulador precisa de implementar `PromiseResolveThenableJob` da spec ECMAScript.

3. **Ordem de execução no script** — Quando o código tem múltiplas statements no top-level (ex: Caso 2), a ordem em que as promises são criadas e os `.then()` registados importa.

4. **Mapping AST → linhas de código** — Para o highlight no editor, cada step da timeline precisa de saber qual a linha do código original que está a ser executada.

---

## 11. Design UI (Wireframe)

```
┌──────────────────────────────────────────────────────────────────┐
│  🔮 Visual Promise                            [Speed: ▸▸] [?Help] │
├─────────────────────┬────────────────────────────────────────────┤
│                     │                                            │
│   ┌───────────────┐ │  ┌──────────────────────────────────────┐  │
│   │               │ │  │         CALL STACK                   │  │
│   │  Code Editor  │ │  │                                      │  │
│   │               │ │  │    ┌──────────────────────┐          │  │
│   │               │ │  │    │  then1()             │ ◄── novo │  │
│   │               │ │  │    ├──────────────────────┤          │  │
│   │   ▸ linha     │ │  │    │  <anonymous>         │          │  │
│   │     actual    │ │  │    └──────────────────────┘          │  │
│   │               │ │  └──────────────────────────────────────┘  │
│   │               │ │                                            │
│   │               │ │  ┌──────────────────────────────────────┐  │
│   └───────────────┘ │  │       MICROTASK QUEUE                │  │
│                     │  │                                      │  │
│  ┌───────────────┐  │  │   [resume(f)] → [reaction(then2)]    │  │
│  │ Exemplo: ▾    │  │  │       ▲ dequeue                      │  │
│  │ ○ Caso 1      │  │  └──────────────────────────────────────┘  │
│  │ ○ Caso 2      │  │                                            │
│  │ ● Caso 3      │  │  ┌──────────────────────────────────────┐  │
│  │ ○ Caso 4      │  │  │        CONSOLE                       │  │
│  │ ○ ...         │  │  │  > start                             │  │
│  └───────────────┘  │  │  > A                                 │  │
│                     │  └──────────────────────────────────────┘  │
│                     │                                            │
│                     │  ┌──────────────────────────────────────┐  │
│                     │  │    EVENT: "console.log('A')"          │  │
│                     │  │    then1 handler a executar...        │  │
│                     │  └──────────────────────────────────────┘  │
│                     │                                            │
│                     │  ┌──────────────────────────────────────┐  │
│                     │  │  T0  T1  T2  T3● T4  T5  T6  T7     │  │
│                     │  │  ────●────●────●────●────●────●──    │  │
│                     │  └──────────────────────────────────────┘  │
├─────────────────────┴────────────────────────────────────────────┤
│  [▶ Play]  [⏸ Pause]  [⏭ Step]  [⏮ Back]  [⟲ Reset]             │
└──────────────────────────────────────────────────────────────────┘
```
