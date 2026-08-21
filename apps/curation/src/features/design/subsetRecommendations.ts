import type {
  Design,
  Factor,
  FactorValue,
  SubsetLevel,
  SubsetRecommendation,
  SubsetTier,
} from "@/features/experiment/types";
import { shortenUri } from "@/lib/curie";

/**
 * The one fold over ``Design.subset_recommendations``.
 *
 * Four surfaces read these — the design tab's "Experiment-wide
 * decisions" pane, the proposer panel, the audit panel, and
 * ValidatorBanner's multi-baseline note — and each of them has to
 * answer the same three questions: does this apply, which factor is it
 * about, and how loudly should it be said. Every one of those answers
 * is a fold over fields that do NOT mean what they look like, so they
 * live here once rather than four times:
 *
 * - ``status: "agent_recommended"`` reads as "pending" and is not.
 *   Paul, 2026-08-20: *"the default is to accept it unless you
 *   disagree."* In effect on arrival; reject is the only disposition.
 * - ``by_factor_id`` reads as identity and is not — it is a per-row
 *   sequence number. ``gemma_factor_id`` is the identity.
 * - ``tier`` is absent on every row in the store today, so "no tier"
 *   has to read as unclassified rather than as tier 1 (`none`), which
 *   would silently hide every recommendation there is.
 *
 * Handoff: ``~/Dev/Gemma/handoffs/SUBSET_RECOMMENDATIONS_UI_2026_08_20.md``.
 */

/** Does this recommendation apply right now?
 *
 * 🛑 Not ``status === "accepted"``. Accept is the DEFAULT — a curator
 * who never opened the panel has agreed, and the only thing that turns
 * a recommendation off is rejecting it. ValidatorBanner asked the
 * narrow question and consequently kept telling curators to record a
 * subset-by that was already sitting in the design. */
export function isInEffect(r: SubsetRecommendation): boolean {
  return r.status !== "rejected";
}

export function isRejected(r: SubsetRecommendation): boolean {
  return r.status === "rejected";
}

// ─── Tier ────────────────────────────────────────────────────────

export interface TierMeta {
  /** Chip text. */
  label: string;
  /** One line on what the tier means, for a title attribute. */
  blurb: string;
  /** How loudly to surface it.
   *  - ``silent`` — nothing to show.
   *  - ``notice`` — say it, quietly, in passing. 🛑 Never a finding,
   *    never an issue, never anything the curator has to clear.
   *  - ``surface`` — a real curation signal; give it the room. */
  loudness: "silent" | "notice" | "surface";
}

/** Paul's four, 2026-08-20. Order is quiet → loud. */
export const TIER_META: Record<SubsetTier, TierMeta> = {
  none: {
    label: "no subset",
    blurb: "Clearly no subset or split.",
    loudness: "silent",
    // 🛑 Unreachable from the Gemma seeder and always will be — cab,
    // 2026-08-20: an axis that EXISTS is at minimum `convention`, and
    // tier 1 describes an experiment with no subset at all, which
    // produces no row to carry it. Kept for a producer that does
    // classify this way, and as the thing `tier` can say that `absent`
    // must not be read as.
  },
  convention: {
    label: "convention",
    blurb:
      "A tissue / cell-type axis subsetted as a matter of course — partly to " +
      "avoid uninteresting contrasts, partly because batch confounds ride " +
      "such axes. Not necessarily of interest to this study; we may omit it.",
    loudness: "notice",
  },
  qa: {
    label: "quality",
    blurb:
      "A batch confound that subsetting resolves. More serious than “this is " +
      "just how we do it”.",
    loudness: "surface",
  },
  two_in_one: {
    label: "two in one",
    // 🛑 An AXIS-level claim, not an experiment-level one. cab,
    // 2026-08-20: "a flagged experiment is not a flagged axis" — the
    // tier is localised by the framing pass's own subset verdict, so
    // this chip says *this axis is the seam*, which is stronger and
    // rarer than "this series may be two studies". Measured: 4 of 50
    // audited experiments carry should_split; exactly 1 has a Gemma
    // subset axis that is the seam. If a "may be two studies" banner
    // ever gets built, it is experiment-level and must NOT be driven
    // off this chip.
    blurb:
      "This axis is the seam: the series packs more than one study along " +
      "it, so the subset is necessary rather than conventional. Splitting " +
      "may be cleaner — the GSE is not a unit.",
    loudness: "surface",
  },
};

/** Tier metadata, or ``null`` when the row carries no tier.
 *
 * 🛑 Null is UNCLASSIFIED, not ``none``. Every row in the store today
 * is null (cab's classifier is measured but unshipped), so folding null
 * to tier 1 would hide all 69 of them — the exact failure this whole
 * change exists to fix. Callers treat null as "surface it plainly,
 * without a tier chip". */
export function tierMetaOf(r: SubsetRecommendation): TierMeta | null {
  const t = r.tier;
  if (!t) return null;
  return TIER_META[t] ?? null;
}

/** What to put on the tier chip's tooltip.
 *
 * The classifier's own sentence when it sent one — why THIS row got
 * THIS tier (Gemma's batch verdict for `qa`, the framing pass's split
 * reasoning for `two_in_one`) — otherwise the generic meaning of the
 * tier. Prose either way, rendered verbatim and never parsed.
 *
 * One helper so the compact strip and the roomy card can't end up
 * explaining the same chip differently. */
export function tierTitle(r: SubsetRecommendation): string | undefined {
  const evidence = (r.tier_evidence ?? "").trim();
  if (evidence) return evidence;
  return tierMetaOf(r)?.blurb;
}

/** Is this one a notice rather than something to act on?
 *
 * Cab's census: 64 of the 69 seeded recommendations are `convention`.
 * A surface that treats all 69 as work is wrong about 93% of them. */
export function isNotice(r: SubsetRecommendation): boolean {
  return tierMetaOf(r)?.loudness === "notice";
}

/** Should this be rendered at all? Only tier 1 says no. */
export function isSilent(r: SubsetRecommendation): boolean {
  return tierMetaOf(r)?.loudness === "silent";
}

// ─── Provenance ──────────────────────────────────────────────────

/** How the recommendation should introduce itself.
 *
 * `gemma` is a fact being carried, not a judgement being made — Gemma
 * recorded the subsetting axis on its own DEA — so it says so in those
 * words rather than borrowing the agent's "recommends". */
export function sourceLabel(r: SubsetRecommendation): string {
  switch (r.source) {
    case "gemma":
      return "Gemma already subsets on this";
    case "curator":
      return "your decision";
    case "agent":
    default:
      return "agent recommends";
  }
}

/** Short chip form of the same. */
export function sourceChip(r: SubsetRecommendation): string {
  switch (r.source) {
    case "gemma":
      return "from Gemma";
    case "curator":
      return "yours";
    case "agent":
    default:
      return "from agent";
  }
}

// ─── Factor resolution + staleness ───────────────────────────────

/** Which rung of the ladder answered. Rendered as provenance on a
 *  re-homed row, and useful when a resolution looks surprising. */
export type ResolveBasis = "gemma_id" | "local_id" | "category" | null;

export interface ResolvedSubset {
  /** The factor the recommendation is about, or null. */
  factor: Factor | null;
  /** The recommendation named an axis and nothing in this design
   *  answers to it.
   *
   *  🛑 EXPECTED, not an error. Paul, 2026-08-20: *"our polishing will
   *  cause this. it's okay."* Callers say "no longer applies" and stop
   *  offering it; nobody warns, and nobody asks the curator to fix
   *  anything.
   *
   *  🛑 A row that never named an axis is NOT stale — see
   *  ``namesAnAxis``. There is nothing for it to have drifted from. */
  stale: boolean;
  /** Which rung resolved it. */
  basis: ResolveBasis;
  /** Levels of ``factor`` the recommendation names. Empty
   *  ``level_labels`` means every level — that IS subset-DEA — so this
   *  is empty in the common case and must not read as "levels
   *  missing". */
  matchedLevels: FactorValue[];
  /** Named levels this factor no longer carries, compared by URI with
   *  both sides grounded.
   *
   *  🛑 A NOTE, never a verdict. cab, 2026-08-20: *"levels corroborate,
   *  they do not condemn"* — factor identity decides staleness. */
  driftedLevels: string[];
}

/** Does this recommendation point at an axis at all?
 *
 * A row may legitimately carry none: the agent's orphan-sample note on
 * GSE… (`by_factor_id: null`, `category: ""`, `level_labels: []`) is a
 * finding whose rationale is the whole content. Rendering it as
 * "Subset by (no factor) → every level" claimed a DEA per level of
 * nothing, and put "(NO FACTOR)" in the collapsed summary. */
export function namesAnAxis(r: SubsetRecommendation): boolean {
  return (
    typeof r.by_factor_id === "number" ||
    typeof r.gemma_factor_id === "number" ||
    !!(r.category ?? "").trim()
  );
}

function norm(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

/** Every grounded URI on a factor value — its statements' subjects. */
function fvUris(fv: FactorValue): string[] {
  const out: string[] = [];
  for (const st of fv.statements ?? []) {
    const u = (st.subject?.uri ?? "").trim();
    if (u) out.push(u);
  }
  return out;
}

/** Resolve a recommendation against a design. cab's four rungs,
 *  measured 2026-08-20 over 85 carries onto polished rows: 4 rescued by
 *  rung 3, 8 genuinely stale, and 4 that resolve to the WRONG factor if
 *  `by_factor_id` is trusted as it arrives.
 *
 *  1. `gemma_factor_id` matches a factor here → applies.
 *  2. the rec carries no Gemma id → fall back to `by_factor_id`.
 *  3. neither answered → a factor of the rec's `category` carrying NO
 *     Gemma id → applies. 🛑 Only an unidentified one; a same-category
 *     factor with a DIFFERENT Gemma id is a different factor.
 *  4. nothing → stale.
 *
 *  🛑 **Re-resolve on read, every time.** Never trust the
 *  `by_factor_id` a recommendation arrives with — it was only ever
 *  meaningful in the row it was computed against. GSE43825's
 *  `local-curator` row carries `by_factor_id: 1` and its ids start at
 *  3; GSE79061's correct id is 90000001. A mis-homed pointer does not
 *  dangle, it renders a real factor, the wrong one. */
export function resolveSubset(
  r: SubsetRecommendation,
  design: Design | null | undefined,
): ResolvedSubset {
  const factors = design?.factors ?? [];
  const none: ResolvedSubset = {
    factor: null,
    stale: false,
    basis: null,
    matchedLevels: [],
    driftedLevels: [],
  };
  // Nothing to have drifted from, and nothing to resolve.
  if (!namesAnAxis(r)) return none;
  if (factors.length === 0) return none;

  const gid = r.gemma_factor_id;
  let factor: Factor | null = null;
  let basis: ResolveBasis = null;

  // Rung 1 — the identity.
  if (typeof gid === "number") {
    factor = factors.find((f) => f.gemma_factor_id === gid) ?? null;
    if (factor) basis = "gemma_id";
  }

  // Rung 2 — the local pointer, when it is all there is. Two ways for
  // that to be true, and BOTH matter:
  //
  //  a. the rec carries no Gemma id (cab's rung 2), or
  //  b. this DESIGN carries no Gemma ids anywhere, so rung 1 failing
  //     taught us nothing. cab, 2026-08-20: that guard "stays
  //     load-bearing — `polished/local-curator` rows authored in the UI
  //     still carry none, by construction." Without it every
  //     UI-authored polished row reads as stale.
  //
  // 🛑 Deliberately NOT a fallback for a Gemma id that failed to match
  // in a design that DOES know Gemma ids: that is precisely how one
  // row's sequence number binds another row's factor.
  const designKnowsGemmaIds = factors.some(
    (f) => typeof f.gemma_factor_id === "number",
  );
  if (
    !factor &&
    (typeof gid !== "number" || !designKnowsGemmaIds) &&
    typeof r.by_factor_id === "number"
  ) {
    factor = factors.find((f) => f.id === r.by_factor_id) ?? null;
    if (factor) basis = "local_id";
  }

  // Rung 3 — the axis's own name, against a factor nobody has
  // identified. The common shape in polished gold is PARTIAL identity:
  // gold rebuilt one factor and the id backfill never reached it, so it
  // sits at `gemma_factor_id: null` beside identified siblings.
  //
  // 🛑 Requires the match to be UNIQUE. cab's rule kills a
  // same-category factor carrying a different Gemma id; two
  // unidentified factors of one category is the same ambiguity one step
  // on, and guessing between them is the mis-homing this rung exists to
  // prevent.
  const category = norm(r.category);
  if (!factor && category) {
    const candidates = factors.filter(
      (f) =>
        f.gemma_factor_id == null &&
        (norm(f.category?.label) === category || norm(f.name) === category),
    );
    if (candidates.length === 1) {
      factor = candidates[0];
      basis = "category";
    }
  }

  if (!factor) return { ...none, stale: true };

  // The levels the recommendation names. `levels` is the canonical
  // (label, uri) PAIR list (agents `c8fe0cc`); the two flat fields are
  // independently-sorted projections of it and are all that pre-`c8fe0cc`
  // rows carry — which is every row in the store until the next re-seed.
  const paired: SubsetLevel[] =
    r.levels && r.levels.length > 0
      ? r.levels
      : (r.level_labels ?? []).map((label) => ({ label, uri: null }));
  // 🛑 The URI side is a SET either way. From `levels` it is the
  // grounded half; from the flat fields it is `level_uris`, which must
  // be intersected and never zipped.
  const uriSet = new Set(
    (r.levels && r.levels.length > 0
      ? r.levels.map((lv) => lv.uri)
      : (r.level_uris ?? [])
    )
      .map((u) => (u ?? "").trim())
      .filter(Boolean),
  );

  // Levels, for display: URI first, label as the fallback — two
  // spellings of one concept are one concept, and 54 of 63 rows match
  // on label alone.
  const labelSet = new Set(paired.map((lv) => norm(lv.label)));
  const matchedLevels = (factor.factor_values ?? []).filter(
    (fv) =>
      fvUris(fv).some((u) => uriSet.has(u)) ||
      labelSet.has(norm(fv.free_text_label)),
  );

  // Drift, for a note: URIs only, and only where BOTH sides are
  // grounded. 9 of 69 axes carry no URIs at all, and an ungrounded
  // level must ABSTAIN rather than read as "gone".
  //
  // Naming the drifted level is only safe from `levels`, where the
  // label and the URI travel together. From the flat projections it is
  // not: 15 of 60 rows cannot be zipped at all, and on GSE20396 index 0
  // is `ganglionic layer of retina` on one side and `CL_0000210`
  // (retinal ganglion CELL) on the other. So a legacy row names the
  // CURIE — the thing that actually differs — rather than a label it
  // cannot vouch for.
  const factorUris = new Set(
    (factor.factor_values ?? []).flatMap(fvUris),
  );
  const driftedLevels: string[] = [];
  if (factorUris.size > 0) {
    for (const lv of paired) {
      const u = (lv.uri ?? "").trim();
      // 🛑 An ungrounded level ABSTAINS. `levels` keeps it with
      // `uri: ""` rather than dropping it, so the empty string is a
      // real value here and means "we cannot say", never "it is gone".
      if (!u) continue;
      if (!factorUris.has(u)) driftedLevels.push(lv.label || shortenUri(u));
    }
    // Pre-`c8fe0cc` rows have no pairs to walk — fall back to the set.
    if (!(r.levels && r.levels.length > 0)) {
      driftedLevels.length = 0;
      for (const u of uriSet) {
        if (!factorUris.has(u)) driftedLevels.push(shortenUri(u));
      }
    }
  }

  return { factor, stale: false, basis, matchedLevels, driftedLevels };
}

/** Display name for the axis a recommendation is about.
 *
 * The resolved factor's own name first, then the axis name the producer
 * recorded (`category` survives a rename and a rebuild, which neither
 * id does), then the bare id. Returns **null** when the row names no
 * axis — callers render those as a note rather than printing
 * "(no factor)", which is what put "SUBSET BY (NO FACTOR) AND CELL
 * TYPE" in the collapsed summary. */
export function subsetFactorLabel(
  r: SubsetRecommendation,
  design: Design | null | undefined,
): string | null {
  const { factor } = resolveSubset(r, design);
  if (factor) {
    return factor.name || factor.category?.label || `factor ${factor.id}`;
  }
  const category = (r.category ?? "").trim();
  if (category) return category;
  if (typeof r.by_factor_id === "number") return `factor ${r.by_factor_id}`;
  return null;
}

// ─── Collections ─────────────────────────────────────────────────

/** Did this arrive with a proposal, or is it already part of the
 *  record?
 *
 * Paul, 2026-08-20: *"these should be in the proposal panel on the
 * right, if they are coming from a proposal. If they are already in the
 * system, obviously they are shown."* `source` is exactly that
 * distinction — an `agent` row is the output of a proposer or audit run
 * (`agent:<run>:subset:framing`, and the run id rides on
 * `source_run_id`), while `gemma` is a fact Gemma already recorded on
 * its own DEA and `curator` is one you wrote down. */
export function isProposed(r: SubsetRecommendation): boolean {
  return r.source === "agent";
}

/** Recommendations worth putting in front of a curator: in effect, not
 *  tier 1, and still describing this design.
 *
 * Stale ones drop out on purpose — "stop being offered as-is" is the
 * instruction. They stay visible where the full list is (the design
 * tab), marked "no longer applies"; they just don't count as live. */
export function liveSubsets(
  design: Design | null | undefined,
): SubsetRecommendation[] {
  return (design?.subset_recommendations ?? []).filter(
    (r) => isInEffect(r) && !isSilent(r) && !resolveSubset(r, design).stale,
  );
}

/** The design tab's list: what is already part of the record.
 *
 * Agent rows live on the proposal panel while they are being reviewed —
 * except once REJECTED, because a rejection is a curator decision and
 * decisions belong in the decisions pane. Without that clause the only
 * control that undoes a rejection would vanish with the proposal. */
export function recordedSubsets(
  design: Design | null | undefined,
): SubsetRecommendation[] {
  return (design?.subset_recommendations ?? []).filter(
    (r) => !isSilent(r) && (!isProposed(r) || isRejected(r)),
  );
}

/** The proposal / audit panel's list: what the agent is proposing, and
 *  has not been dispositioned. */
export function proposedSubsets(
  design: Design | null | undefined,
): SubsetRecommendation[] {
  return (design?.subset_recommendations ?? []).filter(
    (r) =>
      isProposed(r) &&
      isInEffect(r) &&
      !isSilent(r) &&
      !resolveSubset(r, design).stale,
  );
}

/** How many recommendations the curator has actively turned off.
 *
 * The collapsed pane needs this separately from ``summariseSubsets``:
 * a rejection is not in effect, so it contributes nothing to "what
 * applies" — but it IS something the curator recorded, and the only
 * control that undoes it lives inside the pane. Saying "none recorded"
 * over a rejection collapses the pane on the one state where the
 * curator most likely wants back in. */
export function countRejectedSubsets(
  design: Design | null | undefined,
): number {
  return (design?.subset_recommendations ?? []).filter(
    (r) => isRejected(r) && !isSilent(r),
  ).length;
}

/** Does anything here actually want the curator's attention?
 *
 * Drives whether the pane opens on arrival. 63 of the 69 seeded
 * recommendations are tier-2 `convention` — routine policy Paul has
 * said should be *"a NOTICE at most"* — so opening a ~950px pane for
 * one is the panel shouting a fact at somebody who did not ask. `qa`
 * and `two_in_one` are real signals and do earn it. */
export function subsetsWantAttention(
  design: Design | null | undefined,
): boolean {
  return liveSubsets(design).some(
    (r) => tierMetaOf(r)?.loudness === "surface",
  );
}

/** One line for a collapsed surface — the design tab's `<summary>`,
 *  where "none recorded" was showing over a live Gemma recommendation
 *  (Paul, 2026-08-20). Returns null when there is genuinely nothing.
 *
 *  Names the axis rather than counting, because "1 subset" tells the
 *  reviewer nothing they can act on. Rows that name no axis are counted
 *  instead of named — "(no factor)" is not a thing to say in a summary. */
export function summariseSubsets(
  design: Design | null | undefined,
): string | null {
  const live = recordedSubsets(design).filter(
    (r) => isInEffect(r) && !resolveSubset(r, design).stale,
  );
  if (live.length === 0) return null;
  const names: string[] = [];
  let unnamed = 0;
  for (const r of live) {
    const label = subsetFactorLabel(r, design);
    if (label) names.push(label);
    else unnamed++;
  }
  const notes = unnamed > 0 ? `${unnamed} note${unnamed === 1 ? "" : "s"}` : "";
  if (names.length === 0) return notes || null;
  const head =
    names.length === 1
      ? `subset by ${names[0]}`
      : names.length === 2
        ? `subset by ${names[0]} and ${names[1]}`
        : `subset by ${names[0]} and ${names.length - 1} more`;
  return notes ? `${head} · ${notes}` : head;
}

/** The split half of the same summary. ``-1`` is the curator's explicit
 *  "do NOT split"; a positive id names the axis; null / undefined is no
 *  decision. */
export function summariseSplit(
  design: Design | null | undefined,
): string | null {
  const id = design?.should_split_on_factor_id;
  if (id == null) return null;
  if (id === -1) return "no-split asserted";
  const f = (design?.factors ?? []).find((x) => x.id === id);
  const name = f
    ? f.name || f.category?.label || `factor ${f.id}`
    : `factor ${id}`;
  return `split on ${name}`;
}
