import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import type { Design } from "@/features/experiment/types";
import {
  composeCurationDesign,
  type CurationProposalOverlay,
  type G2Design,
} from "./composeDesign";

const KEY = {
  byExperiment: (experimentId: number) => ["design", experimentId] as const,
};

/** Per bro's `STATUS_CURATION_TO_GEMMA_2_0.md` §2 reply: compose the
 *  curation `Design` client-side from Gemma 2.0's canonical
 *  `/datasets/{id}/design` + the latest curation-proposal overlay,
 *  rather than expecting a single composite endpoint. Either
 *  endpoint missing → graceful fallback to the other. */
export function useDesign(experimentId: number) {
  return useQuery({
    queryKey: KEY.byExperiment(experimentId),
    enabled: experimentId > 0,
    queryFn: async (): Promise<Design> => {
      const [g2, overlay, datasetMeta] = await Promise.all([
        api.get<G2Design>(`/rest/v2/datasets/${experimentId}/design`),
        fetchLatestProposalOverlay(experimentId),
        fetchDatasetMeta(experimentId),
      ]);
      return composeCurationDesign(
        g2,
        experimentId,
        datasetMeta.short_name ?? "",
        overlay,
        // External-source metadata for the banner — Gemma 2.0
        // returns ``accession`` / ``externalDatabase`` /
        // ``externalUri`` at the top of the dataset envelope. When
        // any of them are populated we synthesise the curation
        // ``ExternalSource`` shape so the banner shows
        // ``GEO: GSE2018`` instead of falling through to "direct
        // upload" (which it does when ``external_source === null``).
        datasetMeta.external_database || datasetMeta.accession
          ? {
              database: datasetMeta.external_database ?? "",
              accession: datasetMeta.accession ?? "",
              uri: datasetMeta.external_uri ?? null,
            }
          : null,
      );
    },
  });
}

interface DatasetMeta {
  id?: number;
  short_name?: string | null;
  name?: string | null;
  /** Source database label — "GEO", "ArrayExpress", "CELLxGENE",
   *  etc. Absent on true direct-upload datasets. */
  external_database?: string | null;
  /** Accession at the source database (e.g. "GSE2018"). */
  accession?: string | null;
  /** Click-through URL at the source database. */
  external_uri?: string | null;
}

async function fetchDatasetMeta(experimentId: number): Promise<DatasetMeta> {
  try {
    // Gemma 2.0 returns the dataset envelope as a single-element
    // array. The short-name + title we need for the banner live on
    // that first row.
    const raw = await api.get<DatasetMeta | DatasetMeta[]>(
      `/rest/v2/datasets/${experimentId}`,
    );
    if (Array.isArray(raw)) return raw[0] ?? {};
    return raw ?? {};
  } catch {
    return {};
  }
}

async function fetchLatestProposalOverlay(
  experimentId: number,
): Promise<CurationProposalOverlay | null> {
  // Pulls the latest PROPOSAL-kind curation proposal so we can lift
  // its payload overlay (is_baseline / biomaterial_short_names /
  // tags) onto the composed design. Tolerates 404 / shape drift —
  // the design renders fine without overlay (statements + sample
  // assignments still come from /design).
  try {
    const raw = await api.get<unknown>(
      `/rest/v2/datasets/${experimentId}/curation-proposals?kind=proposal&limit=1`,
    );
    return extractOverlayFromProposalsResponse(raw);
  } catch {
    return null;
  }
}

function extractOverlayFromProposalsResponse(
  raw: unknown,
): CurationProposalOverlay | null {
  if (!raw) return null;
  // The endpoint returns either a bare array (new-shape) or a
  // ``{items, total}`` envelope (legacy). Peek the first row's
  // ``payload_json`` either way.
  let first: Record<string, unknown> | null = null;
  if (Array.isArray(raw) && raw.length > 0) {
    first = raw[0] as Record<string, unknown>;
  } else if (
    typeof raw === "object" &&
    raw !== null &&
    "items" in raw &&
    Array.isArray((raw as { items: unknown[] }).items) &&
    (raw as { items: unknown[] }).items.length > 0
  ) {
    first = (raw as { items: Record<string, unknown>[] }).items[0];
  }
  if (!first) return null;
  const payload = first.payload_json ?? first.payload ?? null;
  if (!payload || typeof payload !== "object") return null;
  // The payload schema is the proposal Pydantic model; only the
  // fields we surface here matter, so cast conservatively.
  return payload as CurationProposalOverlay;
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
