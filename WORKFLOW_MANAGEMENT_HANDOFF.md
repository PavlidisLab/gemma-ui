# Workflow management — UI/agent handoff

Companion to `WORKFLOW_MANAGEMENT.md`. That doc is the product brief;
this one is the cross-repo wire contract. The UI can't be built until
the entities and endpoints below exist in the mock.

---

## Mental model

Two completely disjoint worlds. A dataset lives in exactly one:

```
Screening world                  │  Gemma world
─────────────────────────────────┼──────────────────────────────────
Pre-Gemma candidates (GEO IDs)   │  Gemma experiments (dataset IDs)
Curation track only              │  Curation + Analysis tracks
Screening group type             │  Pipeline / Review group types
No Gemma ID                      │  Has Gemma ID
```

When a candidate is approved and a skeleton is loaded it crosses the
boundary permanently. It is no longer a candidate — it becomes a Gemma
experiment. The screening provenance (who found it, why it was selected,
which batch) travels as read-only history on the experiment record but
the entity type changes and it never appears in screening UI again.

---

## Entity 1: Candidate

A pre-Gemma dataset under consideration for curation. Identified by
external accession, not a Gemma ID.

### Shape

```python
class Candidate(BaseModel):
    id: str                          # internal UUID
    accession: str                   # e.g. "GSE12345", "E-MTAB-1234"
    source: CandidateSource          # see enum below
    title: str | None
    organism: str | None
    platform: str | None
    sample_count: int | None
    status: CandidateStatus          # see state machine below
    decision_reason: str | None      # required when excluded or deferred
    reviewer: str | None             # who made the decision
    reviewed_at: datetime | None
    notes: str | None
    gemma_id: int | None             # set when skeleton is loaded
    loaded_at: datetime | None
    added_by: str
    added_at: datetime
    source_batch: str | None         # e.g. "GEO scrape 2025-10"

class CandidateSource(str, Enum):
    GEO = "GEO"
    ARRAY_EXPRESS = "ArrayExpress"
    SRA = "SRA"
    MANUAL = "manual"                # curator added directly

class CandidateStatus(str, Enum):
    PENDING = "pending"              # added, not yet reviewed
    IN_REVIEW = "in_review"          # someone is looking at it
    APPROVED = "approved"            # include — ready to load
    EXCLUDED = "excluded"            # not suitable
    DEFERRED = "deferred"            # not now, revisit later
    LOADED = "loaded"                # skeleton loaded; gemma_id set
```

### State machine

```
pending ──→ in_review ──→ approved ──→ loaded
                      ├─→ excluded
                      └─→ deferred ──→ in_review  (revisit)
```

Validator: `excluded` and `deferred` require `decision_reason`.
`loaded` requires `gemma_id` and `loaded_at`.

### Bulk intake

Candidates arrive in batches (a GEO scrape, a collaborator list).
The bulk-create endpoint accepts a list and a `source_batch` label
so the whole intake is traceable.

---

## Entity 2: Group

A named, typed, persistent collection a curator uses to track work
together. Persistent because curation takes days to months.

### Shape

```python
class GroupType(str, Enum):
    SCREENING = "screening"    # contains Candidates
    PIPELINE = "pipeline"      # contains Gemma experiments
    REVIEW = "review"          # contains Gemma experiments

class Group(BaseModel):
    id: str
    name: str
    type: GroupType
    description: str | None
    created_by: str
    created_at: datetime

class GroupMember(BaseModel):
    group_id: str
    # screening groups: candidate_id; pipeline/review: gemma dataset id
    member_id: str
    added_by: str
    added_at: datetime
```

Group type is immutable after creation. Screening groups hold only
candidates; pipeline and review groups hold only Gemma experiment IDs.
One experiment can belong to multiple groups (thematic + workflow
groupings are independent).

---

## Entity 3: Pipeline status summary

The UI's list view renders per-experiment status strips for both
tracks. Each track needs a compact status object per step.

```python
class StepStatus(str, Enum):
    NOT_RUN = "not_run"
    OK = "ok"
    FAILED = "failed"
    IN_PROGRESS = "in_progress"
    NEEDS_ATTENTION = "needs_attention"
    NA = "na"                  # not applicable (e.g. affy-only step on RNA-seq)

class PipelineStep(BaseModel):
    status: StepStatus
    last_run: datetime | None
    details: str | None        # failure reason, or brief summary

class AnalysisTrack(BaseModel):
    missing_value_analysis: PipelineStep   # 2-channel only; NA otherwise
    batch_info: PipelineStep
    preprocessing: PipelineStep
    dea: PipelineStep
    diagnostics: PipelineStep

class CurationTrack(BaseModel):
    design: PipelineStep
    tags: PipelineStep
    outlier_review: PipelineStep
    batch_decision: PipelineStep
    audit: PipelineStep

class ExperimentPipelineStatus(BaseModel):
    dataset_id: int
    analysis: AnalysisTrack
    curation: CurationTrack
    is_public: bool
    is_troubled: bool
    needs_attention: bool
    curation_note: str | None
    geeq_quality: float | None
    geeq_suitability: float | None
```

The UI needs this for every row in the list view. A bulk endpoint
is essential — loading statuses one-by-one for a 50-row list is
unusable.

---

## API endpoints needed

### Candidates

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/rest/v2/candidates` | filterable by status, source, source_batch, reviewer |
| `POST` | `/rest/v2/candidates` | single create |
| `POST` | `/rest/v2/candidates/bulk` | batch intake; body: `{ source_batch, source, items: [{accession, title?, ...}] }` |
| `GET` | `/rest/v2/candidates/{id}` | |
| `PATCH` | `/rest/v2/candidates/{id}` | status transitions, notes, reviewer |
| `DELETE` | `/rest/v2/candidates/{id}` | |

### Groups

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/rest/v2/groups` | filterable by type, created_by |
| `POST` | `/rest/v2/groups` | |
| `GET` | `/rest/v2/groups/{id}` | |
| `PATCH` | `/rest/v2/groups/{id}` | name, description only; type is immutable |
| `DELETE` | `/rest/v2/groups/{id}` | |
| `GET` | `/rest/v2/groups/{id}/members` | returns candidates or experiment stubs depending on type |
| `POST` | `/rest/v2/groups/{id}/members` | body: `{ member_ids: string[] }` |
| `DELETE` | `/rest/v2/groups/{id}/members/{memberId}` | |

### Pipeline status

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/rest/v2/datasets/{id}/pipeline-status` | single experiment |
| `POST` | `/rest/v2/datasets/pipeline-status` | bulk; body: `{ dataset_ids: int[] }`; returns map of id → status |

The bulk endpoint is load-bearing for the list view — the UI will
call it with the IDs of whatever page of experiments is visible.

### Note on analysis dispatch

Pipeline dispatch actions (trigger preprocess, fillBatchInfo, DEA,
etc.) call the **real Gemma REST API** directly, not the mock agent
service. The mock only needs to implement the status read endpoints
above. Dispatch wiring comes later when we integrate with the real
Gemma backend.

---

## Provenance link (candidate → experiment)

When a candidate is loaded as a skeleton, `candidate.gemma_id` is
set. The UI will want to surface this as read-only history on the
experiment: "Sourced from GEO scrape 2025-10, approved by Paul
2025-10-14." No write path from the experiment side — provenance
is set once at load time and doesn't change.

Whether this lives as a field on the Gemma experiment record or as
a reverse-lookup on the candidate is your call. The UI just needs
`GET /rest/v2/datasets/{id}` (or the pipeline-status endpoint) to
include a `candidate_provenance` stub:

```python
class CandidateProvenance(BaseModel):
    candidate_id: str
    accession: str
    source: CandidateSource
    source_batch: str | None
    approved_by: str | None
    approved_at: datetime | None
```

---

## Open questions / decisions for the agent side

File responses here and the UI side will pick them up:

- **Visibility model for groups:** **Team-visible by default.** The
  `GET /rest/v2/groups` list returns all groups; an optional
  `created_by` query param lets the UI filter to "my groups". No
  per-user ACL in the mock — curators are a small team and sharing
  queues is the primary use case.

- **Candidate metadata enrichment:** **No auto-lookup in the mock.**
  The curator supplies `title`, `organism`, `sample_count` etc. on
  create (all optional). For the real tool a GEO fetch helper makes
  sense; for the mock, whatever the curator types is fine.

- **`source_batch` as a first-class entity:** **String label is
  enough for now.** `GET /rest/v2/candidates?source_batch=...`
  filters to a batch. If a curator needs batch-level metadata
  (query used, who ran the scrape, date) we can add a
  `SourceBatch` entity later; the string label is a natural key
  for the upgrade.

## Agent-side implementation status (2026-05-02)

All mock endpoints are implemented in
`gemma_curation_agents/mock_gemma_curation_api/`:

| Endpoint group | Routes | Storage methods |
|---|---|---|
| Pipeline status (single) | `GET /datasets/{id}/pipeline-status` | `get_pipeline_status` |
| Pipeline status (bulk) | `POST /datasets/pipeline-status` | `get_pipeline_statuses_bulk` |
| Pipeline dispatch | `POST /datasets/{id}/preprocess`, `.../diagnostics`, `.../batchInformation/fetch`, `.../geeq/recalculate`, `.../analyses/differential` | `set_pipeline_step`, `create_and_complete_task` |
| Task polling | `GET /tasks/{id}` | `get_task` |
| GEEQ | `GET/POST /datasets/{id}/geeq` | `get_geeq`, `set_geeq` |
| Outlier | `PUT /datasets/{id}/samples/{sid}/outlier` | `set_outlier` |
| QT preferred | `PATCH /datasets/{id}/quantitationTypes/{qtid}` | `set_qt_preferred` |
| Visibility | `POST /datasets/{id}/makePublic`, `.../makePrivate` | `set_experiment_visibility` |
| Groups | `GET/POST /groups`, `GET/PATCH/DELETE /groups/{id}`, `GET/POST /groups/{id}/members`, `DELETE /groups/{id}/members/{mid}` | `create_group`, `get_group`, `list_groups`, `update_group`, `delete_group`, `add_group_members`, `remove_group_member` |
| Candidates | `GET/POST /candidates`, `POST /candidates/bulk`, `GET/PATCH/DELETE /candidates/{id}` | `create_candidate`, `get_candidate`, `list_candidates`, `patch_candidate`, `delete_candidate` |

Schema lives in `workflow_schemas.py` — start there when building TS types.
