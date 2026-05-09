# Set navigator: per-member audit status + drop wasted-verbiage rationales

Filed 2026-05-08 from the GUI session.

## Two unrelated asks rolled together

Both small. Independent commits welcome.

## 1. `ExperimentSummary.audit_status` for the set-navigator popover

Curators walking a calibration set want to see at a glance which
members they haven't started yet, which are mid-triage, and which
are closed. The popover member list already shows troubled /
needs_attention / public glyphs from the existing
`ExperimentSummary` shape — adding audit-status to that same
parallel summary list is the cheapest way to surface it.

UI side has already:

- Defined the field shape in
  `src/api/workflowTypes.ts`:

  ```ts
  export type ExperimentAuditStatus = "none" | "in_progress" | "closed";

  export interface ExperimentSummary {
      ...existing fields...
      audit_status?: ExperimentAuditStatus;
  }
  ```

- Renders an `AuditStatusGlyph` per member row when the field is
  set. Three shapes:
    - `none` → outlined ring, slate (muted "haven't started")
    - `in_progress` → half-fill, amber
    - `closed` → filled disc, emerald
  Hidden entirely when `audit_status` is `undefined` (older agents)
  so nothing breaks.

### Suggested aggregation

Per the comment on the TS side:

- `none` — no `AuditReport` exists for this experiment.
- `in_progress` — at least one `AuditReport` row exists but none
  are finalized; OR a finalized report exists with pending
  dispositions remaining (counts a curator who closed the audit
  without dispositioning everything as still in-progress;
  optional refinement).
- `closed` — at least one `AuditReport` is finalized AND every
  finding on the latest report has a non-pending disposition.

Simpler version that's still useful: just key on `finalized_at` —
`none` if no report, `closed` if the latest is finalized,
`in_progress` otherwise. The disposition-pending refinement above
is nice-to-have, not blocking.

The lookup happens in the same path that already populates
`troubled` / `needs_attention` / `is_public` for member_summaries,
so the join is incremental rather than a new query family.

### When to populate

Same opt-in as the rest of the summary: only when the caller sets
`?include_summaries=true` on
- `GET /rest/v2/groups/{group_id}`
- `GET /rest/v2/groups`
- `GET /rest/v2/datasets/{experiment_id}/groups`

The chip-render path (no summaries) is unchanged.

## 2. Drop wasted-verbiage rationale templates

Two rationale patterns the calibration judges emit are pure
filler:

1. `"Accept if this is real curation work the agent caught, dismiss if the agent was wrong."`
   — already known; you trimmed this from the extras / misses /
   match templates in commit `f0f9f16`. Remaining stragglers (if
   any judge still emits it) should drop the same suffix.

2. `"Agent emitted with the evidence quote on file (see the supporting-evidence panel)."`
   AND the bare parenthetical
   `"(see the supporting-evidence panel)"`
   appended to claim sentences. The proposer-suggestion panel
   already shows the supporting-evidence blockquote when one
   exists; pointing at it from the rationale is redundant.

UI side already strips both client-side via
`trimRationaleBoilerplate` in
`src/features/audit/AuditSidebarPanel.tsx`:

```ts
out = out.replace(
  /\s*\(\s*see\s+the\s+supporting[- ]evidence\s+panel\.?\s*\)\s*\.?/gi,
  "",
);
out = out.replace(
  /\s*(?:^|\.\s+)Agent\s+emitted\s+with\s+the\s+evidence\s+quote\s+on\s+file\.?/i,
  "",
);
```

Conservative — only strips when the recognisable pattern is
present. Once the agent stops emitting them, the regex becomes a
no-op safely.

## Cross-repo compatibility

Both pure additive / subtractive:

- `audit_status` — optional field; older UIs ignore it, newer UIs
  render the glyph when present.
- Rationale trim — same prose with less filler; UI's defensive
  regex covers either side until both sides ship.

No `MIN_UI_VERSION` bump.
