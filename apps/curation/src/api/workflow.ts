/**
 * TanStack Query hooks for the workflow management endpoints.
 *
 * Endpoints live under `/rest/v2/...` on the same mock host as all
 * other curation routes. Schema mirrors: src/api/workflowTypes.ts.
 *
 * Three resource families:
 *   - Pipeline status (per-experiment read + bulk read + dispatch mutations)
 *   - Groups (CRUD + membership)
 *   - Candidates (CRUD + bulk intake)
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import { resolveGemmaMode } from "@/lib/gemmaMode";
import type {
  AsyncTask,
  Candidate,
  CandidateBulkCreate,
  CandidateCreate,
  CandidatePatch,
  CandidateStatus,
  DatasetListParams,
  DifferentialAnalysisRunRequest,
  ExperimentPipelineStatus,
  GeeqScores,
  Group,
  GroupCreate,
  GroupMembersAdd,
  GroupPatch,
  GroupType,
  OutlierPatch,
  QuantitationTypePatch,
  WorkflowDatasetListResponse,
} from "./workflowTypes";

// ---------------------------------------------------------------------------
// Query key registry
// ---------------------------------------------------------------------------

const KEY = {
  pipelineStatus: (id: number | string) =>
    ["workflow", "pipeline-status", id] as const,
  pipelineStatusBulk: (ids: (number | string)[]) =>
    ["workflow", "pipeline-status-bulk", [...ids].sort()] as const,
  geeq: (id: number | string) =>
    ["workflow", "geeq", id] as const,
  task: (taskId: string) =>
    ["workflow", "task", taskId] as const,
  groups: (filters?: { type?: GroupType; createdBy?: string }) =>
    ["workflow", "groups", filters ?? {}] as const,
  group: (id: string) =>
    ["workflow", "group", id] as const,
  groupMembers: (id: string) =>
    ["workflow", "group-members", id] as const,
  candidates: (filters?: {
    status?: CandidateStatus;
    source?: string;
    sourceBatch?: string;
    reviewer?: string;
  }) => ["workflow", "candidates", filters ?? {}] as const,
  candidate: (id: string) =>
    ["workflow", "candidate", id] as const,
  datasetsPaginated: (params: DatasetListParams) =>
    ["workflow", "datasets-paginated", params] as const,
};

// ---------------------------------------------------------------------------
// Pipeline status — reads
// ---------------------------------------------------------------------------

export function usePipelineStatus(experimentId: number | string) {
  return useQuery({
    queryKey: KEY.pipelineStatus(experimentId),
    queryFn: async () => {
      const raw = await api.get<unknown>(
        `/rest/v2/datasets/${experimentId}/pipeline-status`,
      );
      return adaptPipelineStatus(raw, experimentId);
    },
    enabled: Boolean(experimentId),
    refetchOnWindowFocus: true,
  });
}

/** Bulk pipeline status for a list of experiment IDs. Used by the
 *  workflow list view to load all visible rows in one round trip.
 *  Returns a map of string(id) → ExperimentPipelineStatus. */
export function usePipelineStatusBulk(experimentIds: number[]) {
  return useQuery({
    queryKey: KEY.pipelineStatusBulk(experimentIds),
    queryFn: async () => {
      const raw = await api.post<Record<string, unknown>>(
        `/rest/v2/datasets/pipeline-status`,
        { dataset_ids: experimentIds },
      );
      const out: Record<string, ExperimentPipelineStatus> = {};
      for (const [k, v] of Object.entries(raw ?? {})) {
        out[k] = adaptPipelineStatus(v, Number(k));
      }
      return out;
    },
    enabled: experimentIds.length > 0,
    refetchOnWindowFocus: true,
  });
}

// ---------------------------------------------------------------------------
// Gemma-rest 2.0 → UI shape adapter for pipeline-status
// ---------------------------------------------------------------------------
//
// gemma-rest ships a flat `{steps: [{step, status, last_run, ...}], geeq,
// is_public, is_troubled, ...}` shape — analysis-only, no curation track,
// and snake_cased status values that don't match `StepStatus`. local_api
// ships the richer `{analysis: {...}, curation: {...}}` shape this UI
// originally targeted. Adapt at the client boundary so the UI components
// see one shape regardless of which backend answered.
//
// Curation-track steps (design / tags / audit / outlier_review /
// batch_decision) aren't tracked by gemma-rest at all — they stub to
// `not_run`. If we later route the workflow endpoint to local_api,
// the adapter is a no-op pass-through (the UI shape arrives intact).

const EMPTY_STEP = { status: "not_run" as const, last_run: null, details: null };
const NA_STEP = { status: "na" as const, last_run: null, details: null };

function mapGemmaStatus(s: unknown): import("./workflowTypes").StepStatus {
  switch (s) {
    case "ok": return "ok";
    case "failed": return "failed";
    // Both spellings: legacy rows wrote `needs_attention` as a step
    // state and still parse. Normalised to the new name on the way in
    // so nothing downstream carries two.
    case "incomplete":
    case "needsAttention":
    case "needs_attention": return "incomplete";
    case "notApplicable":
    case "not_applicable": return "na";
    case "notRun":
    case "not_run":
    default: return "not_run";
  }
}

function adaptPipelineStatus(raw: unknown, id: number | string): ExperimentPipelineStatus {
  if (!raw || typeof raw !== "object") {
    return blankPipelineStatus(id);
  }
  const obj = raw as Record<string, unknown>;
  // If it already looks like the UI shape, pass through.
  if (obj.analysis && obj.curation) return obj as unknown as ExperimentPipelineStatus;

  // Gemma-rest shape: flat `steps[]`.
  const stepsArr = Array.isArray(obj.steps) ? (obj.steps as Array<Record<string, unknown>>) : [];
  const byName = new Map<string, Record<string, unknown>>();
  for (const s of stepsArr) {
    if (typeof s.step === "string") byName.set(s.step, s);
  }
  const pick = (name: string): import("./workflowTypes").PipelineStep => {
    const s = byName.get(name);
    if (!s) return { ...EMPTY_STEP };
    return {
      status: mapGemmaStatus(s.status),
      last_run: (s.last_run as string | null) ?? null,
      details: (s.details as string | null) ?? null,
    };
  };

  // Combine the three diagnostics-bucket steps into one. Worst-wins
  // (failed > needs_attention > in_progress > not_run > na > ok)
  // so the strip flags trouble even when only one sub-step misbehaves.
  const diagSubs = [pick("pca"), pick("sampleCorrelation"), pick("meanVariance")];
  const diagnostics = combineSteps(diagSubs);

  const geeqObj = (obj.geeq as Record<string, unknown> | null) ?? null;
  const geeqQuality = geeqObj
    ? (geeqObj.publicQualityScore as number | null) ?? (geeqObj.public_quality_score as number | null) ?? null
    : null;
  const geeqSuit = geeqObj
    ? (geeqObj.publicSuitabilityScore as number | null) ?? (geeqObj.public_suitability_score as number | null) ?? null
    : null;

  return {
    dataset_id: (obj.dataset_id as number | undefined) ?? id,
    analysis: {
      missing_value_analysis: pick("missingValue"),
      batch_info: pick("batchInfo"),
      preprocessing: pick("preprocess"),
      dea: pick("dea"),
      diagnostics,
    },
    curation: {
      design: { ...NA_STEP },
      tags: { ...NA_STEP },
      outlier_review: { ...NA_STEP },
      batch_decision: { ...NA_STEP },
      audit: { ...NA_STEP },
    },
    is_public: (obj.is_public as boolean | undefined) ?? false,
    is_troubled: (obj.is_troubled as boolean | undefined) ?? false,
    needs_attention: (obj.needs_attention as boolean | undefined) ?? false,
    curation_note: (obj.curation_note as string | null | undefined) ?? null,
    geeq_quality: geeqQuality,
    geeq_suitability: geeqSuit,
    candidate_provenance: null,
  };
}

function combineSteps(steps: import("./workflowTypes").PipelineStep[]): import("./workflowTypes").PipelineStep {
  const rank: Record<import("./workflowTypes").StepStatus, number> = {
    failed: 5, incomplete: 4, not_run: 2, na: 1, ok: 0,
  };
  let worst = steps[0] ?? { ...EMPTY_STEP };
  for (const s of steps) if (rank[s.status] > rank[worst.status]) worst = s;
  return worst;
}

function blankPipelineStatus(id: number | string): ExperimentPipelineStatus {
  return {
    dataset_id: id,
    analysis: {
      missing_value_analysis: { ...EMPTY_STEP },
      batch_info: { ...EMPTY_STEP },
      preprocessing: { ...EMPTY_STEP },
      dea: { ...EMPTY_STEP },
      diagnostics: { ...EMPTY_STEP },
    },
    curation: {
      design: { ...EMPTY_STEP },
      tags: { ...EMPTY_STEP },
      outlier_review: { ...EMPTY_STEP },
      batch_decision: { ...EMPTY_STEP },
      audit: { ...EMPTY_STEP },
    },
    is_public: false,
    is_troubled: false,
    needs_attention: false,
    curation_note: null,
    geeq_quality: null,
    geeq_suitability: null,
    candidate_provenance: null,
  };
}

// ---------------------------------------------------------------------------
// Paginated dataset list
// ---------------------------------------------------------------------------

/** The largest `limit` `/rest/v2/datasets` will accept, per mode.
 *
 *  🛑 **The two backends do not agree, and the difference is a 400.**
 *  The local store raised its cap to 1000 so a whole ticket fits in one
 *  page (design review 2026-06-14). Gemma did not: it answers
 *  `400 {"error":{"message":"The provided limit cannot exceed 100."}}`
 *  — measured on gemma2 `96e7a5d790` 2026-08-31, and it is the LIMIT
 *  that is refused, not the `ids` list: the same 400 comes back with
 *  two ids.
 *
 *  Clamped here rather than at the caller so no page-size picker,
 *  sticky localStorage value or future caller can put a number on the
 *  wire that the server refuses. */
export const MAX_DATASET_PAGE_SIZE = { local: 1000, remote: 100 } as const;

export function maxDatasetPageSize(mode: "local" | "remote"): number {
  return MAX_DATASET_PAGE_SIZE[mode];
}

/** Where an id-scoped dataset list lives, per mode.
 *
 *  🛑 **Gemma has no `ids` query parameter.** Its `/datasets` takes
 *  `query`, `filter`, `offset`, `limit`, `sort` — nothing else — and an
 *  unknown parameter is DROPPED, not rejected. So `?ids=…` returned the
 *  whole corpus sorted by recency: measured 2026-08-31, asking for 3 ids
 *  answered 100 rows of `totalElements: 23547`, and a ticket queue
 *  rendered a confident page of experiments that were not its members.
 *
 *  Gemma's own form is the comma list in the PATH —
 *  `/datasets/9474,5381,27103` → `totalElements: 3` — and it honours
 *  `sort`, `offset` and the same 100 cap. 500 ids is a 2.5 kB URL, well
 *  inside any limit.
 *
 *  The local store implements `?ids=`, so the shape stays mode-scoped
 *  rather than being "fixed" for both. */
function datasetListPath(
  mode: "local" | "remote",
  ids: string | undefined,
  qs: string,
): string {
  if (ids && mode === "remote") {
    return `/rest/v2/datasets/${encodeURIComponent(ids)}?${qs}`;
  }
  return `/rest/v2/datasets?${qs}`;
}

/** A `filter` clause restricting to a set of dataset ids.
 *
 *  🛑 **The ids-in-path route does NOT accept `query`.** Measured on
 *  gemma2 `41f45962c5`:
 *
 *      /datasets/{500 ids}?query=dissecting
 *        400 "Unknown query parameter 'query'. This endpoint accepts:
 *             cursor, filter, limit, offset, sort."
 *
 *  So every search typed into a ticket's queue in remote mode 400ed,
 *  and the list went on showing the previous unfiltered page — which
 *  reads as "the search does nothing" rather than as an error (Paul,
 *  2026-09-01: "this search is barely (or not?) working").
 *
 *  The plain `/datasets` route takes both, and they compose — verified
 *  against a known hit: `query=dissecting&filter=id in (20728,1,2)`
 *  returns exactly `GSE185024.1`. So a search inside an id scope moves
 *  off the path form and expresses the scope as a filter instead.
 *
 *  🛑 Do NOT reach for `filter=name like %…%` as the search. It answers
 *  200 with zero rows even for a short name that exists
 *  (`shortName like %GSE6966%` → 0), so it fails silently in the one
 *  way a search must not. `query` is the search; `filter` is the
 *  scope. */
export function idScopeFilter(ids: string): string {
  return `id in (${ids})`;
}

/** Exposed for test — the URL shape is the whole fix. */
export const __test = { datasetListPath, idScopeFilter };

export function useDatasetsPaginated(params: DatasetListParams) {
  const mode = resolveGemmaMode().mode;
  const p = new URLSearchParams();
  // Remote + an id scope + a search cannot use the path form, which
  // rejects `query` — see `idScopeFilter`. Fall back to the plain route
  // with the scope expressed as a filter.
  const scopeAsFilter =
    mode === "remote" && !!params.ids && !!params.query;
  // 🛑 Each side parenthesised. `and` binds tighter than `or`, so a
  // caller filter of `a = 1 or b = 2` joined bare would scope only the
  // second disjunct and return rows from outside the scope.
  const clauses = [params.filter, scopeAsFilter ? idScopeFilter(params.ids!) : null]
    .filter(Boolean)
    .map((c) => `(${c})`);
  const filter = clauses.length > 1 ? clauses.join(" and ") : (params.filter ?? (scopeAsFilter ? idScopeFilter(params.ids!) : ""));
  if (params.query)  p.set("query",  params.query);
  if (filter)        p.set("filter", filter);
  if (params.sort)   p.set("sort",   params.sort);
  // Remote carries the ids in the path instead — see `datasetListPath`.
  if (params.ids && mode === "local") p.set("ids", params.ids);
  p.set("limit",  String(Math.min(params.limit ?? 50, maxDatasetPageSize(mode))));
  p.set("offset", String(params.offset ?? 0));
  return useQuery({
    queryKey: KEY.datasetsPaginated(params),
    // 🛑 An empty scope cannot be expressed as `ids` — omitting it asks
    // for EVERYTHING. A caller whose scope is empty passes
    // `enabled: false` and gets no rows instead of the whole corpus.
    enabled: params.enabled !== false,
    queryFn: async () => {
      const raw = await api.get<Record<string, unknown>>(
        datasetListPath(mode, scopeAsFilter ? undefined : params.ids, p.toString()),
      );
      return adaptDatasetListResponse(raw);
    },
    // ``/rest/v2/datasets`` costs ~3.3 s on the local store REGARDLESS
    // of ``ids`` or ``limit`` — measured 2026-08-09: the handler loads
    // every design's ``body_json`` (534 rows, 30.8 MB), json.loads
    // (0.33 s) + normalize_keys (2.35 s) over the lot, then filters in
    // Python. Every ticket page and dashboard load waits on it.
    //
    // So: no refetch on window focus (this query used to override the
    // app default to ``true``, which meant a fresh 3.3 s wait every
    // time the curator tabbed back), and a long staleTime — the row
    // fields here (short_name, name, GEEQ, troubled) change rarely, and
    // per-target ticket status comes from ``useTicket``, not this call.
    //
    // Mitigation, not a fix. The endpoint is agents-side; see handoff
    // UI_ASK_2026_08_09_DATASETS_LIST_FULL_SCAN.md.
    refetchOnWindowFocus: false,
    staleTime: 5 * 60_000,
    placeholderData: (prev) => prev,
  });
}

// gemma-rest 2.0 ships dataset rows with the GEEQ scores in a nested
// `geeq: { public_quality_score, public_suitability_score, ... }` object,
// not the flat `geeq_public_quality_score` / `geeq_public_suitability_score`
// fields the workflow UI's WorkflowDatasetRow expects. Lift them at the
// boundary so the queue rows render Q/S pills correctly.
//
// `is_public` likewise isn't on the gemma-rest row — derive `true` if the
// row appears in this list (gemma-rest's `/datasets` only returns public
// data unless an admin filter is specified). Fields the UI shows but
// gemma-rest doesn't carry (n_pending_proposals, latest_audit_verdict,
// taxon_common_name, technology_type) default to safe values.
function adaptDatasetListResponse(
  raw: Record<string, unknown>,
): WorkflowDatasetListResponse {
  const rows = Array.isArray(raw.data) ? (raw.data as Record<string, unknown>[]) : [];
  const out = rows.map((r): import("./workflowTypes").WorkflowDatasetRow => {
    const geeq = (r.geeq as Record<string, unknown> | null | undefined) ?? null;
    const num = (k: string): number | null => {
      if (!geeq) return null;
      const v = geeq[k];
      return typeof v === "number" && Number.isFinite(v) ? v : null;
    };
    return {
      id: Number(r.id ?? 0),
      short_name: (r.short_name as string) ?? (r.accession as string) ?? String(r.id ?? ""),
      name: (r.name as string) ?? "",
      taxon_common_name: (r.taxon_common_name as string) ?? "",
      technology_type: (r.technology_type as string) ?? "",
      number_of_bio_assays: Number(r.number_of_bio_assays ?? 0),
      last_updated: (r.last_updated as string) ?? "",
      troubled: Boolean(r.troubled),
      needs_attention: Boolean(r.needs_attention),
      is_public: r.is_public === undefined ? true : Boolean(r.is_public),
      curation_note: (r.curation_note as string | null | undefined) ?? null,
      geeq_public_quality_score:
        (r.geeq_public_quality_score as number | null | undefined) ??
        num("public_quality_score"),
      geeq_public_suitability_score:
        (r.geeq_public_suitability_score as number | null | undefined) ??
        num("public_suitability_score"),
      n_pending_proposals: Number(r.n_pending_proposals ?? 0),
      n_unactioned_blocker: Number(r.n_unactioned_blocker ?? 0),
      n_unactioned_major: Number(r.n_unactioned_major ?? 0),
      latest_audit_verdict: (r.latest_audit_verdict as string | null | undefined) ?? null,
      // GEO-derived optional fields. Server only populates these on
      // preboarded rows (where the eutils deep-fetch ran); harmless
      // pass-through when absent — the consumer types them as
      // optional.
      assay: (r.assay as string | undefined) || undefined,
      platform_short_name:
        (r.platform_short_name as string | undefined) || undefined,
      external_uri: (r.external_uri as string | undefined) || undefined,
      accession: (r.accession as string | undefined) || undefined,
      external_database:
        (r.external_database as string | undefined) || undefined,
    };
  });
  return {
    data: out,
    total_elements: Number(raw.total_elements ?? out.length),
    offset: Number(raw.offset ?? 0),
    limit: Number(raw.limit ?? out.length),
  };
}

// ---------------------------------------------------------------------------
// Pipeline dispatch mutations
// ---------------------------------------------------------------------------

function useDispatch(experimentId: number | string, path: string, _step: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body?: unknown) =>
      api.post<AsyncTask>(`/rest/v2/datasets/${experimentId}/${path}`, body ?? {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY.pipelineStatus(experimentId) });
    },
  });
}

export function useRunPreprocess(experimentId: number | string) {
  return useDispatch(experimentId, "preprocess", "preprocess");
}

export function useRunDiagnostics(experimentId: number | string) {
  return useDispatch(experimentId, "preprocess/diagnostics", "pca");
}

export function useFetchBatchInfo(experimentId: number | string) {
  return useDispatch(experimentId, "batchInformation/fetch", "batch_info");
}

export function useRecalculateGeeq(experimentId: number | string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<AsyncTask>(`/rest/v2/datasets/${experimentId}/geeq/recalculate`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY.pipelineStatus(experimentId) });
      qc.invalidateQueries({ queryKey: KEY.geeq(experimentId) });
    },
  });
}

export function useRunDea(experimentId: number | string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body?: DifferentialAnalysisRunRequest) =>
      api.post<AsyncTask>(
        `/rest/v2/datasets/${experimentId}/analyses/differential`,
        body ?? {},
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY.pipelineStatus(experimentId) });
    },
  });
}

export function useRedoDea(experimentId: number | string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (analysisId: number) =>
      api.post<AsyncTask>(
        `/rest/v2/datasets/${experimentId}/analyses/differential/${analysisId}/redo`,
        {},
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY.pipelineStatus(experimentId) });
    },
  });
}

export function useDeleteDea(experimentId: number | string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (analysisId: number) =>
      api.delete<void>(
        `/rest/v2/datasets/${experimentId}/analyses/differential/${analysisId}`,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY.pipelineStatus(experimentId) });
    },
  });
}

// ---------------------------------------------------------------------------
// GEEQ
// ---------------------------------------------------------------------------

export function useGeeq(experimentId: number | string) {
  return useQuery({
    queryKey: KEY.geeq(experimentId),
    queryFn: () =>
      api.get<GeeqScores>(`/rest/v2/datasets/${experimentId}/geeq`),
    enabled: Boolean(experimentId),
  });
}

// ---------------------------------------------------------------------------
// Task polling
// ---------------------------------------------------------------------------

export function useTask(taskId: string | null | undefined) {
  return useQuery({
    queryKey: KEY.task(taskId ?? ""),
    queryFn: () => api.get<AsyncTask>(`/rest/v2/tasks/${taskId}`),
    enabled: !!taskId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "running" ? 1500 : false;
    },
  });
}

// ---------------------------------------------------------------------------
// Outlier + QT write surfaces
// ---------------------------------------------------------------------------

export function useSetOutlier(experimentId: number | string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sampleId, outlier }: { sampleId: string; outlier: boolean }) =>
      api.put<void>(
        `/rest/v2/datasets/${experimentId}/samples/${sampleId}/outlier`,
        { outlier } satisfies OutlierPatch,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY.pipelineStatus(experimentId) });
    },
  });
}

export function useSetQtPreferred(experimentId: number | string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ qtId, isPreferred }: { qtId: number; isPreferred: boolean }) =>
      api.patch<void>(
        `/rest/v2/datasets/${experimentId}/quantitationTypes/${qtId}`,
        { is_preferred: isPreferred } satisfies QuantitationTypePatch,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY.pipelineStatus(experimentId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Visibility (public / private)
// ---------------------------------------------------------------------------

export function useSetVisibility(experimentId: number | string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (makePublic: boolean) =>
      api.post<void>(
        `/rest/v2/datasets/${experimentId}/${makePublic ? "makePublic" : "makePrivate"}`,
        {},
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY.pipelineStatus(experimentId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

/** 🛑 **`/curation/v1/groups` is a real GEMMA route as well as ours.**
 *  Gemma serves its own USER groups there — measured on gemma2:
 *  `/rest/v2/groups` returns `{id, name, description, memberCount}`
 *  objects ("Administrators", 14 members), and
 *  `/rest/v2/datasets/{id}/groups` returns the dataset's ACL groups as
 *  bare STRINGS (`["Agents","Administrators"]`).
 *
 *  Curation sets answer the same paths on the store, so in remote mode
 *  the two collide and Gemma's answer arrives in a `Group[]` shape.
 *  Neither side took the other's name: the store's routes date from
 *  2026-05-01 and 05-08, Gemma's from 05-22 — two services grew the
 *  same nouns three weeks apart. Which one moves is a decision about
 *  cost (Gemma has external clients; the store's prefix is scaffolding
 *  for a service being absorbed), not about who was first. The
 *  strings render as chips with no label and a
 *  "undefined · undefined · undefined members" tooltip; the user-group
 *  objects are worse, because `memberCount` snakeifies into
 *  `member_count` and "Administrators · 14 members" reads as a
 *  perfectly ordinary set.
 *
 *  This guard keeps the wrong data off the screen. It is not the fix:
 *  the sets API has to move off `/rest`, which is Gemma's namespace —
 *  filed as `UIB_TO_CAB_2026_08_29_THE_SETS_API_COLLIDES_WITH_GEMMAS_OWN_GROUPS`.
 *  Delete this once the routes move; until then a set with no `type`
 *  is not a set we can render. */

/** 🛑 **A set mutation in remote mode edits Gemma's ACCESS CONTROL.**
 *
 *  These calls sat on `/rest/v2/groups*` until 2026-08-29, which is
 *  Gemma's own
 *  `GroupsWebService` — `POST /groups` creates a USER group, `PUT`
 *  renames one, `DELETE` removes one, and the member routes add and
 *  remove people from it. Every one is gated on `isAuthenticated()`
 *  alone.
 *
 *  Measured, the exposure is narrower than that list looks but not
 *  gone: Gemma coerces `{id}` to a `Long`, so every per-id call
 *  carrying one of our UUIDs 404s — rename, delete, members, finalize
 *  and reopen are all inert. **The collection `POST /groups` is live.**
 *  It may 400 on our unknown `type` field, but that is inferred from
 *  Jackson config rather than tried, and without `type` it creates a
 *  real `UserGroup` owned by the caller.
 *
 *  So this throws before the request rather than after: there is no
 *  safe version of finding out. Reads have {@link curationSetsOnly};
 *  writes have nowhere to go until the store moves to `/curation/v1`
 *  (Paul, 2026-08-29 — Gemma's routes stay put, the store takes the
 *  prefix). Delete this guard when the calls move. */
function assertCurationStore(action: string): void {
  if (resolveGemmaMode().mode !== "local") {
    throw new Error(
      `Cannot ${action} against Gemma: curation sets live in the curation ` +
        `store, and this path is Gemma's own user-group API. Switch to a ` +
        `store-backed session.`,
    );
  }
}

export function curationSetsOnly(rows: unknown): Group[] {
  if (!Array.isArray(rows)) return [];
  return rows.filter(
    (r): r is Group =>
      !!r &&
      typeof r === "object" &&
      typeof (r as Group).id === "string" &&
      typeof (r as Group).type === "string",
  );
}

export function useGroups(filters?: { type?: GroupType; createdBy?: string }) {
  const params = new URLSearchParams();
  if (filters?.type) params.set("type", filters.type);
  if (filters?.createdBy) params.set("created_by", filters.createdBy);
  const qs = params.toString();
  return useQuery({
    queryKey: KEY.groups(filters),
    queryFn: async () =>
      curationSetsOnly(
        await api.get<unknown>(`/curation/v1/groups${qs ? `?${qs}` : ""}`),
      ),
    refetchOnWindowFocus: true,
  });
}

export function useGroup(
  groupId: string | null | undefined,
  options: { includeSummaries?: boolean } = {},
) {
  const { includeSummaries = false } = options;
  return useQuery({
    queryKey: [...KEY.group(groupId ?? ""), includeSummaries] as const,
    queryFn: () => {
      const qs = includeSummaries ? "?include_summaries=true" : "";
      return api.get<Group>(`/curation/v1/groups/${groupId}${qs}`);
    },
    enabled: !!groupId,
  });
}

/** Groups the given experiment is a member of. Backed by the
 *  agents-side ``GET /rest/v2/datasets/{id}/groups`` endpoint —
 *  cheap server-side filter on the membership table.
 *
 *  ``includeSummaries`` opts into the per-member ``ExperimentSummary``
 *  list (short_name + title + status flags) the set-navigator popover
 *  needs. Off by default so the chip-render path stays light. */
export function useExperimentGroups(
  experimentId: number | string,
  options: { includeSummaries?: boolean } = {},
) {
  const { includeSummaries = false } = options;
  return useQuery({
    queryKey: [
      "workflow",
      "experiment-groups",
      experimentId,
      includeSummaries,
    ] as const,
    queryFn: async () => {
      const qs = includeSummaries ? "?include_summaries=true" : "";
      return curationSetsOnly(
        await api.get<unknown>(
          `/curation/v1/datasets/${experimentId}/groups${qs}`,
        ),
      );
    },
    refetchOnWindowFocus: true,
  });
}

export function useCreateGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: GroupCreate) =>
      (assertCurationStore("create a set"),
      api.post<Group>("/curation/v1/groups", body)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workflow", "groups"] });
    },
  });
}

export function useUpdateGroup(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: GroupPatch) =>
      (assertCurationStore("rename a set"),
      api.patch<Group>(`/curation/v1/groups/${groupId}`, body)),
    onSuccess: (updated) => {
      qc.setQueryData(KEY.group(groupId), updated);
      qc.invalidateQueries({ queryKey: ["workflow", "groups"] });
    },
  });
}

export function useDeleteGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (groupId: string) =>
      (assertCurationStore("delete a set"),
      api.delete<void>(`/curation/v1/groups/${groupId}`)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workflow", "groups"] });
    },
  });
}

/** Finalize a set — stamps ``finalized_at`` server-side. Mirrors
 *  the per-experiment review finalize lifecycle. Idempotent-refresh:
 *  re-POST overwrites reviewer + notes + timestamp rather than 409. */
export function useFinalizeGroup(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ reviewer, notes }: { reviewer: string; notes?: string }) =>
      api.post<Group>(`/curation/v1/groups/${groupId}/finalize`, {
        reviewer,
        ...(notes ? { notes } : {}),
      }),
    onSuccess: (updated) => {
      qc.setQueryData(KEY.group(groupId), updated);
      qc.invalidateQueries({ queryKey: ["workflow", "groups"] });
    },
  });
}

/** Reopen a finalized set so it's editable again. Clears
 *  ``finalized_at`` + ``finalized_by``; preserves ``finalized_notes``
 *  so a re-finalize dialog can prefill from the prior close. */
export function useReopenGroup(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ reviewer }: { reviewer: string }) =>
      api.post<Group>(`/curation/v1/groups/${groupId}/reopen`, { reviewer }),
    onSuccess: (updated) => {
      qc.setQueryData(KEY.group(groupId), updated);
      qc.invalidateQueries({ queryKey: ["workflow", "groups"] });
    },
  });
}

export function useAddGroupMembers(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (memberIds: (string | number)[]) => {
      assertCurationStore("add set members");
      return api.post<Group>(`/curation/v1/groups/${groupId}/members`, {
        member_ids: memberIds,
      } satisfies GroupMembersAdd);
    },
    onSuccess: (updated) => {
      qc.setQueryData(KEY.group(groupId), updated);
      qc.invalidateQueries({ queryKey: ["workflow", "groups"] });
    },
  });
}

export function useRemoveGroupMember(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (memberId: string) =>
      (assertCurationStore("remove a set member"),
      api.delete<void>(`/curation/v1/groups/${groupId}/members/${memberId}`)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY.group(groupId) });
      qc.invalidateQueries({ queryKey: ["workflow", "groups"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

export function useCandidates(filters?: {
  status?: CandidateStatus;
  source?: string;
  sourceBatch?: string;
  reviewer?: string;
}) {
  const params = new URLSearchParams();
  if (filters?.status) params.set("status", filters.status);
  if (filters?.source) params.set("source", filters.source);
  if (filters?.sourceBatch) params.set("source_batch", filters.sourceBatch);
  if (filters?.reviewer) params.set("reviewer", filters.reviewer);
  const qs = params.toString();
  return useQuery({
    queryKey: KEY.candidates(filters),
    queryFn: () =>
      api.get<Candidate[]>(`/curation/v1/candidates${qs ? `?${qs}` : ""}`),
    refetchOnWindowFocus: true,
  });
}

export function useCandidate(candidateId: string | null | undefined) {
  return useQuery({
    queryKey: KEY.candidate(candidateId ?? ""),
    queryFn: () => api.get<Candidate>(`/curation/v1/candidates/${candidateId}`),
    enabled: !!candidateId,
  });
}

export function useCreateCandidate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CandidateCreate) =>
      api.post<Candidate>("/curation/v1/candidates", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workflow", "candidates"] });
    },
  });
}

export function useCreateCandidatesBulk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CandidateBulkCreate) =>
      api.post<Candidate[]>("/curation/v1/candidates/bulk", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workflow", "candidates"] });
    },
  });
}

export function usePatchCandidate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: CandidatePatch }) =>
      api.patch<Candidate>(`/curation/v1/candidates/${id}`, patch),
    onSuccess: (updated) => {
      qc.setQueryData(KEY.candidate(updated.id), updated);
      qc.invalidateQueries({ queryKey: ["workflow", "candidates"] });
    },
  });
}

export function useDeleteCandidate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (candidateId: string) =>
      api.delete<void>(`/curation/v1/candidates/${candidateId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workflow", "candidates"] });
    },
  });
}
