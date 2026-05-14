# Align mock + UI to real Gemma's REST wire (1.32.7)

**Status:** Open ask, agents-side mock changes + UI changes in lockstep.
Filed 2026-05-13 by Paul (UI).
**Reference:** [`PavlidisLab/Gemma`](https://github.com/PavlidisLab/Gemma/tree/hotfix-1.32.7),
PRs #1650 / #1652 / #1653 / #1655 (merged May 6–13).

## Why

Real Gemma 1.32.7 now exposes the REST endpoints we've been mocking:

| Gemma endpoint | UI client | Status |
|---|---|---|
| `GET /datasets/{id}/auditEvents` | `src/api/history.ts` | mock-only today |
| `GET /datasets/{id}/curationDetails` | `src/api/curation.ts` | mock-only today |
| `PUT /datasets/{id}/curationDetails` | `src/api/curation.ts` | mock-only today |
| `PUT /datasets/{id}/permissions` | `src/api/datasets.ts` (publish flow) | shape mismatch |
| `GET /datasets/{id}/pipelineStatus` | `src/api/workflow.ts` | mock-only today |
| `isPublic` on `ExpressionExperimentValueObject` | `useDatasetVisibility` separate query | adopt inline |

The mock has been serving these with Pydantic-default snake_case and a
few small shape divergences (flat `last_foo_event_at` / `_by` where
Gemma nests an `AuditEventValueObject`). Per Paul, 2026-05-13: *"if it
makes no difference to us, we should adapt"* — naming convention
doesn't affect what the UI does, so we align both ends to real
Gemma's wire rather than asking the Gemma team to match us.

## Specific shape changes — mock + UI in lockstep

### 1. `AuditEvent` → camelCase, drop mock-only `shape`

UI shape today (`src/api/history.ts`):

```ts
interface AuditEvent {
  id: number;
  date: string;          // ISO
  performer: string;
  action: string;        // "C" | "U"
  event_type: string;    // ← rename
  note: string;
  detail: string;
  shape: { ... } | null; // ← drop (mock-only)
}
```

Target (matches `AuditEventValueObject`):

```ts
interface AuditEvent {
  id: number;
  date: string;
  performer: string;
  action: string;
  eventType: string;     // was event_type
  note: string;
  detail: string;
  // shape removed
}
```

Mock change: serialize `event_type` → `eventType`. Drop `shape` from
the wire (move it to a separate `/auditEvents/{id}/shape` endpoint if
it's still useful for the UI's history-tab graph, or just drop — the
UI hasn't been wiring it to anything user-visible).

### 2. `CurationDetails` → embed `AuditEventValueObject`s

UI shape today (`src/api/curation.ts`):

```ts
interface CurationDetails {
  experiment_id: number;
  last_updated: string;
  troubled: boolean;
  needs_attention: boolean;
  curation_note: string;
  last_note_update_at: string;
  last_note_update_by: string;
  last_troubled_event_at: string;
  last_troubled_event_by: string;
  last_needs_attention_event_at: string;
  last_needs_attention_event_by: string;
}
```

Target (matches `CurationDetailsValueObject`):

```ts
interface CurationDetails {
  lastUpdated: string;
  troubled: boolean;
  needsAttention: boolean;
  curationNote: string;          // nullable, admin-only
  lastTroubledEvent: AuditEvent | null;
  lastNeedsAttentionEvent: AuditEvent | null;
  lastNoteUpdateEvent: AuditEvent | null;
}
```

UI's curation banner reads `last_*_at` / `last_*_by`; switch to
`lastFooEvent.date` / `lastFooEvent.performer`. The nested shape is
strictly richer (full event detail accessible without a second
query), so this is also a small UX gain.

### 3. `isPublic` inline on `ExpressionExperimentValueObject`

Today: `useDatasetVisibility` hits a mock-only
`/rest/v2/datasets/{id}/visibility` endpoint that returns
`{ experiment_id, is_public, published_at, published_by }`.

Real Gemma:
- `ExpressionExperimentValueObject` exposes `isPublic: boolean`
  inline (via `GET /datasets/{id}`).
- No separate `/visibility` endpoint; no `published_at` / `_by`
  fields.

UI change: read `isPublic` from the main dataset query. Drop the
separate `useDatasetVisibility` hook. The `published_at` / `_by`
detail isn't on real Gemma's wire — if curators need it, surface it
from the `auditEvents` list filtered by the
`PublicExperimentEvent` type instead.

Mock change: stop serving `/visibility`. Expose `isPublic` on the
main dataset response, matching the camelCase Gemma serialization.

### 4. `PUT /datasets/{id}/permissions` replaces `POST /publish`

Today (`src/api/datasets.ts`): `usePublishExperiment` does
`POST /rest/v2/datasets/{id}/publish?reviewer=X` with empty body,
returns `DatasetVisibility`.

Real Gemma:
- `PUT /rest/v2/datasets/{id}/permissions`
- Body: `PermissionsUpdateRequest` (need to confirm exact shape —
  presumably `{ isPublic: boolean }` or similar; check Gemma's
  `DatasetsWebService.java`)
- Returns: `DatasetPermissionsValueObject`

UI change: switch the publish mutation to PUT `/permissions` with
the right body. Mock should mirror.

### 5. snake_case → camelCase across remaining payloads

The above are the load-bearing ones, but the convention difference
spans every endpoint the mock serves. Brother should sweep the mock's
Pydantic models to emit camelCase via `model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)`, and the UI's TS
mirrors update accordingly.

Catch list off the top:
- `experiment_id` → `experimentId` (everywhere)
- `short_name` → `shortName`
- `factor_values` → `factorValues`
- `free_text_label` → `freeTextLabel`
- `audit_id` → `auditId`
- `finalized_at` / `_by` → `finalizedAt` / `finalizedBy`
- `target_id` / `target_kind` → `targetId` / `targetKind`

Big touch surface, but mechanical. The TS-side change is one find-
and-replace per file plus a `tsconfig.app.json` typecheck pass.

## Ordering

To avoid breaking the live UI:

1. Brother lands mock changes behind a feature flag or a new
   `?wire=gemma` query param so the existing snake_case responses
   keep serving until the UI cuts over.
2. UI lands camelCase + nested types in a single commit, opts into
   the new wire shape, removes the visibility / publish workarounds.
3. Once UI is on the new wire and tested against the mock, drop the
   flag — mock only serves Gemma-shape.

Or simpler: brother lands the mock change, UI follows the next
working day. Friday talk demo runs on whatever's current; UI rewrite
lands the following week, no rush.

## Adopt-able new endpoints (optional, not in scope of this handoff)

Recorded for follow-up — these don't require coordination with the
mock, just adoption when convenient:

- `GET /annotations/term?uri=...` returns
  `OntologyTermValueObject { uri, label, definition, obsolete, usageCount }`.
  Could power deprecation warnings on `Term` chips (`obsolete: true`)
  and definition tooltips.
- `GET /annotations/categories` returns
  `List<OntologyTermSimpleValueObject>` — canonical EFC list,
  source of truth for `CategoryPicker`.
- `GET /annotations/predicates` returns
  `List<OntologyTermSimpleValueObject>` — canonical predicate list,
  superset of what `guidelines.ts` ships (and what
  `PREDICATE_URI_HANDOFF.md` asks the agent to use).
- `GeneValueObject` now carries NCBI URIs + `associatedExperimentCounts`
  — useful if gene chips ever pick up a usage signal.

These are nice-to-haves; the wire alignment above is the
load-bearing piece.
