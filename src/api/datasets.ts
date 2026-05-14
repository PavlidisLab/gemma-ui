import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import type { Design } from "@/features/experiment/types";
import type { WorkflowDatasetListResponse } from "./workflowTypes";

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

  // ---- Audit fields (see AUDIT_FEATURE.md §"Open ask … DatasetSummary
  // audit fields" for the spec). All optional / nullable so the UI
  // degrades to "no audits known" when an older mock is in front of
  // us. Once my brother ships them on the agents side these populate
  // with no client change.

  /** Total audits ever submitted for this experiment. 0 = never
   *  audited; undefined = older server that doesn't track this yet. */
  n_audits?: number;
  /** audit_id of the most recent audit (by audited_at), for
   *  deep-linking from the row to the detail page. */
  latest_audit_id?: string | null;
  /** ISO 8601 UTC of the most recent audit. */
  latest_audited_at?: string | null;
  /** overall_verdict of the most recent audit. Null = never audited;
   *  undefined = older server that doesn't track audits. */
  latest_audit_verdict?:
    | "clean"
    | "minor_issues"
    | "major_issues"
    | "blockers"
    | null;
  /** Unactioned findings on the LATEST audit only, broken out by
   *  severity. Older audits' findings don't count — re-auditing is
   *  the canonical way to refresh the assessment. */
  n_unactioned_blocker?: number;
  n_unactioned_major?: number;
  n_unactioned_minor?: number;
}

const KEY = ["datasets"] as const;

export function useDatasets() {
  return useQuery({
    queryKey: KEY,
    queryFn: async () => {
      const resp = await api.get<WorkflowDatasetListResponse>(
        "/rest/v2/datasets?limit=100",
      );
      return resp.data.map(
        (r): DatasetSummary => ({
          experiment_id:      r.id,
          short_name:         r.short_name,
          title:              r.name,
          taxon:              r.taxon_common_name,
          updated_at:         r.last_updated,
          n_factors:          0,
          n_fvs:              0,
          n_biomaterials:     r.number_of_bio_assays,
          n_tags:             0,
          troubled:           r.troubled,
          needs_attention:    r.needs_attention,
          has_curation_note:  !!r.curation_note,
          n_pending_proposals: r.n_pending_proposals,
          n_unactioned_blocker: r.n_unactioned_blocker,
          n_unactioned_major:   r.n_unactioned_major,
          n_unactioned_minor:   0,
          latest_audit_verdict: r.latest_audit_verdict as DatasetSummary["latest_audit_verdict"],
          n_audits:             undefined,
          latest_audit_id:      undefined,
          latest_audited_at:    undefined,
        }),
      );
    },
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
 *
 * Variant accepting ``strip_curation`` mirrors the CLI's
 * ``--strip-curation`` flag — drops factors / IC tags / FV-synth
 * tags before storing so the dataset lands as a fresh skeleton.
 * Used by the UI's "Reset experiment" affordance.
 */
export interface ImportArgs {
  reference: string;
  strip_curation?: boolean;
}

export function useImportFromGemma() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: string | ImportArgs) => {
      const body: ImportArgs =
        typeof args === "string" ? { reference: args } : args;
      return api.post<Design>("/rest/v2/datasets/import", body);
    },
    onSuccess: (design) => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ["design", design.experiment_id] });
      qc.invalidateQueries({ queryKey: ["audit-events", design.experiment_id] });
      // strip_curation now drops proposals server-side (agents'
      // ``delete_for_experiment`` chained from ``import_from_gemma``).
      // Invalidate the proposals queries so the sidebar repaints
      // empty rather than showing the just-stripped proposal as
      // accepted/rejected from a stale cache. Broad ``["proposals"]``
      // covers both per-experiment and cross-experiment listings.
      qc.invalidateQueries({ queryKey: ["proposals"] });
    },
  });
}

/**
 * Reset an experiment to its fresh-skeleton state by re-importing
 * from real Gemma with ``strip_curation: true``. Curated factors and
 * curator-attached / IC tags get dropped; biomaterials, characteristics,
 * and metadata stay. Equivalent to running
 * ``mock-gemma import --strip-curation`` from the CLI.
 *
 * Wraps ``useImportFromGemma`` so the caller doesn't have to pass
 * the experiment id at the mutation site.
 */
export function useResetExperiment(experimentId: number) {
  const importer = useImportFromGemma();
  return {
    ...importer,
    mutate: (
      options?: Parameters<typeof importer.mutate>[1],
    ) =>
      importer.mutate(
        { reference: String(experimentId), strip_curation: true },
        options,
      ),
    mutateAsync: () =>
      importer.mutateAsync({
        reference: String(experimentId),
        strip_curation: true,
      }),
  };
}

/**
 * Mirrors `DatasetPermissionsValueObject` returned by Gemma's
 * `PUT /datasets/{id}/permissions` (1.32.7+). The mock matched the
 * real Gemma shape 2026-05-13 — see GEMMA_WIRE_ALIGNMENT_HANDOFF.md
 * phase-1. `isShared` is always present (mock mirrors `isPublic`
 * since there's no group-shared concept on the mock side; real
 * Gemma tracks it independently).
 *
 * Phase-1-only: the read path uses PUT `/permissions` with an empty
 * body (omitted `isPublic` = query without mutating, per the
 * endpoint contract). Once phase-2 lands and the rest of the wire
 * is on camelCase, the hook name probably collapses into the main
 * dataset query (real Gemma exposes `isPublic` inline on
 * `ExpressionExperimentValueObject`).
 */
export interface DatasetPermissions {
  // Wire field is `isPublic`; client.ts snakeify-on-read converts it
  // to `is_public` before this type sees it. Same for `is_shared`.
  // When the UI does the full camelCase cutover (post-Friday) the
  // adapter drops and these flip to camelCase.
  is_public: boolean;
  is_shared: boolean;
}

const VISIBILITY_KEY = (experimentId: number) =>
  ["dataset-visibility", experimentId] as const;

const permissionsPath = (experimentId: number) =>
  `/rest/v2/datasets/${experimentId}/permissions`;

/**
 * Read an experiment's public/shared state. PUT with an empty body
 * is a read-only query against the new permissions endpoint — the
 * endpoint contract treats an omitted `isPublic` as "report current
 * state, don't mutate."
 */
export function useDatasetVisibility(experimentId: number) {
  return useQuery({
    queryKey: VISIBILITY_KEY(experimentId),
    queryFn: () =>
      api.put<DatasetPermissions>(permissionsPath(experimentId), {}),
  });
}

/**
 * Publish an experiment — flip `isPublic` to `true`.
 *
 * Destructive in the sense that it makes the curation visible to
 * everyone with Gemma access; the UI gates it behind a
 * `ConfirmModal`.
 */
export function usePublishExperiment(experimentId: number, reviewer: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.put<DatasetPermissions>(
        `${permissionsPath(experimentId)}?reviewer=${encodeURIComponent(reviewer)}`,
        // Body snake_case — mock accepts either via populate_by_name=True
        // on the new schemas. Keeps the rest of the UI's outgoing
        // bodies uniformly snake_case until the full cutover.
        { is_public: true },
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
