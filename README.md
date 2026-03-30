# visual-promise

Ferramenta didática para visualizar **Call Stack** e **Microtask Queue** em código JavaScript com **Promises** e **async/await**, passo a passo.

> Estado actual: **MVP funcional** com UI + dataset determinístico (fixtures) via `simulateCase(1..6)`.

## Demo local

### Requisitos
- Node.js (testado com Node **v24**)

### Instalar
```bash
npm install
```

### Correr
```bash
npm run dev
```

### Testes
```bash
npm test
```

### Build
```bash
npm run build
npm run preview
```

---

## O que existe neste momento

### UI (Visualizer)
- Selector de exemplos (Casos 1..6)
- Timeline controls: **Play/Pause**, **Step/Back**, **Reset**, **Speed**, scrubber **T0..Tn**
- Painéis:
  - **Call Stack**
  - **Microtask Queue (FIFO)**
  - **Event Log** (Current event + Last 5)
  - **Console** (outputs acumulados até ao step actual)

### Motor (fase 1)
- `simulateCase(caseId)` devolve a timeline **exacta** do dataset (fixtures) para estabilizar:
  - formato de `TimelineStep`
  - UI
  - testes de regressão

> Próxima evolução: substituir fixtures por um motor real que gera a timeline a partir de um **SimModel** (e depois a partir de `code: string`).

---

## Dataset (source of truth)

- Dataset original: [`DATASET.md`](./DATASET.md)
- Timelines esperadas (fixtures): [`src/engine/dataset/expected.ts`](./src/engine/dataset/expected.ts)
- Snippets por caso: [`src/engine/dataset/snippets.ts`](./src/engine/dataset/snippets.ts)
- Testes:
  - [`src/engine/dataset.all.test.ts`](./src/engine/dataset.all.test.ts)

---

## Docs (regras e invariantes)

Documentos que formalizam as regras operacionais e servem de base para o motor:

- [`docs/1-promises-regras-nucleares.md`](./docs/1-promises-regras-nucleares.md)
- [`docs/2-promises-algoritmo-operacional.md`](./docs/2-promises-algoritmo-operacional.md)
- [`docs/3-promises-padroes-e-invariantes.md`](./docs/3-promises-padroes-e-invariantes.md)

---

## Arquitectura (alto nível)

Data flow desejado (visível no diagrama):

1) **Editor** (código do utilizador)
2) (Futuro) **Parser/Analyzer** (Babel) → `SimModel`
3) **Simulator Engine** → `TimelineStep[]`
4) **UI Visualizer** renderiza a timeline e permite navegação

---

## Diagramas (Excalidraw)

Podes abrir os `.excalidraw` em https://excalidraw.com (drag & drop do ficheiro):

- UI mock: [`design/ui-mock.excalidraw`](./design/ui-mock.excalidraw)
- Roadmap + arquitectura: [`design/roadmap-architecture.excalidraw`](./design/roadmap-architecture.excalidraw)

---

## Roadmap (resumo)

- **P1 — Motor real**: entidades (promises, jobs), FIFO, adoption/resolve-derived, gerar timeline a partir de `SimModel`, manter testes.
- **P2 — Parser subset**: `simulate(code: string)` via Babel, mapping para linhas do editor.
- **P3 — UX didáctica**: Monaco editável, highlight por step, tooltips/explicações, export/import exemplos.
- **P4+**: `.catch/.finally`, rejects/erros, `Promise.all/race`, task queue + `setTimeout`, export GIF.

---

## Estrutura de pastas (curta)

- `src/engine/` — simulação + dataset fixtures + testes
- `src/ui/` — UI/visualização
- `docs/` — regras/invariantes para o motor
- `design/` — Excalidraw (UI + roadmap)

---

## Licença

TBD.
