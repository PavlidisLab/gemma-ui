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
  /** `ONECOLOR` | `TWOCOLOR` | `DUALMODE` | `SEQUENCING` | `GENELIST`
   *  | `OTHER`. Added to the reference 2026-08-28 alongside the
   *  dataset-level field. */
  technology_type?: string | null;
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
  /** The dataset's own classifier.
   *
   *  🛑 It answers ONLY when the dataset's platforms agree. A dataset on
   *  a microarray and a sequencer is both, and null there means "ask the
   *  platforms" — not "unknown". The old details-path rule took whichever
   *  platform the iterator reached first, which labelled half of such a
   *  dataset wrong with nothing to distinguish that from a real answer.
   *
   *  Null on 0 of 500 sampled after the 2026-08-28 fix; before it, null
   *  on 300 of 300. */
  technology_type?: string | null;
}

export interface PlatformFields {
  /** The dataset's technology, resolved. Empty string when the
   *  platforms disagree — a dataset that is genuinely both is not a
   *  question this field can answer, and picking one would be a guess. */
  technology_type: string;
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

/** The technology every platform agrees on, or "" when they do not.
 *
 *  🛑 `GENELIST` is NOT an instrument. It is the generic platform Gemma
 *  switches sequencing data ONTO ("Generic platform for Mus musculus,
 *  indexed by NCBI IDs"), and it is **half the corpus** — 252 of 500
 *  sampled, against 1 that reads SEQUENCING. Every one of those 252
 *  carries an `originalPlatforms` entry and every one of those is
 *  SEQUENCING (gembro, measured 2026-08-28). `modality.ts` maps it to
 *  sequencing on that basis; anything else reading this field has to
 *  know the same thing. */
function agreedTechnology(refs: PlatformRef[]): string {
  const seen = new Set(
    refs.map((r) => (r?.technology_type || "").trim()).filter(Boolean),
  );
  return seen.size === 1 ? [...seen][0] : "";
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
    // Dataset-level first — it is null precisely when the platforms
    // disagree, and then the platforms are the only honest source.
    technology_type: flat(r?.technology_type) || agreedTechnology(current),
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
