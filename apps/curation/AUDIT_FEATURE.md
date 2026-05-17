# Audit existing curation — UI handoff

Companion to `PROGRESS_SSE.md`. This describes a **new** feature on
the agent side: auditing experiments that are *already curated* in
Gemma, rather than proposing fresh annotations. The agent server
will expose a parallel set of endpoints; the UI gets a new "Audit"
surface alongside the existing proposal flow.

Scope of this doc: what the UI needs to know to consume the new
endpoints and present audit results. Implementation on the agent side
lives in `gemma-curation-agents`; that work happens in parallel.

---

## Concept

The proposer answers *"what should the curation be?"* The auditor
answers *"is the existing curation correct, given the guidelines?"*

Per-experiment workflow:

1. Snapshot the experiment's existing factors / FVs / tags / sample
   assignments.
2. Run the proposer silently as a **comparison anchor** (never
   submitted) so the audit judge has structured baseline artifacts to
   compare against.
3. The audit judge evaluates each existing thing against guidelines
   and emits **AuditFinding** records — never rewrites curation
   directly. Curator clicks "accept fix" in the UI to materialise
   suggested changes.

Output is an **AuditReport**, stored separately from `Proposal` (its
own table, own endpoints, its own lifecycle — an audit may run
repeatedly as guidelines evolve; a proposal is one-shot).

---

## Wire schemas

Live in `gemma_curation_agents/agents/audit/schemas.py` as of
2026-05-01. Sample fixture covering every Phase 1 `target_kind` and
every `severity` is checked in at
`gemma_curation_agents/agents/audit/fixtures/sample_audit_report.json`
— copy that into the UI repo as the report-view fixture.

The TypeScript shapes below mirror the Pydantic models. When the
agent side changes a field, this doc updates in the same commit; if
you find yourself wanting to render a field that isn't here, file it
back as a question rather than inventing a shape.

```ts
type AuditTargetKind =
  | "experiment"   // experiment-wide finding (e.g. "design type wrong")
  | "factor"       // an existing FactorProposal-equivalent
  | "fv"           // a FactorValueProposal-equivalent
  | "tag"          // a TagProposal-equivalent
  | "assignment"   // sample-to-FV assignment
  | "statement";   // predicate/object on an FV — deferred, see below

type Severity = "ok" | "minor" | "major" | "blocker";

interface AuditFinding {
  target_kind: AuditTargetKind;
  target_id: string;          // stable id pointing back to the existing
                              // curation element (factor.id, fv.id,
                              // tag.id, biomaterial.short_name, etc.)
  severity: Severity;         // "ok" findings are emitted for green checks
  issue_code: string;         // e.g. "missing_baseline", "forbidden_efc",
                              // "ungrounded_term", "wrong_assignment"
  rationale: string;          // plain-English why
  citation: string;           // short Confluence ref, mirrors SubtaskDecision
  citation_url: string;
  suggested_fix: string;      // free-text; may reference proposer target ids
                              // for "use the proposer's version of this"
  proposer_suggestion: string;// one-line rendering of what the silent
                              // proposer produced for the same target, when
                              // comparable; empty otherwise
}

interface AuditReport {
  audit_id: string;             // server-assigned
  experiment_id: number;
  experiment_short_name: string;
  audited_at: string;           // ISO8601 UTC
  model: string | null;
  scope: AuditScope;            // see below
  findings: AuditFinding[];
  // Bag of structured context, parallel to Proposal.evidence
  evidence: {
    skeleton_excerpt: string;
    paper_source: string | null;
    paper_excerpt: string;
    // The silent comparison proposal in full, so the UI can render
    // "what the agent would have done" alongside each finding without
    // a second round-trip. Same shape as the existing Proposal.
    // Nullable: future scope choices (e.g. tags-only audits) may
    // skip the proposer entirely. When null, every finding's
    // ``proposer_suggestion`` will also be empty.
    comparison_proposal: Proposal | null;
  };
  // Roll-up for inbox sorting / filtering
  summary: {
    n_blocker: number;
    n_major: number;
    n_minor: number;
    n_ok: number;
    overall_verdict: "clean" | "minor_issues" | "major_issues" | "blockers";
  };
  // Latest disposition per finding-target. Empty on a freshly
  // produced report; populated by the GET endpoints from an
  // append-only log written by PATCH /audits/{audit_id}.
  dispositions: AuditFindingDisposition[];
}

interface AuditFindingDisposition {
  target_id: string;          // matches one finding's target_id
  status: "pending" | "accepted" | "dismissed" | "needs_more_info";
  reviewer: string;           // empty string when never dispositioned
  reviewed_at: string | null; // ISO8601 UTC; null when never dispositioned
  notes: string;              // free-text; default ""
}
```

### AuditScope

Phase 1 ships **subset-selectable audits** so a curator can audit only
tags, only the design, etc. without paying for the whole pipeline.

```ts
interface AuditScope {
  // Any subset; empty array = audit nothing (server returns 400)
  include: Array<"factors" | "fvs" | "tags" | "assignments">;
  // "statements" intentionally omitted from Phase 1 — see Roadmap below
}
```

Default scope when the UI sends none: `["factors", "fvs", "tags", "assignments"]`.

---

## Endpoints (anticipated)

All under the same agent service that hosts `/propose`. Auth + CORS
identical.

### `POST /audit/{accession}`

Synchronous JSON response. Body mirrors `ProposeRequest` plus an
optional `scope`:

```ts
interface AuditRequest {
  tier?: "fast" | "standard" | "strong";
  model?: string;
  scope?: AuditScope;          // omit to audit everything (Phase 1 set)
  use_cache?: boolean;         // default true
  refresh_cache?: boolean;     // default false
}
```

Returns `AuditReport`. `409` on per-accession single-flight (same
mechanism as `/propose`). `500` on pipeline failure.

### `POST /audit/{accession}/stream`

SSE variant of `/audit/{accession}`. Same event envelope as
`/propose/{accession}/stream` (see `PROGRESS_SSE.md` §ProgressEvent
shape — `schema_version`, `run_id`, `timestamp`, `event`, `level`,
`message`, `progress`, `payload`). Same request body as the
synchronous endpoint.

`progress` is monotonic non-decreasing across the stream — clamp
defensively with `Math.max(prev, ev.progress)` per the proposer
SSE convention.

Event taxonomy that actually ships:

| event                                    | progress    | notes |
|------------------------------------------|-------------|-------|
| `stream.opened`                          | 0.00        | service-synthesised; `accession` |
| `phase.audit.started`                    | 0.00        | `accession, with_comparison` |
| `phase.skeleton.fetching`                | 0.02        | only when `skeleton` not pre-built (i.e. always for the live endpoint) |
| `phase.snapshot.fetched`                 | 0.08        | `n_factors, n_tags, n_samples` |
| `subtask.audit.finding` (deterministic)  | 0.10        | one per deterministic-judge finding; payload `finding: AuditFinding` |
| `phase.comparison.running`               | 0.15        | silent proposer kicks off |
| (proposer's own `phase.*` / `subtask.*`) | 0.15–0.65   | proposer events bubble through with progress remapped into this window; original event names preserved (`phase.skeleton.fetched`, `phase.design.completed`, etc.) |
| `phase.comparison.completed`             | 0.65        | `n_proposed_factors, n_proposed_tags` |
| `phase.comparison.errored`               | 0.65        | swallowed proposer failure; audit continues |
| `phase.judge.tags_llm.running`           | 0.70        | when scope includes tags + comparison on |
| `subtask.audit.finding` (tag LLM)        | 0.80        | one per LLM-tag-judge finding |
| `phase.judge.tags_llm.completed`         | 0.83        | `n_findings` |
| `phase.judge.factors_llm.running`        | 0.85        | when scope includes factors + comparison on |
| `subtask.audit.finding` (factor LLM)     | 0.92        | one per LLM-factor-judge finding |
| `phase.judge.factors_llm.completed`      | 0.93        | `n_findings` |
| `phase.judge.completed`                  | 0.95        | overall; `n_findings, n_blocker, n_major, n_minor` |
| `phase.submitting`                       | 0.97        | POSTing to mock |
| `phase.audit.completed`                  | 1.00        | `audit_id, n_findings` |
| `stream.result`                          | 1.00        | service-synthesised terminal; `payload.report` carries the full `AuditReport` |
| `error.terminal`                         | last seen   | terminal on pipeline failure; `payload.error, payload.type` |

Notes for the UI consumer:

- The bubbled proposer events (between `phase.comparison.running` and
  `phase.comparison.completed`) keep their original names, so the
  proposer's existing log-feed renderer (see `PROGRESS_SSE.md`)
  works unchanged inside the audit stream — you don't need an
  audit-specific switch on those event names.
- `phase.completed` (the proposer's terminal) is **filtered out**
  during bubbling so it doesn't prematurely set audit progress to
  1.0. The audit emits its own `phase.audit.completed`.
- `subtask.audit.finding` events let the UI populate the findings
  list incrementally for long audits, but the final
  `stream.result.payload.report` is canonical — reconcile against
  it if a network blip drops mid-stream events.
- 400 (`scope: []`) and 422 (unknown scope item) are surfaced
  before the stream opens, so the client gets a real HTTP error
  rather than an empty SSE response.
- 409 (duplicate audit in flight) likewise.

### `GET /datasets/{id}/audits`

Returns `{ items: AuditReport[], total: number }`. Most-recent-first.
For the audit inbox.

### `GET /audits/{audit_id}`

Single audit. Use after the SSE stream closes (or in the inbox detail
view) when you want a fresh fetch.

### `PATCH /audits/{audit_id}`

Curator dispositions, parallel to the existing `PATCH
/curation-proposals/{id}`. Body is one disposition update per
request:

```ts
interface AuditFindingDispositionPatch {
  target_id: string;          // must match a finding on the audit
  status: "pending" | "accepted" | "dismissed" | "needs_more_info";
  reviewer: string;
  notes?: string;             // free-text; default ""
}
```

Returns the updated `AuditReport` with **every** finding's latest
disposition folded into `report.dispositions` (one entry per
`target_id` that has ever been dispositioned on this audit). One
PATCH = one click in the UI; bulk dispositioning isn't supported on
this endpoint and isn't needed for Phase 1.

Storage is append-only — flipping a finding from `accepted` to
`dismissed` records both, but `report.dispositions` only ever shows
the latest per `target_id`. The full history is queryable later if
we ever want to surface it.

**Server is authoritative for dispositions.** A `dispositions` field
on the inbound POST body is silently dropped — only PATCH writes
disposition state.

---

## Caching

Same disk-backed cache as the proposer. Cache key includes:

* the skeleton hash (existing-curation state — re-curation invalidates)
* the audit `scope`
* the model id

Re-running an audit on an unchanged experiment with the same scope
returns instantly without LLM calls. The UI should treat audits as
cheap to re-trigger after curator edits — that's the point.

`refresh_cache: true` forces a fresh judge pass. The UI should expose
this as a "re-audit ignoring cache" affordance, mirroring the
proposer's existing "request fresh proposal" button.

---

## UI integration shape (per-experiment)

Findings show up in **two** surfaces simultaneously inside an
experiment, plus a **third** surface across experiments. The two
in-experiment surfaces share a single source of disposition state
so a click in one updates the other.

### A. Inline severity dots — anchored to the curation element

For every finding whose `target_kind` resolves to a concrete UI
element, render a small severity dot (rose / amber / slate / emerald)
directly on that element:

| `target_kind` | UI anchor                                                    |
|---------------|--------------------------------------------------------------|
| `factor`      | dot on the factor card title in the design editor            |
| `fv`          | dot on the FV card / chip                                    |
| `tag`         | dot on the tag chip in the Overview tags strip               |
| `assignment`  | dot in a new gutter on the sample-details row                |
| `statement`   | dot on the statement row inside the FV editor (Phase 2 only) |

Click the dot → opens / scrolls the matching finding card in surface
B (the sidebar). The dot is the smallest possible cue that something
is flagged; the rationale / suggested fix lives in B.

`target_kind: "experiment"` has no concrete anchor — those findings
appear only in B.

The UI needs a small **target-id resolver** to map an
`AuditFinding.target_id` back to the UI element it anchors to. The
canonical format is documented in the §Status table at the bottom
of this doc (`gemma_curation_agents/agents/audit/target_ids.py`).
The resolver should treat any unknown shape as "no anchor" rather
than crashing — forward-compat with future `target_kind` additions.

### B. Per-experiment audit sidebar — flat triagable list

Lives in the same sidebar real estate as the proposals list.
Coexistence: a `Proposals | Audit` toggle at the top of the sidebar.
Curator picks one at a time; both lists persist their state across
the toggle.

**This is the single source of truth for disposition state** —
Accept fix / Dismiss / Needs more info live here. Inline dots in
surface A scroll the relevant finding into view in this sidebar;
they don't carry their own action surface.

The sidebar shows the same per-finding cards as surface C but in a
more compact variant for the narrower viewport (sidebar ≈ 320px
default).

### C. Cross-experiment audit inbox + standalone report view

Mirror of `ProposalsInbox`. Lists `AuditReport`s by
`overall_verdict` then recency. Click a row → the full
`AuditReportView` already implemented at
`src/features/audit/AuditReportView.tsx` — same finding cards as
B, not constrained to sidebar width, not anchored to any
experiment-shell tab.

The standalone view is also the right surface when an audit just
finished from the trigger dialog and the curator wants to read the
whole thing before acting in-context.

### Tradeoff to mind

Dual surfaces (A + B) means the same finding is visible in two
places, and a curator could disposition in B and forget the A dot
is still there. Mitigation: both surfaces read the same store —
when a disposition flips, the dot color / shape updates to match
(e.g. dismissed → small × overlay; accepted → faded).

---

## UI surfaces (sketch — refine as the feature lands)

### 1. Audit trigger

On any experiment that has existing curation, a button alongside
"Request proposal" labelled "Audit curation". Opens a small dialog:

* Scope checkboxes (factors / FVs / tags / assignments) — all on by
  default.
* Model selector (reuse the proposer's tier picker).
* "Ignore cache" toggle.

POSTs to `/audit/{accession}/stream` and renders the same progress
panel shape as `ProposeProgressPanel.tsx`. Reuse that component — the
event taxonomy is a superset.

### 2. Audit inbox

Mirror of `ProposalsInbox.tsx`, lists `AuditReport`s by
`overall_verdict` then recency. Each row shows the verdict pill,
counts of findings by severity, and the experiment short name.

### 3. Audit report view

Per-finding card, grouped by `target_kind` then severity. Each card
shows:

* The existing element (rendered the same way the design view
  renders it — reuse the existing factor/tag components).
* The finding's `rationale` + `citation` (link via `citation_url`).
* `suggested_fix` as a side-by-side diff against the existing
  element where possible — when `evidence_proposer` is non-empty,
  surface it as "What the agent would have proposed instead".
* Disposition controls: **Accept fix**, **Dismiss**, **Needs more
  info** (free-text). All wired to `PATCH /audits/{id}`.

### 4. "Flagged for review" surface

Aggregation across audits where `summary.overall_verdict ∈
{major_issues, blockers}`. This is the curator's queue of "old
curation that needs attention." Eventually this is populated by both
manual audits and a batch sweep (see roadmap); for Phase 1 it's just
manual audits.

---

## What's NOT in Phase 1

* **Statement-level findings** (predicate/object on an FV).
  Deferred — adds prompt surface without a clear win for the first
  cut. The schema reserves the `"statement"` target kind so we can
  ship it later without a wire break.
* **Auto-rewrite of curation.** The agent only ever *suggests* fixes.
  Materialising a fix is always a curator click. This is a hard rule;
  do not add UI affordances that POST findings back as curation
  edits without curator confirmation.
* **Batch sweep.** A `gca audit-curation --since DATE` CLI for
  bulk-flagging will land later. UI work for the inbox should assume
  audits arrive both manually (button) and in batches (background).

---

## Coordination

This doc is the source of truth for the wire contract. When the agent
side ships a piece, the agent doc updates first, this doc updates,
then the UI work proceeds. If you find yourself wanting to render a
field that isn't in the schemas above, file it back as a question
rather than inventing a shape — the agent side may need to emit it.

Build order on the agent side (for awareness):

1. `AuditFinding` / `AuditReport` schemas + mock-API tables / endpoints.
2. Per-target judge sub-agents (factor judge, tag judge first; FV /
   assignment can ride on the existing baseline-picker / coverage /
   term-validator subtasks running in audit mode).
3. `audit_pipeline.py` + `audit_service.py` (parallel of
   `pipeline.py` / `proposer_service.py`).
4. SSE wiring for the new event taxonomy.
5. `PATCH /audits/{id}` for curator dispositions.

UI can begin on (1) the audit trigger dialog and progress panel
against a stub server, and (2) the report view against a fixture
`AuditReport` JSON, before the agent side is fully wired.

### Status (2026-05-01)

* **Step 1 — schemas + fixture: done.** Schemas at
  `gemma_curation_agents/agents/audit/schemas.py`; fixture at
  `gemma_curation_agents/agents/audit/fixtures/sample_audit_report.json`.
  UI may proceed on the report view immediately.
* **Step 2 — pipeline scaffold + deterministic judges: in progress.**
  `audit_curation()` runs end-to-end against a hand-built `Skeleton`
  and emits real `AuditFinding`s for two checks:
  - **Forbidden EFC** (factor scope) — flags factors whose category is
    on the proposer's S2 forbidden list (`dose`, `duration`,
    `concentration`, `time`, `timepoint duration`). Emits `ok` for
    allowed categories. `severity=major`, `issue_code=forbidden_efc`.
  - **Tag grounding** (tag scope) — flags tags missing ontology URIs.
    Both URIs missing → `severity=major`, `issue_code=ungrounded_tag`.
    Value URI only missing → `severity=minor`,
    `issue_code=ungrounded_term`. Both present → `ok`.

  No LLM judges and no service layer yet — but the silent
  comparison proposer is now wired (see next bullet).
  `target_id` convention is settled and documented in
  `gemma_curation_agents/agents/audit/target_ids.py`:

  | kind | format |
  |---|---|
  | experiment | `experiment:{db_id}` |
  | factor | `factor:{category-slug}` |
  | fv | `fv:{factor-slug}/{fv-slug}` |
  | tag | `tag:{category-slug}/{value-slug}` |
  | assignment | `assignment:{biomaterial-short-name}` |

* **Step 2b — silent comparison proposer wired: done.**
  `audit_curation()` now invokes `propose_curation()` with
  `submit=False` and `treat_skeleton_as_fresh=True`, attaches the
  result to `evidence.comparison_proposal`, and lifts paper context
  (`paper_source`, `paper_excerpt`) onto the audit evidence so the
  UI doesn't need to peel them out of the embedded `Proposal`. A
  proposer failure (LLM timeout, biolit hiccup) is logged and
  swallowed — the audit still completes, with
  `comparison_proposal: null`. Cache is honoured (proposer's
  on-disk cache; audit-level cache is a separate later step).

  The Phase 1 deterministic judges don't read this yet, so
  `proposer_suggestion` on every finding is still empty. That
  changes when the LLM judges land — at which point the UI's
  side-by-side panel becomes load-bearing.

* **Step 3 — mock-API persistence + dispositions: done.**
  Five live endpoints (auth: same bearer as the proposals routes):

  | route | purpose |
  |---|---|
  | `POST /rest/v2/datasets/{id}/audits` | submit a fresh `AuditReport`; server assigns `audit_id`; inbound `dispositions` are dropped |
  | `GET /rest/v2/datasets/{id}/audits` | per-experiment list, most-recent-first; `dispositions` folded in |
  | `GET /rest/v2/audits` | cross-experiment inbox list |
  | `GET /rest/v2/audits/{audit_id}` | single audit with dispositions |
  | `PATCH /rest/v2/audits/{audit_id}` | append one `AuditFindingDispositionPatch`; returns the audit with refreshed dispositions |

  Storage is SQLite (`audits` + `audit_dispositions` tables). The
  disposition log is append-only; the read path returns the latest
  row per `target_id`. UI can stop stubbing PATCH and switch to
  the live endpoint immediately. `audit_curation()` accepts
  `submit=True` + `target=...` to POST the report end-to-end.

* **Step 4 — agent service for `POST /audit/{accession}`: done.**
  Lives on the same FastAPI app as `/propose` (in
  `gemma_curation_agents/proposer_service.py`), so the UI's existing
  service URL works unchanged. New surface:

  | route | purpose |
  |---|---|
  | `POST /audit/{accession}` | run an audit + persist to mock; returns the `AuditReport` |
  | `GET /health` | now also exposes `audit_in_flight: string[]` |

  Request body (all fields optional):

  ```ts
  interface AuditRequest {
    tier?: "fast" | "standard" | "strong";
    model?: string;                    // wins over tier
    scope?: Array<"factors" | "fvs" | "tags" | "assignments">;
    with_comparison?: boolean;         // default true
    use_cache?: boolean;               // default true
    refresh_cache?: boolean;           // default false
  }
  ```

  Behaviour:
  - Synchronous; returns the persisted `AuditReport` (already
    POSTed to the mock — no extra round-trip needed).
  - Single-flight per accession **independent of `/propose`** —
    a curator can request a proposal and an audit on the same
    experiment in parallel without 409ing each other. Both share
    the global Anthropic concurrency cap.
  - 400 on `scope: []` (likely UI bug — checkboxes all unchecked).
  - 409 on duplicate audit in flight for the same accession.
  - 500 on pipeline failure (Anthropic error, biolit, etc.).

  No SSE variant yet — that's its own follow-up since the audit
  pipeline doesn't emit progress events. For Phase 1 the
  synchronous endpoint is enough; the UI can show a spinner
  against the in-flight POST.

* **Step 5a — first LLM judge (tags): done.**
  `agents/audit/judges/tag_llm_judge.py` runs one structured-output
  Anthropic call per audit (when `with_comparison=True` AND `tags`
  is in scope) and emits two new finding shapes:

  - **Per-tag semantic verdicts** — `target_kind: "tag"`, severities
    `ok`/`minor`/`major`, `issue_code` ∈ `{ok, wrong_value,
    wrong_category, vague, redundant, out_of_scope}`. These coexist
    with the deterministic grounding findings (different
    `issue_code`s, different concerns — both can fire on the same
    tag). `proposer_suggestion` populates with the proposer's
    rendering of the same tag when relevant.
  - **Missing-tag findings** — `target_kind: "experiment"`,
    `issue_code: "missing_tag"`, severity `minor`. Surfaced when the
    proposer suggested a tag the existing curation lacks. Anchored
    to the experiment (no concrete UI element to dot-attach), with
    `suggested_fix: "Add tag \`X: Y\`."` and `proposer_suggestion`
    pre-rendered.

  Behavior contracts the UI can rely on:
  - LLM call is skipped entirely when `tags` not in scope OR when
    the existing tag list is empty (no point) OR when
    `with_comparison=False` (cheap-pass mode).
  - LLM error doesn't fail the audit — it degrades to a single
    `severity: "minor"`, `issue_code: "tag_judge_errored"`,
    `target_kind: "experiment"` finding so deterministic findings
    still ship.

* **Step 5b — LLM factor judge: done.**
  `agents/audit/judges/factor_llm_judge.py` runs one structured-output
  Anthropic call per audit (gating: `with_comparison=True` AND
  `factors` in scope AND existing factor list non-empty). Two finding
  shapes:

  - **Per-factor semantic verdicts** — `target_kind: "factor"`,
    severities `ok`/`minor`/`major`/`blocker` (`blocker` reserved for
    "factor materially misrepresents the design"; rare). `issue_code`
    ∈ `{ok, wrong_category, wrong_fv_partition, vague_fv_labels,
    conflated, redundant_factor}`. Coexists with the deterministic
    `forbidden_efc_judge` (different `issue_code`s — both can fire
    on the same factor). `proposer_suggestion` populates with
    `category: [fv1, fv2, ...]`.
  - **Missing-factor findings** — `target_kind: "experiment"`,
    `issue_code: "missing_factor"`, severity `minor` (capped at 2
    per audit; the proposer over-proposes more often than it
    under-proposes, and the prompt tells the model to be
    conservative). `suggested_fix: "Add factor \`X\` with FVs [...]."`

  What the judge **doesn't** opine on (because the read API doesn't
  expose it for existing factors): baseline picks, statement
  predicates/objects, sample-to-FV assignments. The prompt tells
  the model to stay within the visible surface (category + name +
  FV labels) so it doesn't hallucinate verdicts about things it
  can't see. The corresponding judges land when those data shapes
  start flowing through the skeleton extractor.

  Same error-fold contract as the tag judge: an LLM hiccup degrades
  to one `severity: "minor"`, `issue_code: "factor_judge_errored"`,
  `target_kind: "experiment"` finding.

* **Step 6 — SSE stream variant of `/audit/{accession}`: done.**
  `POST /audit/{accession}/stream` lives on the same FastAPI app;
  same body shape as the synchronous endpoint; same single-flight
  + concurrency rules. Event taxonomy is the table above. The
  silent comparison proposer's own SSE events (when it's enabled)
  bubble through with `progress` remapped into the 0.15–0.65
  window so the audit progress bar doesn't get yanked to 1.0
  mid-run by the proposer's terminal event.

  The UI can drop the spinner on the trigger button and reuse
  `ProposeProgressPanel`-style rendering — the event envelope is
  identical (`schema_version`, `run_id`, `timestamp`, `event`,
  `level`, `message`, `progress`, `payload`).

* **Step 5c-a — skeleton enrichment + deterministic FV / assignment
  coverage judge: done.** `Skeleton.ExistingFactor` now carries a
  `fv_meta: list[ExistingFactorValue]` field with per-FV detail
  lifted from gemmapy's `sample_factor_values`: FV id, label,
  statement predicate / object, and the biomaterial short names
  assigned to that FV. Snapshot's `FvTarget` surfaces these; the
  audit pipeline reads them. The schema change is additive — older
  callers that build `ExistingFactor` without `fv_meta` keep
  working, judges check before reading.

  New deterministic judge (`fv_coverage_judge`), gated on `fvs` OR
  `assignments` in scope, emits two finding shapes:

  - **Per-FV** — `target_kind: "fv"`. `severity: "ok"` /
    `issue_code: "ok"` for an FV with at least one biomaterial;
    `severity: "major"` / `issue_code: "fv_empty"` for an FV with
    none (rare; structurally broken). When the skeleton extractor
    couldn't lift assignment data (no `sample_factor_values`,
    legacy callers), every FV gets a single `ok` finding whose
    rationale says "FV exists; sample-assignment data wasn't
    available, so FV membership wasn't audited."
  - **Per-factor** — `target_kind: "factor"`. `severity: "major"`
    / `issue_code: "incomplete_assignments"` when the union of an
    existing factor's FV assignments doesn't cover every sample;
    rationale carries the count (`"covers 8/12 samples; 4 unassigned"`).
    Skipped when assignment data isn't available or `n_samples == 0`.

* **Step 5c-b — LLM FV judge: done.**
  `agents/audit/judges/fv_llm_judge.py` runs one structured-output
  Anthropic call per audit (gating: `with_comparison=True` AND
  `fvs` in scope AND at least one factor's FVs carry assignment /
  statement / id data). Two finding shapes:

  - **Per-FV semantic verdicts** — `target_kind: "fv"`, severities
    `ok`/`minor`/`major`, `issue_code` ∈ `{ok, vague_label,
    wrong_assignment, missing_statement, redundant_fv}`. Coexists
    with the deterministic `fv_coverage_judge` (different concerns,
    both can fire on the same FV). `proposer_suggestion` populates
    with `label (predicate object) ← N samples` when the proposer
    produced a comparable FV.
  - **Missing-FV findings** — `target_kind: "factor"` (anchored
    to the parent factor — no concrete UI element exists for an
    FV that doesn't exist yet), `issue_code: "missing_fv"`,
    severity `minor` (capped at 4 per audit). `suggested_fix:
    "Add FV \`X\` to this factor."`.

  What the judge **doesn't** opine on: baseline picks (Gemma's
  read API doesn't expose them). The prompt explicitly tells the
  model to stay off the topic.

  Same error-fold contract as the other LLM judges: failure
  degrades to one `severity: "minor"`, `issue_code:
  "fv_judge_errored"`, `target_kind: "experiment"` finding.

  Phase 1 audit pipeline is now feature-complete: deterministic
  judges (forbidden EFC, tag grounding, FV/assignment coverage) +
  LLM judges (tag, factor, FV) all wired and gated correctly. SSE
  stream emits `phase.judge.fvs_llm.running` / `…completed`
  events alongside the existing tag/factor LLM phase events. The audit trigger dialog and inbox can be
  built against a stub once the report view is shaped — no need to
  wait for the live endpoint.

### UI status (2026-05-01)

Mirrors the agent-side Step list above so my brother can see what's
wired on the UI side without crawling the source tree.

* **Wire types — done.** `src/api/auditTypes.ts` carries
  `AuditFinding`, `AuditReport`, `AuditScope`, `AuditEvidence`,
  `AuditSummary`, `AuditFindingDisposition`,
  `AuditFindingDispositionPatch`, `DispositionStatus`, `AuditRequest`
  (flat `scope` array per Step 4's request shape). Re-exports the
  existing `Proposal` for the embedded comparison.

* **Standalone fixture preview — done.** `#/audit-preview` renders
  `AuditReportView` against the bundled fixture for layout
  iteration without a live server. Disposition controls toast
  view-only; the live disposition path is on the per-experiment
  sidebar and the audit detail page (below).

* **Per-experiment sidebar (surface B) — done.**
  `AuditSidebarPanel` toggles into the proposals sidebar slot via
  `Proposals | Audit` segmented control. Reads the most-recent live
  audit from `useAuditsForExperiment(experimentId)`; dev override
  slot lets curators load the fixture or synthesise a report
  against the loaded design (slug-targets match real elements so
  inline dots fire). Compact finding cards (severity-sorted, `ok`
  collapsed, click-to-expand) with PATCH-backed disposition
  controls — server-authoritative for live, in-memory for synth.
  Sidebar header shows verdict pill + per-severity counts + scope.

* **Inline severity dots (surface A) — done.** `AuditDot` resolves
  via `findingsByTarget` in `AuditContext`; renders nothing when
  the target has no findings. Dispositioned findings dim and pick
  up an overlay glyph (× dismissed, ✓ accepted, ? needs more
  info). Anchors wired in:
    - `FactorList` factor-name column → `factorTarget(category)`
    - `FactorValueCard` FV title → `fvTarget(category, label)`
    - `OverviewPanel` tag chips (single + multi-value) →
      `tagTarget(category, value)`
    - `SampleDetailsPanel` short-name cell →
      `assignmentTarget(short_name)`
  Click → flips sidebar to Audit view, expands the matching card,
  scrolls into view, blue ring while focused.

* **Cross-experiment inbox (surface C) — done.**
  `#/audits` lists every `AuditReport` from `GET /rest/v2/audits`,
  grouped by experiment, sorted by recency. Verdict-filter tabs
  default to "actionable" (blockers + major). Per-row click lands
  on `#/audits/{audit_id}` (standalone detail page); group-row
  click drops into the experiment shell instead.

* **Standalone detail page — done.** `#/audits/{audit_id}` reads
  `useAuditDetail(auditId)` and renders `AuditReportView` with
  PATCH-wired dispositions. "Open experiment →" link drops into
  the experiment shell where the inline dots show.

* **Trigger dialog + SSE stream — done.** `+ audit` button in the
  sidebar header opens `AuditTriggerDialog` (scope checkboxes,
  tier picker, `with_comparison`, `refresh_cache`). On submit,
  `useAuditStream(experimentId)` POSTs `/audit/{accession}/stream`
  and the existing `ProposeProgressPanel` renders the live progress
  + log feed (we widened it to take a generic `ProgressPanelState`
  so both proposer and audit streams share it). On `done`, the
  panel stays visible above the freshly-loaded report; on `error`,
  same — the curator dismisses when they're satisfied.

* **target_id resolver — done.** `src/features/audit/targetIds.ts`
  mirrors `target_ids.py`'s `_slug` rule exactly (lowercase +
  collapse runs of whitespace into single dashes). Forward-compat:
  `parseTargetId()` returns null on unknown shapes so an unknown
  `target_kind` doesn't crash the dot resolver.

* **Vite proxy — done.** `/audit` → `GEMMA_PROPOSER_URL`
  (timeouts disabled to match `/propose`).

* **Phase 2 deferred:** statement-level findings (no UI anchor
  yet — `statement` target_kind is reserved in the type), audit
  history surface (per-experiment "all audits, not just latest"),
  per-finding deep linking from inbox row to specific scrolled
  position in the detail page, richer rendering of embedded
  `comparison_proposal` (currently a JSON dump in `AuditReportView`).

### `DatasetSummary` audit fields — done

`GET /rest/v2/datasets` now surfaces the seven audit fields on every
row. All optional / defaulted, so a row with no audits returns
`n_audits: 0`, `latest_audit_id: null`, etc. without breaking the
existing TS shape. Computed in `Storage.audit_summaries()` —
counts only the latest audit's findings whose latest disposition
is `pending` (or absent), per the doc semantics. `ok` findings
are excluded from the unactioned counts.

Live verification against the post-batch mock DB:

```
short_name      n_audits verdict            unactioned B/M/m
GSE47162               2 major_issues       0 /  2 /  8
GSE281069.1            1 major_issues       0 /  2 /  1
GSE63264               1 major_issues       0 /  9 /  9
GSE74282               1 major_issues       0 / 10 /  8
GSE34201               1 major_issues       0 /  1 /  5
GSE86936               1 minor_issues       0 /  0 /  3
GSE42052               1 minor_issues       0 /  0 /  4
GSE206270              1 minor_issues       0 /  0 /  6
GSE145202              1 minor_issues       0 /  0 /  4
GSE32309               1 major_issues       0 /  6 /  7
```

(GSE47162's `n_audits: 2` is from the prompt-fix reaudit; latest
wins, so the unactioned counts are from the post-fix audit, not
the original.)

The mock server needs restart for the new `DatasetSummary`
Pydantic shape to take effect on the wire — storage-layer changes
are picked up live, but the response_model is bound at app
startup.

### Original ask (for reference)

The UI's experiments landing page (`/rest/v2/datasets`, served via
`useDatasets` → `DatasetSummary`) is becoming a unified dashboard:
one row per experiment, status chips that combine curation flags +
pending proposals + audit state. Today the row knows nothing about
audits — curators have to open each experiment to see whether it
needs audit triage.

Please add these fields to `DatasetSummary` (Pydantic + the
`/rest/v2/datasets` GET handler). All optional / nullable so the
UI can ship the dashboard incrementally; missing values degrade to
"no audits run yet".

```ts
interface DatasetSummary {
  // … existing fields …

  /** Total count of audits ever submitted for this experiment. 0 =
   *  never audited. */
  n_audits: number;

  /** audit_id of the most recent audit (by audited_at). Null when
   *  n_audits == 0. Lets the row deep-link to the audit detail
   *  page (#/audits/{audit_id}). */
  latest_audit_id: string | null;

  /** ISO 8601 UTC timestamp of the most recent audit. Null when
   *  n_audits == 0. Sortable so curators can see "audited recently"
   *  at a glance. */
  latest_audited_at: string | null;

  /** overall_verdict of the most recent audit, or null when
   *  n_audits == 0. The dashboard uses this for the verdict chip
   *  + the verdict filter pill. */
  latest_audit_verdict:
    | "clean"
    | "minor_issues"
    | "major_issues"
    | "blockers"
    | null;

  /** Counts of *unactioned* findings on the LATEST audit only —
   *  i.e. findings whose latest disposition is "pending" (not
   *  accepted / dismissed / needs_more_info), broken out by
   *  severity. Older audits' findings don't count: re-running an
   *  audit is the canonical way to refresh the assessment.
   *
   *  These drive the dashboard's "audit issues" filter pill and
   *  the per-row chip's color (rose = blockers > 0; amber =
   *  major > 0; slate = minor > 0; emerald when verdict=clean
   *  with no unactioned findings). */
  n_unactioned_blocker: number;
  n_unactioned_major: number;
  n_unactioned_minor: number;
}
```

Semantics notes:
- "Latest audit only" for the unactioned counts. Older audits are
  history — if a curator re-audits, fresh-pending findings on the
  new audit replace the old assessment. The same `target_id`
  appearing in both audits doesn't double-count because the
  disposition is keyed on (audit_id, target_id).
- `n_ok` is intentionally not part of the dashboard surface — green
  checks aren't a dashboard signal.
- A future `?audit_verdict=blockers,major_issues` query param on
  GET `/rest/v2/datasets` would let the UI push the filter
  server-side; nice-to-have, not blocking the dashboard work.

UI side will ship the dashboard chip + filter + sort with these
fields treated as optional (TS `?:` so a server that hasn't been
upgraded yet still type-checks). Once they land server-side, the
row populates without any client change.
