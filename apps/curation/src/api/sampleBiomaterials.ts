/**
 * Per-sample biomaterial detail, read from Gemma's
 * `GET /rest/v2/datasets/{id}/samples`.
 *
 * 🛑 **Why a second fetch exists at all.** `composeDesign` reads
 * per-sample characteristics off a legacy `biomaterials` array. Only the
 * local API emits that array (`design_schemas.py:96`); Gemma's own
 * `/datasets/{id}/design` never has. Its `bioMaterialAssignments` rows
 * carry three fields and no more:
 *
 *     { bioMaterialId, bioMaterialName, factorValueIds }
 *
 * So every Gemma-backed design composed a biomaterial with
 * `characteristics: {}`, and the sample table, the popover and the
 * inherited-chip projection all rendered empty — on GSE324761 the
 * popover said "CHARACTERISTICS (0) · none recorded" while Gemma held
 * `cell line = MCF7 cell` on all four samples. Verified 2026-08-29 that
 * the two hosts agree byte for byte (2901 bytes from gemma2 and through
 * the store), so this is the endpoint's shape, not a store defect.
 *
 * The data was one request away the whole time: `/samples` nests the
 * BioMaterial under each BioAssay as `sample`, with its characteristics
 * and their URIs.
 *
 * 🛑 **It also carries the GEO accession, which nothing else did.**
 * `geoSampleFor` joins the sourceMetadata document on a GSM, and the
 * only GSM in the design payload is the tail of Gemma's piped
 * biomaterial name (`GSE2018_bioMaterial_7|GSM36429`). Names minted
 * without the pipe — `GSE324761_Biomat_1` — have no GSM to recover, so
 * the GEO join silently missed and the popover said "no GEO fields for
 * this sample". The accession travels as its own field here rather than
 * overloading `short_name` further.
 */
import { api } from "./client";

/** One characteristic on a BioMaterial, post-`snakeify`. */
interface WireCharacteristic {
  category?: string | null;
  category_uri?: string | null;
  value?: string | null;
  value_uri?: string | null;
  original_value?: string | null;
}

/** A BioAssay row. The BioMaterial hangs off it as `sample` — several
 *  assays may share one (multi-lane / multi-platform runs), which is
 *  why the rows below are keyed by biomaterial and not by assay. */
interface WireBioAssay {
  id?: number | null;
  name?: string | null;
  accession?: { accession?: string | null } | null;
  sample?: {
    id?: number | null;
    name?: string | null;
    characteristics?: WireCharacteristic[] | null;
  } | null;
}

/** The subset of the legacy `biomaterials` shape this can fill, plus
 *  the accession. Deliberately NOT the whole `LegacyBiomaterial`:
 *  `source_biomaterial_id` (single-cell bucket parentage) and
 *  `geo_fields` are not on this endpoint, and inventing empties for
 *  them would let a caller read "no parent" where the truth is "not
 *  asked". Absent stays absent. */
export interface SampleBiomaterial {
  short_name: string;
  name: string;
  /** GEO sample id (`GSM…`) when the import recorded one. The join key
   *  for `sourceMetadata`'s per-sample document. */
  accession: string | null;
  characteristics: Record<string, string>;
  characteristic_uris: Record<
    string,
    { category_uri?: string | null; value_uri?: string | null }
  >;
  bio_assays: Array<{ short_name: string; name: string }>;
}

/** Pull the GEO short-name out of Gemma's piped biomaterial name.
 *  Mirrors `composeDesign`'s `parseShortName` so the two agree on the
 *  join key — a name without a pipe is returned whole, which is what
 *  `bio_material_assignments` will be keyed by. */
function shortNameOf(name: string): string {
  const pipe = name.lastIndexOf("|");
  if (pipe < 0) return name;
  return name.slice(pipe + 1) || name;
}

/** Fold one BioMaterial's characteristics into the parallel
 *  category-keyed maps the design consumers expect.
 *
 *  🛑 Two characteristics CAN share a category, and the map cannot hold
 *  both. Measured 2026-08-29 across 84 samples in 4 datasets: zero
 *  collisions — but four datasets do not prove a corpus, so duplicates
 *  are JOINED rather than dropped. A curator reading `treatment = A; B`
 *  can see something is doubled; a curator reading `treatment = A` has
 *  no way to know B existed. The URI map keeps the first, since there
 *  is no way to join two URIs into one meaningful value. */
function foldCharacteristics(chars: WireCharacteristic[]): {
  characteristics: Record<string, string>;
  characteristic_uris: SampleBiomaterial["characteristic_uris"];
} {
  const characteristics: Record<string, string> = {};
  const characteristic_uris: SampleBiomaterial["characteristic_uris"] = {};
  for (const c of chars) {
    const cat = (c.category ?? "").trim();
    const val = (c.value ?? "").trim();
    if (!cat || !val) continue;
    characteristics[cat] = characteristics[cat]
      ? `${characteristics[cat]}; ${val}`
      : val;
    if (!(cat in characteristic_uris)) {
      characteristic_uris[cat] = {
        category_uri: c.category_uri ?? null,
        value_uri: c.value_uri ?? null,
      };
    }
  }
  return { characteristics, characteristic_uris };
}

/** Build the per-biomaterial rows for one experiment.
 *
 *  Keyed by the same short name `composeDesign` derives from
 *  `bio_material_name`, so the result drops straight into the existing
 *  `legacyByShortName` lookup. */
export function toSampleBiomaterials(
  assays: WireBioAssay[],
): SampleBiomaterial[] {
  const byShortName = new Map<string, SampleBiomaterial>();
  for (const a of assays) {
    const bm = a.sample;
    const rawName = (bm?.name ?? "").trim();
    if (!bm || !rawName) continue;
    const shortName = shortNameOf(rawName);
    const accession = (a.accession?.accession ?? "").trim() || null;

    let row = byShortName.get(shortName);
    if (!row) {
      const folded = foldCharacteristics(bm.characteristics ?? []);
      row = {
        short_name: shortName,
        name: rawName,
        accession,
        characteristics: folded.characteristics,
        characteristic_uris: folded.characteristic_uris,
        bio_assays: [],
      };
      byShortName.set(shortName, row);
    } else if (!row.accession && accession) {
      // Several assays on one biomaterial: the first that names a GSM
      // wins, rather than the first assay in the list.
      row.accession = accession;
    }

    const assayName = (a.name ?? "").trim();
    if (accession || assayName) {
      row.bio_assays.push({
        short_name: accession ?? assayName,
        name: assayName,
      });
    }
  }
  return [...byShortName.values()];
}

/** Fetch and shape the biomaterial detail for one experiment.
 *
 *  `/samples` returns a bare `{data}` envelope with no pagination
 *  siblings (checked on a 32-sample dataset: all 32 in one response),
 *  so the client unwraps it to the array and there is no page to
 *  follow. */
export async function fetchSampleBiomaterials(
  experimentId: number | string,
): Promise<SampleBiomaterial[]> {
  const assays = await api.get<WireBioAssay[]>(
    `/rest/v2/datasets/${experimentId}/samples`,
  );
  return toSampleBiomaterials(Array.isArray(assays) ? assays : []);
}
