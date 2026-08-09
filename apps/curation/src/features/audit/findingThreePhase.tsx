/**
 * Three-phase finding card body.
 *
 * Per design review 2026-06-15: every finding card renders EXACTLY
 * THREE flat labelled sections, in order:
 *
 *   1. **Why proposed** — proposer rationale + evidence + citation.
 *      NEVER references gold or any other curation set.
 *   2. **Reviews** — flat list of reviewer-LLM verdicts (defender,
 *      factor_defender, arbiter, boss). Each row reads as
 *      ``<reviewer> ▪ <verdict tag> ▪ <one-sentence gist>``. Header
 *      ALWAYS shown (design review 2026-06-15: helps the curator see what's
 *      expected to be there), even when no reviewers ran. Reviewers
 *      DO NOT compare to any external curation set.
 *   3. **Comparison vs <set>** — chip strip + comparison-judge
 *      verdict + accept/reject affordance. Comparator is supplied by
 *      the calling card (factor-card grid, tag-card chip strip).
 *      OMITTED ENTIRELY when no comparison ran — NO "Auditor says
 *      (no entry)" placeholder.
 *
 * Each phase shows a brief summary always; supporting detail collapses
 * behind a per-section show/hide chevron. Brief stays visible so the
 * curator can scan; expand to dig in.
 *
 * Anti-patterns this replaces:
 *   - "STRONG SUGGESTION" / "NOT SUGGESTED" header (confidence rides
 *     on each reviewer's verdict tag now).
 *   - "INTERNAL REVIEW — proposer-side defence (judge/boss)" subtitle.
 *   - "Auditor says ... no entry" placeholder line.
 *   - Nested-box decoration (the slate / blue / emerald per-section
 *     bordered envelopes that ``SectionedJudgeChain`` shipped).
 *
 * Wire shape: reads ``finding.why`` / ``finding.reviews`` /
 * ``finding.comparison`` directly. The transitional legacy-field
 * fallbacks (``proposer_defense`` / ``defender_verdict`` / … projected
 * into the new shape at render time) were dropped once the producer
 * shipped the three blocks — see the phase-3 note below the imports
 * for what replaced them.
 */

import { useState, type ReactNode } from "react";
import type {
  AuditFinding,
  AuditReport,
  ReviewVerdict,
  WhyBlock,
} from "@/api/auditTypes";
import { cn } from "@/lib/cn";
import { FindingEvidenceBlock } from "./agentDetailsPanel";
import { RuleCite } from "./RuleCite";
import { HelpPopup } from "@/components/ui/HelpPopup";
import { guidelineRefForFinding } from "@/lib/guidelineRegistry";
import { normalizeWikiUrl } from "@/lib/guidelines";
import { splitRationaleTrail } from "./rationaleText";

// ---------------------------------------------------------------------------
// Phase 3 of the rollout (design review 2026-06-15): UI now reads the new wire
// blocks (`finding.why` / `finding.reviews` / `finding.comparison`)
// directly. Legacy field fallbacks dropped; vocabulary translation
// dropped (producer ships curator-friendly verdict strings via the
// agents-repo `curator_verdict_label()` map, and the eval-repo
// migration script `migrate_findings_to_three_phase.py` translated
// every stored review's wire labels). If a finding lacks a populated
// `why` block the section is omitted (gold_only_miss findings have
// no positive proposer rationale by design). If `reviews` is empty
// the section renders with the "no review was done" placeholder.
// ---------------------------------------------------------------------------

/**
 * Curator-friendly label for a verdict code/string.
 *
 * Two buckets, attributed against the producer
 * (``build_calibration_batch.py`` ``_LEGACY_LEANS`` / ``_ARBITER_LEANS``)
 * and the "defender is proposer reasoning" framing rule:
 *
 *  1. **Proposer's reasoning** (no-gold codes). The proposer never
 *     sees current/gold — its verdict is a confidence read on its OWN
 *     reasoning ("strongly supported" / "borderline"), NOT a debate
 *     ruling. These strings must never reference "current" or "gold".
 *  2. **Arbiter ruling** (gold-aware codes). Emitted by the
 *     gold-aware arbiter / comparison judge — these MAY reference
 *     current-vs-proposal ("the current curation is correct"). Any
 *     code that names gold/current (``*_overzealous_gold``,
 *     ``gold_correct_per_rule``, ``concept_gold_right``, …) belongs
 *     here, even the ones the producer files under the holdover
 *     "legacy defender" dict.
 *
 * The producer also ships pre-translated curator strings on newer
 * packages; those human strings are not keys here and fall through
 * the trimmed pass-through unchanged (so a finding that already reads
 * "Real new factor" stays verbatim). Unknown snake_case codes are
 * humanized (underscores → spaces, sentence case) rather than shown
 * raw.
 */

/** Proposer-reasoning codes — confidence read on the proposer's own
 *  reasoning. NO current/gold reference. */
const PROPOSER_REASONING_LABELS: Record<string, string> = {
  // Tag agent_extra side — "the extra tag I proposed is …".
  extra_genuine_new: "strongly supported",
  extra_borderline: "borderline",
  extra_unsupported: "weakly supported",
  extra_confounded: "borderline (possible confound)",
  extra_inherited_redundant: "weakly supported (redundant)",
  agent_correct_inherited: "supported (inherited)",
  // Tag/factor agent_miss side — "I may have missed this".
  agent_miss_genuine: "borderline (possible miss)",
  miss_genuine: "borderline (possible miss)",
  miss_inherited_from_design: "supported (from design)",
  miss_borderline: "borderline",
};

/** Arbiter-ruling codes — gold-aware comparison verdicts. MAY
 *  reference current-vs-proposal. */
const ARBITER_RULING_LABELS: Record<string, string> = {
  // Per-rule arbiter rulings.
  agent_correct_per_rule: "Ruling: the proposal is correct",
  gold_correct_per_rule: "Ruling: the current curation is correct",
  equivalent_per_rule: "Ruling: equivalent",
  equivalent_by_judgment: "Ruling: equivalent",
  judgment_genuine_miss: "Ruling: the current curation has it (genuine miss)",
  judgment_unclear: "Couldn't judge",
  guideline_omission: "Ruling: guideline gap",
  cannot_judge: "Couldn't judge",
  // Gold-naming verdicts the producer files under the "legacy
  // defender" dict but which are gold-aware comparison rulings.
  agent_correct_overzealous_gold:
    "Ruling: the proposal is correct (current curation overzealous)",
  miss_overzealous_gold:
    "Ruling: the proposal is correct (current curation overzealous)",
  // Same-category / same-partition FV-subject concept comparison.
  concept_agent_right: "Ruling: the proposal is correct",
  concept_gold_right: "Ruling: the current curation is correct",
  concept_equivalent: "Ruling: equivalent",
  concept_both_wrong: "Ruling: neither side is correct",
  concept_borderline: "Ruling: borderline",
};

/** Humanize an unrecognized snake_case code: underscores → spaces,
 *  first letter upper. Never surface raw ``snake_case`` to curators. */
function humanizeVerdictCode(raw: string): string {
  const spaced = raw.replace(/_/g, " ").trim();
  if (!spaced) return "";
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Curator-friendly label for a verdict code/string.
 *
 *  Lookup order:
 *    1. Known proposer-reasoning code → confidence read.
 *    2. Known arbiter-ruling code → comparison ruling.
 *    3. Already-human producer string (no underscores, has a space or
 *       is short prose) → pass through trimmed.
 *    4. Unknown snake_case code → humanized.
 *
 *  Always exported as a single callable so callers don't depend on
 *  whether translation happens here or at the producer. */
export function verdictLabel(raw: string | null | undefined): string {
  const v = (raw ?? "").trim();
  if (!v) return "";
  if (v in PROPOSER_REASONING_LABELS) return PROPOSER_REASONING_LABELS[v];
  if (v in ARBITER_RULING_LABELS) return ARBITER_RULING_LABELS[v];
  // Looks like a raw snake_case code we don't know? Humanize it.
  // (Single token with underscores, no spaces — e.g. a future
  // ``foo_bar_baz`` verdict.) Otherwise it's already curator prose:
  // pass through verbatim.
  if (/^[a-z0-9]+(_[a-z0-9]+)+$/.test(v)) return humanizeVerdictCode(v);
  return v;
}

/** Phase-1 Why block. Returns the wire block when populated; null
 *  otherwise (caller omits the section). */
export function deriveWhy(finding: AuditFinding): WhyBlock | null {
  const w = finding.why;
  if (!w) return null;
  const hasContent =
    (w.brief && w.brief.trim()) ||
    (w.rationale && w.rationale.trim()) ||
    (w.evidence && w.evidence.length > 0) ||
    (w.citation && w.citation.trim()) ||
    (w.citation_url && w.citation_url.trim());
  return hasContent ? w : null;
}

/** Phase-2 Reviews list. Returns the wire list directly. Empty list
 *  when no reviewer LLM ran — caller renders the "no review was done"
 *  placeholder. */
export function deriveReviews(
  finding: AuditFinding,
  _report: AuditReport | null,
): ReviewVerdict[] {
  return finding.reviews ?? [];
}

// ---------------------------------------------------------------------------
// Phase-level section primitive — flat, no nested boxes.
// ---------------------------------------------------------------------------

/** One flat section in the three-phase render. Header always
 *  visible, body collapses behind a per-section chevron. ``brief``
 *  shows even when the section is collapsed (so the curator can
 *  scan); ``detail`` reveals on expand. */
function PhaseSection({
  header,
  headerAccessory,
  brief,
  detail,
  defaultOpen = false,
  alwaysShowHeader = true,
}: {
  header: string;
  /** Small affordance rendered immediately after the header label
   *  (e.g. a ``<RuleCite/>`` ``?`` next to "Why proposed"). */
  headerAccessory?: ReactNode;
  brief: ReactNode | null;
  detail: ReactNode | null;
  defaultOpen?: boolean;
  alwaysShowHeader?: boolean;
}): JSX.Element | null {
  const [open, setOpen] = useState(defaultOpen);
  const hasBrief = brief != null && brief !== false && brief !== "";
  const hasDetail = detail != null && detail !== false && detail !== "";
  if (!hasBrief && !hasDetail && !alwaysShowHeader) return null;
  // Compact: the label is an inline lead-in, not a heading on its own
  // row. ``LABEL  content………  [more]`` keeps a one-line fact to one
  // line and only spends vertical space on genuinely-folded detail.
  return (
    <section className="leading-snug">
      <div className="flex items-baseline gap-x-2 flex-wrap">
        <span className="rs-10 uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400 shrink-0">
          {header}
        </span>
        {headerAccessory ? (
          <span className="shrink-0">{headerAccessory}</span>
        ) : null}
        {hasBrief ? (
          <div className="flex-1 min-w-0 rs-11 text-slate-700 dark:text-slate-200">
            {brief}
          </div>
        ) : null}
        {hasDetail ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="rs-10 text-slate-400 hover:text-slate-700 underline-offset-2 hover:underline dark:text-slate-500 dark:hover:text-slate-200 shrink-0"
            aria-label={open ? `hide ${header} details` : `show ${header} details`}
            title={open ? "hide details" : "show details"}
          >
            {open ? "less" : "more"}
          </button>
        ) : null}
      </div>
      {open && hasDetail ? (
        <div className="mt-0.5 pl-1 rs-11 text-slate-700 dark:text-slate-200 space-y-1">
          {detail}
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Phase 1 — Why proposed
// ---------------------------------------------------------------------------

function WhyPhase({
  why,
}: {
  why: WhyBlock | null;
}): JSX.Element | null {
  if (!why) return null;
  const rationale = (why.rationale ?? "").trim();
  const evidence = why.evidence ?? [];
  const citation = (why.citation ?? "").trim();
  const citationUrl = (why.citation_url ?? "").trim();
  // Split off the agent's raw reasoning trail ("— Full agent reasoning
  // trail — [S8b_…] (target=design) …") from the curator-facing
  // summary. Dumping the whole concatenated subtask log inline made
  // the section an illegible wall (design review 2026-06-21). The summary stays
  // in ``brief``; the trail tucks behind the section's "more" toggle,
  // formatted one step per line.
  const { summary, trail } = splitRationaleTrail(rationale);
  const summaryText = (summary ?? "").trim();
  // Dedupe: when the summary is just the lone evidence quote (e.g.
  // ``TOV112D (8)`` for a characteristic-sourced tag), the compact
  // evidence line below already shows it — don't print it twice.
  const soleQuote =
    evidence.length === 1 ? (evidence[0].quote ?? "").trim() : null;
  const showRationale = summaryText && summaryText !== soleQuote;
  // Evidence is the 411 — show it inline + compact, no fold. Context
  // (when present) hides behind the per-line "context" toggle inside
  // FindingEvidenceBlock's compact mode.
  const brief = (
    <div className="space-y-0.5">
      {showRationale ? <div>{summaryText}</div> : null}
      {evidence.map((ev, i) => (
        <FindingEvidenceBlock key={i} evidence={ev} compact />
      ))}
      {citation || citationUrl ? (
        <div className="rs-10 text-slate-500 dark:text-slate-400">
          §{" "}
          {citationUrl ? (
            <a
              href={normalizeWikiUrl(citationUrl)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-700 hover:underline dark:text-blue-300"
              title={citation || citationUrl}
            >
              {citation || citationUrl}
            </a>
          ) : (
            <span>{citation}</span>
          )}
        </div>
      ) : null}
    </div>
  );
  return (
    <PhaseSection
      header="Why proposed"
      headerAccessory={
        <HelpPopup title="Why proposed" size="md">
          <div className="leading-snug">
            The proposer's rationale + supporting evidence (quotes /
            sources) for this proposal — the reasoning that led to it. It
            describes the proposal on its own terms and never references
            your current curation.
          </div>
        </HelpPopup>
      }
      brief={brief}
      detail={trail ? <ReasoningTrailDetail trail={trail} /> : null}
    />
  );
}

/** Render the agent's concatenated reasoning trail as one readable
 *  step per line. The agent emits it as
 *  ``[S8b_design_opus_escalation] (target=design) <prose>
 *  [S8_dea_usability] (target=design) <prose> …`` — one long string
 *  with no breaks. We split at each ``[subtask] (target=…)`` marker so
 *  each step gets its own line, with the marker in muted monospace so
 *  the eye can scan the pipeline. Falls back to the raw text when the
 *  markers aren't present. Design review 2026-06-21: "this is an illegible
 *  mess." */
function ReasoningTrailDetail({ trail }: { trail: string }): JSX.Element {
  const segments = trail
    .split(/(?=\[[A-Za-z0-9_]+\]\s*\(target=)/g)
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length <= 1) {
    return <div className="whitespace-pre-wrap">{trail}</div>;
  }
  return (
    <div className="space-y-1.5">
      {segments.map((seg, i) => {
        const m = /^\[([A-Za-z0-9_]+)\]\s*(\(target=[^)]*\))?\s*([\s\S]*)$/.exec(
          seg,
        );
        if (!m) {
          return (
            <div key={i} className="whitespace-pre-wrap">
              {seg}
            </div>
          );
        }
        const [, label, target, body] = m;
        return (
          <div key={i}>
            <span className="font-mono rs-10 text-slate-500 dark:text-slate-400">
              {label}
            </span>
            {target ? (
              <span className="font-mono rs-10 text-slate-400 dark:text-slate-500 ml-1">
                {target}
              </span>
            ) : null}{" "}
            <span>{body.trim()}</span>
          </div>
        );
      })}
    </div>
  );
}

/** A small "GUIDELINE  ?" row that pops the precise curation rule for
 *  the finding. Rendered at the top of the reasoning body (not gated on
 *  a Why block) so it appears on EVERY finding that maps to a rule —
 *  including match findings, whose Why phase is suppressed. Renders
 *  nothing when the finding resolves to no rule. Design review 2026-06-21. */
function GuidelineCiteRow({ finding }: { finding: AuditFinding }): JSX.Element | null {
  if (!guidelineRefForFinding(finding)) return null;
  return (
    <div className="flex items-baseline gap-1 rs-10 text-slate-500 dark:text-slate-400">
      <span className="uppercase tracking-wide font-semibold shrink-0">
        guideline
      </span>
      <RuleCite finding={finding} size="sm" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Phase grouping — the three VOICES, visually separated (ticket 83).
//
// Curator feedback (2026): the three phases "blend together and it's too
// hard to tell what the proposer did vs. what was internal-critic vs.
// what was based on comparison with gold." The fix is grouping +
// labelling — NOT a data change. Every phase's voice gets a labelled
// container so the curator instantly knows who is speaking, and the
// load-bearing **gold-blind vs gold-seeing** distinction is made
// unmissable (the gold-comparison group is tinted + explicitly marked
// "sees gold — eval only", distinct from the two gold-blind groups).
//
// The reviewer LLMs sort into voices deterministically here (UI-side
// classification, no data mutation): defender / factor_defender / arbiter /
// comparison judge are the GOLD-SEEING voices (the defender pass reads
// gold.jsonl in audit mode, so it is gold-AWARE — corrected 2026-07-01, it
// used to be mis-filed as the gold-blind proposer); the boss is the
// gold-blind INTERNAL CRITIC. The PROPOSER's own gold-blind reasoning is
// NOT a review row — it is the separate WHY block in the Proposer voice.
// ---------------------------------------------------------------------------

type PhaseKind = "proposer" | "critic" | "gold";

/** Which voice a reviewer belongs to. The arbiter / comparison judge AND
 *  the defender / factor-defender see the gold standard (gold-aware);
 *  ``reviewerPhase`` never returns "proposer" — the proposer's gold-blind
 *  reasoning is the WHY block, not a review. Unknown reviewers fall to the
 *  internal-critic group. */
export function reviewerPhase(reviewer: string | null | undefined): PhaseKind {
  const k = (reviewer ?? "").trim().toLowerCase();
  // Gold-SEEING voices: the arbiter, the generic comparison judge, and
  // the fv-concept adjudicator (label "fv-concept (vs gold)"). The
  // fv-concept judge compares the agent's concept to GOLD — it must
  // land in the Gold-comparison phase, never the gold-blind Proposer
  // phase (that duplicated its ruling into both). Match on "concept"
  // or an explicit "gold"/"vs gold" marker in the reviewer label.
  if (
    k.includes("arbiter") ||
    k.includes("comparison") ||
    k.includes("concept") ||
    k.includes("vs gold") ||
    k.includes("(gold") ||
    // The defender / factor-defender passes READ the gold standard
    // (run_defender_pass.py loads gold.jsonl and runs in "audit" mode when
    // gold is present) — they are gold-AWARE, not the gold-blind proposer.
    // Their advocacy belongs in the sees-gold group alongside the arbiter,
    // so a gold-referencing defender rationale ("the curator's collapse is
    // correct") never reads as the proposer's gold-blind reasoning. The
    // proposer's OWN gold-blind rationale is the separate WHY block, which
    // lives in the Proposer voice group independently of these reviews.
    k === "defender" ||
    k === "factor_defender"
  ) {
    return "gold";
  }
  return "critic";
}

/** Whitespace/case-normalise a rationale for near-duplicate detection. */
function normRationale(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Collapse near-duplicate review rows: when one row's normalised
 *  rationale is a prefix of / contained in another's, keep the longer
 *  (more-complete) row and drop the shorter. Belt-and-suspenders for the
 *  fv-concept full-text-vs-arbiter-brief pair even if a stale package
 *  slipped both rows through. Order-stable on the kept rows. */
export function dedupeReviews(reviews: ReviewVerdict[]): ReviewVerdict[] {
  const kept: ReviewVerdict[] = [];
  for (const r of reviews) {
    const key = normRationale(r.rationale) || normRationale(r.verdict);
    if (!key) {
      kept.push(r);
      continue;
    }
    let replaced = false;
    let dropped = false;
    for (let i = 0; i < kept.length; i++) {
      const ek =
        normRationale(kept[i].rationale) || normRationale(kept[i].verdict);
      if (!ek) continue;
      if (ek === key || ek.includes(key) || key.includes(ek)) {
        if (key.length > ek.length) {
          kept[i] = r;
          replaced = true;
        } else {
          dropped = true;
        }
        break;
      }
    }
    if (!replaced && !dropped) kept.push(r);
  }
  return kept;
}

/** Small pill marking whether the voice saw the gold standard. This is
 *  the load-bearing eval distinction — the two gold-blind voices carry
 *  the real signal; the gold-seeing voice is the eval crutch. */
function GoldVisibilityBadge({ seesGold }: { seesGold: boolean }): JSX.Element {
  return seesGold ? (
    <span
      data-testid="gold-visibility-sees-gold"
      className="rs-10 font-semibold text-amber-700 dark:text-amber-300"
    >
      sees reference · eval only
    </span>
  ) : (
    <span
      data-testid="gold-visibility-gold-blind"
      className="rs-10 font-medium text-emerald-700 dark:text-emerald-400"
    >
      reference-blind
    </span>
  );
}

/** A labelled container for ONE voice. Flat / minimal (matches the dark
 *  style): a coloured left rule + a badge header. The gold-seeing group
 *  additionally gets an amber tint so it reads as visually apart from
 *  the two gold-blind groups at a glance. */
function PhaseGroup({
  kind,
  title,
  help,
  children,
}: {
  kind: PhaseKind;
  title: string;
  help?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  const seesGold = kind === "gold";
  return (
    <section
      data-testid={`phase-group-${kind}`}
      data-phase-gold={seesGold ? "sees-gold" : "gold-blind"}
      className={cn(
        "rounded-sm border-l-2 pl-2 pr-1 py-1",
        seesGold
          ? "border-amber-400 bg-amber-50/60 dark:border-amber-500/70 dark:bg-amber-950/20"
          : "border-slate-300 dark:border-slate-600",
      )}
    >
      <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
        <span
          className={cn(
            "rs-10 uppercase tracking-wide font-bold px-1 py-px rounded-sm",
            seesGold
              ? "text-amber-800 bg-amber-100 dark:text-amber-200 dark:bg-amber-900/40"
              : "text-slate-600 bg-slate-100 dark:text-slate-300 dark:bg-slate-800",
          )}
        >
          {title}
        </span>
        <GoldVisibilityBadge seesGold={seesGold} />
        {help ? <span className="shrink-0">{help}</span> : null}
      </div>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

/** Muted "nothing here" note for a voice that produced no content for
 *  this finding (keeps the three-voice scaffold stable so the curator
 *  learns the fixed layout). */
function NoneNote({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="rs-10 italic text-slate-400 dark:text-slate-500">
      {children}
    </div>
  );
}

/** Flat list of reviewer rows (no per-row detail in this revision — the
 *  one-sentence rationale IS the brief). */
function ReviewList({ reviews }: { reviews: ReviewVerdict[] }): JSX.Element {
  return (
    <ul className="space-y-0.5">
      {reviews.map((r, i) => (
        <ReviewRow key={i} review={r} />
      ))}
    </ul>
  );
}

/** Curator-facing reviewer name. The wire uses the producer's internal
 *  role names (``defender`` / ``factor_defender``); "defender" reads as
 *  adversarial jargon. It is the gold-AWARE agent-side defence (it reads
 *  gold), so it renders in the sees-gold group — name it "agent defence",
 *  NOT "proposer's reasoning" (the proposer is gold-blind; its reasoning is
 *  the separate WHY block). Leave arbiter / boss as-is. */
function reviewerLabel(reviewer: string | null | undefined): string {
  const r = (reviewer ?? "").trim();
  const key = r.toLowerCase();
  if (key === "defender" || key === "factor_defender") {
    return "agent defence";
  }
  return r;
}

function ReviewRow({ review }: { review: ReviewVerdict }): JSX.Element {
  const v = verdictLabel(review.verdict);
  const r = (review.rationale ?? "").trim();
  const isBoss = (review.reviewer ?? "").trim().toLowerCase() === "boss";
  // Phase 5 (design review 2026-06-15): boss-row copy is intentionally
  // minimized. We surface that the boss reviewed and made changes,
  // but don't expose the structured-action specifics
  // (`undo` / `rename` / `change_category` / `drop_fv`) as
  // per-card affordances. Keeps the card from becoming a
  // boss-action interface. The boss's rationale (when present)
  // appears as the italic continuation, same as other reviewers.
  if (isBoss) {
    return (
      <li className="flex items-baseline gap-1.5 flex-wrap">
        <span className="rs-10 uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400">
          boss
        </span>
        <span className="text-slate-400 dark:text-slate-500">▪</span>
        <span className="rs-11 font-medium text-slate-700 dark:text-slate-200">
          review resulted in changes based on feedback
        </span>
        {r ? (
          <>
            <span className="text-slate-400 dark:text-slate-500">▪</span>
            <span className="rs-11 italic text-slate-600 dark:text-slate-300">
              {r}
            </span>
          </>
        ) : null}
      </li>
    );
  }
  return (
    <li className="flex items-baseline gap-1.5 flex-wrap">
      <span className="rs-10 uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400">
        {reviewerLabel(review.reviewer)}
      </span>
      <span className="text-slate-400 dark:text-slate-500">▪</span>
      {v ? (
        <span className="rs-11 font-medium text-slate-700 dark:text-slate-200">
          {v}
        </span>
      ) : null}
      {v && r ? (
        <span className="text-slate-400 dark:text-slate-500">▪</span>
      ) : null}
      {r ? (
        <span className="rs-11 italic text-slate-600 dark:text-slate-300">
          {r}
        </span>
      ) : null}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Three-phase body — composes all three phases.
// ---------------------------------------------------------------------------

/** The three-phase render. Pass-through for ``FindingEvidence``
 *  rendering (uses the existing ``FindingEvidenceBlock`` so quote /
 *  context / highlight behaviour stays consistent with the legacy
 *  panel).
 *
 *  Phase 3 renders from ``finding.comparison`` via
 *  ``ComparisonJudgePhase`` below, and is omitted entirely when no
 *  comparison ran. An earlier design had the CALLER own phase 3 (so it
 *  could supply a per-kind chip strip / FactorComparisonGrid) via an
 *  exported ``ComparisonPhase``; no caller ever adopted it, so that
 *  half was removed rather than left as a second way to draw the same
 *  section. */
export function ThreePhaseFindingBody({
  finding,
  report,
}: {
  finding: AuditFinding;
  report: AuditReport | null;
}): JSX.Element {
  let why = deriveWhy(finding);
  // ``suggested_fix`` fallback: when no judge / defender / proposer
  // stage has populated a Why block but the agent shipped a one-line
  // ``suggested_fix`` ("Already captured by biomaterial
  // characteristic"), surface it as the Why brief. Better than a
  // bare empty WHY PROPOSED slot the curator has nothing to act on.
  // Per FINDING_SHORT_RATIONALE_BM_AWARE_2026_06_16.
  //
  // EXCEPT match findings (design review 2026-06-19, GSE241529): a
  // ``calibration_match`` / ``calibration_tag_match_*`` carries a
  // ``suggested_fix`` of "Remove tag `X` from the existing curation."
  // — that's the action a *reject* disposition performs, NOT a
  // proposal. Surfacing it under "WHY PROPOSED" made a confirmed match
  // read as a removal recommendation ("TAG MATCH … Remove tag"). A
  // match has no proposal to remove; suppress the fallback for it.
  // (Producer also clears the text on new builds; this guard fixes
  // already-built packages and is defence-in-depth.)
  const isMatchCode =
    !!finding.issue_code && /(^|_)match(_exact|_near|_close)?$/.test(
      finding.issue_code,
    );
  if (!why && !isMatchCode) {
    const fix = (finding.suggested_fix ?? "").trim();
    if (fix) {
      why = {
        brief: fix,
        rationale: fix,
        evidence: [],
        citation: "",
        citation_url: "",
      } as WhyBlock;
    }
  }
  // Collapse near-duplicate review rows before splitting into voices
  // (belt-and-suspenders for the fv-concept full-text-vs-arbiter-brief
  // pair; the build-side dedup is the primary guard).
  const reviews = dedupeReviews(deriveReviews(finding, report));
  const comparison = finding.comparison ?? null;

  // Sort reviewer LLMs into their voice (UI-side, no data mutation).
  const proposerReviews = reviews.filter(
    (r) => reviewerPhase(r.reviewer) === "proposer",
  );
  const criticReviews = reviews.filter(
    (r) => reviewerPhase(r.reviewer) === "critic",
  );
  // Within the gold phase, the fv-concept review row and the
  // comparison-judge block can restate the same ruling. Drop a gold
  // review whose rationale near-duplicates the comparison-judge text so
  // the phase shows the ruling once.
  const comparisonText = normRationale(
    comparison?.judge_rationale || comparison?.judge_brief || "",
  );
  const goldReviews = reviews.filter((r) => {
    if (reviewerPhase(r.reviewer) !== "gold") return false;
    if (!comparisonText) return true;
    const rk = normRationale(r.rationale);
    if (!rk) return true;
    return !(
      rk === comparisonText ||
      rk.includes(comparisonText) ||
      comparisonText.includes(rk)
    );
  });

  const hasProposer = !!why || proposerReviews.length > 0;
  const hasGoldComparison = goldReviews.length > 0 || !!comparison;

  return (
    <div className="space-y-1.5">
      <GuidelineCiteRow finding={finding} />

      {/* Voice 1 — the proposer (reference-blind): what it proposed + why. */}
      <PhaseGroup
        kind="proposer"
        title="Proposer"
        help={
          <HelpPopup title="Proposer — reference-blind" size="md">
            <div className="leading-snug">
              What the agent proposed and its own reasoning for it. The
              proposer never sees your current curation or any reference
              standard — its rationale and any confidence read
              ("strongly supported" / "borderline") describe the
              proposal on its own terms.
            </div>
          </HelpPopup>
        }
      >
        <WhyPhase why={why} />
        {proposerReviews.length > 0 ? (
          <ReviewList reviews={proposerReviews} />
        ) : null}
        {!hasProposer ? (
          <NoneNote>no proposer rationale recorded for this finding</NoneNote>
        ) : null}
      </PhaseGroup>

      {/* Voice 2 — the internal critic (reference-blind boss review). */}
      <PhaseGroup
        kind="critic"
        title="Internal critic"
        help={
          <HelpPopup title="Internal critic — reference-blind" size="md">
            <div className="leading-snug">
              The boss-critic's holistic review of the proposal. It is a
              correctness reviewer that, like the proposer, never sees
              the reference standard — see the Boss-critic review panel for
              its experiment-wide blockers / advisories.
            </div>
          </HelpPopup>
        }
      >
        {criticReviews.length > 0 ? (
          <ReviewList reviews={criticReviews} />
        ) : (
          <NoneNote>no internal-critic review for this finding</NoneNote>
        )}
      </PhaseGroup>

      {/* Voice 3 — the reference comparison (SEES REFERENCE — eval crutch). */}
      <PhaseGroup
        kind="gold"
        title="Reference comparison"
        help={
          <HelpPopup title="Reference comparison — sees reference" size="md">
            <div className="leading-snug">
              The reference-seeing judges: the arbiter's ruling and the
              comparison against the reference (polished consensus)
              curation. Unlike the two voices above, these DID see the
              reference standard — this is the eval crutch, present only
              to score the run, not a reference-blind signal.
            </div>
          </HelpPopup>
        }
      >
        {goldReviews.length > 0 ? <ReviewList reviews={goldReviews} /> : null}
        <ComparisonJudgePhase comparison={comparison} />
        {!hasGoldComparison ? (
          <NoneNote>no reference comparison for this finding</NoneNote>
        ) : null}
      </PhaseGroup>
    </div>
  );
}

/** Phase-3 TEXT only — the comparison-judge verdict + one-sentence
 *  rationale. The VISUAL chip strip / factor grid lives outside the
 *  reasoning collapsible (caller owns it) so toggling "reasoning"
 *  hides all the prose at once and leaves the visual + action
 *  buttons visible. */
function ComparisonJudgePhase({
  comparison,
}: {
  comparison: import("@/api/auditTypes").ComparisonVerdict | null;
}): JSX.Element | null {
  if (!comparison) return null;
  const v = verdictLabel(comparison.judge_verdict);
  const r = (comparison.judge_rationale ?? "").trim();
  const brief = (comparison.judge_brief ?? "").trim();
  if (!v && !r && !brief) return null;
  const label = (comparison.comparator_label ?? "").trim() || "comparator";
  return (
    <PhaseSection
      header={`Comparison vs ${label}`}
      brief={
        <div className="rs-11 text-slate-700 dark:text-slate-200 leading-snug">
          {v ? <span className="font-semibold mr-1">{v}.</span> : null}
          {brief ? (
            <span className="italic text-slate-600 dark:text-slate-300">
              {brief}
            </span>
          ) : null}
          {!brief && r ? (
            <span className="italic text-slate-600 dark:text-slate-300">
              {r}
            </span>
          ) : null}
        </div>
      }
      detail={
        brief && r && r !== brief ? (
          <div className="rs-11 italic text-slate-600 dark:text-slate-300">
            {r}
          </div>
        ) : null
      }
      defaultOpen={false}
      alwaysShowHeader
    />
  );
}

// Re-export shared types for tests / callers.
export type { ReviewVerdict, WhyBlock } from "@/api/auditTypes";
