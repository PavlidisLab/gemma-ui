import { useState } from "react";
import { cn } from "@/lib/cn";
import { Term } from "@/components/ui/Term";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DismissDialog } from "@/features/audit/DismissDialog";
import { normalizeWikiUrl } from "@/lib/guidelines";
import type {
  FactorProposal,
  StatementProposal,
  TagProposal,
} from "@/api/types";
import type {
  AttachedDefenderVerdict,
  SubtaskDecision,
} from "@/api/justification";
import type { ProposalDisposition } from "./proposalDispositions";

/**
 * Per-element review card for the new proposal-review surface —
 * mirrors ``CompactFindingCard`` (audit sidebar) so the curator
 * uses the same chrome to review proposals as they do for audits.
 *
 * Sky tint for factor cards, emerald for tag cards. Header shows
 * a small status badge (+/✎/✕/⏸ glyph) keyed to the current
 * disposition. Body is a read-only chip view of what's proposed;
 * the curator does the actual editing in the Design / Tags
 * panels — this card just guides the disposition decision.
 *
 * Phase 1: retain / reject / park are user-pickable; ``edited``
 * is reserved for the future draft-diff path. Per Paul
 * 2026-05-21: "we need to record what was rejected, retained,
 * edited from the proposal (sent back to agent to learn)".
 */

type CardKind = "factor" | "tag";

interface BaseProps {
  /** Stable identity for this element (factor:proposalId:idx /
   *  tag:proposalId:idx). Used as DismissDialog's targetId for
   *  draft-store keying so a half-typed reject note survives the
   *  curator pressing Escape and reopening. */
  elementKey: string;
  disposition: ProposalDisposition;
  onDispose: (d: ProposalDisposition) => void;
  /** Optional curator note attached to this element's disposition.
   *  Defaults to empty; the curator can toggle a tiny inline
   *  textarea via the "add note" affordance, or capture it through
   *  the reject/park dialog. */
  note?: string;
  onNoteChange?: (note: string) => void;
  /** Total sample count for the experiment — used by the factor
   *  card to flag partial sample coverage. Falls back to "no
   *  warning surfaced" when undefined. */
  totalSamples?: number;
}

export function FactorReviewCard({
  factor,
  elementKey,
  disposition,
  onDispose,
  note,
  onNoteChange,
  totalSamples,
}: BaseProps & { factor: FactorProposal }) {
  const fvs = factor.factor_values ?? [];
  const fvCount = fvs.length;
  const isContinuous = factor.factor_type === "continuous";
  const label =
    factor.name_in_design || factor.category?.label || "factor";
  // Count unique samples assigned across this factor's FVs — total
  // assigned count is the size of the union (some FVs may carry
  // overlapping assignments, though that's usually a bug).
  const assignedSamples = (() => {
    const set = new Set<string>();
    for (const fv of fvs) {
      for (const s of fv.biomaterial_short_names ?? []) set.add(s);
    }
    return set.size;
  })();
  return (
    <ReviewCardShell
      kind="factor"
      elementKey={elementKey}
      identityLabel={label}
      disposition={disposition}
      onDispose={onDispose}
      note={note}
      onNoteChange={onNoteChange}
    >
      <div className="flex items-baseline gap-1.5 flex-wrap">
        <span className="font-semibold text-[12px] text-slate-800 dark:text-slate-100">
          {label}
        </span>
        {factor.category?.uri ? (
          <Term uri={factor.category.uri} asLink={false}>
            {factor.category.label || ""}
          </Term>
        ) : (
          <span className="italic text-stone-500 text-[11px]">
            {factor.category?.label || "(no category)"}
          </span>
        )}
        <MatchTypeChip matchType={factor.match_type} />
        <BaselineRelevanceChip
          relevance={factor.baseline_relevance}
          reason={factor.baseline_relevance_reason}
        />
        {!isContinuous ? (
          <SampleCoverageChip
            assigned={assignedSamples}
            total={totalSamples}
          />
        ) : null}
        <span className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 ml-auto">
          {isContinuous ? "continuous" : `${fvCount} level${fvCount === 1 ? "" : "s"}`}
        </span>
      </div>
      <DefenderVerdictsCluster verdicts={factor.defender_verdicts} />
      <SubtaskDecisionsRow decisions={factor.subtask_decisions} />
      {!isContinuous && fvs.length > 0 ? (
        <ul className="space-y-1 pl-1">
          {[...fvs]
            .sort((a, b) => (a.is_baseline ? 1 : 0) - (b.is_baseline ? 1 : 0))
            .map((fv, i) => {
              const lab = (fv.free_text_label || "").trim() || "(unlabeled)";
              const n = fv.biomaterial_short_names?.length ?? 0;
              const statements = fv.statements ?? [];
              const showFvMatch =
                fv.match_type && fv.match_type !== factor.match_type;
              // Single ontology-anchored statement whose subject
              // label matches the FV's free-text label is the common
              // case (label == term name). Render the Term chip
              // INLINE in place of the plain label so the row shows
              // the label + CURIE in one slot, and skip the separate
              // statement list below. Multi-statement and free-text
              // FVs keep the split layout — the statement list
              // legitimately differs from the label.
              const onlyStmt = statements.length === 1 ? statements[0] : null;
              const redundant =
                !!onlyStmt &&
                !!onlyStmt.subject?.uri &&
                (onlyStmt.subject.label || "").trim().toLowerCase() ===
                  (fv.free_text_label || "").trim().toLowerCase() &&
                !!(fv.free_text_label || "").trim();
              return (
                <li key={i} className="text-[11px]">
                  <div className="flex items-baseline gap-1.5 flex-wrap">
                    <span
                      className={cn(
                        "w-2.5 inline-block text-center shrink-0 leading-none",
                        fv.is_baseline
                          ? "text-amber-500 dark:text-amber-400"
                          : "text-sky-500/80 dark:text-sky-400/80",
                      )}
                      title={
                        fv.is_baseline
                          ? "baseline (reference level)"
                          : "factor level"
                      }
                    >
                      {fv.is_baseline ? "▂" : "○"}
                    </span>
                    {redundant && onlyStmt ? (
                      <Term
                        uri={onlyStmt.subject.uri ?? null}
                        asLink={false}
                        className="!whitespace-normal break-words"
                      >
                        {lab}
                      </Term>
                    ) : (
                      <span className="flex-1 min-w-0 break-words text-slate-700 dark:text-slate-200">
                        {lab}
                      </span>
                    )}
                    {showFvMatch ? (
                      <MatchTypeChip matchType={fv.match_type} />
                    ) : null}
                    <AssignmentConfidenceChip
                      meta={fv.biomaterial_assignment_meta}
                    />
                    {n > 0 ? (
                      <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono shrink-0">
                        ({n})
                      </span>
                    ) : null}
                  </div>
                  {/* Skip the statement list when redundant — the
                      inline Term chip above already carries the
                      single statement's subject + URI. */}
                  {!redundant && statements.length > 0 ? (
                    <ul className="pl-3.5 mt-0.5 space-y-0.5">
                      {statements.map((s, si) => (
                        <StatementLine key={si} statement={s} />
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
        </ul>
      ) : null}
    </ReviewCardShell>
  );
}

export function TagReviewCard({
  tag,
  elementKey,
  disposition,
  onDispose,
  note,
  onNoteChange,
}: BaseProps & { tag: TagProposal }) {
  // Value-first ordering (per Paul, 2026-05-24): the resolved term
  // is the load-bearing identity; the category is qualifying context.
  // Render value chip first, then a separator, then the category in
  // a more muted (italic) wrapper so the eye lands on the term.
  const identityLabel =
    [tag.value?.label, tag.category?.label].filter(Boolean).join(" — ") ||
    "tag";
  return (
    <ReviewCardShell
      kind="tag"
      elementKey={elementKey}
      identityLabel={identityLabel}
      disposition={disposition}
      onDispose={onDispose}
      note={note}
      onNoteChange={onNoteChange}
    >
      <div className="flex items-baseline gap-1.5 flex-wrap">
        <Term uri={tag.value?.uri ?? null} asLink={false}>
          {tag.value?.label || ""}
        </Term>
        <span className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
          in
        </span>
        <Term
          uri={tag.category?.uri ?? null}
          asLink={false}
          className="italic opacity-80"
        >
          {tag.category?.label || ""}
        </Term>
        <MatchTypeChip matchType={tag.match_type} />
        <DebateBadgeChip badge={tag.badge} />
      </div>
      <DefenderVerdictsCluster verdicts={tag.defender_verdicts} />
      <SubtaskDecisionsRow decisions={tag.subtask_decisions} />
      {tag.evidence_quote ? (
        <div className="text-[10px] italic text-slate-500 dark:text-slate-400 border-l-2 border-slate-300 dark:border-slate-600 pl-2 line-clamp-2">
          “{tag.evidence_quote}”
        </div>
      ) : null}
    </ReviewCardShell>
  );
}

/**
 * One statement under an FV — subject [predicate] object. Mirrors the
 * audit S-P-O comparator render: small predicate (no chip, muted),
 * Term chips with CURIEs on subject / object when URI-resolved,
 * italic free-text otherwise. Missing parts are omitted so a
 * subject-only statement reads as just the subject. Per Paul
 * 2026-05-22: the per-factor card needs to surface the actual
 * structured statement so the curator sees the ontology terms
 * directly, not just the FV label.
 */
function StatementLine({ statement }: { statement: StatementProposal }) {
  const subj = statement.subject;
  const pred = statement.predicate;
  const obj = statement.object;
  const hasSubject = !!(subj?.label || subj?.uri);
  const hasPredicate = !!(pred?.label || pred?.uri);
  const hasObject = !!(obj?.label || obj?.uri);
  const decisions = statement.subtask_decisions;
  return (
    <li className="text-[10.5px]">
      <div className="flex items-baseline gap-1 flex-wrap">
        {hasSubject ? (
          <Term uri={subj.uri ?? null} asLink={false}>
            {subj.label ?? ""}
          </Term>
        ) : null}
        {hasPredicate ? (
          <Term
            uri={pred?.uri ?? null}
            variant="predicate"
            asLink={false}
          >
            {pred?.label ?? ""}
          </Term>
        ) : null}
        {hasObject ? (
          <Term uri={obj?.uri ?? null} asLink={false}>
            {obj?.label ?? ""}
          </Term>
        ) : null}
        {decisions && decisions.length > 0
          ? decisions.map((d, i) => (
              <SubtaskDecisionChip key={i} decision={d} />
            ))
          : null}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Signal chips — surface the judgment/extra-info signals the
// new-shape agent_proposal payload already carries: debate badge,
// match_type, baseline_relevance, BM-assignment confidence. Mirrors
// the audit conventions (small muted chips with tooltip rationale).
// Subtask decisions, proposer suggestion, debate transcript, and a
// proposer-side Boss verdict aren't on the new-shape payload yet —
// handoff filed for bro to plumb them.
// ---------------------------------------------------------------------------

function DebateBadgeChip({ badge }: { badge: string | undefined }) {
  if (!badge) return null;
  const configs: Record<string, { label: string; title: string; cls: string }> = {
    platinum: {
      label: "✓ verified",
      title: "debate: human-verified outcome",
      cls: "bg-sky-50 border-sky-200 text-sky-700 dark:bg-sky-900/30 dark:border-sky-700 dark:text-sky-300",
    },
    gold: {
      label: "✓ unchallenged",
      title:
        "debate: no challenger raised an objection — not an evidence-quality signal",
      cls: "bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-900/30 dark:border-emerald-700 dark:text-emerald-300",
    },
    silver: {
      label: "✓ settled",
      title: "debate: settled after one contested round",
      cls: "bg-slate-100 border-slate-300 text-slate-600 dark:bg-slate-600/50 dark:border-slate-500 dark:text-slate-200",
    },
    bronze: {
      label: "★ contested",
      title: "debate: settled after multiple contested rounds",
      cls: "bg-orange-50 border-orange-200 text-orange-700 dark:bg-orange-900/30 dark:border-orange-700 dark:text-orange-300",
    },
    stuck: {
      label: "!! needs call",
      title: "debate: no consensus — needs human call",
      cls: "bg-rose-50 border-rose-200 text-rose-700 dark:bg-rose-900/30 dark:border-rose-700 dark:text-rose-300",
    },
  };
  const cfg = configs[badge];
  if (!cfg) return null;
  return (
    <span
      className={cn(
        "inline-flex items-baseline text-[10px] tracking-wide font-medium px-1 py-0 rounded border",
        cfg.cls,
      )}
      title={cfg.title}
    >
      {cfg.label}
    </span>
  );
}

function MatchTypeChip({
  matchType,
}: {
  matchType: "exact" | "close" | "new" | undefined;
}) {
  if (!matchType) return null;
  const configs: Record<
    "exact" | "close" | "new",
    { label: string; title: string; cls: string }
  > = {
    exact: {
      label: "= exact",
      title: "exact match against existing Gemma curation",
      cls: "bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-900/30 dark:border-emerald-700 dark:text-emerald-300",
    },
    close: {
      label: "≈ close",
      title: "close match against existing Gemma curation — verify",
      cls: "bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-300",
    },
    new: {
      label: "+ new",
      title: "no counterpart in Gemma — net-new",
      cls: "bg-sky-50 border-sky-200 text-sky-700 dark:bg-sky-900/30 dark:border-sky-700 dark:text-sky-300",
    },
  };
  const cfg = configs[matchType];
  return (
    <span
      className={cn(
        "inline-flex items-baseline text-[10px] tracking-wide font-medium px-1 py-0 rounded border",
        cfg.cls,
      )}
      title={cfg.title}
    >
      {cfg.label}
    </span>
  );
}

function BaselineRelevanceChip({
  relevance,
  reason,
}: {
  relevance: "required" | "not_applicable" | "uncertain" | undefined;
  reason?: string;
}) {
  // "required" is the default — don't clutter the card with a chip
  // for it. Surface the off-default cases only.
  if (!relevance || relevance === "required") return null;
  const configs: Record<
    "not_applicable" | "uncertain",
    { label: string; cls: string }
  > = {
    not_applicable: {
      label: "baseline n/a",
      cls: "bg-slate-100 border-slate-300 text-slate-600 dark:bg-slate-600/50 dark:border-slate-500 dark:text-slate-200",
    },
    uncertain: {
      label: "baseline?",
      cls: "bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-300",
    },
  };
  const cfg = configs[relevance];
  return (
    <span
      className={cn(
        "inline-flex items-baseline text-[10px] tracking-wide font-medium px-1 py-0 rounded border",
        cfg.cls,
      )}
      title={
        reason ||
        (relevance === "uncertain"
          ? "baseline picker was uncertain — no canonical reference timepoint found"
          : "no baseline expected by structure (subset axis / continuous / panel)")
      }
    >
      {cfg.label}
    </span>
  );
}

/** Sample-coverage flag for a factor — surfaces when the factor's
 *  FVs don't cover all experiment samples. Renders nothing on full
 *  coverage; renders an amber warning chip with the deficit when
 *  partial. Per Paul 2026-05-22: "not having all samples assigned
 *  should be flagged more clearly". */
function SampleCoverageChip({
  assigned,
  total,
}: {
  assigned: number;
  total: number | undefined;
}) {
  if (!total || total <= 0) return null;
  if (assigned >= total) return null;
  const unassigned = total - assigned;
  return (
    <span
      className="inline-flex items-baseline text-[10px] tracking-wide font-semibold px-1 py-0 rounded border bg-amber-100 border-amber-300 text-amber-800 dark:bg-amber-900/40 dark:border-amber-700 dark:text-amber-200"
      title={`Only ${assigned} of ${total} samples are assigned to a factor value — ${unassigned} unassigned. Add or rebalance FVs to cover all samples before committing.`}
    >
      ⚠ {assigned}/{total} assigned ({unassigned} left)
    </span>
  );
}

/** Summarise the per-sample BM-assignment confidence breakdown for an
 *  FV. Surface only when the assignment isn't all-"high" — the
 *  agent's default. */
function AssignmentConfidenceChip({
  meta,
}: {
  meta:
    | {
        biomaterial_short_name?: string;
        confidence: string;
        source: string;
        rationale?: string;
      }[]
    | undefined;
}) {
  if (!meta || meta.length === 0) return null;
  const buckets: Record<string, number> = {};
  for (const m of meta) {
    const k = (m.confidence || "").toLowerCase() || "?";
    buckets[k] = (buckets[k] ?? 0) + 1;
  }
  const nonHigh = Object.entries(buckets).filter(
    ([k]) => k !== "high",
  );
  if (nonHigh.length === 0) return null;
  const summary = nonHigh
    .map(([k, n]) => `${n} ${k}`)
    .join(", ");
  // Enumerate the actually-iffy samples in the tooltip so the curator
  // can tell WHICH samples are flagged (not just how many). Order
  // low-confidence first, then medium. Each line shows short_name,
  // confidence, source, and a rationale fragment when present.
  const confidenceRank: Record<string, number> = {
    low: 0,
    medium: 1,
    high: 2,
  };
  const flagged = meta
    .filter((m) => (m.confidence || "").toLowerCase() !== "high")
    .sort(
      (a, b) =>
        (confidenceRank[(a.confidence || "").toLowerCase()] ?? 99) -
        (confidenceRank[(b.confidence || "").toLowerCase()] ?? 99),
    );
  const lines: string[] = [
    `Sample assignments below high confidence: ${summary}.`,
    "",
  ];
  for (const m of flagged) {
    const sn = m.biomaterial_short_name || "(unknown sample)";
    const conf = (m.confidence || "?").toLowerCase();
    const src = m.source ? ` · ${m.source}` : "";
    const rat = m.rationale ? ` — ${m.rationale}` : "";
    lines.push(`• ${sn} [${conf}${src}]${rat}`);
  }
  return (
    <span
      className="inline-flex items-baseline text-[10px] tracking-wide font-medium px-1 py-0 rounded border bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-300 cursor-help"
      title={lines.join("\n")}
    >
      ⚠ {summary}
    </span>
  );
}

/**
 * Defender / arbiter / boss verdicts attached to an element. Renders
 * a small row of pills, one per verdict. Each pill shows the side
 * initial + a strength glyph; the tooltip carries the verdict
 * string + rationale + citation. Tooltip text uses native `title`
 * for now; a richer popover can come later when the audit-side
 * `AttachedDefenderVerdictPill` extracts into the shared
 * justification module.
 *
 * Per the unified-justification schema (2026-05-22): wire shape uses
 * `citationUrl` (camelCase) on this type alone — all other compound
 * names in the payload are snake. Handle both.
 */
function DefenderVerdictsCluster({
  verdicts,
}: {
  verdicts: AttachedDefenderVerdict[] | undefined;
}) {
  if (!verdicts || verdicts.length === 0) return null;
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {verdicts.map((v, i) => (
        <DefenderVerdictPill key={i} verdict={v} />
      ))}
    </div>
  );
}

function DefenderVerdictPill({ verdict }: { verdict: AttachedDefenderVerdict }) {
  const sideConfig: Record<
    "defender" | "arbiter" | "boss",
    { label: string; cls: string }
  > = {
    defender: {
      label: "def",
      cls: "bg-sky-50 border-sky-200 text-sky-700 dark:bg-sky-900/30 dark:border-sky-700 dark:text-sky-300",
    },
    arbiter: {
      label: "arb",
      cls: "bg-indigo-50 border-indigo-200 text-indigo-700 dark:bg-indigo-900/30 dark:border-indigo-700 dark:text-indigo-300",
    },
    boss: {
      label: "boss",
      cls: "bg-purple-50 border-purple-200 text-purple-700 dark:bg-purple-900/30 dark:border-purple-700 dark:text-purple-300",
    },
  };
  const cfg = sideConfig[verdict.side];
  if (!cfg) return null;
  const strengthGlyph =
    verdict.strength === "strong"
      ? "●"
      : verdict.strength === "weak"
        ? "○"
        : "◐";
  const citation = verdict.citation ?? "";
  // Cloud-style atlassian URLs get rewritten to the configured wiki
  // host so a curator click lands on the intranet page instead of a
  // 404. Same normalisation the audit/proposal-v2 panels do.
  const citationUrl = normalizeWikiUrl(verdict.citationUrl ?? "");
  const rationale = verdict.rationale ?? "";
  // Concise tooltip: side · strength · verdict · rationale · citation.
  // Some browsers truncate long titles; for now this is best-effort.
  const titleParts = [
    `${verdict.side} · ${verdict.strength ?? "moderate"}`,
    verdict.verdict ? `"${verdict.verdict}"` : "",
    rationale,
    citation,
  ].filter(Boolean);
  const title = titleParts.join("\n\n");
  const inner = (
    <>
      <span>{cfg.label}</span>
      <span className="ml-0.5 leading-none">{strengthGlyph}</span>
    </>
  );
  return citationUrl ? (
    <a
      href={citationUrl}
      target="_blank"
      rel="noopener noreferrer"
      title={title}
      className={cn(
        "inline-flex items-baseline text-[10px] tracking-wide font-medium px-1 py-0 rounded border hover:underline",
        cfg.cls,
      )}
    >
      {inner}
    </a>
  ) : (
    <span
      title={title}
      className={cn(
        "inline-flex items-baseline text-[10px] tracking-wide font-medium px-1 py-0 rounded border",
        cfg.cls,
      )}
    >
      {inner}
    </span>
  );
}

/**
 * Subtask decisions attached to an element. Each decision is a small
 * chip showing the subtask slug + a confidence dot. Tooltip carries
 * the label / verdict / citation; clicking opens the citation URL
 * in a new tab when populated.
 */
function SubtaskDecisionsRow({
  decisions,
}: {
  decisions: SubtaskDecision[] | undefined;
}) {
  if (!decisions || decisions.length === 0) return null;
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {decisions.map((d, i) => (
        <SubtaskDecisionChip key={i} decision={d} />
      ))}
    </div>
  );
}

function SubtaskDecisionChip({ decision }: { decision: SubtaskDecision }) {
  const confidence = decision.confidence;
  // Confidence dot: zero=rose (kill switch), low=amber, medium=slate,
  // high=emerald, undefined=slate.
  const confCls =
    confidence === "zero"
      ? "text-rose-600 dark:text-rose-400"
      : confidence === "low"
        ? "text-amber-600 dark:text-amber-400"
        : confidence === "high"
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-slate-400 dark:text-slate-500";
  const titleParts = [
    decision.label || decision.subtask,
    decision.verdict,
    decision.citation,
  ].filter(Boolean);
  const title = titleParts.join("\n\n");
  // Shorten the subtask slug for display: "S2r_ontology_normalise"
  // → "S2r". Keep the full slug in the tooltip via `label` /
  // `verdict`.
  const shortSlug = decision.subtask.split("_")[0] || decision.subtask;
  const url = normalizeWikiUrl(decision.citation_url ?? "") || undefined;
  const inner = (
    <>
      <span className="font-mono">{shortSlug}</span>
      {confidence ? (
        <span className={cn("ml-0.5 leading-none", confCls)}>●</span>
      ) : null}
    </>
  );
  const baseCls =
    "inline-flex items-baseline text-[10px] tracking-wide font-medium px-1 py-0 rounded border bg-slate-50 border-slate-200 text-slate-600 dark:bg-slate-700/50 dark:border-slate-600 dark:text-slate-300";
  return url ? (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={title}
      className={cn(baseCls, "hover:underline")}
    >
      {inner}
    </a>
  ) : (
    <span title={title} className={baseCls}>
      {inner}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Shared shell
// ---------------------------------------------------------------------------

function ReviewCardShell({
  kind,
  elementKey,
  identityLabel,
  disposition,
  onDispose,
  children,
  note,
  onNoteChange,
}: {
  kind: CardKind;
  elementKey: string;
  /** Plain-text summary of what this element is — used as the
   *  rationale-row text in the reject/park dialog so the curator
   *  knows which element they're acting on. */
  identityLabel: string;
  disposition: ProposalDisposition;
  onDispose: (d: ProposalDisposition) => void;
  children: React.ReactNode;
  note?: string;
  onNoteChange?: (note: string) => void;
}) {
  const tint =
    kind === "factor"
      ? "border-sky-300 bg-sky-50 dark:border-sky-700 dark:bg-sky-900/40"
      : "border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-900/30";
  const isPending = disposition === "pending";
  const [noteOpen, setNoteOpen] = useState(!!note && note.length > 0);
  // Reject + park route through the audit's DismissDialog so the
  // curator can attach a note at decision-time (per Paul 2026-05-22:
  // "like for audits"). Retain stays a one-click positive action.
  const [dialog, setDialog] = useState<{
    mode: "dismiss" | "not_sure";
    anchor: HTMLElement;
  } | null>(null);

  const requestDispose = (
    d: ProposalDisposition,
    e: React.MouseEvent<HTMLButtonElement>,
  ) => {
    if (d === "rejected") {
      setDialog({ mode: "dismiss", anchor: e.currentTarget });
      return;
    }
    if (d === "parked") {
      setDialog({ mode: "not_sure", anchor: e.currentTarget });
      return;
    }
    onDispose(d);
  };

  const handleDialogConfirm = (_tag: string | null, notes: string) => {
    if (!dialog) return;
    onDispose(dialog.mode === "dismiss" ? "rejected" : "parked");
    if (onNoteChange) onNoteChange(notes);
    setDialog(null);
  };

  return (
    <div
      className={cn(
        // Inline rounded/border instead of ``card`` so the
        // ``html.dark .card`` global doesn't override the dark
        // kind-tint. Per Paul 2026-05-21.
        "rounded-lg border p-2 text-xs space-y-1.5",
        tint,
        !isPending && "opacity-60 hover:opacity-100 transition-opacity",
      )}
    >
      <div className="flex items-start gap-1.5">
        <DispositionBadge disposition={disposition} kind={kind} />
        <div className="flex-1 min-w-0 space-y-1">{children}</div>
      </div>
      <ActionButtons
        disposition={disposition}
        onDispose={onDispose}
        onRequestDispose={requestDispose}
        kind={kind}
        noteOpen={noteOpen}
        hasNote={!!note && note.trim().length > 0}
        onToggleNote={
          onNoteChange ? () => setNoteOpen((v) => !v) : undefined
        }
      />
      {noteOpen && onNoteChange ? (
        <textarea
          value={note ?? ""}
          onChange={(e) => onNoteChange(e.target.value)}
          placeholder="optional note — context, doubts, why you decided this way…"
          rows={2}
          className={cn(
            "w-full text-[11px] rounded border px-1.5 py-1 resize-y leading-snug",
            "bg-white dark:bg-slate-900",
            "border-slate-300 dark:border-slate-600",
            "text-slate-700 dark:text-slate-200",
            "placeholder:text-slate-400 dark:placeholder:text-slate-500",
            "focus:outline-none focus:ring-1 focus:ring-sky-400",
          )}
        />
      ) : null}
      {dialog ? (
        <DismissDialog
          mode={dialog.mode}
          finding={{ issue_code: kind, rationale: identityLabel }}
          targetId={elementKey}
          anchor={dialog.anchor}
          initialNotes={note ?? ""}
          onCancel={() => setDialog(null)}
          onConfirm={handleDialogConfirm}
        />
      ) : null}
    </div>
  );
}

function DispositionBadge({
  disposition,
  kind,
}: {
  disposition: ProposalDisposition;
  kind: CardKind;
}) {
  const config: Record<
    ProposalDisposition,
    { glyph: string; cls: string; label: string }
  > = {
    pending: {
      glyph: "+",
      cls:
        kind === "factor"
          ? "bg-sky-600 text-white border border-sky-700"
          : "bg-emerald-600 text-white border border-emerald-700",
      label: `proposed ${kind} — pending your review`,
    },
    retained: {
      glyph: "✓",
      cls: "bg-emerald-600 text-white border border-emerald-700",
      label: "retained as proposed",
    },
    edited: {
      glyph: "✎",
      cls: "bg-amber-500 text-amber-950 border border-amber-600",
      label: "kept but edited from the proposal",
    },
    rejected: {
      glyph: "✕",
      cls: "bg-rose-600 text-white border border-rose-700",
      label: "rejected — removed from design",
    },
    parked: {
      glyph: "⏸",
      cls: "bg-slate-500 text-white border border-slate-600",
      label: "parked — defer decision",
    },
  };
  const c = config[disposition];
  return <StatusBadge glyph={c.glyph} cls={c.cls} label={c.label} />;
}

function ActionButtons({
  disposition,
  onDispose,
  onRequestDispose,
  kind,
  noteOpen,
  hasNote,
  onToggleNote,
}: {
  disposition: ProposalDisposition;
  /** Direct disposition setter — used for "retain" + "undo" where
   *  no dialog is needed. */
  onDispose: (d: ProposalDisposition) => void;
  /** Anchor-aware disposition setter — used for reject + park so the
   *  parent can open DismissDialog positioned against the clicked
   *  button. */
  onRequestDispose: (
    d: ProposalDisposition,
    e: React.MouseEvent<HTMLButtonElement>,
  ) => void;
  kind: CardKind;
  noteOpen: boolean;
  hasNote: boolean;
  /** When undefined, the "note" affordance doesn't render — used
   *  when the parent didn't wire a note handler. */
  onToggleNote?: () => void;
}) {
  const isPending = disposition === "pending";
  const noteButton = onToggleNote ? (
    <button
      type="button"
      onClick={onToggleNote}
      title={
        noteOpen
          ? "hide note"
          : hasNote
            ? "show note"
            : "add an optional note (why you decided this way)"
      }
      className={cn(
        "ml-auto text-[10px] underline-offset-2 hover:underline",
        hasNote
          ? "text-sky-700 hover:text-sky-900 dark:text-sky-300 dark:hover:text-sky-100"
          : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100",
      )}
    >
      {noteOpen ? "✎ hide note" : hasNote ? "✎ note" : "+ note"}
    </button>
  ) : null;

  if (!isPending) {
    return (
      <div className="flex items-center gap-2 text-[11px]">
        <span className="text-slate-500 dark:text-slate-400">
          {disposition === "retained" && "retained"}
          {disposition === "edited" && "kept with edits"}
          {disposition === "rejected" && "rejected"}
          {disposition === "parked" && "parked"}
        </span>
        {noteButton}
        <button
          type="button"
          onClick={() => onDispose("pending")}
          className="text-[10px] text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100 underline-offset-2 hover:underline"
          title="reopen for review"
        >
          undo
        </button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
      <button
        type="button"
        onClick={() => onDispose("retained")}
        className="px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-700 text-white hover:bg-emerald-800"
        title={`Keep this proposed ${kind} as-is.`}
      >
        retain
      </button>
      <button
        type="button"
        onClick={(e) => onRequestDispose("rejected", e)}
        className="px-2 py-0.5 rounded text-[11px] font-semibold bg-white text-rose-700 border border-rose-300 hover:bg-rose-50 dark:bg-slate-800 dark:text-rose-300 dark:border-rose-700 dark:hover:bg-rose-900/30"
        title={`Reject this proposed ${kind} — remove it from the design. Opens a note dialog.`}
      >
        reject
      </button>
      <button
        type="button"
        onClick={(e) => onRequestDispose("parked", e)}
        className="px-2 py-0.5 rounded text-[11px] border border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
        title="Defer the decision; commit gate stays active. Opens a note dialog."
      >
        park
      </button>
      {noteButton}
    </div>
  );
}
