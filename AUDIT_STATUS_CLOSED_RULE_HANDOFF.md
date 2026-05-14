# `audit_status` "closed" rule needs to track finalize, not disposition coverage

**Status:** Open ask, agents-side. Filed 2026-05-13 by Paul (UI).
**Sibling docs:** [`CALIBRATION_DISPOSITION_REASONS_HANDOFF.md`](./CALIBRATION_DISPOSITION_REASONS_HANDOFF.md) ·
[`AUDIT_FEATURE.md`](./AUDIT_FEATURE.md)

## Why

`mock_gemma_curation_api/storage.py:2477` computes
`audit_status_by_eid` for member-summary rendering. Current rule:

```python
if a["finalized_at"] and all_dispositioned:
    audit_status_by_eid[eid] = "closed"
else:
    audit_status_by_eid[eid] = "in_progress"
```

`all_dispositioned` requires every finding's latest disposition to
have a non-pending status.

Failure mode: calibration audits emit `calibration_match` findings
(severity=ok) that the UI renders as compact green-check rows —
"no action needed" by design. Curators don't click them, so they
stay `status="pending"` forever. The Close-audit confirm dialog
explicitly tells the curator pending findings stay pending on close
("close audit; pending findings stay pending in the log"). So:

1. Curator runs audit on GSE.
2. Curator dispositions every actionable finding.
3. Curator does *not* disposition match findings — nothing to act on.
4. Curator clicks **Close audit**. `finalized_at` set on the audit row.
5. `audit_status` returns `"in_progress"` because `all_dispositioned`
   is False (match findings still pending).
6. Member-list glyph in the set navigator shows amber-half-fill
   forever, even though the curator considers the audit done.

Reported by Paul, 2026-05-13. Glyph rendering at
`src/features/experiment/ExperimentBanner.tsx:831` (`AuditStatusGlyph`):
amber half-fill = `in_progress`, emerald disc = `closed`. The bug
is that no audit can ever reach `closed` once `calibration_match`
findings exist on it.

## Ask

Change the closed rule to follow the curator's explicit close signal:

```python
if a["finalized_at"]:
    audit_status_by_eid[eid] = "closed"
else:
    audit_status_by_eid[eid] = "in_progress"
```

`finalized_at` is set only when the curator clicks Close audit. That
matches the curator's intent — the existing `n_pending` /
`pending_findings` counts on the audit summary are the right place
to surface "you closed with X pending"; the boolean status field
should be the close-signal boolean.

If `all_dispositioned` is load-bearing for other consumers (eval
scoring, dispositions report aggregation), keep that check in those
consumers; just stop using it in the `audit_status` derivation. A
half-step alternative is to exclude `severity="ok"` findings from
the `all_dispositioned` check — preserves the "all actionable
findings triaged" spirit while no longer holding match findings
against the close. Either works for the UI side.

## In-place vs rebuild

This is a storage-side derivation only. No calibration kit or
disposition data needs rewriting — the fix is a pure change to how
`audit_status` is computed from existing rows. Existing closed
audits flip from `in_progress` to `closed` the moment the storage
patch lands; nothing migrates.

## UI workaround in v0.6.5+

`AuditSidebarPanel.SidebarHeader.handleClose` now sweeps all pending
`severity="ok"` findings to `accepted` before calling `finalize()`.
Belt-and-braces for the glyph display while waiting on this fix.
Drop the sweep once `audit_status` follows `finalized_at` directly —
it writes a small amount of disposition data per close that exists
purely to satisfy the current rule.

## Why now

Friday talk demo (2026-05-15) walks GSE177029 and the surrounding
calibration set. The set-navigator glyph is one of the at-a-glance
signals the audience picks up first; having it stuck amber on every
audit makes the demo look worse than the work is.
