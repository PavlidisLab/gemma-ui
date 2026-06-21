# Statement / term widget unification

**Goal:** maintainability. Today four parallel renderers draw ontology
terms and S‑P‑O statements with almost no shared code. Converge them on a
**shared core**, with each surface *extending* the core rather than being
forced into one identical component (Paul 2026-06-21: "let's not force two
components to be the same thing; the fvcompare version is an extension of
the basic one … don't break anything").

## Current state (the drift)

| Renderer | File | Draws | Shares the leaf? |
|---|---|---|---|
| `Term` | `components/ui/Term.tsx` | one leaf chip (label + CURIE popover) | — (it *is* the leaf) |
| `StatementChip` (3 sizes) | `components/ui/StatementChip.tsx` | subject · pred · object | ✅ uses `Term`. Dev-preview only |
| `FvDisplayRow` | `packages/ontology/src/FvDisplayRow.tsx` | S‑P‑O **+** baseline glyph, `(n)`, per-slot diff, multi-statement stacking | ✅ via `termRenderer` → `Term` |
| `TagValueChip` / `TagGroupChip` | `features/overview/OverviewPanel.tsx` | S‑P‑O + category grouping + "+N more" + inline edit | ❌ **hand-rolls** label + `CurieLink`, bypassing `Term` |

The shared **core** is: the `Term` leaf + the S‑P‑O walk (subject · pred ·
object). `FvDisplayRow` is the comparison **extension** (adds baseline /
`(n)` / diff / stacking). `TagValueChip` is the TagBar extension (adds
grouping / "+N more" / edit). Nothing should flatten one into another —
the extensions keep their extras.

## Guardrails (do not break)

- The **comparison surface** is delicate. The `@critical` Playwright spec
  `e2e/_factor_grid_unified.spec.ts` fences its render — every commit runs
  it via the pre-commit hook. Do not touch `FvDisplayRow`'s diff /
  sample-count / stacking behaviour without that spec staying green.
- Behaviour-preserving only unless a change is explicitly requested.
  Same chips, same colours, same truncation, same tooltips.
- Run `npx vitest run` + the `@critical` e2e before every commit (the
  hook enforces this; don't `--no-verify`).

## Phases (each its own commit)

### Phase 0 — TagBar adopts the canonical leaf (SAFE, start here)
`TagValueChip` (and siblings) currently hand-roll the URI chip
(`<span>label</span>` + `<CurieLink>`), bypassing `Term`. Route that leaf
through the canonical `Term` component so the TagBar inherits the one chip
treatment (palette, CURIE popover, truncation) — the "same widget should
be used here" from the screenshot. **Cannot touch the comparison surface
(different file).** Keep grouping / "+N more" / editing exactly as-is —
this phase only swaps the *leaf* render.
- Acceptance: TagBar chips visually unchanged except they now use `Term`;
  CURIE popover opens from TagBar chips; vitest + `@critical` green.

### Phase 1 — extract the S‑P‑O walk primitive
`StatementChip` and `FvDisplayRow` both walk `subject · pred · object`.
Extract that walk into one primitive (subject `Term` + per-pair predicate
text + object `Term`), parameterised by the visual bits that legitimately
differ (separator `·` vs ` - `, predicate styling, **optional per-slot
diff**). `StatementChip` consumes it. `FvDisplayRow` adopts it **only**
with diff threaded through as an optional extension — guarded by the
`@critical` factor-grid spec.

### Phase 2 — comparison composes the basic widget (later, separately)
Once the primitive is proven, have the comparison row compose the basic
widget end-to-end (FV-name / baseline / `(n)` / stacking as the extension
layer). Separate commit, separate review.

## Out of scope
- The `CuriePopover` term-detail card (separate surface; its own work).
- Browser-app adoption of `StatementChip` (deferred, tracked elsewhere).
