import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import type { Design } from "@/features/experiment/types";

const KEY = {
  byExperiment: (experimentId: number) => ["design", experimentId] as const,
};

export function useDesign(experimentId: number) {
  return useQuery({
    queryKey: KEY.byExperiment(experimentId),
    queryFn: () => api.get<Design>(`/rest/v2/datasets/${experimentId}/design`),
  });
}

/**
 * Whole-design replace. The mock accepts a PUT with the full Design body.
 *
 * Non-optimistic by design: the editor uses an explicit-commit model
 * with a separate local draft buffer (see DesignEditor + CommitBar),
 * so the cached "saved" copy needs to stay anchored to the server
 * state until the PUT actually lands. That way the diff between
 * draft and saved stays visible — including while a commit is in
 * flight or after a failure.
 *
 * ``reviewer`` is appended to the URL as a query param so the
 * server can stamp it into the history log. Mock auth — the real
 * Gemma side will pull from the bearer/session.
 */
export function useUpdateDesign(experimentId: number, reviewer = "") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (design: Design) => {
      const params = reviewer
        ? `?reviewer=${encodeURIComponent(reviewer)}`
        : "";
      return api.put<Design>(
        `/rest/v2/datasets/${experimentId}/design${params}`,
        design,
      );
    },
    onSuccess: (server) => {
      qc.setQueryData(KEY.byExperiment(experimentId), server);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: KEY.byExperiment(experimentId) });
      qc.invalidateQueries({ queryKey: ["audit-events", experimentId] });
    },
  });
}
