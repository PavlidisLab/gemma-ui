/**
 * Adapter that composes the curation `Design` from two Gemma 2.0
 * endpoints, per agreement with the agents side (2026-05-23):
 *
 *   1. `GET /datasets/{id}/design`
 *      Canonical Gemma 2.0 shape — `experimental_factors[]` (after
 *      ``snakeify`` at the client boundary),
 *      `bio_material_assignments[]`. Carries factor metadata,
 *      structured S-P-O statements per FV, sample → FV id mapping.
 *
 *   2. `GET /datasets/{id}/curation-proposals?kind=PROPOSAL&limit=1`
 *      Latest proposal's `payload_json` carries the curation-only
 *      overlay: per-FV `is_baseline` + `biomaterial_short_names[]`,
 *      top-level `tags[]`.
 *
 * The merge stays here (UI side) so the canonical `/design` endpoint
 * doesn't carry curation-specific overlay fields. We fall back to
 * empty / defaults whenever the overlay is missing — design alone is
 * enough to render the editor read-only.
 */

import { taxonLabel, type TaxonBearingRow } from "@/lib/taxon";
import { platformFields, type PlatformBearingRow } from "@/lib/platform";
import type {
  Biomaterial,
  Design,
  ExternalSource,
  Factor,
  FactorType,
  FactorValue,
  OntologyTerm,
  Publication,
  Statement,
  Tag,
} from "@/features/experiment/types";

// ─── Gemma 2.0 wire shapes (post-snakeify) ───────────────────────

interface G2Term {
  /** Shared with the statement that predicates it — see
   *  `composeFvStatements`. */
  id?: number;
  category?: string | null;
  category_uri?: string | null;
  value?: string | null;
  value_uri?: string | null;
}

interface G2Statement {
  id?: number;
  category?: string | null;
  category_uri?: string | null;
  subject?: string | null;
  subject_uri?: string | null;
  predicate?: string | null;
  predicate_uri?: string | null;
  object?: string | null;
  object_uri?: string | null;
}

interface G2FactorValue {
  id: number;
  value?: string | null;
  summary?: string | null;
  is_measurement?: boolean | null;
  is_baseline?: boolean | null;
  characteristics?: G2Term[];
  statements?: G2Statement[];
}

interface G2ExperimentalFactor {
  id: number;
  /** 🐍 SNAKE on purpose, unlike its `factors[]` twin. The projection
   *  returns plain dicts, so the server model's camel alias generator
   *  never reaches inside — its neighbours (`is_baseline`,
   *  `category_uri`, `bio_material_name`) are snake for the same
   *  reason. Post-`snakeify` both spellings land here identically, so
   *  this only matters when reading the raw payload. */
  gemma_factor_id?: number | null;
  local_factor_id?: string | null;
  name?: string | null;
  description?: string | null;
  /** "categorical" | "continuous". */
  type?: string | null;
  category?: G2Term | null;
  values?: G2FactorValue[];
}

interface G2BioMaterialAssignment {
  bio_material_id: number;
  bio_material_name?: string | null;
  factor_value_ids?: number[];
}

/** Legacy biomaterial row carried alongside the Gemma 2.0
 *  ``bio_material_assignments`` shape. The local API's
 *  ``Design`` Pydantic model emits both — see
 *  ``gemma_curation_agents/local_api/design_schemas.py:96`` (the
 *  "wire-shape compatibility" block). The G2 ``bio_material_assignments``
 *  array carries only ``bio_material_name`` + ``factor_value_ids``;
 *  per-sample ``characteristics`` (the popover's bread and butter) live
 *  on this legacy ``biomaterials`` array.
 */
interface LegacyBiomaterial {
  short_name: string;
  name?: string | null;
  characteristics?: Record<string, string>;
  characteristic_uris?: Record<
    string,
    { category_uri?: string | null; value_uri?: string | null }
  >;
  bio_assays?: Array<{
    short_name?: string;
    name?: string | null;
  }>;
  source_biomaterial_id?: number | null;
  /** Raw per-sample GEO MINiML free-text (treatment/growth/extract
   *  protocol, source_name, title…). Emitted by the local API's
   *  ``BiomaterialD.geo_fields`` (design_schemas.py) and snakeified by
   *  the client; forwarded to the popover's "From GEO — raw" section. */
  geo_fields?: Record<string, string>;
}

/** The wire-only half of the design payload: fields this adapter
 *  reads and TRANSFORMS (or renames) on its way to a `Design`. Every
 *  other `Design` field the server emits rides through untouched —
 *  see `G2Design` below. */
interface G2DesignWire {
  id?: number;
  name?: string | null;
  description?: string | null;
  /** GEO series "Overall design" free-text, kept separate from the
   *  abstract/summary in ``description`` (local_api Design.overall_design;
   *  snakeified from ``overallDesign``). Surfaced once in the UI's
   *  "design (GEO)" row. */
  overall_design?: string | null;
  experimental_factors?: G2ExperimentalFactor[];
  bio_material_assignments?: G2BioMaterialAssignment[];
  /** Legacy field — the local API emits it alongside
   *  ``bio_material_assignments`` so consumers that need the full
   *  biomaterial detail (characteristics + bio_assays +
   *  source_biomaterial_id) can pick it up without a second fetch.
   */
  biomaterials?: LegacyBiomaterial[];
  /** EE-level tags (curated annotations on the experiment). The
   *  local_api Design schema emits them alongside the rest of the
   *  design; real Gemma 2.0's ``/datasets/{id}/design`` may or may
   *  not include them (the field is optional here for that reason).
   *  When absent the UI falls back to whatever the proposal overlay
   *  carries; absent in both → empty list. Without this the banner's
   *  ``ModalityIndicator`` was always mis-classifying single-cell /
   *  single-nucleus studies as bulk RNA-seq because the assay tag
   *  it inspects was missing from the composed Design. */
  tags?: Tag[];
  /** Linked publications — populated by the local_api Design
   *  schema's ``publications`` field (built at ingest from the
   *  GEO MINiML ``<Pubmed-ID>`` tag). Pre-2026-06-11 ``composeCurationDesign``
   *  silently dropped this on its return path, so the OverviewPanel's
   *  "Publications" card and the PrePublishChecklist both rendered
   *  empty even when the upstream had a PMID. Fixed by adding the
   *  copy-through. */
  publications?: Publication[];
  /** The gold version this design was last synced from
   *  (`pg500-2873cc08b06b`). Read-only here: the UI never authors it,
   *  it just has to survive the trip. Dropped on the return path until
   *  2026-08-17 — the same copy-through gap `publications` hit above —
   *  which cost two things at once. The header's version chip rendered
   *  nothing, so "am I looking at the current curation?" stayed
   *  unanswerable in the one place it was being asked; and the commit
   *  edit log's `base.gold_data_version` went out null on every write
   *  through /design, which is the base identity the store's reconcile
   *  has to guess without. */
  gold_data_version?: string;
  /** This dataset's OWN curation version (`76a6c5b55d9c`) — distinct
   *  from the set name above, and the only thing a staleness comparison
   *  may look at. Read-only here, and it must survive the trip for the
   *  same reason `gold_data_version` must: this function builds a new
   *  Design field-by-field, `normaliseDesignForSave` spreads whatever it
   *  is handed, and a whole-design replace that omits a stored field can
   *  unstamp the row. That is not hypothetical — it is the leading
   *  candidate for the store's 34 unstamped base rows, from the eight
   *  weeks this path dropped `gold_data_version`. Landed store-side
   *  2026-08-17; absent until a landing stamps the rows. */
  annotation_version?: string;
  /** What the baseline holds for THIS dataset, computed by the store at
   *  request time. Carried so the header can compare without a second
   *  request. 🛑 Never written back — `normaliseDesignForSave` strips
   *  it, because a stored copy of a request-time projection would report
   *  freshly-landed rows as stale. */
  baseline?: unknown;
}

/** Everything on `Design` that the server emits in its final shape and
 *  this adapter does not touch — `subset_recommendations`,
 *  `should_split_on_factor_id`, `loaded_at`, and whatever lands next.
 *
 *  🛑 Deliberately an `Omit` of `Design` rather than a list of names. A
 *  field added to `Design` joins this passthrough on its own, which is
 *  the property the old hand-listed return literal did not have: it
 *  dropped `publications` for eight weeks (fixed 2026-06-11),
 *  `gold_data_version` for eight more (2026-08-17), and
 *  `subset_recommendations` from the day the field existed until
 *  2026-08-20 — three instances of one bug, because a literal that
 *  enumerates known keys is a data-loss site by construction. */
type DesignPassthrough = Partial<Omit<Design, keyof G2DesignWire>>;

export type G2Design = G2DesignWire & DesignPassthrough;

// ─── Curation-proposal overlay shape ─────────────────────────────

/** Slice of the latest proposal's payload that we lift onto the
 *  composed Design. We only read the fields we need; the full
 *  proposal payload is rich and lives in its own type elsewhere.
 *
 *  ``design.proposed_factors`` is the materialise-from-payload path:
 *  when the canonical /design has no factors yet (the agent's
 *  proposed factors haven't been committed), we synthesise Factor[]
 *  from the overlay so the sample-details + design-setup tabs
 *  agree. Before this landed (2026-06-03), the sample-details tab
 *  showed zero factor columns on uncommitted-proposal experiments
 *  while design-setup parsed the payload via a separate adapter
 *  path. */
export interface CurationProposalOverlay {
  /** Per FV-id overlay. */
  factor_values?: Record<
    number,
    {
      is_baseline?: boolean;
      biomaterial_short_names?: string[];
    }
  >;
  tags?: Tag[];
  design?: {
    proposed_factors?: ProposedFactorOverlay[];
  };
}

interface ProposedFactorOverlay {
  category?: string | null;
  category_uri?: string | null;
  factor_type?: string | null;
  factor_values?: ProposedFactorValueOverlay[];
}

interface ProposedFactorValueOverlay {
  label?: string | null;
  is_baseline?: boolean;
  samples?: string[];
  statements?: ProposedStatementOverlay[];
}

interface ProposedStatementOverlay {
  subject_label?: string | null;
  subject_uri?: string | null;
  predicate_label?: string | null;
  predicate_uri?: string | null;
  object_label?: string | null;
  object_uri?: string | null;
}

// ─── Compose ─────────────────────────────────────────────────────

/** Slim metadata strip lifted from `/rest/v2/datasets/{id}` onto the
 *  composed Design so the banner can render technology_type /
 *  platform / external_source without an extra fetch. Only the
 *  banner-relevant fields are read; the full DatasetMeta type lives
 *  in design.ts. */
export interface DatasetMetaSlim
  extends TaxonBearingRow,
    PlatformBearingRow {
  /** When Gemma first saw this dataset — the banner's "loaded at".
   *  Live 2026-08-28; it is the `action "C"` audit event, lifted onto
   *  the VO so the banner does not read 213 events for one timestamp.
   *  🛑 Display only: `auditTrail.*` is unregistered from the dataset
   *  filter surface, so it cannot be sorted or filtered on. */
  date_created?: string | null;
  /** 🛑 Read via `taxonLabel(meta)`. Gemma sends the taxon nested and
   *  has no `taxonCommonName`; `TaxonBearingRow` carries both shapes. */
  taxon_common_name?: string | null;
  technology_type?: string | null;
  assay?: string | null;
  /** The dataset's own title and abstract, from
   *  `/rest/v2/datasets/{id}`. 🛑 These are NOT the same fields as the
   *  design payload's — Gemma's `ExperimentalDesign` has its own `name`
   *  (empty on every dataset checked) and a `description` that carries
   *  the GEO "Overall design" line. The experiment's real title and
   *  abstract only exist here. */
  name?: string | null;
  description?: string | null;
}

export function composeCurationDesign(
  g2: G2Design,
  experimentId: number | string,
  experimentShortName: string,
  overlay?: CurationProposalOverlay | null,
  externalSource?: ExternalSource | null,
  meta?: DatasetMetaSlim | null,
): Design {
  const fvOverlay = overlay?.factor_values ?? {};
  /** The experiment's abstract, which only the dataset row carries. */
  const abstract = (meta?.description ?? "").trim();

  // Derive per-FV biomaterial-short-name lists from the assignments
  // table. We split the ``bio_material_name`` on '|' since Gemma's
  // import emits "GSE_bioMaterial_X|GSM12345" — the tail is the GEO
  // short-name. Falls back to the raw bio_material_name when no
  // delimiter is present.
  const samplesByFvId = new Map<number, string[]>();
  for (const bma of g2.bio_material_assignments ?? []) {
    const shortName = parseShortName(bma.bio_material_name ?? "");
    for (const fvId of bma.factor_value_ids ?? []) {
      let arr = samplesByFvId.get(fvId);
      if (!arr) {
        arr = [];
        samplesByFvId.set(fvId, arr);
      }
      arr.push(shortName);
    }
  }

  // Factor IDENTITY, from whichever of the two shapes carries it.
  //
  // 🛑 `gemma_factor_id` is the identity; the `id` beside it is a
  // per-row sequence number, and cab measured what trusting it costs
  // (2026-08-20): one design's `by_factor_id` resolved against another
  // design bound GSE74438's organism-part levels to a GENOTYPE factor.
  // It resolved, which is worse than dangling.
  //
  // The `experimental_factors[]` projection carried no identity at all
  // until cab fixed it at source the same day, so a design serialized
  // before then has it only on `factors[]`. Both are read: the
  // projection first (it is the row being composed), then a lookup into
  // `factors[]`, which is 1:1 on `id` and so an exact match rather than
  // a heuristic one. Two sources, one ladder — not two mechanisms.
  const identityById = new Map<
    number,
    Pick<Factor, "gemma_factor_id" | "local_factor_id">
  >();
  for (const f of g2.factors ?? []) {
    if (typeof f?.id === "number") {
      identityById.set(f.id, {
        gemma_factor_id: f.gemma_factor_id ?? null,
        local_factor_id: f.local_factor_id ?? null,
      });
    }
  }

  let factors: Factor[] = (g2.experimental_factors ?? []).map((ef) => {
    const fallback = identityById.get(ef.id);
    return {
      ...composeFactor(ef, fvOverlay, samplesByFvId),
      gemma_factor_id: ef.gemma_factor_id ?? fallback?.gemma_factor_id ?? null,
      local_factor_id: ef.local_factor_id ?? fallback?.local_factor_id ?? null,
    };
  });

  // Materialise from proposal payload when the canonical design has
  // no factors yet. The agent's proposed factors live in the proposal
  // payload (``payload.design.proposed_factors``) — sample-details
  // can't show factor columns without them, and the design-setup tab
  // was the only consumer parsing the payload directly. This unifies
  // the two paths: every Design consumer sees the same factors.
  // FV/factor ids are synthesised as negatives (real Gemma ids are
  // positive) so consumers that key on id don't collide with future
  // commits.
  const proposed = overlay?.design?.proposed_factors;
  if (factors.length === 0 && proposed && proposed.length > 0) {
    factors = proposed.map((pf, fi) => materialiseProposedFactor(pf, fi));
  }

  // Biomaterials: prefer the legacy ``biomaterials`` array when the
  // server emits it (the local API does — see
  // ``design_schemas.py:96``). It carries the per-sample
  // characteristics + characteristic_uris + bio_assays +
  // source_biomaterial_id the popovers and the per-sample tooltips
  // depend on. Fall back to the minimum-viable mapping from the
  // ``bio_material_assignments`` table for any consumer (real Gemma
  // 2.0?) that doesn't emit the legacy field.
  const legacyByShortName = new Map<string, LegacyBiomaterial>();
  for (const lb of g2.biomaterials ?? []) {
    if (lb.short_name) legacyByShortName.set(lb.short_name, lb);
  }
  const biomaterials: Biomaterial[] = (g2.bio_material_assignments ?? []).map(
    (bma) => {
      const shortName = parseShortName(bma.bio_material_name ?? "");
      const legacy = legacyByShortName.get(shortName);
      return {
        short_name: shortName,
        name: legacy?.name ?? bma.bio_material_name ?? "",
        characteristics: legacy?.characteristics ?? {},
        characteristic_uris: legacy?.characteristic_uris,
        bio_assays: legacy?.bio_assays
          ?.filter((a): a is { short_name: string; name?: string | null } =>
            typeof a.short_name === "string" && a.short_name.length > 0,
          )
          .map((a) => ({ short_name: a.short_name, name: a.name ?? "" })),
        source_biomaterial_id: legacy?.source_biomaterial_id ?? null,
        geo_fields: legacy?.geo_fields,
      };
    },
  );

  // 🛑 CARRY THE OBJECT, then override. Everything the server put on
  // the design row survives by default; only the fields below, which
  // this adapter genuinely transforms or renames, get replaced.
  //
  // The four dropped here are wire-only: `id` / `name` are the G2
  // spellings of `experiment_id` / `title`, and the two array shapes
  // are re-derived into `factors` / `biomaterials` just below — sending
  // them back on the PUT would double the body with a stale copy of
  // what we just recomposed.
  const {
    id: _wireId,
    name: _wireName,
    experimental_factors: _wireFactors,
    bio_material_assignments: _wireAssignments,
    ...carried
  } = g2;

  return {
    ...carried,
    experiment_id:
      typeof experimentId === "number" ? experimentId : Number(experimentId),
    experiment_short_name: experimentShortName,
    factors,
    biomaterials,
    // Overlay tags (from the latest pending proposal) win when
    // present — that lets the curator preview the agent's tag
    // suggestions on the design. When no overlay, fall back to the
    // saved EE-level tags from ``g2`` (what local_api returns; real
    // Gemma 2.0 may or may not emit them yet). Empty in both → no
    // tags. Pre-2026-05-23 this was ``overlay?.tags ?? []`` which
    // dropped the saved tags on the floor and caused the banner's
    // ModalityIndicator to misclassify single-cell studies as bulk.
    tags: overlay?.tags ?? g2.tags ?? [],
    // Publications copy-through. composeCurationDesign was building
    // a fresh Design from g2 + overlay + meta but had never been
    // taught about the design's `publications` field — so the
    // OverviewPanel "Publications" card and the PrePublishChecklist
    // both rendered as empty even when the local API returned a
    // populated PMID list. Fixed 2026-06-11 (design review GSE102415).
    publications: g2.publications ?? [],
    external_source: externalSource ?? null,
    // 🛑 `||`, not `??`, and the dataset row as the fallback.
    //
    // Gemma's ExperimentalDesign carries `name: ""` — an EMPTY STRING,
    // which `??` passes straight through — on every dataset checked, so
    // the composed design had no title and the page rendered "experiment
    // 517" where "GSE6306 · Sample Matching by Inferred Agonal Stress…"
    // belongs. The real title is on `/rest/v2/datasets/{id}`, which this
    // adapter already fetches for the taxon and platform.
    //
    // Design first so local mode is untouched: the store's design
    // payload carries both fields directly.
    title: g2.name || meta?.name || undefined,
    // 🛑 The dataset's `description` is the ABSTRACT. The design
    // payload's is the ExperimentalDesign's own blurb, which on Gemma
    // is the GEO "Overall design" line and nothing else:
    //
    //   /datasets/517         description "Gene expression patterns in
    //                                      the brain are strongly…"
    //   /datasets/517/design  description " Overall design: Agonal
    //                                      Stress Rating comparison"
    //
    // Taking the design's first put the overall-design line in the
    // abstract slot — and `OverviewPanel` then LIFTS that line out into
    // its own "design (GEO)" row and removes it from the body, so the
    // description rendered as "(no description — click to add)" on a
    // dataset with a full abstract.
    //
    // So the abstract wins, and the design's own description becomes
    // the overall design when it is not already set. Local mode is
    // untouched: the store's dataset row carries no `description` at
    // all, so `abstract` is empty there and both fields read exactly as
    // they did.
    description: abstract || g2.description || undefined,
    overall_design:
      g2.overall_design ||
      (abstract ? g2.description || undefined : undefined) ||
      undefined,
    taxon: taxonLabel(meta),
    // 🛑 `assay` has NO Gemma equivalent and is not going to get one.
    // It is GEO's `gdstype` sentence, fetched from eutils by the store's
    // preboarding pass; Gemma's nearest record is the SOFT-derived
    // source metadata, which does not carry it and is not on the dataset
    // REST surface (gembro, 2026-08-28). Blank in remote mode is the
    // truth, not a gap to fill.
    assay: meta?.assay ?? "",
    // Flat scalars from the store, `platforms[]` / `originalPlatforms[]`
    // from Gemma — see lib/platform.ts. Carries `technology_type` too,
    // resolved from the dataset or, when its platforms disagree, from
    // the platforms themselves. Gemma answered null for that field on
    // 300 of 300 until 2026-08-28.
    ...platformFields(meta),
    loaded_at: meta?.date_created ?? undefined,
    // `gold_data_version` / `annotation_version` / `baseline` used to be
    // copied through by hand here. They ride in `...carried` now, along
    // with everything else — which is the whole point of the change.
  };
}

function composeFactor(
  ef: G2ExperimentalFactor,
  fvOverlay: NonNullable<CurationProposalOverlay["factor_values"]>,
  samplesByFvId: Map<number, string[]>,
): Factor {
  const category: OntologyTerm = {
    label: ef.category?.category ?? ef.name ?? "",
    uri: ef.category?.category_uri ?? null,
  };
  const factor_values: FactorValue[] = (ef.values ?? []).map((v) => {
    const ov = fvOverlay[v.id] ?? {};
    const fromAssignments = samplesByFvId.get(v.id) ?? [];
    return {
      id: v.id,
      free_text_label: v.summary || v.value || "",
      is_baseline: ov.is_baseline ?? v.is_baseline ?? false,
      statements: composeFvStatements(v),
      // Overlay wins when populated — proposal payload typically
      // carries the canonical curator-blessed assignment. Fall back
      // to the assignments table from the canonical /design.
      biomaterial_short_names:
        ov.biomaterial_short_names && ov.biomaterial_short_names.length
          ? ov.biomaterial_short_names
          : fromAssignments,
      numeric_value: v.is_measurement
        ? parseNumeric(v.value ?? v.summary ?? "")
        : null,
    };
  });
  return {
    id: ef.id,
    name: ef.name ?? "",
    category,
    description: ef.description ?? "",
    type: (ef.type === "continuous" ? "continuous" : "categorical") as FactorType,
    factor_values,
  };
}

/** Build a Factor from a proposal-payload ``proposed_factors`` entry.
 *  Used when the canonical /design has zero factors — the proposal is
 *  the only source of factor shape. Synthesises negative ids so they
 *  don't collide with real Gemma factor ids when the proposal lands
 *  for real later. */
function materialiseProposedFactor(
  pf: ProposedFactorOverlay,
  fi: number,
): Factor {
  const categoryLabel = (pf.category ?? "").trim();
  const factor_values: FactorValue[] = (pf.factor_values ?? []).map(
    (pfv, vi) => materialiseProposedFv(pfv, fi, vi),
  );
  return {
    id: -(fi + 1),
    name: categoryLabel,
    category: { label: categoryLabel, uri: pf.category_uri ?? null },
    description: "",
    type: (pf.factor_type === "continuous" ? "continuous" : "categorical") as FactorType,
    factor_values,
  };
}

function materialiseProposedFv(
  pfv: ProposedFactorValueOverlay,
  fi: number,
  vi: number,
): FactorValue {
  return {
    id: -((fi + 1) * 1000 + (vi + 1)),
    free_text_label: (pfv.label ?? "").trim(),
    is_baseline: !!pfv.is_baseline,
    statements: (pfv.statements ?? []).map(materialiseProposedStatement),
    biomaterial_short_names: [...(pfv.samples ?? [])],
    numeric_value: null,
  };
}

function materialiseProposedStatement(
  ps: ProposedStatementOverlay,
): Statement {
  const hasPredicate = !!(ps.predicate_label || ps.predicate_uri);
  const hasObject = !!(ps.object_label || ps.object_uri);
  return {
    category: { label: "", uri: null },
    subject: {
      label: ps.subject_label ?? "",
      uri: ps.subject_uri ?? null,
    },
    predicate: hasPredicate
      ? { label: ps.predicate_label ?? "", uri: ps.predicate_uri ?? null }
      : null,
    object: hasObject
      ? { label: ps.object_label ?? "", uri: ps.object_uri ?? null }
      : null,
  };
}


/** A factor value's annotations, merged by id.
 *
 *  🛑 **A characteristic and a statement are THE SAME ROW** (Paul,
 *  2026-08-28). `statements` is not a second collection beside
 *  `characteristics` — it is the subset of them that carries a
 *  predicate, serialized with the subject columns renamed:
 *
 *      characteristic   id · category · value   · valueUri
 *      statement        id · category · subject · subjectUri · predicate · object
 *
 *  The wire proves it: on ee 1658 FV 77277 the characteristic and the
 *  statement are both id `30133596`, same term, same URI. Measured over
 *  698 factor values in 60 datasets, statement ids are a subset of
 *  characteristic ids on 42 of 42 FVs that have both, and never once a
 *  set the characteristics do not contain.
 *
 *  So a plain grounded value ships `statements: []` and lives entirely
 *  in `characteristics` —
 *
 *      FV 3598  summary "nucleus accumbens"  statements []
 *               characteristics [{ value "nucleus accumbens",
 *                                  valueUri UBERON_0001882 }]
 *
 *  — and reading only `statements` left it with a bare
 *  `free_text_label`, so every surface that asks "is this grounded"
 *  read a real UBERON term as free text. That is the ORDINARY shape for
 *  a simple value, not an edge case: all six of ee 517's organism-part
 *  values are it.
 *
 *  ⚠️ Merged by id rather than "statements win", which is the same
 *  answer on every FV measured and is right for a different reason: an
 *  FV whose characteristics are only PARTLY predicated would lose the
 *  rest under a wholesale swap. Zero of 698 had that shape — but zero
 *  measured is not zero possible, and the merge cannot drop a row
 *  whatever the wire does next.
 *
 *  The browser app already knew the underlying fact (`DatasetPage.tsx`:
 *  "FVs with no S-P-O statements still carry ontology identity in their
 *  characteristics"). This side did not. */
function composeFvStatements(v: G2FactorValue): Statement[] {
  const byId = new Map<number, Statement>();
  const bySubject = new Map<string, Statement>();
  /** The term a row names, for joining a statement that arrived
   *  without an id. A characteristic and the statement predicating it
   *  name the same term, so this is the row's own identity, not a
   *  guess about which rows go together. */
  const termKey = (label: string, uri: string | null) =>
    `${label.trim().toLowerCase()}|${uri ?? ""}`;
  const out: Statement[] = [];
  for (const c of v.characteristics ?? []) {
    if (!c) continue;
    if (!(c.value ?? "").trim() && !c.value_uri) continue;
    const s: Statement = {
      category: { label: c.category ?? "", uri: c.category_uri ?? null },
      subject: { label: c.value ?? "", uri: c.value_uri ?? null },
      predicate: null,
      object: null,
    };
    out.push(s);
    if (typeof c.id === "number") byId.set(c.id, s);
    bySubject.set(termKey(c.value ?? "", c.value_uri ?? null), s);
  }
  for (const raw of v.statements ?? []) {
    if (!raw) continue;
    const composed = composeStatement(raw);
    // The predicated reading of a characteristic already listed
    // REPLACES it in place — same row, more said about it. Joined on
    // the shared id, which the wire always carries; on the term itself
    // when it does not, so a missing id cannot double the row.
    const seat =
      (typeof raw.id === "number" ? byId.get(raw.id) : undefined) ??
      bySubject.get(termKey(raw.subject ?? "", raw.subject_uri ?? null));
    const at = seat ? out.indexOf(seat) : -1;
    if (at >= 0) out[at] = composed;
    else out.push(composed);
  }
  return out;
}

function composeStatement(s: G2Statement): Statement {
  return {
    category: {
      label: s.category ?? "",
      uri: s.category_uri ?? null,
    },
    subject: {
      label: s.subject ?? "",
      uri: s.subject_uri ?? null,
    },
    predicate: s.predicate
      ? { label: s.predicate, uri: s.predicate_uri ?? null }
      : null,
    object: s.object
      ? { label: s.object, uri: s.object_uri ?? null }
      : null,
  };
}

/** Pull the GEO short-name (or similar trailing token) out of
 *  Gemma's biomaterial name shape "GSE2018_bioMaterial_7|GSM36429".
 *  Returns the whole string when no delimiter is present. */
function parseShortName(name: string): string {
  const pipe = name.lastIndexOf("|");
  if (pipe < 0) return name;
  return name.slice(pipe + 1) || name;
}

function parseNumeric(s: string): number | null {
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
