# Partial Support UX Design — Visual Promise

**Document status:** Draft
**Author:** VP-UX-Designer
**Last updated:** 2026-03-18
**Related:** `docs/capability-matrix.md`

---

## Overview

Visual Promise is a pedagogical tool. Users paste JavaScript snippets to see Promise/async behavior visualized step by step. The audience is developers learning async JavaScript — they may be confused or frustrated if they don't understand why their code isn't fully visualized.

Every snippet falls into one of three capability states:

| State | Visual | What happens |
|---|---|---|
| **Full** | Green | Visualization runs completely |
| **Partial** | Amber | Visualization runs but some behavior can't be traced |
| **Unsupported** | Red | Visualization is blocked; error shown |

This document specifies how the app communicates these states to users at every touchpoint — banners, inline indicators, error messages, and UX flows.

---

## Section 1: Capability Banner Component

The `CapabilityBanner` is the primary way users learn about a snippet's support level. It appears at the top of the visualization area, immediately after code is pasted or validated.

### `CapabilityBanner` — "full" state

**When it renders:** The user has pasted a fully supported snippet.

**Appearance:**
- Background: `#f0fdf4` (light green)
- Border-left: 4px solid `#22c55e` (green)
- Icon: `✓` or a checkmark circle in `#22c55e`
- Text color: `#166534` (dark green)
- No expand/collapse — it is compact and quiet

**Copy:**
```
✓  Ready to visualize
Your snippet uses supported Promise/async patterns. Click Run to see it step by step.
```

**Actions:**
- `[Run →]` — primary CTA button (green), enabled

**Behavior:**
- Does NOT block the Run button. The visualization proceeds normally.
- Does NOT persist in a collapsed state across sessions — it simply doesn't render if the snippet is full (cleaner UI).
- Dismissible: users can click `×` to hide it, but it reappears on next paste.

**Layout note:** In full state, a brief inline indicator replaces the full banner:
```
✓ Ready to visualize          [Run →]
```
This keeps the visual weight low for the happy path.

---

### `CapabilityBanner` — "partial" state

**When it renders:** The code contains a partially-supported construct (e.g., async handler inside `.then()`, foreign callback in executor).

**Appearance:**
- Background: `#fffbeb` (light amber)
- Border-left: 4px solid `#f59e0b` (amber)
- Icon: `⚠️` (warning triangle) or a half-filled circle in `#f59e0b`
- Text color: `#92400e` (dark amber)
- Collapsible with `[▼]/[▲]` toggle on the right
- Default state: **expanded** (because partial support requires explanation)

**Copy (expanded):**
```
┌──────────────────────────────────────────────────────────────┐
│ ⚠️  Partial Support — some behavior may not be visible       │
│                                                    [▲ Hide]  │
│                                                                      │
│ This snippet contains an async function passed to .then().          │
│ Nested awaits inside the handler are visualized, but calls          │
│ to external functions (like 'fetchUser') cannot be traced.          │
│                                                                      │
│ [Edit snippet]                               [See examples →]        │
└──────────────────────────────────────────────────────────────┘
```

**Copy (collapsed):**
```
⚠️  Partial support — 1 thing can't be visualized    [▼]
```

**Actions:**
- `[Edit snippet]` — focuses the code editor
- `[See examples →]` — opens a side panel or modal with working alternatives
- `[▲ Hide]` / `[▼ Show details]` — toggles the expanded explanation

**Behavior:**
- The Run button is **enabled** with an amber accent: `[Run ▶]` (amber border/text, not green).
- A subtle label `[partial]` appears next to the Run button.
- The visualization starts but flags the unsupported parts as it reaches them.

**Dynamic behavior:** When the visualization reaches an untraced foreign call, it:
1. Pauses step progression
2. Flashes the banner briefly (subtle pulse animation)
3. Expands the banner if it was collapsed
4. Greys out or marks the untraced step in the replay panel

---

### `CapabilityBanner` — "unsupported" state

**When it renders:** The code contains a known-unsupported construct (setTimeout, fetch, import, top-level await, Promise.all, self-referential promise, etc.).

**Appearance:**
- Background: `#fef2f2` (light red)
- Border-left: 4px solid `#ef4444` (red)
- Icon: `✕` or a circle with X in `#ef4444`
- Text color: `#991b1b` (dark red)
- NOT collapsible — the message must be seen

**Copy:**
```
┌──────────────────────────────────────────────────────────────┐
│ ✕  Cannot visualize this snippet                            │
│                                                              │
│ [Error message specific to the detected pattern —           │
│  see Section 4 for full library]                            │
│                                                              │
│ [Edit snippet]              [See supported patterns →]       │
└──────────────────────────────────────────────────────────────┘
```

**Actions:**
- `[Edit snippet]` — focuses the code editor so the user can fix the issue
- `[See supported patterns →]` — opens a curated list of working example snippets

**Behavior:**
- The Run button is **disabled** with a tooltip: "This snippet contains unsupported patterns. Edit the code to continue."
- Visualization is blocked entirely — no steps run, no replay panel populates.
- The unsupported construct is highlighted inline in the editor (red background on the offending line(s); see Section 3).

---

### Banner Design Specs

```
Height (collapsed):  40px
Height (expanded):   auto, min 80px, max 160px
Padding:             12px 16px
Border radius:       6px
Font family:         system-ui, -apple-system, sans-serif
Font size:           14px (body), 13px (secondary)
Font weight:         500 (heading), 400 (body)
Icon size:           16px
Collapse toggle:     right-aligned, 13px, muted text color
Action buttons:      13px, underline on hover, no button chrome
Animation:           height 200ms ease-out, opacity 150ms ease-in
```

---

## Section 2: The Three-State UX Flow

### Flow for "full" snippets

```
1. User types or pastes code into the editor
   ↓
2. Validation runs (synchronous, <50ms)
   ↓
3. Result: FULL capability
   ↓
   ┌─ Inline status bar shows: "✓ Ready to visualize"
   └─ [Run ▶] button is green and enabled
4. User clicks Run
   ↓
5. Visualization begins immediately; step panel populates
   ↓
6. Replay panel shows each step with explanations
   ↓
7. On completion: "Done!" or summary shown
```

**Edge case — snippet becomes "full" after editing:**
- If the user edits code while a partial-banner is showing and the code becomes fully supported, the banner transitions out with a 300ms fade. No reload required.

---

### Flow for "partial" snippets

```
1. User types or pastes code into the editor
   ↓
2. Validation runs; pattern analysis identifies partial-support construct
   ↓
3. Result: PARTIAL capability with reason(s)
   ↓
   ┌─ Amber banner appears, expanded by default
   └─ [Run ▶] button is amber-bordered, enabled
4. User clicks Run (or visualization auto-starts if configured)
   ↓
5. Visualization runs through supported steps normally
   ↓
6. When an untraced foreign call is reached:
   a. Current step in replay panel is marked with ⚠️
   b. Banner pulses once (subtle amber flash)
   c. Step is greyed out with note: "Cannot trace this call"
   d. Playback pauses if in step-by-step mode
   ↓
7. User can:
   a. Resume playback (skips the untraced step)
   b. Click [Edit snippet] to fix the code
   c. Click [See examples] to load a working alternative
   ↓
8. On completion: partial-summary shown:
   "Visualization complete (partial) — 3 steps shown, 1 call not traced"
```

**Partial summary card (shown at end of playback):**
```
┌─────────────────────────────────────────────────────────┐
│  ⚠️  Partial visualization                               │
│                                                          │
│  3 steps were visualized successfully.                   │
│  1 external call could not be traced:                   │
│                                                          │
│    Line 7: fetchUser(id)  — function defined outside     │
│            this snippet                                  │
│                                                          │
│  [Edit snippet]          [Try a full example →]          │
└─────────────────────────────────────────────────────────┘
```

---

### Flow for "unsupported" snippets

```
1. User types or pastes code into the editor
   ↓
2. Validation runs; pattern analysis identifies unsupported construct
   ↓
3. Result: UNSUPPORTED with specific error key
   ↓
   ┌─ Red banner appears immediately (no Run required)
   └─ [Run ▶] button is disabled with tooltip
   └─ Offending line(s) highlighted in red in the editor
   ↓
4. User can:
   a. Click [Edit snippet] to focus editor
   b. Click [See supported patterns →] for alternatives
   c. Read the error message and fix manually
   ↓
5. When code is edited:
   a. Validation re-runs on every keystroke (debounced 300ms)
   b. Banner updates or disappears as issues are resolved
   ↓
6. When code becomes supported (full or partial):
   a. Red banner fades out (300ms)
   b. New banner (amber or inline green) appears
   c. Run button enables
```

**No playback starts until the code is fixed.** This is intentional — we block early and clearly rather than letting the user run code that will fail in confusing ways.

---

## Section 3: Inline Capability Indicators

Inline indicators live in the code editor. They annotate specific lines with glyphs and tooltips so users can see exactly which construct is causing an issue.

### CodeMirror Integration

We use CodeMirror 6's `Decoration` API to add inline markers:

```typescript
// Line decoration types
const lineWarningDecoration = Decoration.line({
  class: "cm-line-partial-support",
});

const lineErrorDecoration = Decoration.line({
  class: "cm-line-unsupported",
});

// Inline widget for glyph in gutter
const unsupportedGlyph = Decoration.widget({
  widget: new InlineWarningWidget("✕", "unsupported"),
  side: "left",
});
```

### Visual Treatment Per Line

| Line type | Left gutter | Line background | Hover cursor |
|---|---|---|---|
| Supported | (none) | (none) | default |
| Partial (flagged) | ⚠️ amber glyph | `#fffbeb` (faint amber tint) | help |
| Unsupported | ✕ red glyph | `#fef2f2` (faint red tint) | not-allowed |

### Hover Tooltips

When the user hovers over a flagged line, a tooltip appears:

**Partial line tooltip:**
```
⚠️  Partial support
This async function is traced, but calls to
'fetchUser' (line 7) cannot be followed.
[Learn more →]
```

**Unsupported line tooltip:**
```
✕  Not supported
'setTimeout' is not part of the supported subset.
[Edit snippet]
```

Tooltip specs:
- Appears 400ms after hover (no flicker on quick mouse-throughs)
- Positioned above the line if there's room, below if near the top
- Max width: 280px
- Dismissible by clicking elsewhere or pressing Escape
- Closes when the cursor leaves the line

### CodeMirror Theme Additions

```css
.cm-line-partial-support {
  background-color: rgba(245, 158, 11, 0.08);
  border-left: 3px solid #f59e0b;
}

.cm-line-unsupported {
  background-color: rgba(239, 68, 68, 0.08);
  border-left: 3px solid #ef4444;
}

.cm-glyph-warning::before {
  content: "⚠";
  color: #f59e0b;
  font-size: 12px;
  margin-right: 4px;
}

.cm-glyph-error::before {
  content: "✕";
  color: #ef4444;
  font-size: 12px;
  margin-right: 4px;
}
```

### Multi-line Constructs

For constructs that span multiple lines (e.g., an `import` statement, or an entire `async function` block containing unsupported code), the entire span is highlighted. The gutter glyph appears at the first line; the background tint covers all lines in the span.

### Animation on Edit

When a user removes an unsupported construct:
1. The red line decoration is removed (150ms fade)
2. If the remaining code is partial: amber decoration fades in (150ms)
3. If fully supported: all decorations removed, green inline status appears

---

## Section 4: Error Messages Library

Each error message is keyed by a machine-readable `errorKey`. The UI renders the message from this library. Copy must be clear, non-technical where possible, and always offer a constructive next step.

### Error Key: `TIMER_NOT_SUPPORTED`

```
⚠️  Timer APIs are not supported

"setTimeout" and "setInterval" are not part of the supported
subset. Visual Promise focuses on Promise/async/await behavior.

Try removing timers and running your snippet again.
For a timer-like example, try chaining Promises with manual
resolve/reject calls instead.

[Edit snippet]                          [Try an example →]
```

**Severity:** error
**Block playback:** yes

---

### Error Key: `NETWORK_NOT_SUPPORTED`

```
⚠️  Network requests are not supported

fetch() and other network APIs are not supported in this tool.
Visual Promise executes code in a sandboxed environment without
network access.

Try a snippet with Promise.resolve() instead — it demonstrates
the same Promise mechanics without network I/O.

[Edit snippet]                          [Try an example →]
```

**Severity:** error
**Block playback:** yes

---

### Error Key: `IMPORT_EXPORT_NOT_SUPPORTED`

```
⚌  import and export are not supported

This tool visualizes individual JavaScript snippets, not modules.
import and export statements cannot be used here.

To visualize Promise behavior, try pasting just the function
that uses Promises — without any module syntax.

[Edit snippet]                          [Try an example →]
```

**Severity:** error
**Block playback:** yes

---

### Error Key: `PROMISE_COMBINATOR_NOT_SUPPORTED`

```
⚠️  Promise combinators are not yet supported

Promise.all(), Promise.race(), Promise.allSettled(), and
Promise.any() are powerful APIs, but they're not yet supported
in this version.

For now, try visualizing a simple .then() chain instead.
We're planning to add combinator support in a future release.

[Edit snippet]                          [See roadmap →]
```

**Severity:** error
**Block playback:** yes
**Special note:** Include a "planned" indicator since this is a roadmap item, not a permanent limitation.

---

### Error Key: `TOP_LEVEL_AWAIT`

```
⚌  Top-level await is not supported

await can only be used inside async functions. JavaScript
throws a SyntaxError at parse time when await appears
outside an async context.

Wrap your code in an async function:

    async function main() {
      // your code here
    }
    main();

[Edit snippet]                          [Try an example →]
```

**Severity:** error
**Block playback:** yes
**Inline suggestion:** Auto-suggest wrapping by showing ghost text or a quick-action button: `[Wrap in async fn]`

---

### Error Key: `SELF_REFERENTIAL_PROMISE`

```
⚌  Circular promise reference detected

A promise cannot resolve with itself. This creates an
unresolvable state — the promise would need to be fulfilled
before it can be fulfilled.

    const p = new Promise(resolve => resolve(p));
    //                      ^^^^^^^^  this is the problem

Check your code and try again. Common causes: passing 'self'
as the resolve value, or returning the same promise from
its own executor.

[Edit snippet]
```

**Severity:** error
**Block playback:** yes

---

### Error Key: `ASYNC_HANDLER_PARTIAL`

```
⚠️  Async handler in .then() — partial visualization

This snippet passes an async function to .then(). This is
valid JavaScript, but it creates nested async boundaries.

What's visualized:
  ✓  The outer Promise chain (.then/.catch/.finally)
  ✓  await expressions inside the async handler
  ✓  Promise values returned from the handler

What can't be traced:
  ✗  Calls to functions defined outside this snippet
       (e.g., fetchUser(), apiCall())

You can still run the visualization. The outer chain will
be shown step by step. The untraced call will be flagged
when it's reached.

[Edit snippet]              [See a fully supported example →]
```

**Severity:** warning
**Block playback:** no (partial run allowed)

---

### Error Key: `FOREIGN_CALLBACK_IN_EXECUTOR`

```
⚌  Foreign callback in executor

The Promise executor (the function you pass to `new Promise`)
should only call resolve() or reject(). Calling other functions
creates control flow we can't trace or visualize.

    new Promise((resolve, reject) => {
      externalCallback(data);  // ✗ not supported
      resolve(value);          // ✓ only this is supported
    });

If you're trying to wrap a callback-based API in a Promise,
consider using a different pattern or pasting a simpler example.

[Edit snippet]              [See a fully supported example →]
```

**Severity:** warning
**Block playback:** no (partial run allowed)

---

### Error Key: `MULTIPLE_ERRORS`

When multiple unsupported patterns are detected simultaneously, show a summary banner:

```
┌──────────────────────────────────────────────────────────────┐
│ ✕  Cannot visualize — 3 issues found                          │
│                                                               │
│  1. Line 3: setTimeout is not supported                      │
│  2. Line 8: import statement is not supported                 │
│  3. Line 12: Top-level await is not supported                 │
│                                                               │
│  Fix these issues and the visualization will be enabled.      │
│                                                               │
│  [Edit snippet]                        [See supported patterns →]│
└──────────────────────────────────────────────────────────────┘
```

Each listed issue links to its line in the editor (click to scroll/jump).

---

## Section 5: Component Architecture

### Component Tree

```
<CapabilityGate>
  └─ <VisualizationLayout>
       ├─ <EditorPanel>
       │    └─ <InlineCapabilityDecorations />  (internal)
       │
       ├─ <DiagnosticsPanel>
       │    ├─ <CapabilityBanner level={capability} />
       │    └─ <ValidationMessages />
       │         └─ <ValidationMessage key={errorKey} />
       │
       └─ <ReplayPanel>
            ├─ <StepList />
            └─ <StepExplanation step={current} />
```

### `<CapabilityGate>`

**Purpose:** Root wrapper that decides whether to render the full visualization or the blocked state.

**Props:**
```typescript
interface CapabilityGateProps {
  snippet: string;                    // Raw code string
  validation: ValidationResult;      // Result from the validator
  children: React.ReactNode;         // Normal visualization children
}
```

**What it renders:**
- If `validation.capability === 'full'` or `'partial'`: renders `children` (the full visualization layout)
- If `validation.capability === 'unsupported'`: renders `children` but with a locked/intercepted state (Run button disabled, banner shown)
- Always renders the editor panel (users need to see and edit their code)

**State handling:**
```typescript
switch (validation.capability) {
  case 'full':
    return <UnblockedLayout>{children}</UnblockedLayout>;
  case 'partial':
    return <PartialLayout>{children}</PartialLayout>;
  case 'unsupported':
    return <BlockedLayout>{children}</BlockedLayout>;
}
```

---

### `<VisualizationLayout>`

**Purpose:** Flex/grid layout container for the three main panels.

**Props:**
```typescript
interface VisualizationLayoutProps {
  editor: React.ReactNode;
  diagnostics: React.ReactNode;
  replay: React.ReactNode;
  state: 'full' | 'partial' | 'unsupported';
}
```

**Layout behavior:**
- Desktop: three-column layout (editor | diagnostics | replay)
- Mobile: stacked (editor on top, diagnostics in middle, replay below)
- In `unsupported` state: replay panel is hidden or shows a placeholder ("Edit your snippet to begin")

---

### `<EditorPanel>`

**Purpose:** CodeMirror editor wrapper with inline capability decorations.

**Props:**
```typescript
interface EditorPanelProps {
  code: string;
  onChange: (code: string) => void;
  decorations: DecorationSet;       // Built from validation result
  readOnly?: boolean;
}
```

**What it renders:**
- CodeMirror 6 editor instance
- Attaches `Decoration.line()` for unsupported/partial lines
- Attaches gutter widgets for glyph icons
- Shows hover tooltips via a custom tooltip extension

**Three-state behavior:**
- `full`: no decorations, normal editor
- `partial`: amber decorations on flagged lines, amber gutter glyphs
- `unsupported`: red decorations on offending lines, red gutter glyphs, cursor shows `not-allowed` on those lines

---

### `<DiagnosticsPanel>`

**Purpose:** Right-side panel that shows the banner and validation messages.

**Props:**
```typescript
interface DiagnosticsPanelProps {
  validation: ValidationResult;
  onEditSnippet: () => void;
  onShowExamples: () => void;
}
```

**What it renders:**
- `CapabilityBanner` at the top
- List of `ValidationMessage` items (for multiple errors)
- Collapsible on desktop (chevron), always visible on mobile

---

### `<CapabilityBanner level={capability} />`

**Purpose:** The primary capability status indicator.

**Props:**
```typescript
interface CapabilityBannerProps {
  level: 'full' | 'partial' | 'unsupported';
  partialDetails?: PartialDetails;  // e.g., { untracedCalls: string[] }
  onEditSnippet: () => void;
  onShowExamples: () => void;
}
```

**What it renders:** (see Section 1 for full specs)
- Full: compact inline indicator with checkmark
- Partial: collapsible amber banner with explanation
- Unsupported: non-collapsible red banner with specific error message

**Interaction:**
- Collapse toggle updates local `useState`; no external state needed
- Action buttons call provided callbacks
- Animates in on mount (fade + slide down, 200ms)

---

### `<ValidationMessages />`

**Purpose:** Renders the list of all detected issues.

**Props:**
```typescript
interface ValidationMessagesProps {
  messages: ValidationMessage[];  // One per detected issue
  onJumpToLine: (line: number) => void;
}
```

**What it renders:**
- A list of `ValidationMessage` items, each showing:
  - Severity icon (⚠️ for warnings, ✕ for errors)
  - The error message (from the library in Section 4)
  - A `[Line N]` link that jumps to the offending line in the editor
- If no issues: renders nothing

---

### `<ReplayPanel>`

**Purpose:** Step-by-step playback of the visualization.

**Props:**
```typescript
interface ReplayPanelProps {
  steps: VisualizationStep[];
  currentStep: number;
  paused: boolean;
  pauseReason?: string;  // e.g., "Untraced foreign call"
}
```

**Three-state behavior:**
- `full`: normal playback, all steps shown with full explanations
- `partial`: steps leading up to the untraced call are shown normally; the untraced step is greyed out with a ⚠️ badge; steps after are hidden or shown as "skipped"
- `unsupported`: shows a placeholder state: "Edit your snippet to begin visualization" with a prompt icon

---

### Data Flow

```
User pastes code
       ↓
useValidation(code) hook
       ↓
validator.analyze(code) → ValidationResult
       ↓
ValidationResult { capability, messages[], partialDetails }
       ↓
    ├─→ CapabilityBanner (reads .capability)
    ├─→ EditorPanel decorations (computed from .messages)
    ├─→ ValidationMessages (renders .messages[])
    └─→ ReplayPanel (reads .capability to set initial state)
```

**Validation runs on:**
- Initial paste (debounced 300ms after last keystroke)
- Every subsequent keystroke (debounced 300ms)
- On "Run" click (synchronous final check)

---

## Section 6: Design Principles

### Principle 1: Fail fast, fail clearly

Unsupported patterns must be detected and displayed **immediately** — not after the user clicks Run, not at step 3 of playback. The moment the validator identifies a known-unsupported construct, the red banner appears. The user should never have to wait for a confusing runtime error.

### Principle 2: Never silently degrade

If a snippet is partial, say so explicitly. Never show partial behavior as if it were complete. The banner, the inline decorations, the step badges, and the end-of-playback summary must all tell a consistent story: "this much was visualized, and here's what wasn't."

### Principle 3: Help without overwhelming

Our audience is developers learning async JavaScript. They may already be confused about why their code doesn't work the way they expect. Error messages must:
- Use plain language first, technical terms second
- State the problem clearly in the first line
- Offer a concrete next step (edit, see example, try this instead)
- Never say "invalid" without saying *why* it's invalid

### Principle 4: Visualization always shows what it can

Partial support is not a failure state — it's a feature. When a snippet is partial, the visualization should still run for the supported parts. The user gets value from seeing the parts that work, and learns from seeing exactly where the boundary is.

### Principle 5: Transitions must be smooth

When a user edits code, the UI should update gracefully. A red banner shouldn't disappear and then reappear in the same frame. Decorations should fade in/out smoothly. The Run button should transition from disabled to enabled without a jarring state flip. Every state change should be animated (200–300ms ease).

### Principle 6: Every message has a next step

Every banner, tooltip, and error message must include at least one actionable next step. "Edit snippet" is the minimum. "See an example that works" is better. Never leave the user stuck with a dead end — if we can't visualize something, we must show them how to get to something we can visualize.

---

## Appendix: Color Reference

| Token | Hex | Usage |
|---|---|---|
| `--color-full-bg` | `#f0fdf4` | Full state banner background |
| `--color-full-border` | `#22c55e` | Full state banner left border |
| `--color-full-text` | `#166534` | Full state banner text |
| `--color-partial-bg` | `#fffbeb` | Partial state banner background |
| `--color-partial-border` | `#f59e0b` | Partial state banner left border |
| `--color-partial-text` | `#92400e` | Partial state banner text |
| `--color-partial-line-bg` | `rgba(245,158,11,0.08)` | Partial line decoration |
| `--color-error-bg` | `#fef2f2` | Unsupported state banner background |
| `--color-error-border` | `#ef4444` | Unsupported state banner left border |
| `--color-error-text` | `#991b1b` | Unsupported state banner text |
| `--color-error-line-bg` | `rgba(239,68,68,0.08)` | Unsupported line decoration |

---

## Open Questions (TODO)

1. **Step-by-step pause UX**: When partial visualization pauses at an untraced call, should it auto-pause playback or just flag it in the step list? Preference: auto-pause with a "Resume anyway" option.
2. **Quick-fix actions**: Should we offer one-click fixes for common issues (e.g., "Wrap in async function" for top-level await, "Remove setTimeout" for timer patterns)?
3. **Example library**: Where do the "Try an example →" links point? A static MDX page? An in-app modal? Need a spec for the examples page.
4. **Persistence**: Should the partial-banner re-appear if the user reloads the page with a partial snippet in the editor? Recommendation: yes — it aids learning.
5. **Analytics**: Should we track which unsupported patterns are most common? This would inform prioritization of the roadmap (e.g., Promise.all support).
