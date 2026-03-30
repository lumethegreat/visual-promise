# visual-promise — SPEC (actualizada)

## 0. Estado actual (P0 — já implementado)

### O que já existe no repositório

- **UI funcional (Visualizer)** com:
  - selector de exemplos (Casos **1..6**)
  - navegação na timeline: **Play/Pause**, **Step**, **Back**, **Reset**, **Speed slider**
  - **Scrubber** (slider) para ir a qualquer `Tn`
  - painéis: **Code**, **Call Stack**, **Microtask Queue**, **Event Log** (Current + Last 5), **Console**

- **Engine (fase 1 / fixtures determinísticas)**:
  - `simulateCase(caseId: 1|2|3|4|5|6)` devolve `TimelineStep[]` exactamente igual ao dataset.

- **Dataset + testes**:
  - dataset original: `DATASET.md`
  - expected fixtures: `src/engine/dataset/expected.ts`
  - testes: `src/engine/dataset.all.test.ts`

> Nota: nesta fase o engine ainda não “simula código”; apenas estabiliza o **formato da timeline** e permite evoluir UI/motor com regressão garantida.

---

## 1. Visão geral

**Nome:** `visual-promise`

**Tipo:** ferramenta didática (web)

**Objectivo:** visualizar, passo a passo, a evolução da **Call Stack** e da **Microtask Queue** (e eventos associados) em exemplos com **Promises** e **async/await**.

**Princípio didático:** cada estado `Tn` representa o estado **ANTES** de executar o evento descrito (convenção do dataset).

---

## 2. Modelo de timeline (contrato principal)

### 2.1 Estrutura de um Step (Tn)

Cada step é um snapshot do simulador:

```text
Tn
Call Stack        | Microtask Queue     | Evento
──────────────────┼─────────────────────┼────────────────────────────
[ ... ]           | [ ... ]             | descrição (multi-linha)

Output: <se houver console.log>
```

### 2.2 Tipos de labels (MVP)

**Call Stack** (labels livres, mas convenção do dataset):
- `example`, `f`, `inner`
- `then1`, `then2`, `asyncThen1`
- `resolve-derived`
- `then callback`

**Microtask Queue** (labels livres, mas convenção do dataset):
- `resume(fn)` / `resume#1`
- `reaction(thenN)`
- `resolve-derived`

### 2.3 Tipo TS usado no código

```ts
export interface TimelineStep {
  step: number;            // 0 => T0, 1 => T1...
  callStack: string[];
  microtaskQueue: string[];
  event: string;           // texto multi-linha
  output?: string;         // output do console no step (se existir)
  codeHighlight?: { startLine: number; endLine: number };
}
```

Fonte: `src/engine/types.ts`

---

## 3. Arquitectura (como os componentes interagem)

### 3.1 Data flow (alvo)

```
(UI) Editor code
      │
      ▼
(Parser/Analyzer — futuro)  code: string  ──►  SimModel
      │
      ▼
(Engine) Simulator Engine (core) ──► TimelineStep[]
      │
      ▼
(UI) Visualizer + Controls (play/step/scrub) + State
```

### 3.2 Arquitectura actual (P0)

- O editor ainda é **read-only** e usa snippets estáticos.
- O “engine” é `simulateCase(caseId)` baseado em fixtures.
- A UI consome `TimelineStep[]` e faz apenas **navegação** (não executa código real).

---

## 4. Componentes (módulos)

### 4.1 Engine (`src/engine/`)

- `types.ts` — contrato `TimelineStep`
- `simulator.ts` — `simulateCase(caseId)`
- `dataset/expected.ts` — timelines esperadas por caso
- `dataset/snippets.ts` — snippets mostrados na UI

### 4.2 UI (`src/ui/`)

- `App.tsx` — layout + wiring (caseId/stepIndex/playback)
- `components.tsx` — visualização dos painéis + playback
- `styles.ts` — estilos (inline) coerentes com o mock

---

## 5. Stack tecnológica (actual vs planeada)

### 5.1 Actual (P0)

- Node.js
- React + ReactDOM
- Vite
- TypeScript
- Vitest
- Styling: **inline CSS** (por agora)

### 5.2 Planeada (P2/P3)

- Monaco Editor (`@monaco-editor/react`) para editor real + highlight
- Babel (`@babel/parser` + `@babel/traverse`) para parser/analyzer do subset
- (Opcional) Zustand para state global (se começar a crescer)
- (Opcional) Framer Motion para animações (se quisermos transições mais ricas)
- (Opcional) Tailwind (se quiseres acelerar styling, mas não é necessário)

---

## 6. Roadmap (incrementos)

- **P1 — Motor real (core)**
  - representar entidades: promises, chains, jobs
  - FIFO da microtask queue
  - adoption / `resolve-derived`
  - gerar timeline a partir de `SimModel`
  - manter os testes do dataset como regressão

- **P2 — Parser (subset JS)**
  - `simulate(code: string)`
  - AST → `SimModel`
  - mapping AST nodes → linhas (para `codeHighlight`)

- **P3 — UX didáctica**
  - Monaco editável + highlight por step
  - tooltips/explicações (a partir dos docs/invariantes)
  - export/import exemplos

- **P4+ — avançado**
  - `.catch/.finally`, rejects/erros
  - `Promise.all/race/allSettled`
  - task queue + `setTimeout` (expandir para event loop completo)

---

## 7. Fonte de verdade / validação

- Dataset: `DATASET.md`
- Docs de regras e invariantes:
  - `docs/1-promises-regras-nucleares.md`
  - `docs/2-promises-algoritmo-operacional.md`
  - `docs/3-promises-padroes-e-invariantes.md`

- Testes: `npm test` deve passar sempre.

---

## 8. Referências de design (Excalidraw)

- Mock UI: `design/ui-mock.excalidraw`
- Arquitectura + roadmap: `design/roadmap-architecture.excalidraw`
