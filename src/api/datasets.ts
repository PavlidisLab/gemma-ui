import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import type { Design } from "@/features/experiment/types";

/**
 * Summary row for the curation UI's landing page. Returned by
 * ``GET /rest/v2/datasets`` — only experiments that have been
 * imported into the mock (via ``./run_import.sh``).
 */
export interface DatasetSummary {
  experiment_id: number;
  short_name: string;
  title: string;
  taxon: string;
  updated_at: string;
  n_factors: number;
  n_fvs: number;
  n_biomaterials: number;
  n_tags: number;
  /** Mirrors Gemma's CurationDetails.troubled flag. */
  troubled: boolean;
  /** Mirrors Gemma's CurationDetails.needsAttention flag. */
  needs_attention: boolean;
  /** Derived: true if the experiment has a non-empty curation note. */
  has_curation_note: boolean;
  /** Count of proposals in status=pending for this experiment. */
  n_pending_proposals: number;
}

const KEY = ["datasets"] as const;

export function useDatasets() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => api.get<DatasetSummary[]>("/rest/v2/datasets"),
  });
}

export interface GemmaDatasetHit {
  experiment_id: number;
  short_name: string;
  accession: string;
  title: string;
  taxon: string;
  n_samples: number;
  external_database: string;
}

/** Search real Gemma's catalog (proxied via gemmapy on the
 *  mock). Used by the landing-page import typeahead. */
export function useGemmaSearch(query: string, options: { enabled?: boolean } = {}) {
  const enabled = options.enabled !== false && query.trim().length >= 2;
  return useQuery({
    queryKey: ["gemma-search", query.trim()],
    queryFn: () =>
      api.get<GemmaDatasetHit[]>(
        `/rest/v2/datasets/search?query=${encodeURIComponent(query.trim())}&limit=20`,
      ),
    enabled,
    staleTime: 1000 * 60 * 5,
  });
}

/**
 * Pull a real Gemma dataset into the mock. Same pathway as the
 * `gca mock-gemma import` CLI; accepts whatever Gemma reference
 * the gemmapy resolver does — GSE accession, shortName, or
 * numeric id.
 */
export function useImportFromGemma() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reference: string) =>
      api.post<Design>("/rest/v2/datasets/import", { reference }),
    onSuccess: (design) => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ["design", design.experiment_id] });
      qc.invalidateQueries({ queryKey: ["audit-events", design.experiment_id] });
    },
  });
}

export interface DatasetVisibility {
  experiment_id: number;
  is_public: boolean;
  /** ISO timestamp of the last visibility change; empty if never set. */
  published_at: string;
  published_by: string;
}

const VISIBILITY_KEY = (experimentId: number) =>
  ["dataset-visibility", experimentId] as const;

/**
 * Read an experiment's public/private state. Real Gemma's REST API
 * doesn't expose this — see ``TODO-gemma-api §14``. The mock
 * tracks it locally so the curation UI has something to wire the
 * "publish" button against.
 */
export function useDatasetVisibility(experimentId: number) {
  return useQuery({
    queryKey: VISIBILITY_KEY(experimentId),
    queryFn: () =>
      api.get<DatasetVisibility>(
        `/rest/v2/datasets/${experimentId}/visibility`,
      ),
  });
}

/**
 * Publish an experiment — flip ``is_public`` to ``true``.
 *
 * Destructive in the sense that it makes the curation visible to
 * everyone with Gemma access; the UI gates it behind a
 * ``ConfirmModal``.
 */
export function usePublishExperiment(experimentId: number, reviewer: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<DatasetVisibility>(
        `/rest/v2/datasets/${experimentId}/publish?reviewer=${encodeURIComponent(reviewer)}`,
        {},
      ),
    onSuccess: (server) => {
      qc.setQueryData(VISIBILITY_KEY(experimentId), server);
      // Publish writes an audit event — bust the audit cache so the
      // History tab reflects it.
      qc.invalidateQueries({ queryKey: ["audit-events", experimentId] });
      // Landing list shows status pills; refresh that too.
      qc.invalidateQueries({ queryKey: KEY });
    },
  });
}
