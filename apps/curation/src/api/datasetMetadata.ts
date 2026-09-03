/**
 * Per-dataset pipeline output files — Gemma 1.0's
 * `getMetaData.html?eeId=N&typeId=3`, with a working equivalent.
 *
 * `GET /datasets/{id}/metadata` lists one entry per file that actually
 * exists on disk; `GET /datasets/{id}/metadata/{type}` streams it.
 * MultiQC types are served `Content-Disposition: inline`, so the report
 * is meant to be READ rather than downloaded.
 *
 * 🛑 **An empty listing is the normal answer, not a fault.** Microarray
 * datasets never have a MultiQC report — 12,760 datasets do, out of far
 * more than that (gembro, 2026-09-02). Verified: eid 40086 lists three
 * files, eid 16 lists none.
 *
 * Types are the enum NAME, never 1.0's numeric `typeId`, and the
 * listing is the source of truth — do not hardcode a set and hope.
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "./client";

export interface DatasetMetadataFile {
  /** Enum name, e.g. `RNASEQ_PIPELINE_REPORT`. Use it in the path. */
  type: string;
  /** Human label, straight from Gemma. */
  display_name?: string | null;
  /** Filename Gemma would save it as. */
  download_name?: string | null;
  content_type?: string | null;
  directory?: boolean | null;
}

export function useDatasetMetadataFiles(experimentId: number | string) {
  return useQuery({
    queryKey: ["dataset-metadata", experimentId],
    queryFn: () =>
      api.get<DatasetMetadataFile[]>(
        `/rest/v2/datasets/${experimentId}/metadata`,
      ),
    enabled: Boolean(experimentId),
    staleTime: 1000 * 60 * 30,
    // A backend without the route at all is an absence, not an error to
    // shout about — the row simply says nothing is recorded.
    retry: false,
  });
}

export function metadataFilePath(
  experimentId: number | string,
  type: string,
): string {
  return `/rest/v2/datasets/${experimentId}/metadata/${encodeURIComponent(type)}`;
}
