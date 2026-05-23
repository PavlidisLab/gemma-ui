import { useEffect, useMemo, useState } from "react";
import type { Proposal } from "@/api/types";
import { useDesignDraft } from "@/features/design/DesignDraftContext";
import {
  FactorReviewCard,
  TagReviewCard,
} from "./ProposalReviewCard";
import {
  MetadataBadge,
  summariseDataset,
} from "./MetadataBadge";
import {
  factorElementKey,
  loadDispositions,
  loadFeedback,
  loadNotes,
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
 * draft-vs-snapshot diff. Per Paul 2026-05-21.
 */
export function ProposalSidebarPanel({
  proposal,
  onApplyToDesign,
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

  /** Retain every still-pending element in one click. Per Paul
   *  2026-05-21: "in fact, accept all or accept rest would be
   *  nice." Smart label below picks "retain all" vs "retain
   *  remaining" based on whether the curator has already started. */
  const retainAllPending = () => {
    setDispositions((prev) => {
      const next = new Map(prev);
      for (let i = 0; i < (proposal.factors?.length ?? 0); i++) {
        const k = factorElementKey(proposalId, i);
        if (!next.has(k)) next.set(k, "retained");
      }
      for (let i = 0; i < (proposal.tags?.length ?? 0); i++) {
        const k = tagElementKey(proposalId, i);
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

  if (!proposal.factors?.length && !proposal.tags?.length) return null;

  return (
    // Inline the rounded/border equivalents instead of using the
    // ``card`` class — the global ``html.dark .card`` rule in
    // index.css overrode the dark sky tint. Per Paul 2026-05-21.
    <div className="p-2 space-y-2 rounded-lg border border-sky-300 bg-sky-50 dark:border-sky-700 dark:bg-sky-900/40">
      {datasetSummary && datasetSummary.nSamples > 0 ? (
        <div className="px-1 pb-1.5 border-b border-sky-200 dark:border-sky-800">
          <MetadataBadge summary={datasetSummary} />
        </div>
      ) : null}
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
          <button
            type="button"
            onClick={() => {
              if (applied) return;
              onApplyToDesign();
            }}
            disabled={applied}
            title={
              applied
                ? "Already applied — clicking again would duplicate factors. Discard the draft or reset the experiment to re-apply."
                : "Push this proposal's tags and factors into the design draft"
            }
            className={
              (counts.reviewed < counts.total ? "" : "ml-auto ") +
              "px-2 py-0.5 rounded text-[11px] font-semibold border " +
              (applied
                ? "border-emerald-300 bg-emerald-50 text-emerald-800 cursor-not-allowed"
                : "border-blue-300 bg-blue-50 text-blue-800 hover:bg-blue-100")
            }
          >
            {applied ? "✓ Applied" : "Apply to design"}
          </button>
        ) : null}
      </div>

      {proposal.factors?.length ? (
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-400 dark:text-slate-500 px-1">
            Design — factors
          </div>
          {proposal.factors.map((f, i) => {
            const key = factorElementKey(proposalId, i);
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

      {proposal.tags?.length ? (
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-400 dark:text-slate-500 px-1">
            Tags
          </div>
          {proposal.tags.map((t, i) => {
            const key = tagElementKey(proposalId, i);
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
          })}
        </div>
      ) : null}

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
