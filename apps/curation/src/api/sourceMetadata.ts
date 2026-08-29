import { useQuery } from "@tanstack/react-query";

import { api, ApiError } from "./client";

/**
 * The GEO record Gemma harvested for a dataset —
 * `GET /rest/v2/datasets/{id}/sourceMetadata`.
 *
 * 🛑 **Gemma is the only source.** The local store carries its own copy
 * on `biomaterials[].geo_fields`, and this deliberately does not read it
 * or fall back to it: one source, ACL-enforced, no second copy to go
 * stale (Paul, 2026-08-29). The store's copy also has a casing split —
 * every `geoFields` child key in the 636 stored designs is camelCase
 * (`growthProtocol` 4128 rows, `growth_protocol` 0) while the panels
 * look up snake — so a fallback would keep alive exactly the defect
 * reading from Gemma repairs.
 *
 * 🛑 **Absence has TWO flavours and neither is an error.**
 *   * `200` with `data: null` — in Gemma, GEO not harvested yet. Most of
 *     the corpus was in that state on 2026-08-29 and the sweep is still
 *     running, so a re-read tomorrow may find a document.
 *   * `404` — the id is not in this Gemma at all. From the UI's seat
 *     this is the COMMON one, not the exotic one: 10 of the 189
 *     experiment ids in the local store 404 against gemma2 (all in the
 *     91219–91665 band) against 3 that answer `data: null`. A bogus id
 *     404s identically, so the client cannot tell "store-only id" from
 *     "no such dataset" — which is the reason both render softly.
 *
 * Routed to Gemma in BOTH modes by a path exception in `vite.config.ts`
 * (the store serves no such route), the same way `auditEvents` and the
 * diagnostics endpoints are.
 */

/** One GEO sample, after the client's snakeify pass.
 *
 *  🛑 The per-sample fields are TOP-LEVEL keys of this object, so they
 *  are normalized (`sourceName` → `source_name`). Only `characteristics`
 *  keeps its keys verbatim — it is in `DATA_KEYED_MAPS`, because those
 *  keys are the column names the submitter wrote and rewriting them is
 *  corruption (`shRNA` → `sh_r_n_a`). Verified against a live document.
 *
 *  The store nested these under `geo_fields`, whose CHILD keys were
 *  therefore never normalized. The two shapes are not key-compatible;
 *  do not pour one into the other. */
export interface GeoSample {
  accession: string;
  title?: string | null;
  description?: string | null;
  source_name?: string | null;
  organism?: string | null;
  molecule?: string | null;
  label?: string | null;
  sample_type?: string | null;
  growth_protocol?: string | null;
  treatment_protocol?: string | null;
  extract_protocol?: string | null;
  label_protocol?: string | null;
  hyb_protocol?: string | null;
  scan_protocol?: string | null;
  data_processing?: string | null;
  library_strategy?: string | null;
  library_source?: string | null;
  library_selection?: string | null;
  instrument_model?: string | null;
  submission_date?: string | null;
  last_update_date?: string | null;
  /** Submitter-written column names, verbatim. */
  characteristics?: Record<string, string> | null;
  /** 🛑 Arrays, not strings — they must not be rendered as a bare
   *  `{value}`, which concatenates the elements with no separator. */
  characteristics_unparsed?: string[] | null;
  supplementary_files?: string[] | null;
  /** Two-channel arrays carry a `ch2_*` twin of several fields. */
  [key: string]: unknown;
}

export interface SourceMetadataDoc {
  schema_version?: number | null;
  source?: string | null;
  source_format?: string | null;
  /** When GEO was read. The document does not move otherwise. */
  harvested_at?: string | null;
  accession?: string | null;
  short_name?: string | null;
  experiment_id?: number | null;
  title?: string | null;
  summary?: string | null;
  overall_design?: string | null;
  status?: string | null;
  url?: string | null;
  organisms?: string[] | null;
  pmids?: string[] | null;
  supplementary_files?: string[] | null;
  submission_date?: string | null;
  last_update_date?: string | null;
  is_split_subseries?: boolean | null;
  truncated?: unknown[] | null;
  sha256?: string | null;
  samples?: GeoSample[] | null;
  /** 🛑 Deliberately NOT surfaced, and not used to size or validate
   *  anything: `sampleCount` is the GEO SERIES count, and it disagrees
   *  with `samples[]` on 53 of 500 datasets measured — exactly the
   *  `isSplitSubseries` ones. `samples[]` is the array to iterate. */
  sample_count?: number | null;
}

export type SourceMetadataResult =
  | { state: "document"; doc: SourceMetadataDoc }
  /** 200 `data: null` — in Gemma, GEO not read yet. */
  | { state: "not_harvested" }
  /** 404 — this id is not in this Gemma. */
  | { state: "not_in_gemma" };

export const NOT_HARVESTED: SourceMetadataResult = { state: "not_harvested" };
export const NOT_IN_GEMMA: SourceMetadataResult = { state: "not_in_gemma" };

export function useSourceMetadata(experimentId: number | string | null | undefined) {
  return useQuery<SourceMetadataResult>({
    queryKey: ["source-metadata", String(experimentId ?? "")],
    enabled: experimentId != null && experimentId !== "",
    queryFn: async () => {
      try {
        // `api.get` unwraps the `{data: …}` envelope and hands back
        // `null` for `{"data":null}` — measured, not assumed.
        const doc = await api.get<SourceMetadataDoc | null>(
          `/rest/v2/datasets/${experimentId}/sourceMetadata`,
        );
        return doc ? { state: "document", doc } : NOT_HARVESTED;
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return NOT_IN_GEMMA;
        throw e;
      }
    },
    // The document carries a `sha256` and a `harvested_at`; it changes
    // when a harvest runs, not while a curator reads.
    staleTime: 30 * 60_000,
    retry: false,
  });
}

/** The GEO sample for one biomaterial, joined on the GSM accession.
 *
 *  🛑 The join is what makes a split subseries safe. On a split
 *  experiment the document is the ORIGINAL SERIES record, so
 *  `samples[]` can carry samples that are not in this Gemma dataset —
 *  53 of 500 documents measured. An unmatched sample is simply never
 *  looked up here. Neither `is_split_subseries` nor the `.1`/`.2`
 *  accession suffix is used as the tell: the suffix is on only 28 of
 *  those 53, and the join makes the flag unnecessary. */
export function geoSampleFor(
  doc: SourceMetadataDoc | undefined,
  accession: string | null | undefined,
): GeoSample | null {
  const want = (accession ?? "").trim().toUpperCase();
  if (!want) return null;
  for (const s of doc?.samples ?? []) {
    if ((s.accession ?? "").trim().toUpperCase() === want) return s;
  }
  return null;
}

/** Per-sample keys that identify the sample rather than describe the
 *  experiment. They are never "constant across samples" in a useful
 *  sense, and `description` already has its own place in the popover. */
const SAMPLE_IDENTITY_KEYS = new Set([
  "accession",
  "title",
  "description",
  "submission_date",
  "last_update_date",
]);

/** Fields carrying the SAME non-empty value on every sample of THIS
 *  dataset — whole-experiment context that GEO buried in per-sample
 *  free text.
 *
 *  Widened from the three protocol fields to every scalar field on
 *  2026-08-29 (Paul: *"we should also widen the overview so that fields
 *  which are the constant across the samples are shown there"*). A field
 *  that varies across samples is genuinely per-sample and stays in the
 *  popover only.
 *
 *  🛑 Computed over the INTERSECTION with this dataset's own samples,
 *  never over the whole document — see {@link geoSampleFor}. A sibling
 *  subseries could otherwise suppress a row that is constant here, or
 *  contribute one that is not.
 *
 *  `characteristics` is deliberately excluded: a characteristic present
 *  on every sample already has a surface (the projected rows in the tag
 *  block), and showing it twice under two names would read as two
 *  facts. Arrays are excluded too — a constant list is not a line of
 *  prose, and the row renders a string. */
export function constantGeoFields(
  doc: SourceMetadataDoc | undefined,
  accessions: ReadonlyArray<string | null | undefined>,
): Array<{ key: string; text: string }> {
  const samples = accessions
    .map((a) => geoSampleFor(doc, a))
    .filter((s): s is GeoSample => s != null);
  if (samples.length === 0) return [];

  const out: Array<{ key: string; text: string }> = [];
  for (const key of Object.keys(samples[0])) {
    if (SAMPLE_IDENTITY_KEYS.has(key)) continue;
    const first = samples[0][key];
    if (typeof first !== "string") continue;
    const text = first.trim();
    if (!text) continue;
    const constant = samples.every((s) => {
      const v = s[key];
      return typeof v === "string" && v.trim() === text;
    });
    if (constant) out.push({ key, text });
  }
  return out;
}

/** `growth_protocol` → `growth (GEO)`. The suffix says whose words these
 *  are: verbatim submitter text, not something we curated. */
export function geoFieldLabel(key: string): string {
  const bare = key.replace(/_/g, " ").replace(/\bprotocol\b/, "").trim();
  return `${bare || key} (GEO)`;
}
