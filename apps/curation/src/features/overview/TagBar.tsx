/**
 * The Overview's TAGS block — the chips, their grouping into
 * reproducible rows, the three view filters (inherited / free-text /
 * variables), and the inline add/edit affordances on direct tags.
 *
 * Extracted from ``OverviewPanel.tsx`` 2026-08-09, when that file was
 * 4260 lines and ~512 KB of transpiled output that the dev server
 * re-parsed on every navigation. This family is 2200 of those lines
 * and has exactly one inbound edge — ``<TagBar>`` on the Overview — so
 * it moves whole. Pure move: no behaviour, palette, or filter rule
 * changed here.
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  StatementEditModal,
  type StatementDraft,
} from "@/components/ui/StatementEditModal";
import { useDatasetTaxon, useDesignDraft } from "@/features/design/DesignDraftContext";
import { GeneSpeciesMark } from "@/components/ui/GeneSpeciesMark";
import { isGeneUri, parseGeneLabel } from "@/lib/gene";
import { CurieLink } from "@/components/ui/CurieLink";
import { Term } from "@/components/ui/Term";
import { HelpPopup } from "@/components/ui/HelpPopup";
import { CategoryPicker } from "@/features/design/CategoryPicker";
import { OntologyTermPicker } from "@/features/design/OntologyTermPicker";
import { useIsReadOnly } from "@/features/comparison/FlowContext";
import { useStickyState } from "@/lib/useStickyState";
import { shortenUri } from "@/lib/curie";
import { cn } from "@/lib/cn";
import { ONTOLOGY_ANCHOR_CLS } from "@/lib/ontologyAnchor";
import { AuditDot } from "@/features/audit/AuditDot";
import { ProvenanceDot } from "@/features/provenance/ProvenanceDot";
import { tagRefId } from "@/features/provenance/refs";
import { EvidenceTrigger } from "@/features/audit/EvidencePopover";
import { augmentInferredFromBiomaterials } from "./augmentInferred";
import { augmentInferredFromFactors } from "./augmentFactorTags";
import { isProtectedTagCategory } from "@/features/experiment/types";
import { FactorsRow } from "./factorChips";
import {
  addTag,
  deleteTag,
  setTagCategory,
  setTagStatements,
  setTagValue,
} from "@/features/design/mutations";
import { buildConstancyIndex, isVariableInferredTag } from "./constantAnnotations";
import { hiddenFreeTextValueCount, visibleTagValues } from "./tagFreeTextFilter";
import { experimentTarget, factorTarget, tagTarget } from "@/features/audit/targetIds";
import { requestAuditFocus } from "@/lib/scrollToAuditTarget";
import type {
  Biomaterial,
  OntologyTerm,
  Statement,
  Tag,
} from "@/features/experiment/types";
/** Inferred-tag categories that pollute the panel without informing
 *  the curator.
 *
 *  - ``individual`` ships as a sample-id list (e.g. ``101, 102, 103,
 *    …``) that swamps the bar.
 *  - ``labelling`` / ``labeling`` is almost always ``biotin`` on
 *    legacy Affymetrix arrays — universal, uninformative, noise. (If
 *    a curator ever attaches it as a *direct* tag, that's an
 *    explicit choice and stays visible — only the inferred form is
 *    filtered.) */
const INFERRED_HIDE_CATEGORIES = new Set<string>([
  "individual",
  "labelling",
  "labeling",
]);

/** Reproducible-position grouping for tag chips. The TagBar's flat
 *  row was unscannable on heavily-tagged experiments (20+ chips of
 *  mixed semantics in one wrap). Categories now bucket into themed
 *  rows so curators always look in the same spot for the same kind
 *  of annotation:
 *
 *    - assay            → modality / technology / analyte
 *    - condition        → disease / treatment / exposure
 *    - sample source    → where the sample came from (organism part,
 *                         cell type, BioSource)
 *    - subject features → properties of the subject (sex, age,
 *                         strain, genotype, ancestry, …)
 *    - admin            → sample identifiers / replicate structure
 *
 *  Anything not in the explicit lists falls into ``other``, which
 *  renders last. Lookups are lowercase + trimmed; both the singular
 *  and the British / American spellings live in the same set when
 *  Gemma's catalogue carries both.
 *
 *  Order of declaration here is the on-screen row order. */
type TagGroupKey =
  | "assay"
  | "condition"
  | "sample_source"
  | "subject_features"
  | "admin"
  | "other";

const TAG_GROUP_LABEL: Record<TagGroupKey, string> = {
  assay: "assay",
  condition: "condition",
  sample_source: "sample source",
  subject_features: "subject features",
  admin: "admin",
  other: "other",
};

const TAG_GROUP_ORDER: TagGroupKey[] = [
  "assay",
  "condition",
  "sample_source",
  "subject_features",
  "admin",
  "other",
];

const TAG_CATEGORY_TO_GROUP: Record<string, TagGroupKey> = {
  // assay
  assay: "assay",
  modality: "assay",
  technology: "assay",
  "molecular entity": "assay",
  analyte: "assay",
  library: "assay",
  "library strategy": "assay",
  "library selection": "assay",
  // condition
  disease: "condition",
  treatment: "condition",
  exposure: "condition",
  intervention: "condition",
  "culture condition": "condition",
  perturbation: "condition",
  // sample source — where the cells / tissue came from
  "organism part": "sample_source",
  "cell type": "sample_source",
  "cell line": "sample_source",
  biosource: "sample_source",
  source: "sample_source",
  // subject features — properties of the donor / model organism
  "biological sex": "subject_features",
  sex: "subject_features",
  age: "subject_features",
  "developmental stage": "subject_features",
  "life stage": "subject_features",
  population: "subject_features",
  ancestry: "subject_features",
  ethnicity: "subject_features",
  strain: "subject_features",
  "background strain": "subject_features",
  genotype: "subject_features",
  // admin (sample-management identifiers + replicate structure)
  "author sample id": "admin",
  "author reference id": "admin",
  "biological replicate": "admin",
  "technical replicate": "admin",
  "sample group": "admin",
  donor: "admin",
  subject: "admin",
};

function tagGroup(category: string | undefined | null): TagGroupKey {
  const k = (category || "").trim().toLowerCase();
  return TAG_CATEGORY_TO_GROUP[k] ?? "other";
}

/** Legend body for the TagBar's `?` popover. Mirrors the live chip
 *  shape (single-frame, palette = source, weight + italic = resolved
 *  vs free-text) so the legend can't drift from what curators
 *  actually see. */
function TagBarLegend() {
  const Sample = ({
    palette,
    val,
    italic,
    mark,
  }: {
    palette: keyof typeof TAG_PALETTE;
    val: string;
    italic?: boolean;
    /** Trailing marker glyph, matching the live chip (e.g. the amber
     *  ``Δ`` a direct free-text value carries). */
    mark?: string;
  }) => {
    const p = TAG_PALETTE[palette];
    return (
      <span
        className={`inline-flex items-baseline gap-1 px-1.5 py-0.5 text-[11px] rounded border ${p.outer}`}
      >
        <span
          className={italic ? "italic opacity-80" : "font-medium"}
        >
          {val}
        </span>
        {mark ? (
          <span className="text-[10px] leading-none font-medium text-amber-700 dark:text-amber-400">
            {mark}
          </span>
        ) : null}
      </span>
    );
  };
  return (
    <div className="space-y-2 text-[11px]">
      <div className="font-medium text-slate-700 dark:text-slate-200">
        Border colour = where the tag came from
      </div>
      <div className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1.5 items-center">
        <Sample palette="direct" val="female" />
        <span>
          <span className="font-medium">Direct</span> — curator-attached.
          Click to edit / delete.
        </span>
        <Sample palette="fv" val="LPS" />
        <span>
          <span className="font-medium">FV-synth</span> — derived from a
          Factor Value on the Design tab. Edit on Design.
        </span>
        <Sample palette="bm" val="brain" />
        <span>
          <span className="font-medium">BM-synth</span> — pulled from raw
          biomaterial characteristics (Gemma's GEO import).
        </span>
        <Sample palette="mixed" val="microglial cell" />
        <span>
          <span className="font-medium">Mixed</span> — the category
          surfaces from more than one source.
        </span>
      </div>
      <div className="pt-1 border-t border-slate-100 dark:border-slate-800">
        <div className="font-medium text-slate-700 dark:text-slate-200 mb-1">
          Typography = whether the value is anchored
        </div>
        <div className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1.5 items-center">
          <Sample palette="bm" val="brain" />
          <span>
            <span className="font-medium">Medium weight</span> —
            ontology-resolved. Click the CURIE to open the term
            popover.
          </span>
          <Sample palette="bm" val="Laser captured…" italic />
          <span>
            <span className="italic">Italic</span> — free text, no
            ontology URI yet.
          </span>
          <Sample palette="direct" val="pLX304 empty vector" italic mark="Δ" />
          <span>
            <span className="font-medium text-amber-700 dark:text-amber-400">
              Δ
            </span>{" "}
            — <span className="font-medium">needs grounding</span>. Free
            text is allowed on a direct tag: the term may not exist yet,
            or just hasn&apos;t been found. Usually it&apos;s the latter.
            The marker says the tag isn&apos;t finished, not that
            it&apos;s wrong — and these are never hidden by{" "}
            <span className="font-medium">Hide free-text</span>.
          </span>
        </div>
      </div>
      <div className="pt-1 border-t border-slate-100 dark:border-slate-800">
        <div className="font-medium text-slate-700 dark:text-slate-200 mb-1">
          Other details
        </div>
        <ul className="list-disc list-inside space-y-0.5 text-slate-600 dark:text-slate-400">
          <li>
            Category, source name, CURIE, evidence code, and full value
            text all live in the chip's <span className="italic">hover
            tooltip</span> — kept off the chip face to cut visual noise.
          </li>
          <li>
            Bracketed qualifiers like{" "}
            <span className="font-mono">M0 [Cells grown in…]</span> are
            stripped from the chip face; hover for the full text.
          </li>
          <li>
            Every term shows as its own chip — nothing is collapsed
            into a count. Use{" "}
            <span className="font-medium">Hide inherited</span> /{" "}
            <span className="font-medium">Hide free-text</span> above to
            thin a busy row.
          </li>
          <li>
            <span className="font-medium">Hide variables</span> (on by
            default) keeps only the inherited annotations that are true
            of EVERY sample. The ones that vary — factor levels,
            per-sample characteristics — are the design, and the factor
            chips below already carry them. Uncheck to see them here
            too. Direct tags are never hidden by it.
          </li>
          <li>
            A <span className="text-violet-500 dark:text-violet-400">violet
            glint</span> on a direct chip means every sample already carries
            that exact ontology term as a characteristic — the tag is
            redundant with the per-sample annotation (the tag still wins;
            the glint just flags it). A grounded tag over free-text
            characteristics is NOT redundant, so it does not glint.
          </li>
        </ul>
      </div>
    </div>
  );
}

/** Context for chip-level edit requests. EditableDirectGroupChip
 *  consumes this and fires ``openEditTag(tag)`` when the curator
 *  clicks an existing chip; TagBar provides the implementation and
 *  hoists the modal so popover positioning + the draft snapshot live
 *  at one level. */
interface TagEditCtxValue {
  openEditTag: (tag: Tag) => void;
}
const TagEditCtx = createContext<TagEditCtxValue | null>(null);
function useTagEditContext(): TagEditCtxValue | null {
  return useContext(TagEditCtx);
}

/** Convert a Tag (the UI's internal shape) into the modal's
 *  StatementDraft. Tag.statements[] becomes the (predicate, object)
 *  pair list; the modal doesn't echo the subject inside each pair
 *  since subject==tag.value per the wire spec. */
function tagToDraft(tag: Tag): StatementDraft {
  return {
    category: { label: tag.category.label, uri: tag.category.uri ?? null },
    subject: { label: tag.value.label, uri: tag.value.uri ?? null },
    pairs: (tag.statements ?? []).map((s) => ({
      predicate: s.predicate ?? null,
      object: s.object ?? null,
    })),
  };
}

/** Convert a StatementDraft into the Statement[] the Tag stores. The
 *  subject mirrors the draft's subject; pairs with neither predicate
 *  nor object are dropped. */
function draftToStatements(draft: StatementDraft): Statement[] {
  return draft.pairs
    .filter((p) => p.predicate?.label || p.object?.label)
    .map((p) => ({
      category: draft.category,
      subject: draft.subject,
      predicate: p.predicate,
      object: p.object,
    }));
}

export function TagBar({
  tags,
  biomaterials,
  experimentId,
}: {
  tags: Tag[];
  biomaterials: Biomaterial[];
  /** Experiment id, threaded down to FV-synth chips so their ``ƒ``
   *  glyph can dispatch a Shell focus request to jump to the Design
   *  tab with that factor highlighted. */
  experimentId: number | string;
}) {
  const { draft, apply, diff } = useDesignDraft();
  // Review-mode lock: only the "+ tag" + chip remove + StatementEditModal
  // mutate state. Expand/collapse, legend popup, and chip select
  // stay live so the curator can still read.
  const tagReadOnly = useIsReadOnly();
  // Free-text filter: heavily-annotated experiments bury the few
  // ontology-resolved chips under dozens of unresolved free-text values
  // (raw numbers, dates, batch ids, yes/no flags). This global sticky
  // preference collapses the view to just the ontology-anchored chips.
  // On by default (design review 2026-07-20) — free text is noise most of the
  // time; the curator toggles it back on per session and the pref
  // sticks app-wide.
  const [hideFreeText, setHideFreeText] = useStickyState<boolean>(
    "overview.tags.hideFreeText",
    true,
  );
  // Inherited (inferred) filter: chips bubbled up from sample
  // characteristics / FV statements repeat what the Design tab already
  // encodes and swamp the header on richly-annotated EEs. On by default
  // (design review 2026-07-20) so the header shows the curator's OWN direct tags;
  // flip it on to see everything the design implies. Also the safety
  // valve for the now-uncollapsed high-cardinality inferred groups
  // (30+ cell types) — they stay hidden until explicitly shown. Sticky
  // app-wide, same as the free-text pref.
  const [hideInferred, setHideInferred] = useStickyState<boolean>(
    "overview.tags.hideInferred",
    true,
  );
  // Variables filter: an inherited chip that applies to only SOME
  // samples is the design re-rendered as tags. GSE41840 put five ƒ
  // ``exposure to …`` chips in the CONDITION row — the levels of a
  // ``treatment`` factor whose own chip sits two rows down carrying all
  // six. The question this row answers is "what constant properties are
  // already annotated", so variables are off by default and one click
  // away. Sticky app-wide like the other two.
  const [hideVariables, setHideVariables] = useStickyState<boolean>(
    "overview.tags.hideVariables",
    true,
  );
  // Modal state: ``mode`` distinguishes add (no tag id yet) vs edit
  // (existing tag id). Initial draft is rebuilt on every open from the
  // tag at the moment of click — guarantees the modal can't show stale
  // state if the curator opens, cancels, mutates elsewhere, then
  // reopens the same chip.
  const [modalState, setModalState] = useState<
    | { mode: "add" }
    | { mode: "edit"; tagId: number; initial: StatementDraft }
    | null
  >(null);
  const openEditTag = (tag: Tag) => {
    setModalState({ mode: "edit", tagId: tag.id, initial: tagToDraft(tag) });
  };
  const editCtxValue: TagEditCtxValue = { openEditTag };

  const addInitial: StatementDraft = {
    category: { label: "", uri: null },
    subject: { label: "", uri: null },
    pairs: [],
  };
  async function handleSave(saved: StatementDraft) {
    if (!draft) return;
    if (modalState?.mode === "add") {
      const { design: afterAdd, tagId } = addTag(draft);
      let next = setTagCategory(afterAdd, tagId, saved.category);
      next = setTagValue(next, tagId, saved.subject);
      next = setTagStatements(next, tagId, draftToStatements(saved));
      apply(next);
    } else if (modalState?.mode === "edit") {
      let next = setTagCategory(draft, modalState.tagId, saved.category);
      next = setTagValue(next, modalState.tagId, saved.subject);
      next = setTagStatements(next, modalState.tagId, draftToStatements(saved));
      apply(next);
    }
    setModalState(null);
  }
  // Set of tag ids that exist in the draft but not the saved server
  // state — these are uncommitted additions. Threaded down to the
  // chip render so the curator can see at a glance what they've
  // added but not yet committed. ``Tag.id`` is assigned by the
  // mutation helpers (addTag) at insertion time, so it's stable
  // across draft edits.
  const addedTagIds = useMemo(
    () => new Set(diff.tags.added.map((t) => t.id)),
    [diff.tags.added],
  );

  // Build a (category-label, value-label) → URI lookup from
  // ``biomaterial.characteristic_uris``. Used to recover the URI
  // on a tag value that came in as part of a comma-joined synth
  // (Gemma sometimes returns ``biological sex: "female, male"``
  // as one tag with URI null; the underlying per-sample
  // characteristic still has PATO terms attached). When the
  // split value matches a biomaterial characteristic, the URI
  // flows through and the value renders ontology-resolved.
  const charUriLookup = useMemo(() => buildCharUriLookup(biomaterials), [
    biomaterials,
  ]);

  // Build a (category-label, fv-label) → URI lookup from the draft's
  // factor value statements. FV-synth tags have comma-joined value
  // labels whose parts are CL/EFO terms, but charUriLookup only covers
  // biomaterial characteristics. This covers the gap so e.g.
  // "long term hematopoietic stem cell" resolves to its CL URI.
  const fvUriLookup = useMemo(() => {
    const map = new Map<string, string>();
    for (const factor of draft?.factors ?? []) {
      const catKey = (factor.category?.label || factor.name || "").trim().toLowerCase();
      for (const fv of factor.factor_values) {
        const label = (fv.free_text_label || "").trim().toLowerCase();
        if (!label) continue;
        for (const s of fv.statements) {
          const uri = s.subject?.uri;
          if (uri) {
            const k = `${catKey}|${label}`;
            if (!map.has(k)) map.set(k, uri);
            break;
          }
        }
      }
    }
    return map;
  }, [draft?.factors]);

  // (category-label, fv-label) → is_baseline lookup. Used to sort
  // baseline FVs to the END of a multi-value chip's preview — the
  // baseline is the implicit reference (mock / control / vehicle),
  // and the interesting comparison values should land first in
  // limited preview space (per design review, 2026-05-17).
  const baselineLookup = useMemo(() => {
    const set = new Set<string>();
    for (const factor of draft?.factors ?? []) {
      const catKey = (factor.category?.label || factor.name || "").trim().toLowerCase();
      for (const fv of factor.factor_values) {
        if (!fv.is_baseline) continue;
        const label = (fv.free_text_label || "").trim().toLowerCase();
        if (!label) continue;
        set.add(`${catKey}|${label}`);
      }
    }
    return set;
  }, [draft?.factors]);

  // Augment inferred tags from ``biomaterial.characteristics`` —
  // Gemma's annotation feed ships only one row per dataset for a
  // BM-source category, so a 6-region cohort surfaces only one
  // organism part. The biomaterials carry the full set; we walk
  // them and build a synth chip per category that captures every
  // distinct value across the cohort.
  //
  // Then layer the FV-projected synth chips from ``draft.factors``:
  // one chip per factor with the factor's FV labels comma-joined as
  // the value. Used to come from agents-side
  // ``import_from_gemma.py`` step 4a; that synthesis was retired on
  // 2026-06-10 because it
  // inflated eval F1 baselines as a factor-as-tag projection
  // artifact. The UI re-synthesises locally so the downstream dedup
  // (FV-synth wins over direct EE tags for the same category) keeps
  // working without any further changes here.
  // Inferred chips reflect per-sample reality: if every sample carries
  // an annotation, the inherited chip shows it. Removing the EE-level
  // direct tag no longer suppresses the inherited version — it surfaces
  // (purple) once the direct one is gone, so the curator still sees that
  // the samples carry it. Design review 2026-07-20 (supersedes the B3 removed-
  // category suppression; "Hide inherited" now governs visibility, and
  // the direct-wins dedup keeps the EE tag on top when both are present).
  const augmentedTags = useMemo(
    () =>
      augmentInferredFromFactors(
        augmentInferredFromBiomaterials(tags, biomaterials),
        draft?.factors ?? [],
      ),
    [tags, biomaterials, draft?.factors],
  );

  // ``category|value_uri`` keys that EVERY sample carries as a GROUNDED
  // biomaterial characteristic — i.e. an inherited EXACT ONTOLOGY-TERM
  // match across the whole cohort. Keyed on the per-sample ``value_uri``
  // (not the label): a tag is only redundant with the per-sample
  // annotation when the samples carry the SAME ontology term. When the
  // characteristics are free text (``characteristic_uris`` absent/null,
  // e.g. GSE38066 strain "C57BL/6NTac" with no URI) the grounded tag is
  // NOT redundant — it's the only grounding — so no key is emitted and no
  // glint fires (design review 2026-07-20). Redundancy cue only; the direct tag
  // still wins the direct-priority dedup.
  const universalCharTerms = useMemo(() => {
    const bms = biomaterials ?? [];
    if (bms.length === 0) return new Set<string>();
    const counts = new Map<string, number>();
    for (const bm of bms) {
      const uris = bm.characteristic_uris ?? {};
      const seen = new Set<string>();
      for (const cat of Object.keys(bm.characteristics ?? {})) {
        const vu = uris[cat]?.value_uri;
        if (!vu) continue;
        seen.add(`${(cat || "").trim().toLowerCase()}|${vu.trim()}`);
      }
      for (const k of seen) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const universal = new Set<string>();
    for (const [key, n] of counts) if (n === bms.length) universal.add(key);
    return universal;
  }, [biomaterials]);

  // Drop block / batch tags here — they're nuisance variables
  // (date_run codes, scan-batch ids, …) and a single batch
  // factor with 11+ levels swamps the bar. The batch factor
  // itself still shows on the Design tab; the curator doesn't
  // need to see every level on the overview header.
  // Which inherited categories are constant across the cohort — see
  // ``constantAnnotations.ts``. Built from the DRAFT's biomaterials +
  // factors so it tracks the curator's uncommitted edits.
  const constancy = useMemo(
    () => buildConstancyIndex(biomaterials, draft?.factors),
    [biomaterials, draft?.factors],
  );
  const visibleTags = augmentedTags.filter((t) => {
    const cat = (t.category.label || "").trim().toLowerCase();
    if (cat === "block" || cat === "batch") return false;
    if (t.inferred && INFERRED_HIDE_CATEGORIES.has(cat)) return false;
    // The variables filter runs HERE, before the dedup below, not at
    // render time. A direct tag is suppressed when an FV-synth chip
    // covers the same (category, value) — drop the FV chip later and
    // the value disappears from the row entirely, taking the curator's
    // own tag with it. Filtering first keeps the dedup's input equal to
    // what actually renders.
    if (hideVariables && isVariableInferredTag(t, constancy)) return false;
    return true;
  });

  // A direct experiment-level tag is redundant with the design ONLY
  // when its VALUE is actually one of the factor's FV values — e.g.
  // GSE208707 ships 8 ``cell type: <X>`` direct tags beside a
  // ``cell type`` factor whose FVs ARE those 8 cell types; the factor
  // encodes them, so hide the duplicate direct chips. Keying on the
  // CATEGORY alone (the old behaviour) was wrong: a ``genotype`` factor
  // whose FVs are mouse-model conditions (``NPp53 (Nkx3-1CreERT2/+;
  // Ptenf/f;p53f/f;…)``) does NOT make a ``genotype: Trp53`` gene tag
  // redundant — the gene is not an FV value — yet every direct genotype
  // tag was dropped, hiding real EE-tags the agent was proposing to
  // remove. So suppress a direct tag only when its (category, value)
  // matches a factor's FV value. Design review 2026-07-21 (GSE… 91268).
  const fvSynthValues = new Set<string>();
  for (const t of visibleTags) {
    if (!(t.inferred && t.inferred_source === "FactorValue")) continue;
    const catLc = (t.category.label || t.category.uri || "").toLowerCase();
    // FV-synth value is the FV labels comma-joined (same split the
    // renderer's ``splitTagValues`` uses).
    for (const part of (t.value.label || "").split(",")) {
      const p = part.trim().toLowerCase();
      if (p) fvSynthValues.add(`${catLc}|${p}`);
    }
  }
  const direct = visibleTags.filter((t) => {
    if (t.inferred) return false;
    // A statement-shaped EE-tag carries more than its bare value
    // (``genotype: Trp53 has_genotype Homozygous negative``) — never
    // suppress it, even if the bare value coincidentally matches an FV.
    if ((t.statements ?? []).length > 0) return true;
    const catLc = (t.category.label || t.category.uri || "").toLowerCase();
    const valLc = (t.value.label || "").trim().toLowerCase();
    return !fvSynthValues.has(`${catLc}|${valLc}`);
  });
  const inferred = visibleTags.filter((t) => t.inferred);

  // Dedup direct + inferred chips. Two rules, applied together
  // within each tag-group row (so an "organism part: microglial
  // cell" chip and a "cell type: microglial cell" chip both
  // landing in ``sample_source`` collapse to one):
  //
  //   1. Same ontology term (same URI) — redundant; keep the
  //      higher-priority chip. Direct > biomaterial-synth >
  //      FV-synth > anything-else.
  //   2. Free-text duplicate of a resolved ontology term — when
  //      a chip with a URI exists for the same value-label in the
  //      same group, drop the free-text duplicate. Ontology-
  //      resolved chips win because they carry the verifiable
  //      identity. Per design review 2026-05-21: "ontology terms are the
  //      best, so just hide free text ones, and same-ontology-
  //      term are redundant."
  //
  // The dedup runs across direct + inferred together so a direct
  // free-text "microglial cell" can be hidden by an inferred URI-
  // bearing "microglial cell" within the same row, and vice versa.
  const groupKeyOf = (t: Tag): string => tagGroup(t.category.label) as string;
  const valLabelLc = (t: Tag) => (t.value.label || "").trim().toLowerCase();
  const sourceRank = (t: Tag): number => {
    if (!t.inferred) return 0;
    if (t.inferred_source === "BioMaterial") return 1;
    if (t.inferred_source === "FactorValue") return 2;
    return 3;
  };
  // Effective URI: prefer the tag's own ``value.uri``; fall back to
  // the biomaterial characteristic URI lookup (synth tags built by
  // ``augmentInferredFromBiomaterials`` ship with null URIs because
  // the augmenter doesn't carry them; the URI is recovered at chip-
  // render time via ``splitTagValues``). Without this fallback,
  // dedup-by-URI misses the case where two synth tags built from
  // different BM characteristic columns map to the same ontology
  // term — Design review 2026-06-12: "redundant terms should be hidden; this
  // is coming from two separate biomaterial char columns"
  // (``BioSource: microglial cell CL:0000129`` +
  // ``organism part: microglial cell CL:0000129``).
  const effectiveUri = (t: Tag): string | null => {
    if (t.value.uri) return t.value.uri;
    const catKey = (t.category.label || "").trim().toLowerCase();
    const valKey = (t.value.label || "").trim().toLowerCase();
    return charUriLookup.get(`${catKey}|${valKey}`) ?? null;
  };
  // Canonical-category preference: when two tags in the same row
  // resolve to the same effective URI, prefer the one whose category
  // is a canonical Gemma category over a GEO-imported one. Lower
  // rank wins.
  const CANONICAL_SAMPLE_SOURCE_CATEGORIES = new Set([
    "organism part",
    "cell type",
    "cell line",
  ]);
  const categoryRank = (t: Tag): number => {
    const k = (t.category.label || "").trim().toLowerCase();
    if (CANONICAL_SAMPLE_SOURCE_CATEGORIES.has(k)) return 0;
    return 1;
  };
  // Build "URI exists for (group, label)" lookup so the free-text
  // pass can drop chips that share their label with a URI-bearing
  // sibling in the same row.
  const uriBearingByGroupLabel = new Set<string>();
  for (const t of [...direct, ...inferred]) {
    if (effectiveUri(t) && (t.value.label || "").trim().length > 0) {
      uriBearingByGroupLabel.add(`${groupKeyOf(t)}|${valLabelLc(t)}`);
    }
  }
  // Signature of a tag's statements (predicate/object pairs). Two
  // statement-shaped tags that share a subject URI but assert
  // DIFFERENT statements are different facts — e.g. ``Trp53
  // has_genotype Homozygous negative`` vs ``Trp53 has_genotype
  // Overexpression``, or a flat subject-only ``Trp53`` vs ``Trp53
  // has_genotype …``. Without folding this into the dedup key, a
  // newly-added statement-shaped tag collapsed into (and vanished
  // behind) an existing tag on the same subject — the curator adds a
  // genotype tag, commits it, and it never appears. URI-first so
  // label case/whitespace drift (``homozygous negative`` vs
  // ``Homozygous negative``, both TGEMO_00001) still dedups;
  // order-independent. A flat tag has an empty signature, which stays
  // distinct from any statement-bearing sibling. Design review 2026-07-21.
  const stmtSig = (t: Tag): string =>
    (t.statements ?? [])
      .map((s) => {
        const p = (s.predicate?.uri || s.predicate?.label || "")
          .trim()
          .toLowerCase();
        const o = (s.object?.uri || s.object?.label || "")
          .trim()
          .toLowerCase();
        return `${p}>${o}`;
      })
      .filter((pair) => pair !== ">")
      .sort()
      .join(";");
  // First pass: dedup by effective URI + statement signature within
  // each row. Sort so the preferred winner lands first: source rank
  // ascending (direct > biomaterial > FV), then canonical category
  // ascending (canonical Gemma > GEO-imported).
  const seenUriKeys = new Set<string>();
  const allSorted = [...direct, ...inferred].sort((a, b) => {
    const s = sourceRank(a) - sourceRank(b);
    if (s !== 0) return s;
    return categoryRank(a) - categoryRank(b);
  });
  const afterUriDedup: Tag[] = [];
  for (const t of allSorted) {
    const uri = effectiveUri(t);
    if (uri) {
      const key = `${groupKeyOf(t)}|${uri}|${stmtSig(t)}`;
      if (seenUriKeys.has(key)) continue;
      seenUriKeys.add(key);
    }
    afterUriDedup.push(t);
  }
  // Second pass: drop free-text chips whose label is already
  // covered by a URI-bearing chip in the same row.
  const dedupedAll = afterUriDedup.filter((t) => {
    if (effectiveUri(t)) return true; // URI chip — keep
    const k = `${groupKeyOf(t)}|${valLabelLc(t)}`;
    return !uriBearingByGroupLabel.has(k);
  });
  // A tag is "resolved" (NOT free-text) when it carries ANY ontology
  // URI: its own ``value.uri`` (or a design-derived effective URI), OR
  // a resolved subject / object inside one of its statements.
  // Statement-shaped tags routinely have a free-text subject label +
  // the ``ƒ`` inferred-from-FV glyph yet still resolve their entities
  // in the statement (sample source → UBERON:0002371, genotype →
  // NCBI:gene:17311, wild-type → EFO:0005168) — those must NOT be
  // hidden. Only chips with no URI anywhere (raw numbers, dates, batch
  // ids, yes/no flags) count as free-text.
  const tagIsResolved = (t: Tag): boolean => {
    // Classify by what the chip actually RENDERS. ``splitTagValues``
    // recovers URIs from the FV / biomaterial lookups — an FV-synth
    // ``cell type`` chip shows ``CL:…`` even though the tag's own
    // ``value.uri`` is null. ``effectiveUri`` alone missed those, so the
    // free-text filter wrongly dropped resolved inferred chips and the
    // "Hide free-text" count over-counted them (design review 2026-07-20). A tag
    // is free-text only when NONE of its rendered values carry a URI and
    // no statement resolves.
    const vals = splitTagValues(
      [t],
      t.category,
      charUriLookup,
      fvUriLookup,
      baselineLookup,
    );
    if (vals.some((v) => !!v.uri)) return true;
    return (t.statements ?? []).some(
      (s) => !!s.subject?.uri || !!s.object?.uri,
    );
  };
  // Two filters that govern OVERLAPPING sets of chips:
  //   • Hide inherited → ALL inferred chips (bubbled up because every
  //     sample carries the annotation), resolved OR free-text.
  //   • Hide free-text → ALL chips with no ontology URI (raw values),
  //     direct OR inferred.
  // The overlap is inferred free-text chips (raw values like ``ATO`` /
  // ``JQ1`` bubbled up from FVs) — both boxes hide them. Free-text now
  // covers inferred too so the curator can strip that raw-value noise
  // while keeping the resolved inherited chips (which Hide inherited
  // would also drop). Because the sets overlap, each "(N)" is a
  // reveal-accurate count: how many chips unchecking THAT box surfaces
  // given the OTHER box's current state — an inferred free-text chip
  // only counts toward a box when the other box isn't already hiding it.
  const isFreeText = (t: Tag) => !tagIsResolved(t);
  const anyInferred = dedupedAll.some((t) => t.inferred);
  // "Hide free-text" is a NOISE filter over inherited values — raw
  // numbers, dates, batch ids, per-sample descriptions bubbled up from
  // characteristics. A DIRECT EE-tag is curation content: an ungrounded
  // one is the curator's own work item ("find the term, or mint it"),
  // so hiding it behind a noise filter buries the very thing that needs
  // action. Direct chips are therefore never free-text-filtered — they
  // carry the "needs grounding" marker instead.
  // The "(N)" beside the box counts CHIPS, not tags — a mixed tag
  // contributes its raw values, a wholly-raw tag goes whole so all of
  // its values count, and a tag rescued by a resolving statement
  // contributes nothing because it isn't hidden.
  const hiddenFreeTextValues = (t: Tag): number =>
    hiddenFreeTextValueCount(
      splitTagValues(
        [t],
        t.category,
        charUriLookup,
        fvUriLookup,
        baselineLookup,
      ),
      !isFreeText(t),
    );
  const anyFreeText = dedupedAll.some(
    (t) => t.inferred && hiddenFreeTextValues(t) > 0,
  );
  const inferredCount = dedupedAll.filter(
    (t) => t.inferred && !(hideFreeText && isFreeText(t)),
  ).length;
  const freeTextCount = hideInferred
    ? 0
    : dedupedAll.reduce(
        (n, t) => n + (t.inferred ? hiddenFreeTextValues(t) : 0),
        0,
      );
  // The variables count has to be taken from the PRE-filter set —
  // ``visibleTags`` (and everything downstream of it) has already
  // dropped them. Same reveal-accurate convention as the other two: 0
  // when "Hide inherited" is already hiding the lot.
  const variableTags = augmentedTags.filter((t) => {
    const cat = (t.category.label || "").trim().toLowerCase();
    if (cat === "block" || cat === "batch") return false;
    if (t.inferred && INFERRED_HIDE_CATEGORIES.has(cat)) return false;
    return isVariableInferredTag(t, constancy);
  });
  const anyVariables = variableTags.length > 0;
  const variableCount = hideInferred
    ? 0
    : variableTags.reduce(
        (n, t) =>
          n +
          splitTagValues(
            [t],
            t.category,
            charUriLookup,
            fvUriLookup,
            baselineLookup,
          ).length,
        0,
      );
  const dedupedDirect = dedupedAll.filter((t) => !t.inferred);
  const dedupedInferred = hideInferred
    ? []
    : dedupedAll.filter(
        (t) => t.inferred && !(hideFreeText && isFreeText(t)),
      );
  const showHeader =
    visibleTags.length > 0 || draft != null;
  if (!showHeader) return null;

  // Bucket direct + inferred tags into the four reproducible group
  // rows + an "other" catch-all. Direct tags render first within a
  // row (editable, green), inferred after (read-only, slate). Empty
  // groups don't render at all, so a sparsely-tagged experiment
  // doesn't get padded with empty rows.
  const directByGroup = new Map<TagGroupKey, Tag[]>();
  const inferredByGroup = new Map<TagGroupKey, Tag[]>();
  for (const t of dedupedDirect) {
    const k = tagGroup(t.category.label);
    const list = directByGroup.get(k) ?? [];
    list.push(t);
    directByGroup.set(k, list);
  }
  for (const t of dedupedInferred) {
    const k = tagGroup(t.category.label);
    const list = inferredByGroup.get(k) ?? [];
    list.push(t);
    inferredByGroup.set(k, list);
  }
  return (
    <TagEditCtx.Provider value={editCtxValue}>
    <div className="pt-1 space-y-0.5">
      <div className="flex items-baseline gap-1.5">
        <span className="text-[11px] uppercase tracking-wide text-slate-500">
          tags
        </span>
        <HelpPopup title="Tag chip legend" size="md">
          <TagBarLegend />
        </HelpPopup>
        {/* Tag view toggles, right-aligned. Each is offered whenever the
            experiment has any chip of that kind (so the toggle stays
            available even when the other filter is currently hiding its
            share); the "(N)" is the reveal count for the current state.
            Both prefs are sticky app-wide and default ON. */}
        {anyInferred || anyFreeText || anyVariables ? (
          <div className="ml-auto inline-flex items-center gap-3">
            {anyInferred ? (
              <label
                className="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 cursor-pointer select-none normal-case tracking-normal"
                title="Hide inherited chips (inferred from sample characteristics / factor-value statements); the curator's own direct tags stay."
              >
                <input
                  type="checkbox"
                  className="h-3 w-3 accent-blue-600"
                  checked={hideInferred}
                  onChange={(e) => setHideInferred(e.target.checked)}
                />
                Hide inherited
                <span className="tabular-nums text-slate-400 dark:text-slate-500">
                  ({inferredCount})
                </span>
              </label>
            ) : null}
            {anyFreeText ? (
              <label
                className="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 cursor-pointer select-none normal-case tracking-normal"
                title="Hide unresolved free-text chips — raw inherited values with no ontology term. Only inherited chips are hidden: an ungrounded direct tag is a work item, so it stays put and carries the Δ needs-grounding marker instead."
              >
                <input
                  type="checkbox"
                  className="h-3 w-3 accent-blue-600"
                  checked={hideFreeText}
                  onChange={(e) => setHideFreeText(e.target.checked)}
                />
                Hide free-text
                <span className="tabular-nums text-slate-400 dark:text-slate-500">
                  ({freeTextCount})
                </span>
              </label>
            ) : null}
            {anyVariables ? (
              <label
                className="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 cursor-pointer select-none normal-case tracking-normal"
                title="Hide inherited chips that apply to only SOME samples — factor levels and per-sample characteristics. This row is for what's annotated about the experiment as a whole; the varying ones are the design, and the factor chips below carry them."
              >
                <input
                  type="checkbox"
                  className="h-3 w-3 accent-blue-600"
                  checked={hideVariables}
                  onChange={(e) => setHideVariables(e.target.checked)}
                />
                Hide variables
                <span className="tabular-nums text-slate-400 dark:text-slate-500">
                  ({variableCount})
                </span>
              </label>
            ) : null}
          </div>
        ) : null}
      </div>
      {/* Render tag-group rows in order, slotting the Factors row
          right after ``sample_source`` per design review 2026-05-21. Factors
          are the experimental design's structural axis; surfacing
          them in the overview header (with the audit sidebar's sky
          palette so curator + non-curator views agree on entity
          identity) lets non-curators see the design without the
          audit context. */}
      {TAG_GROUP_ORDER.flatMap((g) => {
        const rows: JSX.Element[] = [];
        const hasContent =
          (directByGroup.get(g)?.length ?? 0) +
            (inferredByGroup.get(g)?.length ?? 0) >
          0;
        if (hasContent) {
          // Chip-ordering within a row (design review 2026-05-23):
          //   1. inferred from factors (FV-synth, ƒ-glyph)
          //   2. EE tags (direct, curator-attached)
          //   3. other ontology terms (non-FV inferred, has URI)
          //   4. free text (no URI)
          // Splits the inferred bucket into FV-synth vs non-FV, then
          // sorts non-FV so URI-bearing categories render before
          // pure-free-text ones. Direct chips slot between #1 and #3.
          const inferredAll = inferredByGroup.get(g) ?? [];
          const fvSynth = inferredAll.filter(
            (t) => t.inferred_source === "FactorValue",
          );
          const nonFvInferred = inferredAll.filter(
            (t) => t.inferred_source !== "FactorValue",
          );
          // Stable sort so categories with any URI-resolved value
          // come before pure-free-text ones. ``Array.sort`` is stable
          // in modern engines; using a 0/1 key preserves intra-rank
          // order (so two URI-resolved categories keep their input
          // order, and same for two free-text categories).
          const categoryHasUri = new Map<string, boolean>();
          for (const t of nonFvInferred) {
            const k = (t.category.label || "").toLowerCase();
            if (categoryHasUri.get(k)) continue;
            categoryHasUri.set(k, !!t.value.uri);
          }
          const nonFvInferredSorted = [...nonFvInferred].sort((a, b) => {
            const ak = (a.category.label || "").toLowerCase();
            const bk = (b.category.label || "").toLowerCase();
            const au = categoryHasUri.get(ak) ? 0 : 1;
            const bu = categoryHasUri.get(bk) ? 0 : 1;
            return au - bu;
          });
          rows.push(
            <div
              key={g}
              className="flex items-baseline gap-2 flex-wrap pl-2 py-0.5"
            >
              <span
                className="text-[10px] uppercase tracking-wide text-slate-500 mr-1 min-w-[5.5rem]"
                title={`${g} category — reproducible spot for this kind of annotation`}
              >
                {TAG_GROUP_LABEL[g]}
              </span>
              <TagGroups
                tags={fvSynth}
                variant="inferred"
                charUriLookup={charUriLookup}
                fvUriLookup={fvUriLookup}
                baselineLookup={baselineLookup}
                experimentId={experimentId}
                hideFreeTextValues={hideFreeText}
              />
              <EditableDirectTagGroups
                tags={directByGroup.get(g) ?? []}
                addedTagIds={addedTagIds}
                inheritedMatchKeys={universalCharTerms}
              />
              <TagGroups
                tags={nonFvInferredSorted}
                variant="inferred"
                charUriLookup={charUriLookup}
                fvUriLookup={fvUriLookup}
                baselineLookup={baselineLookup}
                experimentId={experimentId}
                hideFreeTextValues={hideFreeText}
              />
            </div>,
          );
        }
        if (g === "sample_source" && (draft?.factors?.length ?? 0) > 0) {
          rows.push(
            <FactorsRow
              key="factors-row"
              factors={draft!.factors}
              experimentId={experimentId}
            />,
          );
        }
        return rows;
      })}
      {draft ? (
        <div className="flex items-center gap-1 pl-2 pt-0.5">
          <button
            type="button"
            className="text-[11px] text-slate-500 hover:text-emerald-800 hover:bg-emerald-50 border border-dashed border-slate-300 hover:border-emerald-300 rounded px-1.5 py-0.5 disabled:opacity-50 disabled:hover:text-slate-500 disabled:hover:bg-transparent disabled:hover:border-slate-300 disabled:cursor-not-allowed"
            onClick={() => setModalState({ mode: "add" })}
            disabled={tagReadOnly}
          >
            + tag
          </button>
          {/* Surface `missing_tag` audit findings beside the actual
              affordance the curator would use to satisfy them.
              Anchored to the experiment shell's target_id (that's
              what the agent emits for missing_tag — there's no
              concrete tag to attach the dot to since the tag
              doesn't exist yet) and filtered to the issue_code so
              other experiment-kind findings (synth_demo_only,
              missing_factor on the same target_id) don't light up
              the wrong affordance. */}
          <AuditDot
            targetId={experimentTarget(draft.experiment_id)}
            issueCodes={["missing_tag"]}
            // missing_tag ships as severity=minor (slate), which
            // disappears against the dashed-border button. Bump to
            // amber here so curators notice the affordance is
            // flagged. cn() under the hood is tailwind-merge so the
            // override wins over the severity class.
            className="bg-amber-400 border-amber-600 text-amber-950"
          />
        </div>
      ) : null}
      <StatementEditModal
        open={modalState !== null}
        initial={
          modalState?.mode === "edit" ? modalState.initial : addInitial
        }
        title={modalState?.mode === "edit" ? "Edit tag" : "Add tag"}
        onCancel={() => setModalState(null)}
        onSave={handleSave}
      />
    </div>
    </TagEditCtx.Provider>
  );
}

// `augmentInferredFromBiomaterials` moved to ./augmentInferred.ts —
// kept out of this tsx file so React Fast Refresh doesn't invalidate
// HMR on every component edit.

/** Inline category + value picker, reused for both edit-existing and
 *  add-new flows. Click outside or Escape to cancel; click ✓ (or
 *  blur into outside) to commit when both fields are populated.
 *  Mirrors the editor that lived in the now-retired TagsPanel. */
function ChipEditor({
  category,
  value,
  onCommit,
  onCancel,
  onDelete,
}: {
  category: OntologyTerm;
  value: OntologyTerm;
  onCommit: (category: OntologyTerm, value: OntologyTerm) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [cat, setCat] = useState<OntologyTerm | null>(category);
  const [val, setVal] = useState<OntologyTerm | null>(value);
  // Two-stage local delete: first trash-click arms (visual change +
  // "click again to confirm"); second click commits. Auto-disarms
  // after 3s so the curator can't get stuck in an armed state.
  // The global commit-bar "undo" rolls back EVERY pending edit at
  // once, so per-chip deletion needs its own confirm step otherwise
  // a curator who deletes one tag then hits global undo loses every
  // other unsaved edit too.
  const [deleteArmed, setDeleteArmed] = useState(false);
  useEffect(() => {
    if (!deleteArmed) return;
    const t = window.setTimeout(() => setDeleteArmed(false), 3000);
    return () => window.clearTimeout(t);
  }, [deleteArmed]);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) {
        if (cat && cat.label && val && val.label) {
          onCommit(cat, val);
        } else {
          onCancel();
        }
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [cat, val, onCommit, onCancel]);

  const canSave = !!(cat && cat.label && val && val.label);
  // ``isDirty`` gates the save / cancel buttons — they only matter
  // when the curator has actually changed something. For chips the
  // curator opened-but-didn't-edit (or protected chips that
  // shouldn't really be editable), the editor stays clean. Click-
  // outside still commits the (unchanged) state and Esc still
  // exits, so no behaviour is lost — just the redundant chrome.
  const termsEqual = (a: OntologyTerm | null, b: OntologyTerm | null) => {
    const al = (a?.label ?? "").trim();
    const bl = (b?.label ?? "").trim();
    const au = a?.uri ?? null;
    const bu = b?.uri ?? null;
    return al === bl && au === bu;
  };
  const isDirty = !termsEqual(cat, category) || !termsEqual(val, value);

  return (
    <span
      ref={ref}
      className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border bg-emerald-50 border-emerald-300 text-emerald-900"
      onClick={(e) => e.stopPropagation()}
    >
      <CategoryPicker
        value={cat}
        placeholder="category"
        onCommit={(next) => setCat(next ?? null)}
      />
      <span className="text-emerald-700/70">:</span>
      <OntologyTermPicker
        value={val}
        category={cat?.label || null}
        searchCategory={cat?.label || null}
        placeholder="value"
        onCommit={(next) => setVal(next ?? null)}
      />
      {isDirty ? (
        <>
          <button
            type="button"
            className="ml-1 px-1.5 text-[10px] font-medium uppercase tracking-wide text-emerald-800 hover:text-emerald-950 disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={() => canSave && onCommit(cat!, val!)}
            disabled={!canSave}
            title={
              canSave
                ? "save edit"
                : `fill ${!cat?.label ? "category" : "value"} first`
            }
          >
            save
          </button>
          <button
            type="button"
            className="px-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-500 hover:text-slate-800"
            onClick={onCancel}
            title="discard changes"
          >
            cancel
          </button>
        </>
      ) : null}
      {onDelete ? (
        <button
          type="button"
          className={cn(
            "ml-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide transition-colors",
            deleteArmed
              ? "bg-rose-600 text-white hover:bg-rose-700"
              : "text-rose-700 hover:bg-rose-100 hover:text-rose-900 dark:text-rose-300 dark:hover:bg-rose-900/30",
          )}
          onClick={() => {
            if (deleteArmed) {
              onDelete();
            } else {
              setDeleteArmed(true);
            }
          }}
          title={
            deleteArmed
              ? "click again to confirm delete (auto-cancels in 3s)"
              : "delete tag (requires a second click)"
          }
        >
          {deleteArmed ? "✗ confirm" : "🗑 delete"}
        </button>
      ) : null}
    </span>
  );
}

/** One renderable value inside a tag group. Splits comma-joined
 *  single-tag values (Gemma sometimes returns a single tag with
 *  ``value.label = "A, B, C"``) so they collapse the same way as
 *  proper multi-tag groups. */
interface TagValue {
  label: string;
  /** URI for the value when Gemma resolved it. Comma-split values
   *  inherit from their source tag (the URI applies to the joined
   *  string, not the parts) so they're treated as free-text here.
   */
  uri: string | null;
  /** Stable key for React. */
  key: string;
}

/** Build a ``(category-label, value-label)`` → URI lookup from
 *  every biomaterial's ``characteristic_uris`` map. Both keys are
 *  lower-cased + trimmed so the lookup tolerates Gemma's
 *  capitalisation drift. Used by ``splitTagValues`` to recover the
 *  URI on a tag value that came in as part of a comma-joined
 *  synth.
 */
function buildCharUriLookup(biomaterials: Biomaterial[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const bm of biomaterials) {
    const chars = bm.characteristics ?? {};
    const uris = bm.characteristic_uris ?? {};
    for (const [cat, value] of Object.entries(chars)) {
      const valUri = uris[cat]?.value_uri;
      if (!valUri) continue;
      const k = `${cat.trim().toLowerCase()}|${(value || "").trim().toLowerCase()}`;
      if (!map.has(k)) map.set(k, valUri);
    }
  }
  return map;
}

function splitTagValues(
  tags: Tag[],
  category: Tag["category"],
  charUriLookup: Map<string, string>,
  fvUriLookup: Map<string, string>,
  baselineLookup: Set<string>,
): TagValue[] {
  const catKey = (category.label || "").trim().toLowerCase();
  const out: TagValue[] = [];
  for (const t of tags) {
    const label = (t.value.label || "").trim();
    if (!label) continue;
    const parts = label.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length <= 1) {
      // Single value — prefer the tag's own URI; fall back to the
      // biomaterial characteristic_uris lookup when the synth-tag
      // builder didn't carry a URI through but the underlying BM
      // characteristic does have one (caught 2026-05-10:
      // ``organism part: hypothalamus`` rendered as free-text in
      // the Tags row while the samples table showed UBERON_0001898
      // for the same value). Final fallback: FV statement subject
      // URIs (catches FV-synth tags whose values are CL/EFO terms).
      const uri =
        t.value.uri ??
        charUriLookup.get(`${catKey}|${label.toLowerCase()}`) ??
        fvUriLookup.get(`${catKey}|${label.toLowerCase()}`) ??
        null;
      out.push({ label, uri, key: `${t.id}:${label}` });
    } else {
      // Comma-joined synth value — the tag's own URI doesn't
      // carry to the parts. Look each part up against
      // biomaterial.characteristic_uris first, then FV statement
      // subject URIs; "female" → PATO_0000383 etc. when Gemma's
      // preprocessor mapped it. Falls back to null (free-text
      // styling) when no match in either lookup.
      parts.forEach((p, i) => {
        const uri =
          charUriLookup.get(`${catKey}|${p.toLowerCase()}`) ??
          fvUriLookup.get(`${catKey}|${p.toLowerCase()}`) ??
          null;
        out.push({ label: p, uri, key: `${t.id}:${i}:${p}` });
      });
    }
  }
  // Drop baseline-placeholder rows entirely — Gemma encodes a
  // baseline FV by giving it an OBI "reference substance role" /
  // "reagent role" label, which leaks into FV-synth tags as a
  // curator-meaningless value alongside the real treatment. Same
  // spirit as the design review's earlier "baselines can be omitted or implied"
  // — these are pure implementation chrome.
  const filtered = out.filter(
    (v) =>
      !BASELINE_PLACEHOLDER_LABELS.has(v.label.toLowerCase()) &&
      !(v.uri && BASELINE_PLACEHOLDER_URIS.has(v.uri)),
  );
  // Two-key sort:
  //   1. Baselines bubble to the END (they're the implicit reference;
  //      preview space goes to the interesting comparisons).
  //   2. Within non-baselines, URI-resolved (ontology) values come
  //      FIRST — they're more curator-trustworthy and visually
  //      prominent. Free-text values follow, demoted in the renderer.
  filtered.sort((a, b) => {
    const aB = baselineLookup.has(`${catKey}|${a.label.toLowerCase()}`) ? 1 : 0;
    const bB = baselineLookup.has(`${catKey}|${b.label.toLowerCase()}`) ? 1 : 0;
    if (aB !== bB) return aB - bB;
    const aU = a.uri ? 0 : 1;
    const bU = b.uri ? 0 : 1;
    return aU - bU;
  });
  return filtered;
}

/** OBI / Gemma placeholders that mark a factor value as "this is the
 *  baseline" rather than carrying a real curator-meaningful value.
 *  Filtered out of FV-synth chip values — they're implementation
 *  chrome that confuses curators ("why is TNF tagged alongside
 *  reference substance role?"). */
const BASELINE_PLACEHOLDER_LABELS = new Set([
  "reference substance role",
  "control",
  "vehicle",
  "mock",
  "untreated",
  "baseline",
]);
const BASELINE_PLACEHOLDER_URIS = new Set([
  "http://purl.obolibrary.org/obo/OBI_0000220",
  "http://purl.obolibrary.org/obo/OBI_0000025",
]);

/** Per-value chip styled by URI presence: emerald + medium-weight
 *  for ontology-resolved, slate + italic for free-text. House
 *  standard — green is reserved for "ontology-backed".
 *
 *  Resolved chips render as ``<a>`` so a click opens the ontology
 *  term page (matches the ``Term`` component's resolved-variant
 *  behaviour elsewhere in the UI). The parent group-chip click
 *  handler is for expand/collapse / edit, so we ``stopPropagation``
 *  on the link click — otherwise clicking the term ID would also
 *  toggle the multi-value collapse. */
/** Strip the bracketed qualifier tail from a tag value label —
 *  ``"M0 [Cells grown in basal media for 7 days. ...]"`` becomes
 *  ``"M0"``. The tail is usually a curator/methods comment that
 *  describes the baseline or sample-prep condition; the headline
 *  short label is what the curator wants to scan. Full text is
 *  preserved via the chip's ``title`` for hover-detail. */
function abbreviateValueLabel(label: string): string {
  return label.replace(/\s*\[[^\]]*\]?\s*$/, "").trim() || label;
}

function TagValueChip({
  value,
  categoryLabel,
  demoted = false,
  needsGrounding = false,
}: {
  value: TagValue;
  /** Category label for this value. Surfaced when the chip is
   *  click-expanded so the curator can see "what kind of annotation
   *  is this" without hovering for the tooltip. Free-text variant
   *  prefixes ``${categoryLabel}: ``; URI variant shows it before
   *  the CURIE. */
  categoryLabel?: string;
  /** When the parent group has at least one ontology-resolved value,
   *  free-text siblings render demoted (lower opacity, lighter
   *  weight) so the eye lands on the anchored terms first. URI
   *  values ignore this prop — they're always the prominent ones. */
  demoted?: boolean;
  /** Free text is legitimate on a direct EE-tag — the term may not
   *  exist yet, or just hasn't been found. It is NOT finished work
   *  though, so mark it: same ``Δ ground`` vocabulary the audit cards
   *  use for ``ungrounded_term``, so one cue means one thing across
   *  surfaces. Ignored on URI-bearing values. */
  needsGrounding?: boolean;
}) {
  const display = abbreviateValueLabel(value.label);
  // Full label (+ category) recoverable on hover, since ``display`` is
  // abbreviated. Threaded to the shared ``Term`` as its ``title``.
  const title = `${value.label}${categoryLabel ? ` (${categoryLabel})` : ""}`;
  // Render through the canonical ``Term`` (bare variant) so the leaf
  // logic — CURIE popover, truncation, tooltip — lives in ONE place
  // instead of being hand-rolled here. ``bare`` keeps it frameless
  // because the value sits inside an already-bordered group chip; a
  // second frame would double-border. The CURIE picks up Term's
  // standard slate styling (was a one-off emerald here). ``asLink=false``
  // keeps the label as plain text — clicking the CURIE opens the
  // popover, matching the prior behaviour. Design review 2026-06-21.
  if (value.uri) {
    return (
      <Term
        variant="bare"
        uri={value.uri}
        asLink={false}
        title={title}
        className="font-medium text-emerald-700 dark:text-emerald-400 max-w-[22ch]"
      >
        {display}
      </Term>
    );
  }
  // Free-text variant: italic, truncated, demoted when the group has
  // ontology-resolved siblings.
  return (
    <>
      <Term
        variant="bare"
        title={title}
        className={cn(
          "italic max-w-[22ch]",
          demoted ? "opacity-50 text-[10px]" : "opacity-80",
        )}
      >
        {display}
      </Term>
      {needsGrounding ? (
        <span
          className="text-[10px] leading-none font-medium text-amber-700 dark:text-amber-400 shrink-0"
          title={`"${value.label}" has no ontology term yet — find one, or mint one if it doesn't exist. Free text is allowed here, but it isn't finished.`}
          aria-label="needs grounding"
        >
          Δ
        </span>
      ) : null}
    </>
  );
}

/**
 * Group tags by category and render a chip per group.
 *
 * - Single-value groups: flat ``category : value`` chip; the value
 *   carries its own ontology / free-text styling.
 * - Multi-value groups (including a single tag whose value is a
 *   comma-joined synth from Gemma — e.g.
 *   ``disease: "X, Y, Z"`` — get split apart): collapsed by
 *   default to ``category N values ▸ preview…``; click to expand
 *   into a row of value chips.
 *
 * Variant only changes a small bookkeeping cue on the chip
 * (a quiet "auto" tag for inferred groups). All chips share the
 * same neutral background so the curator's eye lands on the
 * **value-level** ontology-vs-free-text styling, which is the
 * actually-actionable signal.
 */
type TagGroupVariant = "direct" | "inferred";

function TagGroups({
  tags,
  variant,
  charUriLookup,
  fvUriLookup,
  baselineLookup,
  experimentId,
  hideFreeTextValues = false,
}: {
  tags: Tag[];
  variant: TagGroupVariant;
  charUriLookup: Map<string, string>;
  fvUriLookup: Map<string, string>;
  baselineLookup: Set<string>;
  experimentId: number | string;
  hideFreeTextValues?: boolean;
}) {
  if (tags.length === 0) return null;
  const groups = groupTagsByCategoryLabel(tags);
  return (
    <>
      {[...groups.values()].map((g) => (
        <TagGroupChip
          key={(g.category.label || g.category.uri) + ":" + variant}
          category={g.category}
          tags={g.tags}
          variant={variant}
          charUriLookup={charUriLookup}
          fvUriLookup={fvUriLookup}
          baselineLookup={baselineLookup}
          experimentId={experimentId}
          hideFreeTextValues={hideFreeTextValues}
        />
      ))}
    </>
  );
}

/** Direct-tag analogue of ``TagGroups`` with click-to-edit + delete
 *  affordances. Renders ONE chip per tag — each term shown
 *  individually, never collapsed into a "N ▸" count (design review 2026-07-20:
 *  "I don't like the collapsing of terms at all"). The category is
 *  carried by the group ROW label, so per-tag chips read cleanly
 *  without repeating it. ``EditableDirectGroupChip`` takes the
 *  single-tag path for each. */
function EditableDirectTagGroups({
  tags,
  addedTagIds,
  inheritedMatchKeys,
}: {
  tags: Tag[];
  /** Tag ids present in the draft but not the saved server state.
   *  Chips in this set render with an amber "new" ring so the
   *  curator can see uncommitted additions at a glance. */
  addedTagIds?: Set<number>;
  /** ``category|value_uri`` keys every sample carries as a GROUNDED
   *  characteristic — a flat direct chip with that exact term gets the
   *  violet redundancy glint. */
  inheritedMatchKeys?: ReadonlySet<string>;
}) {
  if (tags.length === 0) return null;
  return (
    <>
      {tags.map((tag) => (
        <EditableDirectGroupChip
          key={tag.id}
          category={tag.category}
          tags={[tag]}
          addedTagIds={addedTagIds}
          inheritedMatchKeys={inheritedMatchKeys}
        />
      ))}
    </>
  );
}

/** Group tags by lowercased category label (URI fallback when the
 *  label is empty). Used by both the inferred ``TagGroups`` path and
 *  the editable direct path so a future change to the grouping key
 *  (e.g. include ``inferred_source`` in the key) only has to land
 *  in one place. */
function groupTagsByCategoryLabel(
  tags: Tag[],
): Map<string, { category: Tag["category"]; tags: Tag[] }> {
  const groups = new Map<string, { category: Tag["category"]; tags: Tag[] }>();
  for (const t of tags) {
    const k = (t.category.label || t.category.uri || "").toLowerCase();
    if (!groups.has(k)) {
      groups.set(k, { category: t.category, tags: [] });
    }
    groups.get(k)!.tags.push(t);
  }
  return groups;
}

/** Render a tag's structured statements inline — used when
 *  ``tag.statements`` is non-empty so a knockout / genotype / drug-
 *  dose tag can carry the full subject · predicate · object shape
 *  instead of collapsing to a single ``value`` chip. Multi-statement
 *  tags stack vertically inside the chip frame (rare — one
 *  statement is the common case). Mirrors the visual convention
 *  used inside ``FvDisplayRow``: anchored = green / weight, free-
 *  text = italic slate, predicate = mono caption. Kept inline so
 *  the TagBar's tight per-chip layout doesn't break. Design review 2026-06-14:
 *  experiment-level tags need the same expressiveness as FV-level
 *  statements (e.g. ``genotype · Abca4 · has_genotype · Homozygous
 *  negative`` for a knockout applying to all samples). */
function TagStatementInline({ statements }: { statements: Statement[] }) {
  return (
    <span className="inline-flex flex-col gap-0.5 items-baseline">
      {statements.map((s, i) => (
        <span
          key={i}
          className="inline-flex items-baseline gap-1 whitespace-normal"
        >
          {s.subject?.label ? (
            <TagInnerTerm
              label={s.subject.label}
              uri={s.subject.uri ?? null}
            />
          ) : null}
          {s.predicate?.label ? (
            <>
              <span className="text-emerald-900/40 dark:text-emerald-200/40">
                ·
              </span>
              <span
                className="font-mono text-[10px] text-emerald-900/75 dark:text-emerald-200/75"
                title={s.predicate.uri || undefined}
              >
                {s.predicate.label}
              </span>
            </>
          ) : null}
          {s.object?.label ? (
            <>
              <span className="text-emerald-900/40 dark:text-emerald-200/40">
                ·
              </span>
              <TagInnerTerm
                label={s.object.label}
                uri={s.object.uri ?? null}
              />
            </>
          ) : null}
        </span>
      ))}
    </span>
  );
}

/** Compact ontology-vs-free-text term render for the inline tag-
 *  statement chip. Same convention as the single-tag chip's value
 *  span — anchored terms get the emerald-weight treatment, free-
 *  text gets italic slate. CURIE / popover affordances live on the
 *  full ``Term`` component; this stub stays text-only so it nests
 *  cleanly inside the chip frame. */
/** A term inside a tag chip.
 *
 *  🛑 Deliberately NOT a ``Term``: the TagBar convention is one frame
 *  per chip, so an inner term carries no border, no prefix and no
 *  inline CURIE. That is a styling decision and it must not become a
 *  behaviour decision — genes still show the SYMBOL and a species
 *  mark here, exactly as they do in a full ``Term``, sourced from the
 *  same helpers rather than re-derived.
 */
function TagInnerTerm({
  label,
  uri,
}: {
  label: string;
  uri: string | null;
}) {
  const datasetTaxon = useDatasetTaxon();
  const gene = isGeneUri(uri) ? parseGeneLabel(label) : null;
  if (!uri) {
    return (
      <span className="italic text-slate-700 dark:text-slate-300">
        {label}
      </span>
    );
  }
  return (
    <span className="inline-flex items-baseline gap-0.5">
      <span
        className="font-medium text-emerald-800 dark:text-emerald-200"
        title={
          gene
            ? [gene.fullName ? `${gene.symbol} — ${gene.fullName}` : gene.symbol,
               shortenUri(uri)].join("\n")
            : shortenUri(uri)
        }
      >
        {gene?.symbol || label}
      </span>
      {gene ? (
        <GeneSpeciesMark
          uri={uri}
          species={gene.species}
          datasetTaxon={datasetTaxon}
        />
      ) : null}
    </span>
  );
}

function EditableDirectGroupChip({
  category,
  tags,
  addedTagIds,
  inheritedMatchKeys,
}: {
  category: Tag["category"];
  tags: Tag[];
  /** Tag ids present in the draft but not the saved server state.
   *  Single-tag chips matching one of these get the amber "new"
   *  ring; multi-tag chips get the ring when *any* of their tags is
   *  new (and the inner editable chip per-value mirrors the per-tag
   *  status when expanded). */
  addedTagIds?: Set<number>;
  /** ``category|value_uri`` keys every sample carries as a GROUNDED
   *  characteristic. A flat direct chip whose exact ontology term matches
   *  gets the violet redundancy glint. */
  inheritedMatchKeys?: ReadonlySet<string>;
}) {
  const { draft, apply } = useDesignDraft();
  const readOnly = useIsReadOnly();
  const [open, setOpen] = useState(false);
  // ``editingId`` + ``commitEdit`` retained for any legacy paths that
  // still call into ChipEditor; today's chip-click surface routes
  // through ``openEditTag`` from TagEditCtx → StatementEditModal at
  // the TagBar level, which handles statements as well as flat
  // category/value pairs.
  const [editingId, setEditingId] = useState<number | null>(null);
  const tagEdit = useTagEditContext();

  function commitEdit(tag: Tag, cat: OntologyTerm, val: OntologyTerm) {
    if (!draft) return;
    const next = setTagCategory(draft, tag.id, cat);
    apply(setTagValue(next, tag.id, val));
    setEditingId(null);
  }
  function deleteOne(tagId: number) {
    if (!draft) return;
    apply(deleteTag(draft, tagId));
    setEditingId(null);
  }

  // Tags whose category names the experiment's assay shape are
  // load-time invariants (Gemma's import attaches them); the curator
  // shouldn't be able to delete them from the UI. Drop the × button
  // and the ChipEditor onDelete prop when the group is protected.
  const protectedCategory = isProtectedTagCategory(category.label);

  // Single tag — render as just the value chip wrapped in an
  // emerald-bordered shell, click to edit, × on hover.
  // C+B chip pass (2026-05-17): category section dropped — the row
  // group header carries it. Category + URI move to hover title.
  if (tags.length === 1) {
    const tag = tags[0];
    if (editingId === tag.id) {
      return (
        <ChipEditor
          category={tag.category}
          value={tag.value}
          onCancel={() => setEditingId(null)}
          onCommit={(c, v) => commitEdit(tag, c, v)}
          onDelete={
            protectedCategory ? undefined : () => deleteOne(tag.id)
          }
        />
      );
    }
    const isNew = addedTagIds?.has(tag.id) ?? false;
    const valueDisplay = abbreviateValueLabel(tag.value.label || "");
    const canEdit = !protectedCategory && !readOnly && !!tagEdit;
    // Inherited-exact-match glint: EVERY sample carries this tag's exact
    // ontology term (same ``value_uri``) as a grounded characteristic, so
    // the tag is genuinely redundant with the per-sample annotation. The
    // direct tag wins (it's shown, not the inferred); the violet glint
    // just flags the redundancy. Requires a grounded, flat tag: a
    // free-text tag isn't grounded, and a statement-bearing tag carries
    // more than a flat per-sample characteristic can match — neither is
    // an exact-statement match, so neither glints. Design review 2026-07-20.
    const isFlatTag = (tag.statements?.length ?? 0) === 0;
    // Free text is LEGITIMATE on a direct tag's subject — the term may
    // not exist yet, or (usually) just hasn't been found. It is not
    // finished work though, so mark it. Reads the subject wherever the
    // chip actually shows it: the flat ``value`` on a plain tag, the
    // statement subjects on a statement-shaped one. Load-time tags are
    // exempt — the curator can't act on a locked chip, so a marker there
    // is pure noise.
    const subjectNeedsGrounding =
      !protectedCategory &&
      (isFlatTag
        ? !!tag.value.label && !tag.value.uri
        : (tag.statements ?? []).some(
            (s) => !!s.subject?.label && !s.subject?.uri,
          ));
    const groundingMark = subjectNeedsGrounding ? (
      <span
        className="text-[10px] leading-none font-medium text-amber-700 dark:text-amber-400 shrink-0"
        title={`No ontology term on this tag's subject yet — find one, or mint one if it doesn't exist. Free text is allowed here, but it isn't finished.`}
        aria-label="needs grounding"
      >
        Δ
      </span>
    ) : null;
    const inheritedKey = tag.value.uri
      ? `${(tag.category.label || "").trim().toLowerCase()}|${tag.value.uri.trim()}`
      : "";
    const hasInheritedMatch =
      isFlatTag && !!inheritedKey && !!inheritedMatchKeys?.has(inheritedKey);
    return (
      <span
        // Audit focus hook — Apply & focus on a tag finding scrolls
        // this chip into view + ring-flashes it.
        data-audit-target={tagTarget(tag.category.label, tag.value.label)}
        role={canEdit ? "button" : undefined}
        tabIndex={canEdit ? 0 : undefined}
        onClick={canEdit ? () => tagEdit?.openEditTag(tag) : undefined}
        onKeyDown={
          canEdit
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  tagEdit?.openEditTag(tag);
                }
              }
            : undefined
        }
        className={cn(
          "group/chip inline-flex items-baseline gap-1 px-1.5 py-0.5 text-[11px] rounded border bg-emerald-50 border-emerald-300 text-emerald-900 dark:bg-emerald-900/30 dark:border-emerald-700 dark:text-emerald-100",
          // Bookmark on the left when the value is ontology-anchored.
          // Free-text tags share the chip frame but get no bookmark.
          tag.value.uri && ONTOLOGY_ANCHOR_CLS,
          protectedCategory ? "cursor-default opacity-90" : "",
          canEdit && "cursor-pointer hover:ring-1 hover:ring-emerald-400 dark:hover:ring-emerald-500",
          // Uncommitted addition — amber ring + soft glow so the
          // curator can see at a glance which chips are pending.
          isNew &&
            "ring-2 ring-amber-400 ring-offset-1 ring-offset-white shadow-[0_0_8px_-2px_rgba(251,191,36,0.7)] dark:ring-offset-slate-900",
          // Inherited-exact-match glint — violet ring + glow. Bumped from
          // a faint ring-1/70% to a full-opacity ring-2 with a stronger
          // glow (2026-07-22: too subtle to spot, light mode especially);
          // colours track the legend swatch (violet-500 light / -400 dark).
          // Stays offset-less so it still yields visually to the amber
          // "new" ring (which adds ring-offset) when both would apply.
          !isNew &&
            hasInheritedMatch &&
            "ring-2 ring-violet-500 shadow-[0_0_8px_-1px_rgba(139,92,246,0.85)] dark:ring-violet-400",
        )}
        title={
          (protectedCategory
            ? `${category.label}: ${tag.value.label} — load-time tag, can't be removed`
            : readOnly
              ? `${category.label}: ${tag.value.label} — read-only in review mode`
              : `${category.label}: ${tag.value.label} — click to edit`) +
          (tag.value.uri ? ` — ${shortenUri(tag.value.uri)}` : "") +
          (hasInheritedMatch
            ? " · violet glint: redundant — every sample carries this exact ontology term"
            : "")
        }
      >
        {/* Padlock for load-time tags — explicit "this can't be
         *  changed" signal. Replaces the silent-no-affordance state
         *  where curators used to click and get the editor with no
         *  meaningful change possible. */}
        {protectedCategory ? (
          <span
            className="text-[10px] opacity-60"
            aria-label="locked"
            title="load-time tag, can't be edited"
          >
            🔒
          </span>
        ) : null}
        {tag.statements && tag.statements.length > 0 ? (
          // Structured tag — the agent / curator decomposed the value
          // into S-P-O (e.g. ``Abca4 · has_genotype · Homozygous
          // negative``). Render the statement chips inline instead of
          // the flat value label. ``tag.value.label`` (if any) still
          // exists as a fallback summary but the structured form is
          // more useful for the curator.
          <>
            <span className="max-w-[40ch]">
              <TagStatementInline statements={tag.statements} />
            </span>
            {groundingMark}
          </>
        ) : (
          <>
            <span
              className={cn(
                "font-medium truncate max-w-[22ch]",
                // Anchored term → emerald text; free-text → italic slate.
                tag.value.uri
                  ? "text-emerald-700 dark:text-emerald-400"
                  : "italic text-slate-700 dark:text-slate-300",
              )}
            >
              {valueDisplay || <em className="not-italic">no value</em>}
            </span>
            {/* CURIE inline next to the label — Term-chip pattern
                per design review 2026-06-15. Click opens the term-detail
                popover (which carries its own "Fetch from OLS"
                button). Inline ↗ external link removed 2026-06-17
                (design review: misclick penalty + clutter). */}
            {tag.value.uri ? (
              <CurieLink
                uri={tag.value.uri}
                className="font-mono text-[10px] text-emerald-700/70 dark:text-emerald-300/70 hover:text-emerald-900 dark:hover:text-emerald-100 whitespace-nowrap bg-transparent border-0 p-0 cursor-pointer no-underline hover:underline"
              />
            ) : null}
            {groundingMark}
          </>
        )}
        <AuditDot
          targetId={tagTarget(tag.category.label, tag.value.label)}
        />
        {/* Where this tag came from — inert until a curator runs
            "populate provenance", and absent for a tag with no
            recorded trace, which is most of them today. */}
        <ProvenanceDot refId={tagRefId(tag.id)} />
        {/* Verbatim provenance for an agent-emitted tag — ❝ glyph,
            click → popover. Renders nothing until the tag carries
            supporting_evidence (pending the Gemma wire field). */}
        <EvidenceTrigger evidence={tag.supporting_evidence} className="ml-0.5" />
        {/* Delete affordance — Design review 2026-06-15: "edit should lead
            to the delete being exposed, but that's all." So the
            chip no longer opens the ChipEditor — it just exposes
            a × delete button on hover. Reveals on group-hover via
            the ``group/chip`` parent so the chip stays compact
            until the curator targets it. */}
        {protectedCategory || readOnly ? null : (
          <button
            type="button"
            className="ml-0.5 inline-flex items-center justify-center w-3.5 h-3.5 rounded-sm text-emerald-700/70 hover:bg-emerald-200 hover:text-rose-700 dark:text-emerald-300/70 dark:hover:bg-rose-900/50 dark:hover:text-rose-200 opacity-0 group-hover/chip:opacity-100 focus:opacity-100 transition-opacity"
            onClick={(e) => {
              e.stopPropagation();
              deleteOne(tag.id);
            }}
            title="delete this tag"
            aria-label="delete tag"
          >
            ×
          </button>
        )}
      </span>
    );
  }

  // Multi-tag — collapse like the read-only inferred groups, but each
  // value chip in the expanded view is independently editable. C+B
  // chip pass: category section dropped; hover title carries it.
  return (
    <span
      className={cn(
        "inline-flex items-baseline text-[11px] rounded border bg-emerald-50 border-emerald-300 text-emerald-900 dark:bg-emerald-900/30 dark:border-emerald-700 dark:text-emerald-100",
        // Bookmark on the left when any wrapped value is ontology-
        // anchored. Mixed free-text + anchored groups still get the
        // bookmark — the group as a whole is anchored.
        tags.some((t) => !!t.value.uri) && ONTOLOGY_ANCHOR_CLS,
        // Highlight the whole multi-tag group when any member is new
        // (curator just added one of N values in this category).
        tags.some((t) => addedTagIds?.has(t.id)) &&
          "ring-2 ring-amber-400 ring-offset-1 ring-offset-white shadow-[0_0_8px_-2px_rgba(251,191,36,0.7)] dark:ring-offset-slate-900",
      )}
      title={`${category.label} — ${tags.length} tags`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-baseline gap-1 px-1.5 py-0.5 hover:underline underline-offset-2"
        title={
          open
            ? "click to collapse"
            : `click to expand ${tags.length} ${category.label} tags`
        }
      >
        <span className="font-medium tabular-nums">{tags.length}</span>
        <span className="text-emerald-900/75 dark:text-emerald-200/75">{open ? "▾" : "▸"}</span>
        {open ? null : (
          <span className="italic ml-1 truncate max-w-[24ch] text-emerald-900/60 dark:text-emerald-200/70">
            {tags
              .slice(0, 2)
              .map((t) => abbreviateValueLabel(t.value.label || "(blank)"))
              .join(", ")}
            {tags.length > 2 ? "…" : ""}
          </span>
        )}
      </button>
      {open ? (
        <span className="inline-flex items-baseline gap-1 flex-wrap px-1.5 py-0.5">
          {tags.map((tag) =>
            editingId === tag.id ? (
              <ChipEditor
                key={tag.id}
                category={tag.category}
                value={tag.value}
                onCancel={() => setEditingId(null)}
                onCommit={(c, v) => commitEdit(tag, c, v)}
                onDelete={
                  protectedCategory ? undefined : () => deleteOne(tag.id)
                }
              />
            ) : (
              <span
                key={tag.id}
                data-audit-target={tagTarget(tag.category.label, tag.value.label)}
                role={!protectedCategory && !readOnly && tagEdit ? "button" : undefined}
                tabIndex={!protectedCategory && !readOnly && tagEdit ? 0 : undefined}
                onClick={
                  !protectedCategory && !readOnly && tagEdit
                    ? (e) => {
                        e.stopPropagation();
                        tagEdit.openEditTag(tag);
                      }
                    : undefined
                }
                onKeyDown={
                  !protectedCategory && !readOnly && tagEdit
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          tagEdit.openEditTag(tag);
                        }
                      }
                    : undefined
                }
                className={cn(
                  "group/chip inline-flex items-baseline gap-1 px-1 rounded bg-emerald-50 border border-emerald-200/70 hover:bg-emerald-100 dark:bg-emerald-900/40 dark:border-emerald-700/60 dark:hover:bg-emerald-800/50",
                  tag.value.uri && ONTOLOGY_ANCHOR_CLS,
                  !protectedCategory && !readOnly && tagEdit && "cursor-pointer",
                  addedTagIds?.has(tag.id) &&
                    "ring-2 ring-amber-400 ring-offset-1 ring-offset-white dark:ring-offset-slate-900",
                )}
                title={
                  protectedCategory
                    ? "load-time tag, can't be removed"
                    : `${tag.value.label} — click to edit`
                }
              >
                {tag.statements && tag.statements.length > 0 ? (
                  // Structured tag — render S-P-O inline; the CURIE
                  // link-out drops here because the inner chips each
                  // carry their own URI hover via ``TagInnerTerm``.
                  <TagStatementInline statements={tag.statements} />
                ) : (
                  <>
                    <TagInnerTerm
                      label={tag.value.label || "(blank)"}
                      uri={tag.value.uri ?? null}
                    />
                    {tag.value.uri ? (
                      <CurieLink
                        uri={tag.value.uri}
                        className="font-mono text-[10px] text-emerald-900/60 hover:text-emerald-900 hover:underline whitespace-nowrap cursor-pointer bg-transparent border-0 p-0"
                      />
                    ) : null}
                  </>
                )}
                <AuditDot
                  targetId={tagTarget(tag.category.label, tag.value.label)}
                />
                <ProvenanceDot refId={tagRefId(tag.id)} />
                {/* Delete affordance — same shape as the single-tag
                    chip above. Hover-reveal via ``group/chip``. The reviewer
                    2026-06-15: edit exposes delete, nothing else. */}
                {protectedCategory || readOnly ? null : (
                  <button
                    type="button"
                    className="ml-1 inline-flex items-center justify-center w-3.5 h-3.5 rounded-sm text-emerald-700/70 hover:bg-emerald-200 hover:text-rose-700 dark:text-emerald-300/70 dark:hover:bg-rose-900/50 dark:hover:text-rose-200 opacity-0 group-hover/chip:opacity-100 focus:opacity-100 transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteOne(tag.id);
                    }}
                    title="delete this tag"
                    aria-label="delete tag"
                  >
                    ×
                  </button>
                )}
              </span>
            ),
          )}
        </span>
      ) : null}
    </span>
  );
}

/** Short tag for inferred-source provenance: BioMaterial → BM,
 *  FactorValue → FV. Anything else falls through verbatim. Surfaced
 *  on every inferred chip so a curator scanning the panel can
 *  answer "where did this come from?" without hovering for the
 *  tooltip. Empty string for tags without a source recorded. */
function inferredSourceTag(source: string | undefined): string {
  if (!source) return "";
  if (source === "BioMaterial") return "BM";
  if (source === "FactorValue") return "FV";
  return source;
}

/** Long-form name for an evidence code, for the chip's hover title.
 *  Limited to the two Gemma actually uses; others render verbatim. */
function evidenceCodeName(code: string | undefined): string {
  const c = (code || "").trim().toUpperCase();
  if (!c) return "";
  if (c === "IC") return "Inferred by Curator";
  if (c === "IIA") return "Inferred from Imported Annotation (GEO)";
  return c;
}

/** Three-way palette for the two-tone tag chip. The provenance signal
 *  (curator-direct vs factor-derived vs biomaterial-inferred) is the
 *  useful distinction a curator is trying to read at a glance:
 *  EE tags they own, FV-synth tags that mirror a factor (so editing
 *  the factor is the way to change them), and BM-inferred tags that
 *  ride along from the biomaterials. Three palettes so the eye can
 *  triage without parsing the tiny "FV" / "BM" badge.
 *
 *  Within each palette the chip splits into two sections — category
 *  on the left in the deeper -100 tier, value on the right in the
 *  -50 tier — so the seam between "what kind of annotation" and
 *  "what value" is visible at chip-scan distance. */
type TagPaletteKey = "direct" | "fv" | "bm" | "mixed";

const TAG_PALETTE: Record<
  TagPaletteKey,
  {
    /** Outer chip border + value-section bg (the right half). */
    outer: string;
    /** Category-section bg + text (the left half). Deeper than outer
     *  so the seam reads clearly. */
    cat: string;
    /** Smaller-weight sibling labels (badges, "N values" preview)
     *  living inside the value section. */
    label: string;
    /** Hover state override on the value section — slight bump so
     *  the chip indicates interactivity (edit / expand) without
     *  blowing out the two-tone differential. */
    valHover: string;
    /** Hover state override on the category section. */
    catHover: string;
  }
> = {
  direct: {
    outer:
      "bg-emerald-50 border-emerald-300 dark:bg-emerald-900/30 dark:border-emerald-700",
    cat:
      "bg-emerald-100 text-emerald-900 dark:bg-emerald-800/50 dark:text-emerald-100",
    label: "text-emerald-900/70 dark:text-emerald-200/70",
    valHover: "group-hover/chip:bg-emerald-100 dark:group-hover/chip:bg-emerald-900/50",
    catHover: "group-hover/chip:bg-emerald-200 dark:group-hover/chip:bg-emerald-700/60",
  },
  fv: {
    outer:
      "bg-sky-50 border-sky-300 dark:bg-sky-900/40 dark:border-sky-700",
    cat:
      "bg-sky-100 text-sky-900 dark:bg-sky-800/50 dark:text-sky-100",
    label: "text-sky-900/70 dark:text-sky-200/70",
    valHover: "group-hover/chip:bg-sky-100 dark:group-hover/chip:bg-sky-900/50",
    catHover: "group-hover/chip:bg-sky-200 dark:group-hover/chip:bg-sky-700/60",
  },
  bm: {
    outer:
      "bg-violet-50 border-violet-300 dark:bg-violet-900/30 dark:border-violet-700",
    cat:
      "bg-violet-100 text-violet-900 dark:bg-violet-800/50 dark:text-violet-100",
    label: "text-violet-900/70 dark:text-violet-200/70",
    valHover: "group-hover/chip:bg-violet-100 dark:group-hover/chip:bg-violet-900/50",
    catHover: "group-hover/chip:bg-violet-200 dark:group-hover/chip:bg-violet-700/60",
  },
  mixed: {
    outer:
      "bg-slate-50 border-slate-300 dark:bg-slate-800/60 dark:border-slate-600",
    cat:
      "bg-slate-100 text-slate-900 dark:bg-slate-700/70 dark:text-slate-100",
    label: "text-slate-900/70 dark:text-slate-200/70",
    valHover: "group-hover/chip:bg-slate-100 dark:group-hover/chip:bg-slate-700/70",
    catHover: "group-hover/chip:bg-slate-200 dark:group-hover/chip:bg-slate-600/70",
  },
};

function pickTagPalette(
  variant: TagGroupVariant,
  sources: string[],
): TagPaletteKey {
  if (variant === "direct") return "direct";
  if (sources.length === 1) {
    if (sources[0] === "FV") return "fv";
    if (sources[0] === "BM") return "bm";
  }
  return "mixed";
}

function TagGroupChip({
  category,
  tags,
  variant,
  charUriLookup,
  fvUriLookup,
  baselineLookup,
  experimentId,
  hideFreeTextValues = false,
}: {
  category: Tag["category"];
  tags: Tag[];
  variant: TagGroupVariant;
  charUriLookup: Map<string, string>;
  fvUriLookup: Map<string, string>;
  baselineLookup: Set<string>;
  experimentId: number | string;
  /** "Hide free-text" is checked — drop this group's unresolved
   *  VALUES, not just wholly-unresolved tags. */
  hideFreeTextValues?: boolean;
}) {
  // Hide free-text bites per VALUE — one inherited tag renders N
  // chips, so the tag-level test alone let a mixed tag's ungrounded
  // values through a checked box. Rule + rationale in
  // ``tagFreeTextFilter.ts``.
  const values = visibleTagValues(
    splitTagValues(tags, category, charUriLookup, fvUriLookup, baselineLookup),
    hideFreeTextValues,
  );
  const [showAllValues, setShowAllValues] = useState(false);

  // Single value (after comma-split) renders flat — no collapse to
  // worry about.
  // Outer chip palette signals provenance (direct EE tag vs FV-synth
  // vs BM-inferred); the chip splits into two tonal sections so the
  // category↔value seam is readable at scan distance. Per-value
  // ontology vs free-text styling lives on top inside the value
  // section.
  // House rule: amber means **warning** only — inferred chips are
  // informational, so they get the violet/sky palettes instead.

  // Inferred-source provenance shorthand. Most groups share one
  // source (all BM, all FV); a mixed group renders both joined with
  // "/". For the placeholder/empty case we fall back to "auto" so the
  // chip still signals inferred-ness. Sort the codes so the rendered
  // order is stable (e.g. always "BM/FV", never "FV/BM" depending on
  // which tag was first in the list).
  const sources =
    variant === "inferred"
      ? Array.from(
          new Set(
            tags.map((t) => inferredSourceTag(t.inferred_source)).filter(Boolean),
          ),
        ).sort()
      : [];
  // Source label dropped from inline render (C+B chip pass) — the
  // palette colour on the outer border already encodes BM vs FV vs
  // mixed. Surfaced in the hover title via `sources` directly.

  // Evidence-code mix across the group's tags. When all tags share
  // one code (the common case), use it for both the border style and
  // the badge. Mixed groups fall back to dashed (lower-trust wins
  // for the visual cue) and render the codes joined. Sorted for
  // stable rendering — same input, same output.
  const evCodes =
    variant === "inferred"
      ? Array.from(
          new Set(
            tags
              .map((t) => (t.evidence_code || "").trim().toUpperCase())
              .filter(Boolean),
          ),
        ).sort()
      : [];
  // Dashed-vs-solid evidence-border distinction dropped in the C+B
  // chip pass (2026-05-17) — too much competing styling per chip.
  // Evidence code now lives in the hover title only. Palette colour
  // (direct/FV/BM/mixed) is the at-a-glance signal.
  const evBorder = "border-solid";
  const evTitle =
    evCodes.length === 1
      ? ` · ${evCodes[0]} (${evidenceCodeName(evCodes[0])})`
      : evCodes.length > 1
        ? ` · evidence: ${evCodes.join(", ")}`
        : "";

  const palette = TAG_PALETTE[pickTagPalette(variant, sources)];

  // FV-synth chips get a clickable `ƒ` glyph that jumps to the Design
  // tab with the originating factor focused. Per design review, 2026-05-17 —
  // colour alone is not enough to signal source on dim screens; the
  // glyph + jump-affordance does double duty (distinguishable
  // typography signal + a real "edit me elsewhere" action).
  const isFvDerived = variant === "inferred" && sources.includes("FV");
  const factorGlyph = isFvDerived ? (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        requestAuditFocus(experimentId, factorTarget(category.label));
      }}
      className={`text-[10px] italic font-serif ${palette.label} hover:underline cursor-pointer leading-none align-baseline`}
      title={`${category.label} — edit on Design tab`}
      aria-label={`go to ${category.label} on Design tab`}
    >
      ƒ
    </button>
  ) : null;

  // C+B chip pass (2026-05-17): drop the in-chip category section
  // (the group row already says it) and the inline source badge
  // (palette colour already encodes it). Category + source + evidence
  // code live in the hover title. Result: chip = just value, bordered
  // by the source palette.
  //
  // Each value renders as its OWN bordered chip — no collapse into a
  // count / "+N more" / popover. Design review 2026-07-20: "I don't like the
  // collapsing of terms at all — this is confusing. Show each term."
  // (Supersedes the 2026-05-23 high-cardinality popover. The new
  // "hide inherited" default-on toggle keeps big inferred groups —
  // 30+ cell types on single-cell EEs — out of the default view, so a
  // curator only faces every term when they explicitly opt to show
  // inherited tags.)
  //
  // Demote free-text values when the group also carries at least one
  // URI-resolved value (per design review, 2026-05-17 — free text plays a
  // supporting role in mixed groups; pure-free-text groups stay at
  // normal weight so they remain readable).
  const hasUriValue = values.some((v) => !!v.uri);

  // Cap the FREE-TEXT tail on inherited groups. A characteristic that
  // carries roughly one free-text value per sample — per-sample sample-
  // source descriptions ("Human multiple myeloma patient sample 37"),
  // GSM titles, and the like — otherwise floods the row with 100+
  // near-identical chips that inform nothing (GSE… 8205). ``splitTagValues``
  // already orders ontology-resolved values first, so EVERY resolved
  // term stays visible; only the free-text overflow past the cap
  // collapses behind an inline "+N more" toggle that expands IN PLACE
  // (not the popover the reviewer retired 2026-07-20 — the terms are still all
  // one click away, in the same row). Direct/curator tags are never
  // capped. Design review 2026-07-21.
  const FREETEXT_CAP = 12;
  const resolvedVals = values.filter((v) => !!v.uri);
  const freeTextVals = values.filter((v) => !v.uri);
  const capActive =
    variant === "inferred" &&
    !showAllValues &&
    freeTextVals.length > FREETEXT_CAP;
  const shownValues = capActive
    ? [...resolvedVals, ...freeTextVals.slice(0, FREETEXT_CAP)]
    : values;
  const hiddenCount = values.length - shownValues.length;
  return (
    <>
      {shownValues.map((v) => (
        <span
          key={v.key}
          title={`${category.label}: ${v.label}${variant === "inferred" ? ` (inferred from ${sources.join(", ") || "auto"})${evTitle}` : ""}`}
          className={`inline-flex items-baseline gap-1 px-1.5 py-0.5 text-[11px] rounded border ${evBorder} ${palette.outer}`}
        >
          {factorGlyph}
          <TagValueChip
            value={v}
            categoryLabel={category.label}
            demoted={hasUriValue && !v.uri}
            needsGrounding={variant === "direct" && !v.uri}
          />
        </span>
      ))}
      {hiddenCount > 0 ? (
        <button
          type="button"
          onClick={() => setShowAllValues(true)}
          title={`Show ${hiddenCount} more inherited free-text value${hiddenCount === 1 ? "" : "s"} (mostly per-sample descriptions)`}
          className="inline-flex items-baseline px-1.5 py-0.5 text-[11px] rounded border border-dashed border-slate-300 text-slate-500 hover:bg-slate-50 hover:text-slate-700 dark:border-slate-600 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          +{hiddenCount} more
        </button>
      ) : null}
      {variant === "inferred" &&
      showAllValues &&
      freeTextVals.length > FREETEXT_CAP ? (
        <button
          type="button"
          onClick={() => setShowAllValues(false)}
          className="inline-flex items-baseline px-1.5 py-0.5 text-[11px] rounded border border-dashed border-slate-300 text-slate-500 hover:bg-slate-50 hover:text-slate-700 dark:border-slate-600 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          show fewer
        </button>
      ) : null}
    </>
  );
}


