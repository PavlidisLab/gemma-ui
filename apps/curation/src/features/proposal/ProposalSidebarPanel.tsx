import { useEffect, useMemo, useState } from "react";
import type { Proposal } from "@/api/types";
import type { SubtaskDecision } from "@/api/justification";
import { useDesignDraft } from "@/features/design/DesignDraftContext";
import { DownstreamShapeBlock } from "@/features/design/DownstreamShapeBlock";
import {
  FactorReviewCard,
  TagReviewCard,
} from "./ProposalReviewCard";
import {
  MetadataBadge,
  summariseDataset,
} from "./MetadataBadge";
import { AgentConsideredPanel } from "./AgentConsideredPanel";
import { OrientationProse } from "@/components/ui/OrientationProse";
import {
  TriageBadge,
  designChipFor,
  splitChipFor,
  subsetChipFor,
  deaUsabilityChipFor,
  extractLevel,
  LEVEL_KIND_LABEL,
} from "./ProposalCardV2";
import { normalizeWikiUrl } from "@/lib/guidelines";
import {
  factorElementKey,
  loadDispositions,
  loadFeedback,
  loadNotes,
  onProposalStateReset,
  saveDispositions,
  saveFeedback,
  saveNotes,
  tagElementKey,
  type DispositionMap,
  type NoteMap,
  type ProposalDisposition,
} from "./proposalDispositions";

/**
 * Per-element proposal-review panel — the new surface that replaces
 * the legacy ``ProposalCardV2`` once it's proven out.
 *
 * Renders one card per proposed factor + one card per proposed tag,
 * using the audit-card template (sky tint for factors, emerald for
 * tags, status badge slot, retain/reject/park actions). The
 * curator dispositions each element independently; bulk progress
 * shows at the top.
 *
 * Phase 1 (this commit): in-memory + localStorage disposition
 * state, no draft mutation, no "edited" detection. Renders
 * alongside the legacy card so the curator can compare layouts.
 *
 * Phase 2 (planned): seed the design draft from the proposal on
 * arrival; rejected → remove from draft; edited detected via
 * draft-vs-snapshot diff. Per design review 2026-05-21.
 */
export function ProposalSidebarPanel({
  proposal,
  onApplyToDesign,
  onRevertApplication,
}: {
  proposal: Proposal;
  /** Optional callback for the bulk "apply proposal to design"
   *  affordance — renders an Apply button in the panel header next to
   *  Retain all. Used by the new-shape arm where the curator's
   *  explicit click is what seeds the design draft from the
   *  proposal. When omitted (legacy arm), no Apply button shows;
   *  the legacy ProposalCardV2 still owns its own accept/apply
   *  affordance. */
  onApplyToDesign?: () => void;
  /** Inverse of ``onApplyToDesign`` — drop the proposal's
   *  applied factors / tags from the draft so the curator can back
   *  out of an Apply without hand-deleting rows. Only renders the
   *  Revert button when the proposal is currently applied to the
   *  draft. Pre-existing saved factors/tags whose identity matches a
   *  proposal item are NOT removed (the underlying mutator guards by
   *  saved-id / saved-key). */
  onRevertApplication?: () => void;
}) {
  const proposalId = proposal.proposal_id ?? "";
  const experimentId = proposal.experiment_id;

  const [dispositions, setDispositions] = useState<DispositionMap>(() =>
    loadDispositions(experimentId, proposalId),
  );
  const [notes, setNotes] = useState<NoteMap>(() =>
    loadNotes(experimentId, proposalId),
  );
  const [feedback, setFeedback] = useState<string>(() =>
    loadFeedback(experimentId, proposalId),
  );

  // Dataset summary mirrors what v2 ProposalCardV2 surfaces — sample
  // count, individual count, batch presence — computed from the saved
  // server Design's biomaterials. Saved (not draft) is the canonical
  // cohort source.
  const { saved, draft } = useDesignDraft();

  // Derive "already applied" from the actual draft state rather than a
  // local boolean — local state resets on page reload, but the draft
  // (and any committed save) persists. A proposal counts as applied
  // when every proposed factor's category is present in the draft AND
  // every proposed tag's (category, value) is in the draft. The dedup
  // logic in ``applyProposalToDesign`` keys on the same fields, so a
  // second click would be a no-op — surface that explicitly so the
  // button doesn't lie about its state.
  const applied = useMemo(() => {
    if (!draft) return false;
    if (!proposal.factors?.length && !proposal.tags?.length) return false;
    const factorKeys = new Set(
      (draft.factors ?? []).map((f) =>
        (f.category?.uri || f.category?.label || "").toLowerCase(),
      ),
    );
    for (const p of proposal.factors ?? []) {
      const k = (p.category?.uri || p.category?.label || "").toLowerCase();
      if (!factorKeys.has(k)) return false;
    }
    const tagKeys = new Set(
      (draft.tags ?? []).map((t) => {
        const c = (t.category?.uri || t.category?.label || "").toLowerCase();
        const v = (t.value?.uri || t.value?.label || "").toLowerCase();
        return `${c}|${v}`;
      }),
    );
    for (const p of proposal.tags ?? []) {
      const c = (p.category?.uri || p.category?.label || "").toLowerCase();
      const v = (p.value?.uri || p.value?.label || "").toLowerCase();
      if (!tagKeys.has(`${c}|${v}`)) return false;
    }
    return true;
  }, [draft, proposal.factors, proposal.tags]);
  const datasetSummary = useMemo(
    () => (saved ? summariseDataset(saved.biomaterials) : null),
    [saved],
  );

  useEffect(() => {
    saveDispositions(experimentId, proposalId, dispositions);
  }, [experimentId, proposalId, dispositions]);

  useEffect(() => {
    saveNotes(experimentId, proposalId, notes);
  }, [experimentId, proposalId, notes]);

  useEffect(() => {
    saveFeedback(experimentId, proposalId, feedback);
  }, [experimentId, proposalId, feedback]);

  // Listen for cross-surface resets dispatched by the commit-undo and
  // per-finding-undo paths. The LS layer is already wiped by the
  // caller; this listener flushes the matching in-memory state so the
  // proposal cards reflect the rollback without the curator having to
  // remount the panel. Per design review 2026-06-10: undo had been leaving
  // proposal cards stuck on retained/rejected.
  useEffect(() => {
    return onProposalStateReset((targetExperimentId) => {
      if (targetExperimentId !== String(experimentId)) return;
      setDispositions(new Map());
      setNotes(new Map());
      setFeedback("");
    });
  }, [experimentId]);

  const setOne = (key: string, d: ProposalDisposition) => {
    setDispositions((prev) => {
      const next = new Map(prev);
      if (d === "pending") next.delete(key);
      else next.set(key, d);
      return next;
    });
  };

  const setNote = (key: string, note: string) => {
    setNotes((prev) => {
      const next = new Map(prev);
      if (!note || note.trim().length === 0) next.delete(key);
      else next.set(key, note);
      return next;
    });
  };

  const getOne = (key: string): ProposalDisposition =>
    dispositions.get(key) ?? "pending";

  /** Retain every still-pending element in one click. Per design review
   *  2026-05-21: "in fact, accept all or accept rest would be
   *  nice." Smart label below picks "retain all" vs "retain
   *  remaining" based on whether the curator has already started. */
  const retainAllPending = () => {
    setDispositions((prev) => {
      const next = new Map(prev);
      for (let i = 0; i < (proposal.factors?.length ?? 0); i++) {
        const k = factorElementKey(proposalId, proposal.factors![i]);
        if (!next.has(k)) next.set(k, "retained");
      }
      for (let i = 0; i < (proposal.tags?.length ?? 0); i++) {
        const k = tagElementKey(proposalId, proposal.tags![i]);
        if (!next.has(k)) next.set(k, "retained");
      }
      return next;
    });
  };

  const counts = useMemo(() => {
    const total = (proposal.factors?.length ?? 0) + (proposal.tags?.length ?? 0);
    let reviewed = 0;
    let retained = 0;
    let rejected = 0;
    let parked = 0;
    for (const v of dispositions.values()) {
      if (v === "pending") continue;
      reviewed++;
      if (v === "retained") retained++;
      else if (v === "rejected") rejected++;
      else if (v === "parked") parked++;
    }
    return { total, reviewed, retained, rejected, parked };
  }, [dispositions, proposal]);

  // Earlier shape hid the panel when both lists were empty. Now the
  // panel still renders if the agent emitted decisions (or a
  // boss_verdict) — those judgments are load-bearing even when no
  // factors / tags landed. Only true silence (no proposals, no
  // decisions, no boss) hides the panel.
  const hasAgentSignal =
    (proposal.factors?.length ?? 0) > 0 ||
    (proposal.tags?.length ?? 0) > 0 ||
    (proposal.subtask_decisions?.length ?? 0) > 0 ||
    !!proposal.boss_verdict;
  if (!hasAgentSignal) return null;

  return (
    // Inline the rounded/border equivalents instead of using the
    // ``card`` class — the global ``html.dark .card`` rule in
    // index.css overrode the dark sky tint. Per design review 2026-05-21.
    <div className="p-2 space-y-2 rounded-lg border border-sky-300 bg-sky-50 dark:border-sky-700 dark:bg-sky-900/40">
      {/* Orchestrator orientation prose — generic top-of-panel slot.
          Reads directly from ``proposal.experiment_summary`` — the
          Proposal IS the canonical location for the field; no
          AuditEvidence fallback applies on this surface. Per
          ``handoffs/EXPERIMENT_SUMMARY_TOP_OF_PANEL_2026_06_12.md``
          and ``handoffs/PIPELINE_COMMENTARY_SURFACING_2026_06_13.md``. */}
      <OrientationProse text={proposal.experiment_summary ?? null} />
      {datasetSummary && datasetSummary.nSamples > 0 ? (
        <div className="px-1 pb-1.5 border-b border-sky-200 dark:border-sky-800">
          <MetadataBadge summary={datasetSummary} />
        </div>
      ) : null}
      {/* Quiet "agent considered but didn't propose" panel — surfaces
          constant BM characteristics the resolver chain inspected but
          couldn't ground. Stays hidden when the proposal carries no
          considered-records. Per
          UIB_HANDOFF_2026_06_11_CONSTANT_KEYS_CONSIDERED.md. */}
      <AgentConsideredPanel
        agentConsidered={proposal.evidence?.agent_considered}
      />
      <DecisionsStrip proposal={proposal} />
      {/* Split / subset recommendation — shared with ProposalCardV2. Reads
          the design draft's should_split_on_factor_id / subset_recommendations
          (seeded at import from the live S2o/S2n machinery). */}
      <DownstreamShapeBlock draft={draft} />
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-[11px] uppercase tracking-wide font-semibold text-slate-600 dark:text-slate-300">
          Proposal review
        </span>
        <span className="text-[10px] text-slate-500 dark:text-slate-400">
          {counts.reviewed} / {counts.total} reviewed
          {counts.retained > 0 && (
            <span className="ml-1 text-emerald-700 dark:text-emerald-400">
              · {counts.retained} retained
            </span>
          )}
          {counts.rejected > 0 && (
            <span className="ml-1 text-rose-700 dark:text-rose-400">
              · {counts.rejected} rejected
            </span>
          )}
          {counts.parked > 0 && (
            <span className="ml-1 text-slate-500 dark:text-slate-400">
              · {counts.parked} parked
            </span>
          )}
        </span>
        {counts.reviewed < counts.total ? (
          <button
            type="button"
            onClick={retainAllPending}
            title={
              counts.reviewed === 0
                ? "Retain every proposed element — the agent's suggestions are all good"
                : "Retain every still-pending element in one click"
            }
            className="ml-auto px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-700 text-white hover:bg-emerald-800"
          >
            {counts.reviewed === 0
              ? `Retain all (${counts.total})`
              : `Retain remaining (${counts.total - counts.reviewed})`}
          </button>
        ) : null}
        {onApplyToDesign ? (
          <span
            className={
              (counts.reviewed < counts.total ? "" : "ml-auto ") +
              "inline-flex items-center gap-1"
            }
          >
            <button
              type="button"
              onClick={() => {
                if (applied) return;
                onApplyToDesign();
              }}
              disabled={applied}
              title={
                applied
                  ? "Already applied — the proposal's factors and tags live in the current draft. Use Revert to back out, or edit individual rows in the Design tab."
                  : "Push this proposal's tags and factors into the design draft"
              }
              className={
                "px-2 py-0.5 rounded text-[11px] font-semibold border " +
                (applied
                  ? "border-emerald-300 bg-emerald-50 text-emerald-800 cursor-not-allowed"
                  : "border-blue-300 bg-blue-50 text-blue-800 hover:bg-blue-100")
              }
            >
              {applied ? "✓ Applied" : "Apply to design"}
            </button>
            {applied && onRevertApplication ? (
              <button
                type="button"
                onClick={onRevertApplication}
                title="Revert to original — drop the proposal's applied factors and tags from the draft. Doesn't touch anything that was already on the saved design."
                className="px-2 py-0.5 rounded text-[11px] font-medium border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600 dark:hover:bg-slate-700"
              >
                ↺ Revert
              </button>
            ) : null}
          </span>
        ) : null}
      </div>

      {proposal.factors?.length ? (
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-400 dark:text-slate-500 px-1">
            Design — factors
          </div>
          {proposal.factors.map((f, i) => {
            const key = factorElementKey(proposalId, f);
            // i kept in signature for symmetry with the tag map below;
            // not used in the key (URI-anchored now).
            void i;
            return (
              <FactorReviewCard
                key={key}
                elementKey={key}
                factor={f}
                disposition={getOne(key)}
                onDispose={(d) => setOne(key, d)}
                note={notes.get(key) ?? ""}
                onNoteChange={(n) => setNote(key, n)}
                totalSamples={datasetSummary?.nSamples}
              />
            );
          })}
        </div>
      ) : null}

      {/* Tags section — always renders, even when no tags are
          proposed. Agent judgments on tag normalization /
          term-validation are load-bearing for the curator even when
          the agent ultimately produced an empty tag list (e.g.
          ``S9_tag_normalization`` collapses, term-validator
          rejections). Empty-tags state shows a placeholder under the
          tag-side decisions strip rather than hiding the heading. */}
      <div className="space-y-1.5">
        <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-400 dark:text-slate-500 px-1">
          Tags
        </div>
        <DecisionsStrip proposal={proposal} scope="tag" />
        {proposal.tags?.length ? (
          proposal.tags.map((t, i) => {
            const key = tagElementKey(proposalId, t);
            void i;
            return (
              <TagReviewCard
                key={key}
                elementKey={key}
                tag={t}
                disposition={getOne(key)}
                onDispose={(d) => setOne(key, d)}
                note={notes.get(key) ?? ""}
                onNoteChange={(n) => setNote(key, n)}
              />
            );
          })
        ) : (
          <div className="px-1 flex items-baseline gap-2 flex-wrap text-[11px]">
            <span className="italic text-slate-500 dark:text-slate-400">
              No tags proposed.
            </span>
            {(proposal.subtask_decisions ?? []).every(
              (d) => !isTagDecision(d),
            ) ? (
              <span
                className="inline-flex items-center gap-1 px-1 py-0 rounded border text-[10px] font-medium bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-300 cursor-help"
                title={
                  "Agent emitted no tag-side subtask_decisions on this proposal — " +
                  "no S9_tag_normalization wrap-up, no skip-reason. " +
                  "Can't tell whether the tag proposer skipped, ran and found " +
                  "nothing, or filtered everything out. See agents-side handoff: " +
                  "TAG_PROPOSER_EMIT_EMPTY_RATIONALE."
                }
              >
                ⚠ no agent rationale
              </span>
            ) : null}
          </div>
        )}
      </div>

      {/* Proposal-wide feedback — ported from v2 ProposalCardV2. The
          textarea captures the curator's notes about the proposal as
          a whole; per-element notes live on each review card. Submit
          wiring (redo with notes / log on accept-reject) follows
          later; today this just persists the value to localStorage. */}
      <div className="pt-1.5 border-t border-sky-200 dark:border-sky-800 space-y-1">
        <div className="text-[11px] uppercase tracking-wide font-semibold text-slate-600 dark:text-slate-300 px-1">
          Feedback
        </div>
        <textarea
          placeholder='e.g. "treat cell type as the EFC" / "rename FV labels to ..." / "drop the biological sex factor"'
          rows={2}
          className="w-full text-xs border border-slate-200 dark:border-slate-700 rounded p-1 bg-white dark:bg-slate-900 dark:text-slate-100"
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
        />
        <p className="text-[10px] text-slate-500 dark:text-slate-400 italic px-1">
          Captured for retry instructions on a future redo-with-notes
          and for prompt-tuning logs on accept / reject.
        </p>
      </div>
    </div>
  );
}

/** True when a subtask_decision is tag-related rather than
 *  design/factor/FV-related. Routes on target_id prefix (the agent
 *  uses ``tag:…`` for all tag-scoped decisions) with a fallback to
 *  the subtask name carrying "tag" (catches the proposal-wide
 *  ``S9_tag_normalization`` rows that have empty target_id). */
function isTagDecision(d: SubtaskDecision): boolean {
  const tid = d.target_id ?? "";
  if (tid.startsWith("tag:")) return true;
  const slug = d.subtask ?? "";
  if (slug.toLowerCase().includes("tag")) return true;
  return false;
}

/**
 * Proposal-level decisions surface — Triage chips for the high-level
 * S1/S8 verdicts (only when non-affirmative, mirroring the legacy
 * ProposalCardV2 strip), a Boss verdict chip when populated, and an
 * "All decisions" expander listing every ``subtask_decision`` on the
 * proposal verbatim so nothing the agent emitted is unreachable in
 * the new review surface.
 *
 * ``scope`` splits the surface in two:
 *   - ``design`` (default): triage chips + boss verdict + every
 *     decision that ISN'T tag-related. Lives at the top of the
 *     panel above the factors list.
 *   - ``tag``: tag-side decisions only (target_id starts with
 *     ``tag:`` or subtask carries "tag"). No triage / boss chips.
 *     Lives inside the Tags section header. Renders even when the
 *     proposal has zero tag rows — agent judgments on tagging
 *     (S9_tag_normalization, term-validator on tag URIs, etc.) are
 *     load-bearing for the curator even with an empty tag list.
 *
 * Per-element subtask chips still render under each factor / tag
 * card separately (``SubtaskDecisionsRow`` inside
 * ProposalReviewCard) — this strip surfaces the proposal-wide ones
 * plus the long-tail "other" rows that don't pin to a specific
 * element.
 */
function DecisionsStrip({
  proposal,
  scope = "design",
}: {
  proposal: Proposal;
  scope?: "design" | "tag";
}) {
  const [allOpen, setAllOpen] = useState(false);
  const all = proposal.subtask_decisions ?? [];
  const decisions = all.filter((d) =>
    scope === "tag" ? isTagDecision(d) : !isTagDecision(d),
  );
  // Boss / triage chips only ride the design strip — tag-side
  // decisions don't carry equivalents.
  const boss = scope === "design" ? proposal.boss_verdict ?? null : null;

  const dv =
    scope === "design"
      ? decisions.find((d) => d.subtask === "S1_design_verdict")
      : undefined;
  const sv =
    scope === "design"
      ? decisions.find((d) => d.subtask === "S1_split_verdict")
      : undefined;
  const subv =
    scope === "design"
      ? decisions.find((d) => d.subtask === "S1_subset_verdict")
      : undefined;
  const deav =
    scope === "design"
      ? decisions.find((d) => d.subtask === "S8_dea_usability")
      : undefined;

  const dChip = dv ? designChipFor(dv.verdict) : null;
  const sChip = sv ? splitChipFor(sv.verdict) : null;
  const subChip = subv ? subsetChipFor(subv.verdict) : null;
  const deaChip = deav ? deaUsabilityChipFor(deav.verdict) : null;

  const hasTriage = !!(dChip || sChip || subChip || deaChip || boss);
  const hasAny = decisions.length > 0 || !!boss;
  if (!hasAny) return null;

  const titleFor = (d: SubtaskDecision) => {
    const { level, kind, clean } = extractLevel(d.verdict);
    const conf = level ? ` — ${LEVEL_KIND_LABEL[kind]}: ${level}` : "";
    const cite = d.citation ? ` — ${d.citation}` : "";
    return `${clean}${conf}${cite}`;
  };

  const wrapperCls =
    scope === "tag"
      ? "space-y-1"
      : "space-y-1 border-b border-sky-200 dark:border-sky-800 pb-1.5";
  const expanderLabel =
    scope === "tag" ? "tag-side decisions" : "agent decisions";

  return (
    <div className={wrapperCls}>
      {hasTriage ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 mr-1">
            Triage
          </span>
          {dChip && dv && (
            <TriageBadge
              label={dChip.label}
              tone={dChip.tone}
              title={titleFor(dv)}
            />
          )}
          {sChip && sv && (
            <TriageBadge
              label={sChip.label}
              tone={sChip.tone}
              title={titleFor(sv)}
            />
          )}
          {subChip && subv && (
            <TriageBadge
              label={subChip.label}
              tone={subChip.tone}
              title={titleFor(subv)}
            />
          )}
          {deaChip && deav && (
            <TriageBadge
              label={deaChip.label}
              tone={deaChip.tone}
              title={titleFor(deav)}
            />
          )}
          {boss ? (
            <span
              className="inline-flex items-baseline text-[10px] tracking-wide font-medium px-1.5 py-0.5 rounded border bg-purple-50 border-purple-200 text-purple-700 dark:bg-purple-900/30 dark:border-purple-700 dark:text-purple-300 cursor-help"
              title={[
                boss.rationale ?? "",
                boss.citation ?? "",
                boss.targets?.length
                  ? `targets: ${boss.targets.join(", ")}`
                  : "",
              ]
                .filter(Boolean)
                .join("\n\n")}
            >
              boss: {boss.status}
            </span>
          ) : null}
        </div>
      ) : null}
      {decisions.length > 0 ? (
        <div>
          <button
            type="button"
            className="text-[11px] text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 underline underline-offset-2"
            onClick={() => setAllOpen((v) => !v)}
            title="every subtask decision the agent emitted on this proposal — including ones already surfaced inline above and on each card"
          >
            {allOpen ? "▾" : "▸"} all {expanderLabel} ({decisions.length})
          </button>
          {allOpen ? (
            <ul className="mt-1 space-y-0.5 pl-2 max-h-72 overflow-y-auto">
              {decisions.map((d, i) => (
                <li key={i} className="text-[11px] leading-snug">
                  <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400 mr-1">
                    {d.subtask}
                  </span>
                  {d.target_id ? (
                    <span
                      className="font-mono text-[10px] text-slate-400 dark:text-slate-500 mr-1"
                      title={d.target_id}
                    >
                      [{d.target_id.length > 32
                        ? d.target_id.slice(0, 30) + "…"
                        : d.target_id}
                      ]
                    </span>
                  ) : null}
                  <span className="text-slate-700 dark:text-slate-200">
                    {d.verdict}
                  </span>
                  {d.citation ? (
                    d.citation_url ? (
                      <a
                        href={normalizeWikiUrl(d.citation_url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-1 text-blue-700 dark:text-blue-300 hover:underline"
                        title={d.citation_url}
                      >
                        — {d.citation}
                      </a>
                    ) : (
                      <span className="ml-1 text-slate-500 dark:text-slate-400">
                        — {d.citation}
                      </span>
                    )
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
