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
} from "./workflowTypes";

// ---------------------------------------------------------------------------
// Query key registry
// ---------------------------------------------------------------------------

const KEY = {
  pipelineStatus: (id: number) =>
    ["workflow", "pipeline-status", id] as const,
  pipelineStatusBulk: (ids: number[]) =>
    ["workflow", "pipeline-status-bulk", [...ids].sort()] as const,
  geeq: (id: number) =>
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
};

// ---------------------------------------------------------------------------
// Pipeline status — reads
// ---------------------------------------------------------------------------

export function usePipelineStatus(experimentId: number) {
  return useQuery({
    queryKey: KEY.pipelineStatus(experimentId),
    queryFn: () =>
      api.get<ExperimentPipelineStatus>(
        `/rest/v2/datasets/${experimentId}/pipeline-status`,
      ),
    enabled: experimentId > 0,
    refetchOnWindowFocus: true,
  });
}

/** Bulk pipeline status for a list of experiment IDs. Used by the
 *  workflow list view to load all visible rows in one round trip.
 *  Returns a map of string(id) → ExperimentPipelineStatus. */
export function usePipelineStatusBulk(experimentIds: number[]) {
  return useQuery({
    queryKey: KEY.pipelineStatusBulk(experimentIds),
    queryFn: () =>
      api.post<Record<string, ExperimentPipelineStatus>>(
        `/rest/v2/datasets/pipeline-status`,
        { dataset_ids: experimentIds },
      ),
    enabled: experimentIds.length > 0,
    refetchOnWindowFocus: true,
  });
}

// ---------------------------------------------------------------------------
// Pipeline dispatch mutations
// ---------------------------------------------------------------------------

function useDispatch(experimentId: number, path: string, step: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body?: unknown) =>
      api.post<AsyncTask>(`/rest/v2/datasets/${experimentId}/${path}`, body ?? {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY.pipelineStatus(experimentId) });
    },
  });
}

export function useRunPreprocess(experimentId: number) {
  return useDispatch(experimentId, "preprocess", "preprocess");
}

export function useRunDiagnostics(experimentId: number) {
  return useDispatch(experimentId, "preprocess/diagnostics", "pca");
}

export function useFetchBatchInfo(experimentId: number) {
  return useDispatch(experimentId, "batchInformation/fetch", "batch_info");
}

export function useRecalculateGeeq(experimentId: number) {
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

export function useRunDea(experimentId: number) {
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

export function useRedoDea(experimentId: number) {
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

export function useDeleteDea(experimentId: number) {
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

export function useGeeq(experimentId: number) {
  return useQuery({
    queryKey: KEY.geeq(experimentId),
    queryFn: () =>
      api.get<GeeqScores>(`/rest/v2/datasets/${experimentId}/geeq`),
    enabled: experimentId > 0,
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

export function useSetOutlier(experimentId: number) {
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

export function useSetQtPreferred(experimentId: number) {
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

export function useSetVisibility(experimentId: number) {
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

export function useGroup(groupId: string | null | undefined) {
  return useQuery({
    queryKey: KEY.group(groupId ?? ""),
    queryFn: () => api.get<Group>(`/rest/v2/groups/${groupId}`),
    enabled: !!groupId,
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
