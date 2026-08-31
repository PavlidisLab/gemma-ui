/**
 * How many annotations a biomaterial's `characteristics` entry actually
 * holds, and which URI belongs to each one.
 *
 * `characteristics` is one string per category, so `foldCharacteristics`
 * joins a category carrying two characteristics with `"; "` and
 * `characteristic_uris` keeps only the first one's URIs. On GSE43526.2
 * (experiment 8959) every sample carries `molecular entity` twice —
 * `polyA RNA extract` (OBI_0000869) and one of `Topotecan` / `Vehicle`,
 * neither grounded — and the Tags row showed two chips reading the same
 * truncated text over the same CURIE. The URI belongs to `polyA RNA
 * extract` alone; the other two are free text and have to look it.
 *
 * 🛑 `"; "` is a convention this app's fold introduced, NOT something a
 * submitter wrote. So nothing here splits on it: the decomposition is
 * read from `characteristic_value_uris`, which the fold emits alongside
 * the joined string. Where that field is absent — the local API's design
 * projection, fixtures, a draft saved before it existed — the joined
 * string is one value, exactly as before, and a submitter's own
 * semicolon stays one annotation.
 */
import type { Biomaterial } from "./types";

/** One characteristic on one biomaterial, with the URIs that are its
 *  own rather than its category-mate's. */
export interface CharacteristicValue {
  /** The category name, as the submitter wrote it, trimmed. */
  category: string;
  /** The value, trimmed. */
  label: string;
  category_uri: string | null;
  value_uri: string | null;
}

/** True when `rows` still describes `joined` — i.e. re-joining them
 *  reproduces the string they were folded from.
 *
 *  `setBiomaterialCharacteristic` rewrites a `characteristics` value in
 *  place and updates neither parallel map, so a curator who edits a
 *  folded characteristic leaves a decomposition of the OLD text behind.
 *  Trusting it there would render the pre-edit values and drop what the
 *  curator typed. The joined string is the one both producers agree on,
 *  so it wins any disagreement. */
function decomposes(
  rows: ReadonlyArray<{ value: string }>,
  joined: string,
): boolean {
  return rows.map((r) => (r.value ?? "").trim()).join("; ") === joined.trim();
}

/**
 * Every characteristic value on one biomaterial, one entry per
 * annotation rather than per category.
 *
 * A category the fold did not double yields exactly one entry, carrying
 * the same label and URIs it always did.
 */
export function characteristicValues(
  bm: Biomaterial,
): CharacteristicValue[] {
  const chars = bm.characteristics ?? {};
  const uris = bm.characteristic_uris ?? {};
  const enumerated = bm.characteristic_value_uris ?? {};
  const out: CharacteristicValue[] = [];
  for (const [rawCat, rawJoined] of Object.entries(chars)) {
    const category = (rawCat || "").trim();
    const joined = (rawJoined || "").trim();
    if (!category || !joined) continue;
    const rows = enumerated[rawCat];
    if (rows && rows.length > 0 && decomposes(rows, joined)) {
      for (const r of rows) {
        const label = (r.value || "").trim();
        if (!label) continue;
        out.push({
          category,
          label,
          category_uri: r.category_uri ?? null,
          value_uri: r.value_uri ?? null,
        });
      }
      continue;
    }
    out.push({
      category,
      label: joined,
      category_uri: uris[rawCat]?.category_uri ?? null,
      value_uri: uris[rawCat]?.value_uri ?? null,
    });
  }
  return out;
}

/**
 * `(category-label, value-label)` → value URI across a cohort, both
 * keys lower-cased + trimmed so the lookup tolerates Gemma's
 * capitalisation drift.
 *
 * Keyed per VALUE, which is what keeps a chip from borrowing the URI of
 * the characteristic it was folded beside: `molecular entity|topotecan`
 * has no entry and renders free text, while `molecular entity|polya rna
 * extract` resolves to OBI_0000869.
 *
 * First writer wins, so a cohort where two samples disagree about a
 * value's URI reports the first — same as before this was per-value.
 */
export function buildCharUriLookup(
  biomaterials: readonly Biomaterial[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const bm of biomaterials) {
    for (const v of characteristicValues(bm)) {
      if (!v.value_uri) continue;
      const k = `${v.category.toLowerCase()}|${v.label.toLowerCase()}`;
      if (!map.has(k)) map.set(k, v.value_uri);
    }
  }
  return map;
}
