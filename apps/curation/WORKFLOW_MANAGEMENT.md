# Experiment workflow management — big picture handoff

The proposer agent (design + tags) is one piece of a much larger curation
pipeline. Paul wants the new UI to manage the **full experiment lifecycle**,
not just experimental design. This doc is the brief for that next layer of
the product.

---

## Lifecycle state diagram

![Lifecycle](../../../gemma-curation-agents-eval/docs/figures/workflow_lifecycle.svg)

Figure source: `gemma-curation-agents-eval/scripts/build_workflow_lifecycle_figure.py`.
Caption: `gemma-curation-agents-eval/decks/CAPTIONS.md`.

The full journey from a GEO accession (or a date-range scrape) to a public
Gemma experiment runs through **eight states**, with three orthogonal layers
hanging off the main flow:

### Main flow

| State | Entity in Gemma | Driver |
|---|---|---|
| **Discovery** | none — external GEO query | Scraper (deterministic) + AI relevance filter |
| **Candidate** | `Candidate` row in the curation DB (no Gemma ID) | AI recommends "should we load?" → curator triages |
| **Skeleton** | `SkeletonInvestigation` ⊂ `Investigation` + append-only `AgentProposal` (JSON) | Proposer agent (Opus / chain / arbiter) |
| **Loaded** | `ExpressionExperiment` exists; data + autofill arrived (taxon, platform, PMID) | Gemma data pipeline (deterministic) |
| **Curate** | EE has design + tags being built | Proposer + curator review |
| **Process** | QC, MV analysis, batch info, vectors, DEA | Gemma pipelines (deterministic) |
| **Audit** | `AuditReport` artifact + audit events written to Gemma | Auditor agent + curator dispositions |
| **Public** | EE published | Curator decision against the pre-public checklist |

### Recuration loop

Audit → Curate is a hard arrow, not a soft one. When the auditor flags a
problem and the curator accepts the disposition, the experiment returns to
the Curate state with the audit's findings as the worklist. The
`PUT /curationDetails` writeback (shipped 2026-05-18) plus a future
`PUT /design` are what make this loop closeable in production.

### Cross-cutting layer 1 — task tickets

Independent of the linear lifecycle, the system carries **task tickets**:
specific work items targeted at one or more experiments. Examples that
matter today:

- "needs alignment to genome" — a deterministic pipeline gap
- "outlier review" — a curator review against the Diagnostics tab
- "batch confound revisit" — usually GEEQ-triggered
- "publication relink" — when CC1 / PMID lookup updates
- "tag drift sweep" — a periodic check across already-curated EEs

Tickets can fire against any lifecycle state. They are a separate object
type from audits (which are produced by the auditor agent and consumed
through dispositions) — a ticket is "do this specific thing" rather than
"react to this finding."

### Cross-cutting layer 2 — evaluations

Evaluations are also state-targeted but produce **metrics rather than
curation actions**. The current eval harness (holdout sets, calibration
packages, ablations, inter-curator agreement runs, regression guardrails)
lives in `gemma-curation-agents-eval` and reads from the Audit-state
artifacts plus, in some cases, fresh Skeleton-state runs. Treating
evaluations as a first-class workflow object lets us:

- queue a benchmark run from the same UI curators use
- carry the same provenance + dispositions back into the audit trail
- avoid the current "evals exist in a parallel universe from production
  curation" split

### Two-world boundary

The Discovery + Candidate states are **the screening world** — external
accession only, no Gemma ID. Skeleton onwards is **the Gemma world** —
every state has an Investigation row, an ID, ACLs, audit trail. Crossing
the boundary (Candidate → Skeleton) is a one-way promotion; screening
provenance carries forward as read-only history.

See `~/Dev/eclipseworkspace/Gemma/AGENT_WRITEBACK_RECCE.md` for the
Gemma-side schema sketch (Investigation subclass + append-only
AgentProposal entity holding the JSON payload).

---

## The full curation pipeline

From Confluence (`How-to-Curate-an-Experiment`), order is "partly arbitrary":

| # | Step | Who/what does it today |
|---|------|------------------------|
| 1 | Multiplatform? → curate platform first | Manual |
| 2 | Link publication (PMID) | **Proposer agent (CC1)** |
| 3 | Curate experimental design (EFCs + FVs + assignments) | **Proposer agent (S1–S9)** |
| 4 | Curate experiment tags | **Proposer agent (S1–S9)** |
| 5 | `affyFromCel` (Affymetrix only) | CLI / Gemma admin |
| 6 | Diagnostics tab review | Manual |
| 7 | Outlier review / removal | Manual |
| 8 | `fillBatchInfo` (microarray; RNA-seq pipeline does it auto) | CLI / Gemma admin |
| 9 | Reprocess vectors + batch-correct | CLI / Gemma admin |
| 10 | DEA (differential expression analysis) | CLI / Gemma admin |
| 11 | Generate flat files (non-GEO datasets only) | CLI |
| 12 | Run the experiment checklist | Manual |
| 13 | Confirm taxon | Manual (SQL check) |
| 14 | Make public, or mark unusable | Manual (admin UI) |

**Steps 2–4 are done.** Steps 5–14 are the "beyond experimental design"
territory. The UI needs to drive them, not just observe them.

---

## Pre-public checklist (from `Experiment-Checklist_41681654.txt`)

This is the gate before an experiment can go public. Every item should become
a live status indicator in the UI, not a mental checklist:

**Details tab:**
- Sample count and platform correct
- Correct taxon annotated
- Platform not unusable / two-colour / dual-mode
- Tags and experiment groups complete
- DEA looks ok (p-value distribution, charts render, baseline correct)
- Linked to publication if possible

**Experimental Design tab:**
- Filled out correctly
- Every sample has FVs for each EFC (unless `DE_Exclude`)
- Batch shows up as an EFC (if applicable)

**Visualize Expression:** design looks right; no batch confound

**Diagnostics:** images render; sample-correlation matrix reasonable;
predicted outliers reviewed; MV plot flat

**Quantitation Types:** correct row marked Pref; Scale set correctly

**History:** failures fixed or flagged

**Admin:** preprocessing complete; DEA done (unless sample study)

---

## What the old Gemma dataset manager does (and why it's bad)

Located at:
- `eclipseworkspace/Gemma/gemma-web/src/main/webapp/pages/expressionExperimentsWithQC.jsp`
- `...scripts/api/entities/experiment/ExpressionExperimentManage.js` (grid)
- `...ExpressionExperimentTools.js` (admin tab)
- `...EEManager.js` (action dispatcher)

### What it tracks per experiment

Each pipeline step as a last-run timestamp + event type string:

| Step | Status states |
|------|--------------|
| Missing value analysis (2-channel only) | date / failed (red) / N/A |
| Batch info fetch | date / failed (red) / missing (gray) |
| Processed vectors | date / failed (red) |
| DEA | date / failed (red) / no-factors (gray) |
| Coexpression links | date / failed (red) / too-small (gray) |
| Diagnostics (PCA) | date / failed (red) |

Plus: `troubled` flag + `troubleDetails`, `needsAttention` flag + `curationNote`,
GEEQ `quality` + `suitability` scores (with manual override flags), `isPublic`.

GEEQ subscores: sample correlation (mean/variance/median), outliers, platform
tech, replicates, batch info, batch confound (auto + manual override), batch
effect (auto + manual override).

Grid filter codes (what curators actually need to see):
`need DEA` / `has DEA` / `needs batch info` / `needs PCA` / `unusable` /
`needs curator attention` / `no factors` / `no tags`.

### What actions it exposes

All long-running actions use async task dispatch (progress window) and
map to Gemma CLI commands:

- Refresh statistics report
- Run missing value analysis (2-channel only)
- Fetch batch info
- Preprocess (full: vectors + reset PCA + downstream)
- Update diagnostics only (lighter: PCA + MV + sample corr + GEEQ)
- Run DEA (interactive: choose factors, subset factor, interactions)
- Redo / refresh stats / delete a specific DEA analysis
- Recalculate batch effect / batch confound
- Recalculate GEEQ scores (full or batch-only)
- Save GEEQ manual overrides
- Mark / unmark bioassay as outlier
- Edit tags (popup grid)
- Delete experiment
- Save curation status / note
- Change usability (trouble) status

### Why it's bad

1. **No explicit state machine** — workflow state inferred from which
   timestamps exist. Nothing says "this experiment is at step 8."
2. **Pipeline steps and curation decisions conflated** — preprocessing
   timestamps and `needsAttention` flags are on the same dense grid row.
3. **22 columns** — nearly unreadable. Each column is a tiny date cell
   with inline action buttons rendered as HTML strings.
4. **Full-page reload on most actions.**
5. **Coexpression is disabled from the UI** — must use CLI.
6. **Audit trail is flat log only** — no "what stage is it at" summary.
7. **GEEQ manual overrides deeply nested** — separate re-score calls for
   batch vs. overall.
8. **No agentic assistance** — every action is a manual button click.

---

## What we want in the new UI

A **workflow management** surface that replaces the old grid and gives curators
clarity on where each experiment is in the pipeline. Key properties:

### 1. Explicit pipeline stage indicator

Each experiment shows where it is in the 14-step pipeline. Not inferred from
timestamps — an explicit stage. When a step fails, it's red and explains why.
When a step hasn't been run yet, it's a clear CTA.

### 2. Pre-public checklist as live status

The checklist items above are not mental checkboxes — each one is a live query
against the experiment's current state. The "ready to publish" gate is a green
light across all items, not a curator's memory.

### 3. DEA management (not just dispatch)

The old UI lets you run DEA, but reviewing results is in a separate tab and
nearly invisible. The new UI should surface:
- Which contrasts exist, which succeeded/failed
- P-value distribution (is the DEA sensible?)
- Baseline correctness check (pairs with the audit agent)
- Re-run / redo / delete per-contrast
- Subset and interaction options (the old UI has these but buries them)

### 4. Batch workflow

- Fill batch info status + result (how many batches, was it a confound?)
- GEEQ batch confound / batch effect badges + manual override controls
- Salvage decision (subset vs. split vs. accept confound) recorded

### 5. Pipeline dispatch without page reload

Each pipeline step (preprocess, fillBatchInfo, DEA, diagnostics) dispatches
async via the existing SSE streaming infrastructure and updates in-place.

### 6. Agentic integration

The proposer already handles steps 2–4. The auditor checks design/tag quality.
The workflow management layer should make it easy to:
- Trigger the proposer for a new experiment from the queue
- Run the auditor after curating
- See audit dispositions alongside the checklist

### 7. Queue view

The old grid's filter codes are the seed of a queue: "needs DEA", "needs batch
info", "needs curator attention". The new UI turns these into a proper
prioritized work queue that curators can pull from.

---

## API gaps to fill (from TODO-gemma-api.md)

The workflow management surface needs several REST endpoints that don't exist
yet on the real Gemma side (§ numbers reference TODO-gemma-api.md):

- **§3 Audit trail** — the History tab is currently empty without this
- **§14 Public/private state** (read) — needed for the pre-public checklist gate
- **§4 Curation write endpoints** — without this the UI can't save checklist
  progress or mark steps done
- **§6 QT editing** — "correct QT marked Pref" checklist item
- **§14b Public/private toggle** (write) — the "publish" button at the end of the checklist

The mock server already implements all of these — the new workflow management
UI can be built and tested against the mock now, then wired to the real
Gemma API when the endpoints land.

---

## Cross-repo notes

- Wire shapes for any new API surfaces go in `../gemma-curation-agents`
  Pydantic models first; TS mirrors in `src/api/`.
- Pipeline dispatch actions (preprocess, DEA, etc.) call the real Gemma REST
  API directly — not the mock agent service. The mock agent service handles
  proposal + audit only.
- The pipeline step statuses (`dateBatchFetch`, `dateDifferentialAnalysis`,
  etc.) come from `GET /rest/v2/datasets/{id}` or a dedicated status-summary
  endpoint (§ yet TBD — the old Gemma backend has
  `ExpressionExperimentController.loadStatusSummaries` which returns the full
  grid snapshot; we'd want a REST equivalent).
