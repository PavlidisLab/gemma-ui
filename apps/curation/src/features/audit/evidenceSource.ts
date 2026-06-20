import type { FindingEvidence } from "@/api/auditTypes";

/**
 * Per-source presentation for a verbatim evidence quote. Curators read
 * the *type* of provenance (a BM characteristic vs a paper sentence vs
 * a catalog inference) at a glance via a stable colour, not just the
 * label text. Centralised here so every evidence surface — the audit
 * finding blocks, the tag-chip popover — stays in lockstep instead of
 * each re-deriving the label/colour. Per Paul 2026-06-18
 * (UIB_HANDOFF_..._TAG_EVIDENCE_QUOTES): "quotes clearly identifiable
 * by type + colour."
 *
 * Colour axis is deliberately disjoint from the codebase-wide
 * "emerald = ontology-backed" cue — no source uses green.
 */
export type EvidenceSourceKey = FindingEvidence["source"];

export interface EvidenceSourceMeta {
  /** Curator-facing source label (chip text). GEO-curator vocabulary,
   *  not the wire enum — per UIB_HANDOFF_2026_06_19_EVIDENCE_SOURCE_LABELS. */
  label: string;
  /** Long-form hover description — the full "what is this pointing at". */
  description: string;
  /** Left-border accent on the blockquote / popover row. */
  borderCls: string;
  /** Source-label header text colour. */
  headerCls: string;
  /** Link colour for the optional "open ↗" source_url. */
  linkCls: string;
  /** Soft background tint for the expanded-context block. */
  contextBgCls: string;
  /** Optional small badge (e.g. a catalog inference isn't a direct
   *  quote — flag it so curators don't read it as verbatim source
   *  text). */
  badge?: string;
}

const BASE: Record<EvidenceSourceKey, EvidenceSourceMeta> = {
  // BM characteristic — the most direct, trustworthy provenance.
  characteristic: {
    label: "sample characteristic",
    description:
      "From a GEO sample characteristic row — every sample's " +
      "BioMaterial.characteristics dict carries (key, value) pairs the " +
      "GEO submitter recorded.",
    borderCls: "border-sky-300 dark:border-sky-600",
    headerCls: "text-sky-700/90 dark:text-sky-300/90",
    linkCls: "text-sky-700/90 hover:text-sky-900 dark:text-sky-300",
    contextBgCls: "bg-sky-50/70 dark:bg-sky-900/30",
  },
  paper: {
    label: "paper",
    description: "From the linked publication's text.",
    borderCls: "border-violet-300 dark:border-violet-600",
    headerCls: "text-violet-700/90 dark:text-violet-300/90",
    linkCls: "text-violet-700/90 hover:text-violet-900 dark:text-violet-300",
    contextBgCls: "bg-violet-50/70 dark:bg-violet-900/30",
  },
  geo_metadata: {
    label: "GEO metadata",
    description:
      "From GEO sample metadata outside the characteristics dict " +
      "(protocols, source name, treatment description, etc.).",
    borderCls: "border-teal-300 dark:border-teal-600",
    headerCls: "text-teal-700/90 dark:text-teal-300/90",
    linkCls: "text-teal-700/90 hover:text-teal-900 dark:text-teal-300",
    contextBgCls: "bg-teal-50/70 dark:bg-teal-900/30",
  },
  sample_names: {
    label: "sample names",
    description:
      "From the sample short-name pattern (e.g. `Sox2_KO_brain_rep1`).",
    borderCls: "border-amber-300 dark:border-amber-600",
    headerCls: "text-amber-700/90 dark:text-amber-300/90",
    linkCls: "text-amber-700/90 hover:text-amber-900 dark:text-amber-300",
    contextBgCls: "bg-amber-50/70 dark:bg-amber-900/30",
  },
  preboarding: {
    label: "lab catalog",
    description:
      "From a lab-maintained catalog (Cellosaurus cell-line catalog, " +
      "TGEMO derivations, value-string mappings).",
    borderCls: "border-indigo-300 dark:border-indigo-600",
    headerCls: "text-indigo-700/90 dark:text-indigo-300/90",
    linkCls: "text-indigo-700/90 hover:text-indigo-900 dark:text-indigo-300",
    contextBgCls: "bg-indigo-50/70 dark:bg-indigo-900/30",
  },
};

/** Neutral fallback for an unrecognized / missing ``source``. Used to
 *  stay deliberately non-committal: defaulting an unknown provenance to
 *  "sample characteristic" (the most authoritative label) misrepresents
 *  it — Paul 2026-06-19, after a paper/GEO quote mislabelled
 *  ``characteristic`` slipped through. A grey "source" chip says "we
 *  don't know where this came from" instead of vouching for it. */
const NEUTRAL: EvidenceSourceMeta = {
  label: "source",
  description: "Provenance not specified by the producer.",
  borderCls: "border-slate-300 dark:border-slate-600",
  headerCls: "text-slate-600/90 dark:text-slate-300/90",
  linkCls: "text-slate-600/90 hover:text-slate-900 dark:text-slate-300",
  contextBgCls: "bg-slate-50/70 dark:bg-slate-800/40",
};

/**
 * Resolve presentation for one evidence row. ``location`` is consulted
 * for the one special case the wire encodes positionally today: a
 * Cellosaurus catalog inference ships as ``source="preboarding"`` +
 * ``location="cellosaurus_catalog"`` (no dedicated ``source`` literal
 * yet — see the handoff's out-of-scope note). We relabel + badge it so
 * curators don't mistake an inferred fact for a verbatim quote.
 */
export function evidenceSourceMeta(
  source: EvidenceSourceKey,
  location?: string | null,
): EvidenceSourceMeta {
  if (
    source === "preboarding" &&
    (location ?? "").trim().toLowerCase() === "cellosaurus_catalog"
  ) {
    // Label stays "lab catalog" (curator vocab); a badge names the
    // specific catalog so the inferred-not-verbatim nature is clear.
    return { ...BASE.preboarding, badge: "Cellosaurus" };
  }
  // Unknown / missing source → neutral grey "source", never the
  // authoritative "sample characteristic" default (Paul 2026-06-19).
  return BASE[source] ?? NEUTRAL;
}
