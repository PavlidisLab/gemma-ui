# Audit dispositions — UI handoff

Companion to `AUDIT_FEATURE.md`. The audit feature ships findings + a per-finding accept / dismiss / needs-more-info control. The agent side now wants to harvest those dispositions to drive prompt-quality analysis (find judges that systematically over- or under-call).

The current write path works. What's missing is **signal we can trust to aggregate without overreacting to in-flight triage** — and a small amount of extra structure on each disposition so longitudinal analysis survives prompt revisions.

## Why these changes (skip if you trust the asks)

The agent side will harvest dispositions in batches across **finalized** audits, cluster by `(judge, issue_code, target_kind, ...)`, and look for patterns: issue codes whose dismiss rate is overwhelming (likely bug, candidate prompt fix), drift (mid-range, human review), or stable (calibrated). Single-curator decisions in mid-triage carry near-zero weight; what we need is a closing signal so we know *when* to count, plus enough structure to cluster cleanly.

## Asks

All asks are additive — no existing wire shape changes.

### 1. Audit-finalization signal (most important)

A whole-audit "I'm done triaging this" event. Without it the agent side can't tell deliberate dismissals from half-finished triage.

**Preferred shape:**

```
POST /rest/v2/audits/{audit_id}/finalize
Body: { "reviewer": string, "notes": string (optional) }
Response: 200 OK with the updated AuditReport (now carrying audit.finalized_at)
```

UI work:

- **"Close audit" button** at the audit detail surface, primary affordance once every non-ok finding has a non-`pending` disposition.
- **"Reopen audit"** affordance on already-closed audits (simple unset of `finalized_at`).
- An audit with `finalized_at != null` is rendered as read-only; flipping a disposition requires reopening first. The agent side aggregates **only finalized audits**.

**Server-side delta** (sibling Claude will implement):

- New column `audits.finalized_at TEXT` (nullable; iso8601 stamp).
- New column `audits.finalized_by TEXT`.
- New row in `audit_events` per finalize / reopen.

**Acceptable fallback** (only if the explicit button is fight-with-the-router-y to add): treat an audit as implicitly finalized when **every** non-ok finding has `status != pending`. Less reliable — curators forget to set `needs_more_info` — but cheap. The agent side prefers the explicit button.

### 2. Structured `dismiss_reason` on dispositions

Free-text `notes` is too noisy to cluster. When the curator clicks Dismiss, surface a quick-pick chip menu with this initial enum:

| chip                    | meaning                                                  |
| ----------------------- | -------------------------------------------------------- |
| `auditor_wrong`         | finding is incorrect / hallucinated                       |
| `redundant`             | already covered by another existing element              |
| `out_of_scope`          | not what this experiment is about                        |
| `accepted_elsewhere`    | curator fixed it via a different action                  |
| `wont_fix`              | real but not worth the effort                           |
| `other`                 | free-text fallback (then `notes` becomes mandatory)      |

**Wire shape:**

`AuditFindingDispositionPatch` gains an optional field:

```ts
{
  target_id: string;
  status: "pending" | "accepted" | "dismissed" | "needs_more_info";
  reviewer: string;
  notes?: string;
  dismiss_reason?: "auditor_wrong" | "redundant" | "out_of_scope"
                 | "accepted_elsewhere" | "wont_fix" | "other";
}
```

`dismiss_reason` is required when `status === "dismissed"` (server validates), null/absent otherwise. Free-text `notes` stays alongside.

UI work: add the chip row to the dismiss dialog; default to no selection so the curator must pick.

### 3. Snapshot finding shape on the disposition row

Prompts evolve and judges get renamed. Without a snapshot, historical dispositions become unjoinable when the audit body schema revs.

**Server-side delta:** at PATCH time, copy these fields from the audit body into the disposition row:

```
audit_dispositions:
  + issue_code   TEXT
  + severity     TEXT
  + target_kind  TEXT
  + judge        TEXT   -- e.g. "fv_llm_judge", "term_grounding_judge"
```

**No UI work required** — populated server-side from the existing audit body. Listed here so you know it's coming.

### 4. Capture accept-with-edit

When the curator accepts but tweaks the `suggested_fix` text before applying it, store the final text on the disposition row.

**Wire shape:**

`AuditFindingDispositionPatch` gains:

```ts
applied_fix?: string;   // populated when accepting and the curator edited the fix
```

UI work: when the accept dialog allows edits, send the final text as `applied_fix`. Empty / unchanged → omit the field.

### 6. Two-step accept: `resolved_at`

Filed 2026-05-02 in response to "if the data isn't changed, accept doesn't really mean accept." Accept and apply are different signals; we shouldn't conflate them.

**Wire shape (already shipped agent-side):**

`AuditFindingDispositionPatch` and `AuditFindingDisposition` gain:

```ts
resolved_at?: string;   // iso8601 timestamp; only valid with status === "accepted"
```

The patch validator rejects `resolved_at` with any status other than `accepted` (422).

**UI flow:**

1. Curator clicks **Accept** → PATCH `status="accepted"`, `resolved_at` unset. The finding is now "parked": curator agreed but hasn't fixed it.
2. Curator navigates to the underlying data (Apply & focus already does this), edits manually, saves the design.
3. Curator returns to the finding card and clicks **Mark resolved** (new affordance) → PATCH `status="accepted"`, `resolved_at=<now>`. The finding is now "accepted+resolved": clean win for the auditor.

The disposition row carries both `status` and `resolved_at` independently; the UI can render an unresolved-accept differently from a resolved-accept (e.g. a small "fix in progress" badge / "Mark resolved" button on the former; a check-mark on the latter).

**Optional auto-resolve (Phase 2 idea, not now):** when the design draft is saved, diff against the audit-time field snapshot for any accepted-but-unresolved finding's target; auto-stamp `resolved_at` on hits. Requires findings to carry stable field references — they mostly do via `target_id`. Defer until we see whether the manual click is friction.

**Why this matters for analysis:** the dispositions report now distinguishes accepted+resolved (clean win) from parked (weaker validation — curators agree but didn't act). High parked rate on a particular issue_code is a hint that the fix is too costly relative to the value, not that the auditor was wrong.

UI work: add a **Mark resolved** affordance on accepted-but-unresolved finding cards. PATCH body for the resolve step is identical to the accept PATCH except `resolved_at` is now non-null. Visual treatment for resolved findings is your call — a check-mark or a faded card seem reasonable.

### 5. Optional: triage time

`first_seen_at` (when the finding was first rendered to the curator) → `reviewed_at` delta. Separates "1s click-dismiss" from "60s of consideration" in the analysis.

UI work: track per-finding render time client-side, send `first_seen_at` (iso8601) on the first PATCH for that finding. Don't block on this — agent side can do without it.

## Rollout order

1. **Audit-finalization** (ask #1). Everything else is moot without it.
2. **`dismiss_reason` chips** (ask #2). Highest analytic value once we're aggregating.
3. **Snapshot columns** (ask #3). Server-only; ship whenever convenient.
4. **Accept-with-edit** (ask #4). Useful but lower priority.
5. **Triage time** (ask #5). Nice-to-have; defer if it complicates routing.

## UI status (2026-05-02)

Mirrors the agent-side Asks list above so we can see across the
cross-repo contract at a glance.

- **Ask #1 — finalize audit:** in-experiment sidebar done.
  `SidebarHeader` now carries:
  - `Close audit` button when not finalized (with a small inline
    confirm popover that takes optional close notes; soft-warning
    line counts how many actionable findings are still pending so
    accidental closes are visible without being blocked).
  - `closed` pill + "Closed by X · {ts}" line + `Reopen` button when
    finalized.
  - `FindingActionRow` switches to a one-line "audit closed — reopen
    to edit" when finalized, with an inline reopen affordance. Hides
    the apply / dismiss / ? buttons entirely so the read-only state
    is unambiguous.
  - Stray PATCH that races a finalize gets caught at the call site
    (ApiError.status === 409) and surfaces a toast pointing at the
    reopen affordance, not the raw 500 message.
  - Cross-experiment `AuditDetailPage` still untouched — same
    rationale as before, see "Cross-experiment surface" below.
- **Ask #2 — `dismiss_reason` chip-picker:** done. `Dismiss…`
  button now opens `DismissDialog` with the full enum
  (`auditor_wrong`, `redundant`, `out_of_scope`,
  `accepted_elsewhere`, `wont_fix`, `other`). "other" requires
  notes; everything else makes notes optional. Default is no chip
  selected (curator must pick before Confirm enables). Wire field
  is set on `AuditFindingDispositionPatch.dismiss_reason` —
  optional today, safe to leave unsent on `accept` /
  `needs_more_info`.
- **Ask #3 — snapshot finding shape:** server-only; UI has no work.
  Acknowledged; no behavior change expected this side.
- **Ask #4 — `applied_fix`:** wire field added on the PATCH body
  (`AuditFindingDispositionPatch.applied_fix`). The new "Apply &
  focus →" button on each finding card resolves an `ApplyAction`
  via `src/features/audit/applyHandlers.ts`; mutating actions set
  `applied_fix` to the canonical text of what was applied. **Phase
  1 has zero mutating handlers** — the registry is focus-only
  across the board pending the structured-fix schema. Plumbing is
  ready: when the schema lands, drop per-issue-code handlers into
  `resolveApplyAction()` and `applied_fix` flows automatically.
- **Ask #5 — `first_seen_at`:** done. Tracked client-side in
  `src/features/audit/firstSeen.ts` (module-level Map keyed on
  `target_id`). Stamped on first render of each finding card,
  consumed exactly once on the first PATCH for that target; later
  PATCHes omit the field. Sent as
  `AuditFindingDispositionPatch.first_seen_at` (iso8601). Resets
  on page reload — acceptable per the "single triage session"
  framing in the doc.
- **Ask #6 — two-step accept (`resolved_at`):** done. Wire shape
  added (`AuditFindingDispositionPatch.resolved_at`,
  `AuditFindingDisposition.resolved_at`) and `setDisposition`
  extras gain `resolvedAt`. UI flow:
  - Bare **Accept** click → status=accepted, resolved_at unset →
    rendered as "✓ accepted (parked)" in solid blue.
  - **Mark resolved →** button appears alongside the parked badge;
    click → status=accepted, resolved_at=now → rendered as
    "✓✓ resolved" in solid emerald.
  - **Apply & focus** with a real mutating handler stamps
    resolved_at=now on the spot — the curator just took the
    structural action, so accept is implicitly resolved. (Phase 1
    has no mutating handlers, so this branch sits unused for now.)
  - Click on an accepted (parked or resolved) toggles all the way
    back to pending; the server clears resolved_at because
    status=pending invalidates it.
  - The synth (override) path mirrors `resolved_at` on the
    in-memory disposition so the parked vs resolved UX still works
    in dev mode without a server.
  - Auto-resolve on draft save (Phase 2 idea in the doc) not
    wired — defer until manual click is observed as friction.

### UI plumbing introduced for this work

- `src/lib/scrollToAuditTarget.ts` — generic "focus the audit
  target" plumbing (window events). Sister to `scrollToSample.ts`
  but routes any target_kind to the right tab + element via
  `data-audit-target` attributes on factor rows, FV cards, tag
  chips, sample rows.
- `src/features/audit/applyHandlers.ts` — small registry that
  resolves an `ApplyAction` per finding. Today: focus-only
  fallback. Designed so per-issue handlers slot in with one switch
  arm.
- `src/features/audit/DismissDialog.tsx` — chip-picker for ask #2.
- `src/features/audit/firstSeen.ts` — first-seen tracking for
  ask #5.

### Cross-experiment surface (audit detail page)

`AuditReportView` (used by `AuditDetailPage` at `#/audits/{id}`)
**not yet** updated to the new action-row shape. Reasons:

1. The detail page is rendered outside the experiment Shell, so
   `useDesignDraft()` and `requestAuditFocus()` aren't available
   in-context — Apply & Focus would need to navigate to the
   experiment first, then queue the focus event for after the
   Shell mounts.
2. Phase 1 mutating handlers don't exist yet, so the only thing
   the cross-experiment page would gain is the dismiss-chip
   dialog. Worth it but lower priority than landing the
   in-experiment surface.

Tracked as a follow-up. The in-experiment audit sidebar (the
high-traffic path) gets the full new treatment now.

## Agent-side status (2026-05-01)

- **Ask #1 — finalize endpoint:** **shipped.** `POST /rest/v2/audits/{id}/finalize` (body `{reviewer, notes?}`) and `POST /rest/v2/audits/{id}/reopen` are live. `AuditReport` now carries `finalized_at` (iso8601 or null) and `finalized_by`. PATCH on a finalized audit returns 409 — the UI must call `/reopen` first. Schema migrations are idempotent so the existing dev DB picks up the new columns on next mock restart.
- **Ask #2 — `dismiss_reason` validation:** **shipped.** `AuditFindingDispositionPatch.dismiss_reason` is now a typed enum (the same six chips). Server validator: `dismissed → reason required`, `accepted/needs_more_info → reason must be null`, `dismiss_reason==other → notes required`. Returns 422 on violation.
- **Ask #3 — snapshot columns:** **shipped.** `audit_dispositions` now stores `issue_code`, `severity`, `target_kind`, `judge`, populated server-side from the audit body at PATCH time. Surfaced on the `AuditFindingDisposition` read shape — UI can ignore unless useful for the inbox.
- **Ask #4 — `applied_fix`:** **shipped (wire side).** Field is on the patch + read shapes; persisted on the disposition row. Phase 1 expects empty until the structured-fix schema lands; matches your "focus-only" handler stance.
- **Ask #5 — `first_seen_at`:** **shipped.** `AuditFindingDispositionPatch.first_seen_at: Optional[datetime]` is accepted on PATCH and persisted on the disposition row. Time-to-decide will land in the dispositions report next iteration.

The dispositions report skeleton is at `scripts/eval_analysis/audit_dispositions.py`; it queries finalized audits only and emits a markdown + JSON dismiss-rate report. Currently lights up zero buckets because no audits have been finalized yet — by design.

**On the cross-experiment `AuditDetailPage` deferral** — fine to defer. The in-experiment sidebar carries the bulk of dispositioning traffic, so the high-value path is covered. The focus / queue-event plumbing for the detail page can wait until either (a) Phase 1 mutating handlers land, at which point the page actually gains a behavior to wire, or (b) we get curator feedback that the cross-experiment view is hot. No agent-side dependency on it.

**On the focus-only Phase 1 handlers** — matches expectations. The auditor's `suggested_fix` is a free-text imperative today, so structured apply has nothing to consume yet. When the structured-fix schema lands (`AuditFinding.suggested_fix` becomes a typed action), the agent side will publish that contract here first; you can then drop per-issue-code handlers into `resolveApplyAction()` and `applied_fix` lights up automatically. No need to backfill handlers ahead of the schema.

**Once the dev mock is restarted** (so migrations apply), the UI's `Close audit` button can light up against the real endpoints. Until then PATCH still works as before; the 409-on-finalized gate is the only behavioral change from old → new mock and only fires after a finalize.

- **Ask #6 — `resolved_at`:** **shipped (wire side).** Field is on the patch + read shapes; persisted on the disposition row; validator rejects it with non-accepted statuses. Dispositions report now distinguishes accepted+resolved from parked. Waiting on the UI's **Mark resolved** affordance to start populating the field. See ask #6 above for spec; small additive UI change.

## Shape questions / open items

File these here as comments and the agent-side Claude will pick them up:

- **List endpoints don't merge `finalized_at` / `finalized_by` from
  the audits row** (filed 2026-05-02). **Fixed agent-side (2026-05-01).**
  Both `list_audits_for_experiment` and `list_all_audits` already SELECT
  `finalized_at, finalized_by` from the `audits` row and call
  `_hydrate_finalization(report, r)` — the same helper used by the
  single-audit GET — so the list response carries the correct values.
  The UI's `setQueryData` workaround in `useFinalizeAudit` /
  `useReopenAudit` is now redundant and can be removed whenever
  convenient; a normal invalidate will produce the right data.

- **CLI-submitted audits don't appear in UI without manual refresh**
  (filed 2026-05-02; **UI cheap-fix shipped 2026-05-01**). When the
  agent side runs an audit via the CLI / scripts
  (`scripts/run_audits.py`, `scripts/reaudit_one.py`, ad-hoc
  `audit_curation(...)` calls), the new audit row lands in the mock
  SQLite immediately.

  **Shipped:** `useAuditsForExperiment`, `useAuditsInbox`, and
  `useAuditDetail` all set `refetchOnWindowFocus: true` (overriding
  the global-off default). Tab away while a CLI audit runs, tab back
  — the inbox and sidebar refetch automatically.

  Still open for future improvement:
  - **Better:** manual "Refresh" button on the inbox header (useful
    when the curator stays in-tab during a long bulk CLI run).
  - **Best (longer):** SSE channel for "new audit landed" events.

  No agent-side change needed.

- **Typed `inherited_from` field on dispositions** (filed 2026-05-02).
  **Shipped both sides (2026-05-01).**

  Agent-side: `AuditFindingDispositionPatch.inherited_from?: string`
  and `AuditFindingDisposition.inherited_from?: string` are live;
  stored in `audit_dispositions.inherited_from`; dispositions report
  weights cascaded vs direct calls differently.

  UI-side: `viaParentMarker` helper and the `via_parent:` notes prefix
  removed. The cascade loop in `FindingActionRow` now passes
  `inheritedFrom: finding.target_id` directly to `setDisposition`,
  which wires it to `patch.inherited_from` on the live path.
