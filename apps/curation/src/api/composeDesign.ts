/**
 * Adapter that composes the curation `Design` from two Gemma 2.0
 * endpoints — per bro's reply on
 * ``CURATION_TO_GEMMA_2_0_HANDOFF.md`` §2 (filed 2026-05-23):
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
}

export interface G2Design {
  id?: number;
  name?: string | null;
  description?: string | null;
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
}

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
export interface DatasetMetaSlim {
  taxon_common_name?: string | null;
  technology_type?: string | null;
  assay?: string | null;
  platform?: string | null;
  platform_short_name?: string | null;
  platform_id?: number | null;
  original_platform?: string | null;
  original_platform_short_name?: string | null;
  original_platform_id?: number | null;
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

  let factors: Factor[] = (g2.experimental_factors ?? []).map((ef) =>
    composeFactor(ef, fvOverlay, samplesByFvId),
  );

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
      };
    },
  );

  return {
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
    // populated PMID list. Fixed 2026-06-11 (Paul GSE102415).
    publications: g2.publications ?? [],
    external_source: externalSource ?? null,
    title: g2.name ?? undefined,
    description: g2.description ?? undefined,
    taxon: meta?.taxon_common_name ?? "",
    technology_type: meta?.technology_type ?? "",
    assay: meta?.assay ?? "",
    platform: meta?.platform ?? "",
    platform_short_name: meta?.platform_short_name ?? "",
    platform_id: meta?.platform_id ?? null,
    original_platform: meta?.original_platform ?? "",
    original_platform_short_name: meta?.original_platform_short_name ?? "",
    original_platform_id: meta?.original_platform_id ?? null,
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
      statements: (v.statements ?? []).map(composeStatement),
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
