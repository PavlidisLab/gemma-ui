# Align mock + UI to real Gemma's REST wire (1.32.7)

**Status:** Phase-1 landed agents-side 2026-05-13; phase-2 still open.
Filed 2026-05-13 by Paul (UI).
**Reference:** [`PavlidisLab/Gemma`](https://github.com/PavlidisLab/Gemma/tree/hotfix-1.32.7),
PRs #1650 / #1652 / #1653 / #1655 (merged May 6–13).

## Phase-1 (additive — already landed 2026-05-13)

`PUT /rest/v2/datasets/{id}/permissions` is now live on the mock,
mirroring `DatasetsWebService.updateDatasetPermissions`:

* Request: `{ "isPublic": true | false | omit }` (camelCase,
  `isPublic` optional — omit to query without mutating).
* Response: `{ "isPublic": bool, "isShared": bool }` (mock has no
  group-shared concept, so `isShared` mirrors `isPublic`).
* 404 when the dataset isn't imported, matching real Gemma.
* Emits a `DatasetVisibilityEvent` audit row on toggle.

Defined at module scope in
`gemma_curation_agents/mock_gemma_curation_api/server.py`
(`PermissionsUpdateRequest` + `DatasetPermissionsValueObject`) so
FastAPI's `typing.get_type_hints` can resolve the body annotation.

**The legacy `POST /publish` and `GET /visibility` endpoints remain
functional unchanged** — UI is free to migrate to PUT `/permissions`
when convenient; mock-side legacy gets removed in phase-2.

## Phase-2 (still open — needs UI lockstep)

These three changes break existing UI clients and need synchronized
landing:

## Background — why this is happening

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

## Specific phase-2 shape changes — mock + UI in lockstep

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

### 4. `PUT /datasets/{id}/permissions` replaces `POST /publish` ✅ phase-1

**Mock side: done 2026-05-13.** `PUT /rest/v2/datasets/{id}/permissions`
is live alongside the legacy `POST /publish`. Body
`PermissionsUpdateRequest` accepts `{ isPublic: boolean | omit }`,
returns `DatasetPermissionsValueObject` with `isPublic` + `isShared`.
The shape was confirmed by reading
`DatasetsWebService.java:PermissionsUpdateRequest`.

UI change (still open): switch `usePublishExperiment` to PUT
`/permissions` with `{ isPublic: true }`. After UI is on the new
endpoint, the legacy `POST /publish` + `GET /visibility` can be
dropped from the mock.

### 4a. Pydantic-driven response/request alignment ✅ phase-2a

**Mock side: done 2026-05-13.** Every wire-facing Pydantic base in
the mock now carries the triple:

```python
ConfigDict(
    populate_by_name=True,
    alias_generator=to_camel,
    serialize_by_alias=True,
)
```

Affected:
* `mock_gemma_curation_api/design_schemas.py:_Strict` (CurationDetailsD,
  OntologyTermD, StatementD, FactorD, …)
* `mock_gemma_curation_api/calibration_batch_schemas.py:_Strict` (CalibrationReviewState, ImportReceipt, …)
* `mock_gemma_curation_api/workflow_schemas.py:_WireBase` (WorkflowDatasetRow, ExperimentPipelineStatus, Group, …)
* `mock_gemma_curation_api/server.py:_WireBase` (PermissionsUpdateRequest, DatasetPermissionsValueObject, CurationDetailsUpdate, AuditEvent, AuditShapeSummary, VisibilityResponse)
* `agents/audit/schemas.py:_Strict` (AuditReport, AuditFinding, dispositions — SSE-emitted)
* `agents/curation_proposer/schemas.py:_Strict` (Proposal, FactorProposal, TagProposal, StatementProposal — SSE-emitted)

**Result:** REST response bodies emit camelCase on the wire (handled
by FastAPI's response serializer via `serialize_by_alias=True`).
Request bodies accept BOTH snake_case and camelCase
(`populate_by_name=True`). SQLite blob writes pinned to
`by_alias=False` so on-disk format stays snake_case across older /
newer rows.

UI side: legacy snake_case TS interfaces still work for input;
the response shape is now camelCase. Cut over field-by-field at
your convenience — the soft cutover plan below is in effect.

### 4b. SSE envelope camelCase ✅ UI absorbs (no lockstep needed)

**Mock side: AUDITED but NOT shipped (2026-05-13).** The
`serialize_by_alias` change in phase-2a fixed Pydantic-derived
contents inside SSE payloads, but the **SSE envelope itself**
(`schema_version`, `run_id`, `timestamp`, `event`, `level`,
`message`, `progress`, `payload`) is constructed as a plain dict in
`proposer_service._sse_synth` and
`agents/curation_proposer/pipeline.RunContext.emit` — these bypass
Pydantic and still emit snake_case.

The current SSE wire is mixed:

```jsonc
{
  "schema_version": 1,         // ← snake (envelope, plain dict)
  "run_id": "...",             // ← snake
  "timestamp": "...",
  "event": "subtask.audit.finding",
  "level": "warn",
  "message": "...",
  "progress": 0.10,
  "payload": {
    "finding": {               // ← snake (top-level payload key, also a kwarg name)
      "targetKind": "tag",     // ← camel (Pydantic-dumped post phase-2a)
      "targetId": "tag:1",
      "issueCode": "...",
      ...
    }
  }
}
```

**Fix is ~15 LOC** but breaks UI stream parsers immediately:

```python
from pydantic.alias_generators import to_camel
def _camel_keys(d):
    return {to_camel(k): v for k, v in d.items()}
```

Apply to both:
* `proposer_service._sse_synth` envelope construction
* `agents/curation_proposer/pipeline.RunContext.emit` envelope construction

The payload `kwargs` also need camelCasing (since callers pass
snake-named kwargs like `finding=`, `proposal=`, `accession=`,
`type=`, `error=`). Pydantic-dumped contents *inside* those values
are already camel — no change needed there.

UI changes needed in lockstep:
* `src/api/audit-stream.ts` event-shape interface: `schema_version`
  → `schemaVersion`, `run_id` → `runId`, plus payload top-level keys
* `src/api/propose-stream.ts` same shape
* Any consumer reading `event.payload.finding.target_kind` (already
  failing — that field is now `targetKind` per phase-2a; fix forward
  to camel everywhere)

**UI side (2026-05-14, post phase-2b handoff):** rather than
lockstep-rename, the UI now applies the same `snakeify` adapter it
uses for fetch responses (`src/api/client.ts`) to each parsed SSE
event in `auditStream.ts` and `proposeStream.ts`. Envelope keys
(`schema_version`, `run_id`, …) and any payload subtree get
normalised to snake_case before the reducer touches them, so bro can
ship the `_camel_keys` fix whenever — UI absorbs both shapes
transparently. Idempotent on snake input, so this is safe to land
before the mock change.

**Bro side (still open):** ship `_camel_keys` on the envelope
construction in `proposer_service._sse_synth` and
`agents/curation_proposer/pipeline.RunContext.emit`. No UI
coordination needed. Smoke-test by running `auditStream` /
`proposeStream` end-to-end against the post-fix mock; the UI's
`snakeify` will roll the envelope back to snake before consumers
read it.

Drop both the UI `snakeify` adapter and the snake-case TS interfaces
together in the post-Friday TS-side camelCase sweep.

### 5. snake_case → camelCase across remaining payloads

The above are the load-bearing ones, but the convention difference
spans every endpoint the mock serves. Brother should sweep the mock's
Pydantic models to emit camelCase, and the UI's TS mirrors update
accordingly.

Catch list off the top:
- `experiment_id` → `experimentId` (everywhere)
- `short_name` → `shortName`
- `factor_values` → `factorValues`
- `free_text_label` → `freeTextLabel`
- `audit_id` → `auditId`
- `finalized_at` / `_by` → `finalizedAt` / `finalizedBy`
- `target_id` / `target_kind` → `targetId` / `targetKind`

**Surfaces that need the sweep (don't half-do it)**

The temptation is to flip response serialization and call it done.
The wire is bigger than that — three places convention has to flip
in step or the UI sees mixed conventions:

1. **REST response bodies** — the obvious one. Driven by the
   Pydantic model config below.
2. **REST request bodies** — `PATCH /audits/{id}/dispositions` sends
   `{ dismiss_reason, accept_reason, not_sure_reason, target_id,
   applied_fix, first_seen_at, resolved_at, inherited_from }` etc.
   `POST /audits/{accession}` sends `{ scope_include, model_tier }`.
   Same for the `proposer_service` PATCH paths. These need to accept
   camelCase too — `populate_by_name=True` (below) handles this for
   free during the transition.
3. **SSE event payloads** — `auditStream` and `proposeStream` emit
   structured event bodies with `event_type`, `target_id`,
   `factor_values`, etc. inside `data:` lines. The SSE serialisation
   path likely doesn't go through FastAPI's `response_model`
   machinery, so the alias config might not pick it up automatically
   — check `gemma_curation_agents/proposer_service.py` (or wherever
   the SSE emit lives) and confirm the JSON encoders there use the
   same model config.

**Pydantic v2 config — the full triple**

```python
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

class WireBase(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,       # accept snake_case AND camelCase on input
        serialize_by_alias=True,     # emit camelCase on output (v2.6+)
    )
```

All three flags matter:
- `alias_generator=to_camel` — defines the aliases.
- `populate_by_name=True` — accepts *either* snake_case *or*
  camelCase on input. Lets legacy clients (older UIs, eval scripts,
  ad-hoc curl) keep working through the transition; the UI cuts
  over field-by-field without a hard sync point.
- `serialize_by_alias=True` — *makes* `.model_dump()` /
  FastAPI's response serializer actually emit camelCase. **Easy to
  miss**: without this, the alias is defined but `.model_dump()`
  still emits snake_case. If you can't bump Pydantic that far,
  alternative is `response_model_by_alias=True` on every FastAPI
  route (works but is N+1 places to remember).

**TS-side: regenerate, don't find-and-replace**

The mock's FastAPI app exposes an OpenAPI spec at `/openapi.json`.
Once the mock emits camelCase, regenerate `src/api/types.ts` via:

```
npx openapi-typescript http://localhost:8080/openapi.json -o src/api/generated.ts
```

(Or similar — the UI hand-maintains its TS mirrors today, but the
header comment on `src/api/types.ts` already notes the intent to
codegen.) Codegen catches everything atomically; find-and-replace
is fine for one or two files but error-prone across a 30-file
sweep.

**Soft cutover plan, given `populate_by_name=True`**

The flag relaxes the lockstep order spelled out in §Ordering below
— with it set, the mock can emit camelCase responses *while still
accepting snake_case requests*. The UI then cuts over field by
field. Each UI commit:

1. Updates one TS interface to camelCase.
2. Updates the consumers reading that interface.
3. Ships — works against the mock either way because the mock now
   accepts both on input and emits camelCase on output.

When all consumers are camelCase, drop the `populate_by_name=True`
flag and require camelCase on input too.

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
