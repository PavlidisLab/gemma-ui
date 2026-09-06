/**
 * The parts of a curation `Design` that Gemma's `/datasets/{id}/design`
 * does not carry, fetched from the endpoints that do.
 *
 * The local API's `Design` (`design_schemas.py`) is a richer object than
 * Gemma's: alongside factors and assignments it holds `biomaterials`,
 * `tags`, `publications` and `overall_design`. `composeDesign` reads all
 * of them off the design payload. Gemma's endpoint has none of them, so
 * on a Gemma-backed experiment each one composed empty — and an empty
 * list renders identically to "this experiment has none", which is why
 * four separate holes went unnoticed until one of them was noticed.
 *
 * Each is available; none was being asked for:
 *
 *     biomaterials  <- /datasets/{id}/samples        (sample.characteristics)
 *     tags          <- /datasets/{id}/annotations    (objectClass ExperimentTag,
 *                                                     includeFreeText=true)
 *     publications  <- /datasets/{id}/publications
 *     overall_design<- /datasets/{id}/sourceMetadata (read in OverviewPanel,
 *                                                     which already has it)
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
import type { FindingEvidence } from "@/api/justification";
import { api } from "./client";
import type {
  OntologyTerm,
  Publication,
  Statement,
  Tag,
} from "@/features/experiment/types";

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
  /** What was extracted and how the library was made. Added to
   *  `BIO_ASSAY` by gembro 2026-09-05 and live on gemma2 the same
   *  night; null on the ~687,000 assays with no molecule recorded. */
  extracted_molecule?: string | null;
  library_selection?: string | null;
  library_strategy?: string | null;
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
  /** The individual characteristics behind each `characteristics`
   *  entry, in the order they were joined into it. See
   *  `Biomaterial.characteristic_value_uris`. */
  characteristic_value_uris: Record<
    string,
    Array<{
      value: string;
      category_uri?: string | null;
      value_uri?: string | null;
    }>
  >;
  /** 🛑 `bio_assay_id` is Gemma's BioAssay id and it is the JOIN KEY
   *  for anything keyed off `/svd` — that route returns `bioAssayIds`,
   *  and the PC x factor panel maps them back to samples through this
   *  field. It was omitted here, so in remote mode that panel matched
   *  nothing and reported "No factor assignments overlap with
   *  bio-assays in the SVD" on every dataset. `short_name` cannot
   *  stand in: it is the GSM accession, which /svd never mentions. */
  bio_assays: Array<{
    bio_assay_id: number | null;
    short_name: string;
    name: string;
    /**
     * Assay-level library facts, straight from `BIO_ASSAY`.
     *
     * 🛑 **These ADD to the biomaterial's `molecular entity`
     * characteristics; they never replace them.** On 254 assays the
     * characteristics hold two or three molecule values while
     * `extractedMolecule` holds ONE — the backfill kept the most
     * specific (`nuclear` > `polyA` > `total`, confirmed on 21
     * multi-valued assays across GSE30567.1/.3). **140 of the 254 are
     * deliberately NULL** (GSE20970, GSE29761, GSE69693: both channels
     * carry a constant `sourceName`, so nothing stored says which is
     * the reference) — there the characteristic is the ONLY record of
     * the molecule. So the field is a SUMMARY, not a re-home, and
     * rendering it instead of the characteristics would silently drop
     * the losing term. `library_selection` does not recover it — it is
     * never `PolyA`, only `cDNA` or null.
     *
     * ⇒ Never write a "prefer extracted_molecule when present"
     * fallback. Show both.
     */
    extracted_molecule: string | null;
    library_selection: string | null;
    library_strategy: string | null;
  }>;
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
 *  is no way to join two URIs into one meaningful value.
 *
 *  GSE43526.2 (experiment 8959) is the corpus counter-example the note
 *  above allowed for: every one of its 10 samples carries `molecular
 *  entity` twice — `polyA RNA extract` (OBI_0000869) plus one of
 *  `Topotecan` / `Vehicle`, neither of which has a URI. Joined, the two
 *  chips read the same truncated text and both showed `OBI:0000869`,
 *  the first characteristic's term. So the join is kept (its consumers
 *  are unchanged) and `characteristic_value_uris` carries the
 *  decomposition beside it, each value with its OWN URIs. */
function foldCharacteristics(chars: WireCharacteristic[]): {
  characteristics: Record<string, string>;
  characteristic_uris: SampleBiomaterial["characteristic_uris"];
  characteristic_value_uris: SampleBiomaterial["characteristic_value_uris"];
} {
  const characteristics: Record<string, string> = {};
  const characteristic_uris: SampleBiomaterial["characteristic_uris"] = {};
  const characteristic_value_uris: SampleBiomaterial["characteristic_value_uris"] =
    {};
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
    // Emitted for every category, not just the doubled ones, so a
    // reader has one enumeration path rather than a branch on whether
    // this particular category collided.
    (characteristic_value_uris[cat] ??= []).push({
      value: val,
      category_uri: c.category_uri ?? null,
      value_uri: c.value_uri ?? null,
    });
  }
  return { characteristics, characteristic_uris, characteristic_value_uris };
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
        characteristic_value_uris: folded.characteristic_value_uris,
        bio_assays: [],
      };
      byShortName.set(shortName, row);
    } else if (!row.accession && accession) {
      // Several assays on one biomaterial: the first that names a GSM
      // wins, rather than the first assay in the list.
      row.accession = accession;
    }

    const assayName = (a.name ?? "").trim();
    // An id alone is enough to keep: the diagnostics join needs the id,
    // not the label, and dropping an unnamed assay loses a real sample
    // from the PC x factor panel.
    if (accession || assayName || a.id != null) {
      row.bio_assays.push({
        bio_assay_id: a.id ?? null,
        short_name: accession ?? assayName,
        name: assayName,
        extracted_molecule: a.extracted_molecule ?? null,
        library_selection: a.library_selection ?? null,
        library_strategy: a.library_strategy ?? null,
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

// ─── EE tags ──────────────────────────────────────────────────────────

/** One row of `/datasets/{id}/annotations`, post-`snakeify`.
 *
 *  🛑 `object_class` is the field that says WHERE the annotation lives —
 *  `ExperimentTag`, `FactorValue` or `BioMaterial` — and the endpoint
 *  returns all three flattened into one list. Gemma 1.0's page renders
 *  that list without surfacing the field, which is why an MCF7 sitting
 *  on the biomaterials looked like an experiment tag with no visible
 *  origin. Only `ExperimentTag` rows are EE tags. */
interface WireAnnotation {
  id?: number | null;
  /** 🛑 **Four fields were renamed and there are no aliases** — a hard
   *  rename, deliberately, because the thing being removed was itself a
   *  compatibility shim (gembro, `b5c6747f68`, merged 2026-08-31, not
   *  deployed; prod is `5328441870`).
   *
   *      className -> category      termName -> value
   *      classUri  -> categoryUri   termUri  -> valueUri
   *
   *  Both spellings are read HERE, at the one adapter that touches
   *  them, rather than per-field at the call sites — the same rule the
   *  case boundary follows. It is a bounded transition: once every
   *  Gemma we read serves `b5c6747f68`, delete the four legacy fields
   *  and the coalescing below.
   *
   *  The rename also brings this route into line with
   *  `/datasets/{id}/samples`, which has always used
   *  `{category, categoryUri, value, valueUri}` — `foldCharacteristics`
   *  above needs no change for the same reason. */
  category?: string | null;
  category_uri?: string | null;
  value?: string | null;
  value_uri?: string | null;
  /** @deprecated pre-`b5c6747f68` spellings; see above. */
  class_name?: string | null;
  /** @deprecated */ class_uri?: string | null;
  /** @deprecated */ term_name?: string | null;
  /** @deprecated */ term_uri?: string | null;
  evidence_code?: string | null;
  object_class?: string | null;
  /** 🛑 **The two (predicate, object) slots Gemma's
   *  `AnnotationValueObject` holds — there is no third.** The subject
   *  is the row's own `value`; these are pairs hanging off it, so one
   *  row can carry a whole composed statement.
   *
   *  Zero experiment-level characteristics in the corpus have a
   *  non-null predicate today (cab, 2026-08-31, over all 68,786 —
   *  so the six datasets probed from this side were exhaustive by
   *  accident, not lucky). They are read anyway because 87 composed
   *  tags across 74 datasets are built and queued for write-back,
   *  and the shape they will arrive in is known:
   *
   *      GSE104324  cell type: Schwann cell
   *                   + derives from part of -> sciatic nerve
   *      GSE34669   organism part: liver
   *                   + has disease -> hepatocellular carcinoma
   *
   *  The predicates to expect are `derives from part of`,
   *  `derives from cell line`, `has modifier` and `has disease`; all
   *  87 are single-pair, so `second_predicate` is unexercised and read
   *  on principle rather than on evidence.
   *
   *  Dropping them is not a cosmetic loss: `cell type = Schwann cell`
   *  rendered without the sciatic nerve is a different claim, and the
   *  composed form exists precisely so it is one tag carrying a
   *  relationship rather than two tags carrying none. */
  predicate?: string | null;
  predicate_uri?: string | null;
  object?: string | null;
  object_uri?: string | null;
  second_predicate?: string | null;
  second_predicate_uri?: string | null;
  second_object?: string | null;
  second_object_uri?: string | null;
  /** 🛑 The ONLY provenance a characteristic carries. Unlike a
   *  publication — which ships a whole `association` block with source,
   *  evidence text, assertedBy and assertedAt — an annotation row is
   *  `{evidenceCode, supportingEvidence}` and nothing else. Gemma
   *  declares it as "a JSON array of {quote, source, location} items
   *  the curation agents emitted", which is `FindingEvidence[]`.
   *
   *  Null on every row today (12 of 12 on 27103, and 0 non-null across
   *  ~7.4M `CHARACTERISTIC` rows on prod). `TagBar`'s `EvidenceTrigger`
   *  has been wired and dark since 2026-06-18 waiting for exactly this
   *  field, so carrying it is what lights it up rather than new UI.
   *
   *  🛑 **Why it is empty is NOT "the write path discards it"** — that
   *  was the first explanation and gembro retracted it on 2026-08-31
   *  after tracing REST mapper → entity → column at every section and
   *  failing to reproduce a drop. The likely cause is that a `tags`
   *  item carrying a `gemmaId` is a KEEP-MARKER: everything else on it
   *  — category, value, statements, supportingEvidence — is read and
   *  thrown away, because there is no tag-update path. An edit is
   *  `deletedIds` plus a fresh `clientRef` item.
   *
   *  Recorded here because the earlier mechanism reached a commit
   *  message of ours (`d3d9e01`) and would otherwise be the version a
   *  later reader finds. Either way this adapter's job is the same. */
  supporting_evidence?: unknown;
}

/** The EE-level tags, and only those.
 *
 *  Sample- and factor-level rows are deliberately dropped: a
 *  BioMaterial characteristic reaches the tag bar as an INHERITED chip
 *  via `augmentInferredFromBiomaterials`, which marks it read-only and
 *  violet. Passing it here instead would present a projection as a
 *  stored tag a curator can remove — see the `inferred` rules in
 *  `TagBar`. */
/** Keep only what the evidence chip can render: an array of objects
 *  carrying a quote. Returns undefined for null, a bare string, or an
 *  array of anything else, so a shape change upstream shows as a
 *  missing chip rather than a broken one. */
function asFindingEvidence(v: unknown): FindingEvidence[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter(
    (e): e is FindingEvidence =>
      !!e && typeof e === "object" && typeof (e as { quote?: unknown }).quote === "string",
  );
  return out.length > 0 ? out : undefined;
}

/** The (predicate, object) pairs on one annotation row, as the flat
 *  `Statement` rows the UI keeps.
 *
 *  🛑 **Both pairs share the row's id.** `gemma_id` is what tells two
 *  pairs of ONE statement apart from two separate statements on one
 *  subject, and only the former is against Gemma's two-pair ceiling —
 *  the same rule `composeDesign`'s factor-value statements follow. A
 *  row that came without an id gets null, which is the "made by the
 *  curator, no statement of its own yet" case.
 *
 *  Subject and category are the tag's own; a pair with neither a
 *  predicate nor an object is not a statement and is skipped. */
function toTagStatements(
  r: WireAnnotation,
  category: OntologyTerm,
  subject: OntologyTerm,
): Statement[] {
  const gemma_id = typeof r.id === "number" ? r.id : null;
  const pairs: [string | null | undefined, string | null | undefined, string | null | undefined, string | null | undefined][] = [
    [r.predicate, r.predicate_uri, r.object, r.object_uri],
    [r.second_predicate, r.second_predicate_uri, r.second_object, r.second_object_uri],
  ];
  const out: Statement[] = [];
  for (const [pLabel, pUri, oLabel, oUri] of pairs) {
    const p = (pLabel ?? "").trim();
    const o = (oLabel ?? "").trim();
    if (!p && !o) continue;
    out.push({
      gemma_id,
      category,
      subject,
      predicate: p ? { label: p, uri: pUri ?? null } : null,
      object: o ? { label: o, uri: oUri ?? null } : null,
    });
  }
  return out;
}

export function toExperimentTags(rows: WireAnnotation[]): Tag[] {
  const tags: Tag[] = [];
  for (const r of rows) {
    if (r.object_class !== "ExperimentTag") continue;
    // 🛑 `value` is the TERM now, not a composed sentence. It used to
    // hold `formatStatement(...)` output on a factor-value row — `"wild
    // type genotype has background APP/PS1"`, or `"dexamethasone"` with
    // the dose clause stripped. Nothing here has to undo that any more.
    const label = (r.value ?? r.term_name ?? "").trim();
    const category = (r.category ?? r.class_name ?? "").trim();
    if (!label && !category) continue;
    const categoryTerm: OntologyTerm = {
      label: category,
      uri: r.category_uri ?? r.class_uri ?? null,
    };
    const valueTerm: OntologyTerm = {
      label,
      uri: r.value_uri ?? r.term_uri ?? null,
    };
    const statements = toTagStatements(r, categoryTerm, valueTerm);
    tags.push({
      id: r.id ?? tags.length + 1,
      category: categoryTerm,
      value: valueTerm,
      // Left undefined rather than `[]` — `TagBar` branches on
      // `statements?.length`, and an empty array is the flat tag it
      // already renders, so the two must not be told apart by identity.
      statements: statements.length > 0 ? statements : undefined,
      evidence_code: r.evidence_code ?? undefined,
      // Passed through, not reshaped: the wire shape IS
      // `FindingEvidence[]`. Anything else is dropped rather than
      // rendered — a malformed blob must not reach the quote chip.
      supporting_evidence: asFindingEvidence(r.supporting_evidence),
    });
  }
  return tags;
}

/** 🛑 `includeFreeText=true` is not optional here — without it the route
 *  **omits every ungrounded annotation**, and an omitted tag is
 *  indistinguishable from an absent one.
 *
 *  Measured on eid 38390 (GSE256180), gemma2 `0293d82c47`:
 *
 *      default              →  4 EE tags,  0 BioMaterial rows
 *      includeFreeText=true →  5 EE tags,  6 BioMaterial rows
 *
 *  The fifth is `strain = Ascl1CreERT2/Ai14`, `valueUri` null —
 *  `CHARACTERISTIC.ID 39131052`, evidence code `IC`, stored since the
 *  original load. It reads as an agent invention when the tag bar shows
 *  no such tag and Gemma's own page shows no such tag.
 *
 *  It is the ONLY parameter this route accepts, and it defaults to
 *  hiding data. Ungrounded tags are shown and marked (italic, no URI),
 *  never suppressed — so the complete list is the one to ask for.
 *
 *  The BioMaterial rows it also unhides are dropped by
 *  `toExperimentTags` as before; sample characteristics come from
 *  `/samples`, which has never suppressed free text (verified on the
 *  same dataset: `BioSource = Trachea`, `valueUri` null, present with
 *  no parameter at all).
 *
 *  Inert in local mode — the store does not serve this route (404 with
 *  or without the parameter), and the caller already falls back to an
 *  empty list. */
export async function fetchExperimentTags(
  experimentId: number | string,
): Promise<Tag[]> {
  const rows = await api.get<WireAnnotation[]>(
    `/rest/v2/datasets/${experimentId}/annotations?includeFreeText=true`,
  );
  return toExperimentTags(Array.isArray(rows) ? rows : []);
}

// ─── Publications ─────────────────────────────────────────────────────

/** One row of `/datasets/{id}/publications`, post-`snakeify`.
 *
 *  `association` already arrives in the shape the UI's
 *  `PublicationAssociation` expects — status / role / source /
 *  evidence — because Gemma carries the publication-provenance block
 *  natively. It is passed through rather than rebuilt. */
interface WirePublication {
  pub_accession?: string | null;
  title?: string | null;
  citation?: { citation?: string | null } | string | null;
  association?: unknown;
}

/** 🛑 The VO has no DOI field. `doi` is required on `Publication`, so it
 *  is filled with the empty string — the same thing the local API's
 *  projection does when GEO gave it only a PMID. Do not invent one from
 *  the citation text. */
export function toPublications(rows: WirePublication[]): Publication[] {
  const out: Publication[] = [];
  for (const r of rows) {
    const pmid = (r.pub_accession ?? "").trim();
    const title = (r.title ?? "").trim();
    const citation =
      typeof r.citation === "string"
        ? r.citation
        : ((r.citation?.citation ?? "") as string);
    if (!pmid && !title) continue;
    out.push({
      pubmed_id: pmid,
      doi: "",
      citation: citation.trim(),
      title,
      association: (r.association ?? null) as Publication["association"],
    });
  }
  return out;
}

export async function fetchPublications(
  experimentId: number | string,
): Promise<Publication[]> {
  const rows = await api.get<WirePublication[]>(
    `/rest/v2/datasets/${experimentId}/publications`,
  );
  return toPublications(Array.isArray(rows) ? rows : []);
}
