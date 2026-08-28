import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import { resolveGemmaMode } from "@/lib/gemmaMode";
import { taxonLabel } from "@/lib/taxon";
import { platformFields } from "@/lib/platform";
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

  // ---- Audit fields. All optional / nullable so the UI
  // degrades to "no audits known" when an older mock is in front of
  // us. Once the agents side ships them on the agents side these populate
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

  // ---- Optional GEO-derived fields populated on preboarded rows
  // (eutils deep-fetch path; see shared/geo_eutils.py in the agents
  // repo). Absent on rows that pre-date the field or never went
  // through preboarding. UI renders them when present, ignores when
  // not.
  /** Short study-type string from NCBI eutils ``gdstype``. */
  assay?: string;
  /** Primary platform short name (GPLxxxx). */
  platform_short_name?: string;
  /** External-source link — GEO FTP series root for preboarded rows. */
  external_uri?: string;
  /** GEO accession (same as ``short_name`` for GEO-sourced rows; kept
   *  separate so non-GEO sources can populate it differently). */
  accession?: string;
  /** Source database — "GEO", "ArrayExpress", etc. */
  external_database?: string;
}

const KEY = ["datasets"] as const;

/**
 * Case-insensitive match of a free-text query against a dataset row's
 * identifying fields — short_name (== the GEO accession for GEO-sourced
 * rows), the explicit accession, title, and taxon. Shared by the
 * dashboard quick-search and the all-experiments filter so both agree
 * on what "matches". An empty query matches everything.
 */
export function datasetMatchesQuery(r: DatasetSummary, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  // 🛑 Coalesce EVERY field, not just the one typed optional.
  //
  // A search box must not be able to throw. The catalogue has two
  // producers with different wire shapes, so a field one of them omits
  // arrives here as `undefined` however the type reads. `taxon` did:
  // Gemma sends no `taxonCommonName` at all, `r.taxon.toLowerCase()`
  // raised a TypeError inside the caller's `useMemo`, and the whole
  // dashboard unmounted the moment a curator typed a character.
  const hay = (v: unknown) => (typeof v === "string" ? v.toLowerCase() : "");
  return (
    hay(r.short_name).includes(q) ||
    hay(r.accession).includes(q) ||
    hay(r.title).includes(q) ||
    hay(r.taxon).includes(q)
  );
}

/** How many catalogue rows remote mode will pull before stopping.
 *
 *  Five pages at Gemma's 100-row cap. Enough for the list to be useful
 *  on arrival, far short of the 25,695 rows a full walk would need — and
 *  a walk that long does not load, it hangs.
 *
 *  🛑 Consumers showing a list built from `useDatasets` MUST say when
 *  they are at this cap. A silently truncated catalogue reads as "that
 *  experiment is not in Gemma", which is the wrong answer to give a
 *  curator about a corpus of 25,000. */
export const REMOTE_CATALOGUE_CAP = 500;

export function useDatasets(options: { refetchInterval?: number | false } = {}) {
  return useQuery({
    queryKey: KEY,
    refetchInterval: options.refetchInterval,
    queryFn: async () => {
      // Page through the whole catalogue. The list page filters + sorts
      // entirely client-side, so it needs every row in hand — a single
      // capped fetch silently hides any experiment past the first page
      // (a hardcoded ``limit=100`` left GSE277000 unreachable at row
      // 340/430). local_api caps ``limit`` at 1000, so loop on
      // ``offset`` until we've pulled ``total_elements``.
      // 🛑 Page size is a BACKEND fact, not a preference. local_api caps
      // `limit` at 1000; Gemma caps it at 100 and rejects anything
      // larger with `400 The provided limit cannot exceed 100` — which
      // failed EVERY page in remote mode, so the catalogue came back
      // empty and the quick-search had nothing to match against.
      // Measured on gemma2, 2026-08-28.
      const remote = resolveGemmaMode().mode === "remote";
      const PAGE = remote ? 100 : 1000;
      // 🛑 Do NOT page the whole catalogue against Gemma.
      //
      // This loop materializes every row so the list can filter and sort
      // client-side. That is right for the curation store (636 rows, one
      // request) and impossible against Gemma: 25,695 datasets at its
      // 100-row cap is 257 SEQUENTIAL requests, which hangs the page
      // rather than loading it. Measured on gemma2, 2026-08-28.
      //
      // So remote mode takes a bounded prefix and says so. The honest
      // fix is server-side search — the client should ask Gemma to
      // filter rather than pulling the corpus over to filter it here —
      // but a partial list that admits it beats a page that never
      // finishes.
      const maxRows = remote ? REMOTE_CATALOGUE_CAP : Infinity;
      const raw: WorkflowDatasetListResponse["data"] = [];
      for (let offset = 0; ; offset += PAGE) {
        const resp = await api.get<WorkflowDatasetListResponse>(
          `/rest/v2/datasets?limit=${PAGE}&offset=${offset}`,
        );
        raw.push(...resp.data);
        // Stop when the server returned a short (final) page or we've
        // accumulated the full count. The short-page check also guards
        // against an empty page looping forever.
        if (
          resp.data.length < PAGE ||
          raw.length >= (resp.total_elements ?? raw.length) ||
          raw.length >= maxRows
        ) {
          break;
        }
      }
      return raw.map(
        (r): DatasetSummary => ({
          experiment_id:      r.id,
          short_name:         r.short_name,
          title:              r.name,
          taxon:              taxonLabel(r),
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
          // GEO-derived optional fields (preboarded rows only;
          // undefined elsewhere). Pass-through from WorkflowDatasetRow.
          assay:                r.assay,
          // Flat from the store, `platforms[]` from Gemma — see
          // lib/platform.ts. Gemma gained the field 2026-08-28; before
          // that the list's platform column was blank in remote mode.
          platform_short_name:  platformFields(r).platform_short_name,
          external_uri:         r.external_uri,
          accession:            r.accession,
          external_database:    r.external_database,
        }),
      );
    },
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
 * tags before storing so the dataset lands as a fresh preboarding state.
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
      // Curations cache backs the chip-strip baseline view; on a
      // re-import the underlying /curations rows almost certainly
      // moved. Per the 2026-06-13 continuity sweep — same hole as
      // ``useUpdateDesign``.
      qc.invalidateQueries({
        queryKey: ["curations", design.experiment_id],
      });
    },
  });
}

/**
 * Reset an experiment to its fresh preboarding state by re-importing
 * from real Gemma with ``strip_curation: true``. Curated factors and
 * curator-attached / IC tags get dropped; biomaterials, characteristics,
 * and metadata stay. Equivalent to running
 * ``mock-gemma import --strip-curation`` from the CLI.
 *
 * Wraps ``useImportFromGemma`` so the caller doesn't have to pass
 * the experiment id at the mutation site.
 */
export function useResetExperiment(experimentId: number | string) {
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
 * Rename a dataset (its ``short_name``). Rarely used — short_name
 * is the curator-facing identifier for an experiment across all
 * downstream Gemma surfaces, so a rename is an exceptional operation
 * (typo fixes, accession adjustments). The result must be unique
 * across all datasets; the endpoint enforces that and returns
 * ``409`` if the candidate name collides.
 *
 * Endpoint contract:
 *   ``PUT /rest/v2/datasets/{id}/short-name``
 *   body: ``{ "short_name": "<new>" }``
 *   responses:
 *     200 → ``{ "experiment_id": <id>, "short_name": "<new>" }``
 *     400 → invalid (empty / whitespace / too long / bad chars)
 *     404 → dataset not found OR endpoint not implemented
 *     409 → ``short_name`` already in use
 *
 * The agents side implements this wire contract separately; until
 * that ships, the UI 404s with a clear "endpoint not yet available"
 * inline hint.
 */
export interface RenameDatasetResponse {
  experiment_id: number;
  short_name: string;
}

export function useRenameExperiment(experimentId: number | string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (shortName: string) =>
      api.put<RenameDatasetResponse>(
        `/rest/v2/datasets/${experimentId}/short-name`,
        { short_name: shortName },
      ),
    onSuccess: () => {
      // Source of truth for the banner's short_name is the design
      // query (it hydrates ``experiment_short_name`` from
      // ``datasetMeta.short_name``). Invalidate both so the banner
      // + landing list both repaint with the new name. Audit history
      // also gets a rename event server-side; bust that cache so the
      // History tab reflects it next view.
      qc.invalidateQueries({ queryKey: ["design", experimentId] });
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ["audit-events", experimentId] });
    },
  });
}

/**
 * Mirrors what the legacy `GET /visibility` / `POST /publish` mock
 * endpoints return. Real Gemma 1.32.7 prefers the new
 * `PUT /permissions` endpoint (with a slimmer
 * `DatasetPermissionsValueObject { isPublic, isShared }` shape),
 * and the agents-side mock now ships both. UI stays on the legacy pair so
 * curators running against older calibration / evaluation packages
 * — which only have the legacy endpoints — keep working. We cut
 * over to PUT `/permissions` post-Friday alongside the rest of the
 * TS-side snake → camel sweep.
 */
export interface DatasetVisibility {
  experiment_id: number;
  is_public: boolean;
  /** ISO timestamp of the last visibility change; empty if never set. */
  published_at: string;
  published_by: string;
}

const VISIBILITY_KEY = (experimentId: number | string) =>
  ["dataset-visibility", experimentId] as const;

/**
 * Read an experiment's public/private state. Hits the legacy
 * `GET /visibility` endpoint so the UI works against both old
 * evaluation packages and the agents-side current mock.
 */
export function useDatasetVisibility(experimentId: number | string) {
  return useQuery({
    queryKey: VISIBILITY_KEY(experimentId),
    queryFn: () =>
      api.get<DatasetVisibility>(
        `/rest/v2/datasets/${experimentId}/visibility`,
      ),
  });
}

/**
 * Publish an experiment — flip `is_public` to `true`.
 *
 * Destructive in the sense that it makes the curation visible to
 * everyone with Gemma access; the UI gates it behind a
 * `ConfirmModal`.
 */
export function usePublishExperiment(experimentId: number | string, reviewer: string) {
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
