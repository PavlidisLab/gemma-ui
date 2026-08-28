/**
 * The platform a dataset was run on, from either producer's shape.
 *
 * 🛑 Two wire shapes for one datum, the same split as
 * ``lib/taxon.ts::taxonLabel``:
 *
 *   local_api  ->  flat scalars: `platform`, `platform_short_name`,
 *                  `original_platform`, … (GEO-derived, preboarding)
 *   Gemma      ->  `platforms: [{id, short_name, name}]` and
 *                  `original_platforms: [...]`, both LISTS
 *
 * Gemma carried neither until 2026-08-28, when the fields landed on
 * `ExpressionExperimentValueObject` for both `/datasets` and
 * `/datasets/{id}` (build `cb6b67e854`). Before that the whole platform
 * line rendered blank in remote mode — a curator could not see what a
 * dataset was run on.
 *
 * 🛑 **A non-empty `original_platforms` means the dataset really was
 * switched.** Gemma leaves out an "original" platform that is also one
 * of the platforms in use, so the emptiness of that list is the answer
 * to "was this moved", not merely the absence of a record.
 *
 * Shape normalization at the ingestion boundary. It picks between two
 * spellings of a datum both producers really send and invents nothing
 * when neither does.
 */

/** One platform as Gemma names it (post-`snakeify`). */
export interface PlatformRef {
  id?: number | null;
  short_name?: string | null;
  name?: string | null;
}

/** Structurally typed, like `TaxonBearingRow`: the callers hold
 *  different row types and a helper named for one payload does not get
 *  reached for by someone holding another. */
export interface PlatformBearingRow {
  platform?: string | null;
  platform_short_name?: string | null;
  platform_id?: number | null;
  original_platform?: string | null;
  original_platform_short_name?: string | null;
  original_platform_id?: number | null;
  platforms?: PlatformRef[] | null;
  original_platforms?: PlatformRef[] | null;
}

export interface PlatformFields {
  platform: string;
  platform_short_name: string;
  platform_id: number | null;
  original_platform: string;
  original_platform_short_name: string;
  original_platform_id: number | null;
}

/** Join every platform's name rather than taking the first. A dataset
 *  really can use more than one, and showing one of three is a wrong
 *  answer given confidently — the shape `modality.ts` regex-tests and
 *  the banner renders both tolerate a list. */
function joinNames(refs: PlatformRef[], key: "name" | "short_name"): string {
  return refs
    .map((r) => (r?.[key] || "").trim())
    .filter(Boolean)
    .join(" · ");
}

/** An id is only meaningful when it names exactly one platform; for a
 *  joined string there is nothing for it to identify. */
function loneId(refs: PlatformRef[]): number | null {
  return refs.length === 1 && typeof refs[0]?.id === "number"
    ? refs[0].id
    : null;
}

export function platformFields(
  r: PlatformBearingRow | null | undefined,
): PlatformFields {
  const list = (v: PlatformRef[] | null | undefined) =>
    Array.isArray(v) ? v.filter(Boolean) : [];
  const current = list(r?.platforms);
  const original = list(r?.original_platforms);
  const flat = (v: string | null | undefined) =>
    typeof v === "string" && v.trim() ? v.trim() : "";
  return {
    platform: flat(r?.platform) || joinNames(current, "name"),
    platform_short_name:
      flat(r?.platform_short_name) || joinNames(current, "short_name"),
    platform_id: r?.platform_id ?? loneId(current),
    original_platform: flat(r?.original_platform) || joinNames(original, "name"),
    original_platform_short_name:
      flat(r?.original_platform_short_name) ||
      joinNames(original, "short_name"),
    original_platform_id: r?.original_platform_id ?? loneId(original),
  };
}
