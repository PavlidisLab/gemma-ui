# Audit comment editing — round-trip the structured fields on read

Filed 2026-05-14 by Paul (UI). Curators asked to be able to modify
their audit comments after the fact — both per-finding disposition
notes and the audit-close note. The UI shipped the affordances in
the same session; this doc captures the small follow-up asks for my
brother to round-trip cleanly.

## Backstory — what shipped UI-side today

`AuditSidebarPanel.tsx`:

- Dispositioned findings now show their stored note inline below
  the action row, with a "✎ edit" link that re-opens the matching
  dialog (dismiss / accept / not-sure) prefilled with the prior
  notes. Server-side this is the same `PATCH
  /rest/v2/audits/{audit_id}` path — the append-only log + latest-
  per-`target_id` read fold means re-PATCHing with a new note IS
  the edit mechanism.
- Closed-audit gate: the edit link is replaced with a "reopen to
  edit" hint. The 409 server rule on a finalized audit already
  blocks the write; this just surfaces the path back.
- Close-note display: when `AuditReport.finalized_notes` is set,
  the closed header strip renders it with the same "reopen to
  edit" hint. The reclose-after-reopen flow now prefills the
  close textarea with the prior note so it's a real edit, not a
  blank rewrite.

All persistence is server-authoritative — TanStack Query refetches
on focus, so navigation away and back roundtrips cleanly. No
localStorage needed.

## Status — both asks landed (2026-05-14)

Backend changes in agents commit on `main` branch:

* **Ask #1** — verified in place. `AuditFindingDisposition` already
  declares `dismiss_reason` / `accept_reason` / `not_sure_reason`
  and the storage fold (`_latest_dispositions`) populates them.
  Four tests added in `tests/unit/test_audit_mock_api.py`
  (`test_dismiss_reason_echoes_on_get`, `test_accept_reason_echoes_on_get`,
  `test_not_sure_reason_echoes_on_get`, `test_edit_disposition_overwrites_reason`)
  lock the round-trip in.
* **Ask #2** — implemented. New `finalized_notes` column on the
  `audits` table; `AuditReport.finalized_notes: str = ""` on the
  read shape; finalize POST writes; both list endpoints + single-
  audit GET surface it; reopen INTENTIONALLY preserves the note
  so reopen+reclose prefills. Six tests in
  `tests/unit/test_audit_mock_api.py`.

UI ask: nothing further needed server-side. Once a UI build picks
up the new shape, prefilling the chip on edit + prefilling the
close-audit textarea on reclose should both work end-to-end.

### UI pickup landed (2026-05-14)

- `AuditFindingDisposition` TS mirror now declares `dismiss_reason`
  / `accept_reason` / `not_sure_reason` as optional read fields.
- Edit-dialog prefill order: **`[tag]` analytic prefix wins over
  the structured field**. The prefix encodes the specific
  calibration chip the curator clicked (e.g. `missed_evidence`)
  before it got squashed to canonical (`weak_evidence`) on send.
  Structured field is the fallback for canonical chips that have
  no prefix.
- Cascaded dispositions (`inherited_from != null`) now hide the
  edit affordance entirely. The note row shows a `cascaded`
  indicator instead, with a tooltip pointing at the parent
  finding's `target_id`. Empty-note cascaded dispositions render
  nothing at all.
- Close-note flow is wired against `AuditReport.finalized_notes`
  (empty-string falsy, so no empty strip rendered). `npm run
  typecheck` clean.

### Backend heads-up — the squash should now be unnecessary

The `[tag]` prefix workaround predates the 2026-05-13 expansion of
the canonical `DismissReason` / `AcceptReason` enums. On the agents
side `missed_evidence` / `no_evidence` / `borderline` (Dismiss) and
`gold_was_wrong` / `borderline` (Accept) are now first-class
canonical chips — see `agents/audit/schemas.py:444-448`. The
schema comment explicitly says:

> The UI's v0.6.4 client-side mapper (chip-key → canonical +
> `[<key>]` prefix in notes) can now be removed in v0.6.5 — chip
> keys map straight through.

Round-trip is locked in by two new tests
(`test_calibration_dismiss_chips_round_trip`,
`test_calibration_accept_chip_round_trips`) that PATCH with each
calibration chip and assert GET returns the same value via the
structured field.

### UI squash removal — landed (2026-05-14)

User declared pre-2026-05-13 eval packages retired, clearing the
belt-and-braces reason for keeping the squash. Removed in the same
session:

- `toCanonicalDismissReason` / `toCanonicalAcceptReason` /
  `tagPrefixedNotes` deleted from `AuditSidebarPanel.tsx`. The
  handler functions now pass the chip key straight to the
  structured `dismissReason` / `acceptReason` field with no notes
  mangling.
- `DismissReason` / `AcceptReason` TS unions extended with the
  promoted calibration chips (`missed_evidence`, `no_evidence`,
  `borderline`, `gold_was_wrong`) + a `(string & {})` forward-
  compat opening on all three reason unions.
- Extracted `parsePrefixedNote` + new `resolveEditInitial` to a
  pure-function helper module (`src/features/audit/
  dispositionEdit.ts`).
- New vitest suite (`dispositionEdit.test.ts`) covering 17 cases
  across the post-2026-05-13 wire (structured field is the chip
  key directly), the legacy pre-2026-05-13 wire (prefix wins over
  squashed structured field — read-only path for already-stored
  rows), non-calibration canonical chips, and graceful-
  degradation edges. The prefix-as-legacy-read stays in
  `parsePrefixedNote` only, not on the write path.

Net effect: new dispositions land with `dismiss_reason=
"missed_evidence"` (etc.) directly, no `[missed_evidence] …`
prefix. Already-stored rows still preselect the right chip on
edit thanks to the prefix-fallback in `resolveEditInitial`.

## Asks (original)

### 1. Surface `dismiss_reason` / `accept_reason` / `not_sure_reason` on the disposition read shape

Today `AuditFindingDisposition` (the read shape on `AuditReport.
dispositions`) carries:

```python
target_id, status, reviewer, reviewed_at, notes, inherited_from,
resolved_at
```

The structured-reason fields (`dismiss_reason`, `accept_reason`,
`not_sure_reason`) are on the **write** shape (`PATCH` body) but
not echoed back on read. This means when the UI re-opens the
dialog to edit a disposition, it can prefill the notes but **can't
prefill the chip selection**. The curator has to re-pick the chip.

Workaround in place: for non-canonical reason tags (the
calibration-specific `missed_evidence` / `gold_was_wrong` /
`borderline` variants) the UI stuffs the tag into notes as a
`[tag] ...` prefix and reads it back. Canonical tags
(`weak_evidence`, `redundant`, etc.) go through the structured
field and round-trip is lost.

**Ask:** echo the three reason fields on `AuditFindingDisposition`
when present, same shape as on the PATCH body:

```python
class AuditFindingDisposition(BaseModel):
    target_id: str
    status: DispositionStatus
    reviewer: str
    reviewed_at: datetime | None
    notes: str
    inherited_from: str | None = None
    resolved_at: datetime | None = None
    # New — echo from latest write row:
    dismiss_reason: DismissReason | None = None
    accept_reason: AcceptReason | None = None
    not_sure_reason: NotSureReason | None = None
```

Append-only storage already keeps the reason field on each row;
the read fold just needs to copy it onto the surfaced row. No
schema migration — old rows have null / missing, which is exactly
what the UI handles today.

### 2. Echo `finalized_notes` on `AuditReport`

`POST /rest/v2/audits/{audit_id}/finalize` accepts `notes` and
routes it into the `audit_events` row server-side, but the note
isn't echoed back on the `AuditReport` shape returned by `GET
/rest/v2/audits/{audit_id}` (or by the finalize response itself).

UI added an optional `finalized_notes?: string | null` to its TS
mirror and degrades to "(no note recorded)" when undefined, so
this ask is purely about populating the field.

**Ask:** add `finalized_notes: str | None` to the `AuditReport`
schema, populated from the most recent finalize-event row (or
held on the audit row directly if that's cheaper). Same nullable
rules as `finalized_at` / `finalized_by`.

The UI's close-audit textarea now prefills with this field on
reopen-then-reclose, so the edit flow turns into a true "see what
you wrote, change it, save" rather than a blank rewrite.

## Out of scope

- Editing the reviewer / timestamp fields. Those are
  authoritative and shouldn't move.
- Editing notes on dispositions inherited from a parent factor
  finding (`inherited_from != null`). The UI already treats those
  as read-only; we'd want the edit affordance to be hidden when
  `inherited_from` is set, and only the parent-finding's
  disposition is editable. Cheap to do UI-side once the ask above
  lands. Flagging here so we don't paint over an inheritance edge
  case on the next pass.

## Verification (when these land)

1. Open a dispositioned finding in the audit sidebar. The chip
   that was originally picked should be pre-selected when the
   "✎ edit" dialog opens (today it's blank unless the chip is a
   non-canonical calibration one).
2. Open a closed audit. The closed header strip should show the
   curator's finalize note. Reopen + reclose — the textarea is
   prefilled with the prior note.
