# Audit dispositions: unified reason flow on accept / not-sure

**Status:** SHIPPED 2026-05-10 — both sides. Wire enums match the
asks below verbatim; UI migrated off the notes-prefix shim onto
typed `accept_reason` / `not_sure_reason` fields.
**Sibling docs:** [`AUDIT_FEATURE.md`](./AUDIT_FEATURE.md) ·
[`AUDIT_DEFENDER_VERDICT_HANDOFF.md`](./AUDIT_DEFENDER_VERDICT_HANDOFF.md)

## Why

Per Paul (2026-05-10) the audit-disposition reason flow expands:

1. **Drop** `auditor_wrong` and `curator_wrong` from `DismissReason`
   — they describe *whose fault* rather than *what was wrong*. Low
   analytic signal, high curator confusion.
2. **Add** an `accept_reason` flow on agent-extra findings —
   adding new curation deserves a "why" the same way rejecting one
   does. Same defender-style feedback loop, opposite polarity.
3. **Add** a `not_sure_reason` flow — clicking "Park" now requires
   a documented reason and counts as a *decided* disposition (the
   finding closes out of the open queue). Curators who don't want
   to commit still have to say *why* they're parking.
4. **Rethink** the criteria so each chip points at a specific
   prompt-quality / coverage signal, not a person.

## What shipped UI-side already (2026-05-10)

`src/features/audit/DismissDialog.tsx` is now mode-aware
(`dismiss` | `accept` | `not_sure`) and exports
`encodeReasonNotes(reasonKey, notes)`.

`AuditSidebarPanel.tsx` `FindingActionRow` opens the right dialog
for each path:

- **Apply on `calibration_agent_extra`** → opens accept dialog;
  on confirm runs the structural mutation + dispositions
  `accepted` + `resolved_at` with reason-prefixed notes.
- **Disagree** → opens dismiss dialog (existing path; `auditor_wrong`
  / `curator_wrong` chips removed).
- **Not sure → "Park…"** → opens not-sure dialog; on confirm
  patches `needs_more_info` with reason-prefixed notes.

`isClosed` in `CompactFindingCard` now includes
`needs_more_info`, so parked findings grey out the same as
dismissed / accepted+resolved.

Reason key encoding: until typed wire fields land, every
disposition's `notes` field carries a `[reason:KEY] <free text>`
prefix (or just `[reason:KEY]` when notes are empty). The dismiss
flow still also sets the typed `dismiss_reason` enum value when
the key matches a typed entry; new keys (`weak_evidence`) fall
back to `dismiss_reason="other"` with the structured key in the
prefix.

## Wire schema asks

### 1. Trim `DismissReason`

```python
class DismissReason(str, Enum):
    REDUNDANT = "redundant"
    OUT_OF_SCOPE = "out_of_scope"
    WEAK_EVIDENCE = "weak_evidence"        # NEW — replaces auditor_wrong's evidence-gap case
    ACCEPTED_ELSEWHERE = "accepted_elsewhere"
    WONT_FIX = "wont_fix"
    OTHER = "other"
    # auditor_wrong and curator_wrong DROPPED — Paul 2026-05-10
```

Migration: existing dispositions with `auditor_wrong` /
`curator_wrong` in storage stay queryable (DB column is text);
the enum just stops emitting them on new writes. UI tolerates
the legacy values via the `(string & {})` opening on the TS
union.

### 2. Add `AcceptReason`

```python
class AcceptReason(str, Enum):
    WELL_EVIDENCED = "well_evidenced"
    FILLS_GAP = "fills_gap"
    MORE_SPECIFIC = "more_specific"
    OTHER = "other"

class AuditFindingDispositionPatch(BaseModel):
    ...
    accept_reason: AcceptReason | None = None  # NEW
```

Server validator: required when `status="accepted"` AND the
finding's `issue_code` is in the agent-extra family
(`calibration_agent_extra`, future `agent_extra_*` codes). Other
accept paths (`calibration_match`, focus-only Accept) skip the
requirement — there's no "why are you accepting" question when
both sides already agree.

### 3. Add `NotSureReason`

```python
class NotSureReason(str, Enum):
    NEED_MORE_DATA = "need_more_data"
    NEED_EXPERT = "need_expert"
    PENDING_UPDATE = "pending_update"
    OTHER = "other"

class AuditFindingDispositionPatch(BaseModel):
    ...
    not_sure_reason: NotSureReason | None = None  # NEW
```

Server validator: required when `status="needs_more_info"`. UI now
gates the status setter on the dialog; never sends
`needs_more_info` without a reason.

### 4. Server-side notes-prefix migration helper

While the typed fields are landing, my brother can backfill
`accept_reason` / `not_sure_reason` from the existing notes
prefix. Regex: `^\[reason:([a-z_]+)\]\s*` — capture group is the
key. Strip the prefix from `notes` after extraction so the curator
prose stays clean for analytics. Same shape works for
`weak_evidence` migration on dismiss.

## Curator-facing rationale (per chip)

**Dismiss reasons** — why the curator rejects the agent's
suggestion:

| key | one-line rationale |
|---|---|
| `redundant` | already inherited from a BM characteristic / covered by another tag |
| `out_of_scope` | not what this experiment is about |
| `weak_evidence` | could be true but the support isn't strong enough |
| `accepted_elsewhere` | curator addressed it via a different action |
| `wont_fix` | real but not worth the effort |
| `other` | free-text fallback (notes mandatory) |

**Accept reasons** (agent-extra findings only):

| key | one-line rationale |
|---|---|
| `well_evidenced` | paper / methods / sample data clearly support adding it |
| `fills_gap` | Gemma had nothing for this slot; agent caught a coverage gap |
| `more_specific` | agent's pick refines an existing entry to the precise term |
| `other` | free-text fallback (notes mandatory) |

**Not-sure reasons** — why the curator parks:

| key | one-line rationale |
|---|---|
| `need_more_data` | paper unclear / contradictory / sparse on this point |
| `need_expert` | domain question beyond the curator's scope |
| `pending_update` | Gemma data is out of date; re-import expected |
| `other` | free-text fallback (notes mandatory) |

## Compatibility

- Older agents emitting fresh dispositions without these fields:
  no behavioural change; UI keeps writing the notes-prefix.
- Older calibration packages with `auditor_wrong` /
  `curator_wrong` dispositions in storage: still parse cleanly;
  UI hides those chips so curators can't pick them on new writes.
- Old "Mark resolved" / "Resolve →" affordance unchanged.
- `dismiss_reason` enum drop must be coordinated — once removed
  from the Pydantic model, fresh writes with the legacy values
  return 422. UI is already not sending them.
