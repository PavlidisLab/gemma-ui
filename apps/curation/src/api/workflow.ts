/**
 * TanStack Query hooks for the workflow management endpoints.
 *
 * Endpoints live under `/rest/v2/...` on the same mock host as all
 * other curation routes. Wire contract: WORKFLOW_MANAGEMENT_HANDOFF.md.
 * Schema mirrors: src/api/workflowTypes.ts.
 *
 * Three resource families:
 *   - Pipeline status (per-experiment read + bulk read + dispatch mutations)
 *   - Groups (CRUD + membership)
 *   - Candidates (CRUD + bulk intake)
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
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
    case "inProgress":
    case "in_progress": return "in_progress";
    case "needsAttention":
    case "needs_attention": return "needs_attention";
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
    failed: 5, needs_attention: 4, in_progress: 3, not_run: 2, na: 1, ok: 0,
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

export function useDatasetsPaginated(params: DatasetListParams) {
  const p = new URLSearchParams();
  if (params.query)  p.set("query",  params.query);
  if (params.filter) p.set("filter", params.filter);
  if (params.sort)   p.set("sort",   params.sort);
  if (params.ids)    p.set("ids",    params.ids);
  p.set("limit",  String(params.limit  ?? 50));
  p.set("offset", String(params.offset ?? 0));
  return useQuery({
    queryKey: KEY.datasetsPaginated(params),
    queryFn: async () => {
      const raw = await api.get<Record<string, unknown>>(
        `/rest/v2/datasets?${p.toString()}`,
      );
      return adaptDatasetListResponse(raw);
    },
    refetchOnWindowFocus: true,
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

export function useGroups(filters?: { type?: GroupType; createdBy?: string }) {
  const params = new URLSearchParams();
  if (filters?.type) params.set("type", filters.type);
  if (filters?.createdBy) params.set("created_by", filters.createdBy);
  const qs = params.toString();
  return useQuery({
    queryKey: KEY.groups(filters),
    queryFn: () =>
      api.get<Group[]>(`/rest/v2/groups${qs ? `?${qs}` : ""}`),
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
      return api.get<Group>(`/rest/v2/groups/${groupId}${qs}`);
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
    queryFn: () => {
      const qs = includeSummaries ? "?include_summaries=true" : "";
      return api.get<Group[]>(`/rest/v2/datasets/${experimentId}/groups${qs}`);
    },
    refetchOnWindowFocus: true,
  });
}

export function useCreateGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: GroupCreate) =>
      api.post<Group>("/rest/v2/groups", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workflow", "groups"] });
    },
  });
}

export function useUpdateGroup(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: GroupPatch) =>
      api.patch<Group>(`/rest/v2/groups/${groupId}`, body),
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
      api.delete<void>(`/rest/v2/groups/${groupId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workflow", "groups"] });
    },
  });
}

/** Finalize a set — stamps ``finalized_at`` server-side. Mirrors
 *  the per-experiment review finalize lifecycle. Idempotent-refresh:
 *  re-POST overwrites reviewer + notes + timestamp rather than 409
 *  (per cab's reply 2026-05-25). */
export function useFinalizeGroup(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ reviewer, notes }: { reviewer: string; notes?: string }) =>
      api.post<Group>(`/rest/v2/groups/${groupId}/finalize`, {
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
      api.post<Group>(`/rest/v2/groups/${groupId}/reopen`, { reviewer }),
    onSuccess: (updated) => {
      qc.setQueryData(KEY.group(groupId), updated);
      qc.invalidateQueries({ queryKey: ["workflow", "groups"] });
    },
  });
}

export function useAddGroupMembers(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (memberIds: (string | number)[]) =>
      api.post<Group>(`/rest/v2/groups/${groupId}/members`, {
        member_ids: memberIds,
      } satisfies GroupMembersAdd),
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
      api.delete<void>(`/rest/v2/groups/${groupId}/members/${memberId}`),
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
      api.get<Candidate[]>(`/rest/v2/candidates${qs ? `?${qs}` : ""}`),
    refetchOnWindowFocus: true,
  });
}

export function useCandidate(candidateId: string | null | undefined) {
  return useQuery({
    queryKey: KEY.candidate(candidateId ?? ""),
    queryFn: () => api.get<Candidate>(`/rest/v2/candidates/${candidateId}`),
    enabled: !!candidateId,
  });
}

export function useCreateCandidate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CandidateCreate) =>
      api.post<Candidate>("/rest/v2/candidates", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workflow", "candidates"] });
    },
  });
}

export function useCreateCandidatesBulk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CandidateBulkCreate) =>
      api.post<Candidate[]>("/rest/v2/candidates/bulk", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workflow", "candidates"] });
    },
  });
}

export function usePatchCandidate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: CandidatePatch }) =>
      api.patch<Candidate>(`/rest/v2/candidates/${id}`, patch),
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
      api.delete<void>(`/rest/v2/candidates/${candidateId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workflow", "candidates"] });
    },
  });
}
