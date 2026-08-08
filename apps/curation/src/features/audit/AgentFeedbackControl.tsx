/**
 * Two-state "was this agent judgement any good?" control.
 *
 * Feedback for the AGENT, not a decision about the design — see
 * ``agentFeedback.ts`` for why it deliberately doesn't ride on the
 * disposition record.
 *
 * Design constraints, all from the ask ("fully optional … only if there
 * was a problem, or if the agent did something useful"):
 *
 *   - **Costs nothing to ignore.** Unset, it's two small ghost glyphs
 *     that don't compete with the verdict text or the action row. It
 *     never blocks, never nags, and nothing is gated on it.
 *   - **Costs one click to use, and one to undo.** Clicking the active
 *     stance clears it, so a misclick isn't a statement the curator is
 *     stuck with.
 *   - **Set state is legible at a glance** — endorsed goes emerald,
 *     flagged goes rose, matching the palette those tones carry
 *     everywhere else in the audit surface.
 *
 * Two states only. A rating scale would invite deliberation on a control
 * whose whole point is that it's cheap.
 */
import { useState } from "react";
import { cn } from "@/lib/cn";
import { useAuditOptional } from "./AuditContext";
import {
  readAgentFeedback,
  setAgentFeedback,
  type FeedbackStance,
  type FeedbackSubject,
} from "./agentFeedback";

/** Unset reads as plain grey — the control has to be ignorable. Set
 *  picks up the tone that already means "good" / "wrong" across the
 *  audit surface, because colour is the only cue that survives a glance
 *  at a 14px glyph. */
const STANCE_CLS: Record<FeedbackStance, { on: string; off: string }> = {
  endorse: {
    on: "bg-emerald-100 dark:bg-emerald-900/40 opacity-100",
    off: "opacity-35 grayscale hover:opacity-80 hover:grayscale-0 hover:bg-emerald-50 dark:hover:bg-emerald-900/30",
  },
  flag: {
    on: "bg-rose-100 dark:bg-rose-900/40 opacity-100",
    off: "opacity-35 grayscale hover:opacity-80 hover:grayscale-0 hover:bg-rose-50 dark:hover:bg-rose-900/30",
  },
};

const STANCE_GLYPH: Record<FeedbackStance, string> = {
  endorse: "\u{1F44D}",
  flag: "\u{1F44E}",
};

const STANCE_TITLE: Record<FeedbackStance, string> = {
  endorse:
    "Endorse — this call was useful. Optional feedback for the agent; changes nothing about the design. Click again to clear.",
  flag: "Flag — this call was wrong or unhelpful. Optional feedback for the agent; changes nothing about the design. Click again to clear.",
};

export function AgentFeedbackControl({
  verdictKey,
  subject = "boss_critic",
  className,
}: {
  /** Stable id of the judgement being rated — the grouped boss
   *  review's ``key``. */
  verdictKey: string;
  subject?: FeedbackSubject;
  className?: string;
}): JSX.Element | null {
  // Sourced here, LENIENTLY, so the boss-critic renderers stay
  // presentational: they're rendered standalone in render tests and on
  // the preview page, and making them require an AuditProvider to show
  // a verdict would be the wrong coupling.
  const audit = useAuditOptional();
  const experimentId = audit?.experimentId ?? "";
  const auditId = audit?.report?.audit_id ?? "";
  const [stance, setStance] = useState<FeedbackStance | null>(() =>
    experimentId ? readAgentFeedback(experimentId)[verdictKey]?.stance ?? null : null,
  );

  // No audit context, or no run to attribute the feedback to → nothing
  // useful can be recorded. Render nothing rather than a control that
  // quietly drops what the curator says.
  if (!experimentId || !auditId || !verdictKey) return null;

  const click = (next: FeedbackStance) => {
    const map = setAgentFeedback(experimentId, verdictKey, {
      stance: next,
      subject,
      auditId,
    });
    setStance(map[verdictKey]?.stance ?? null);
  };

  return (
    <span
      className={cn("inline-flex items-center gap-0.5 shrink-0", className)}
      // Labelled as a group so a screen reader reaches the buttons with
      // the "this is about the agent" framing already established.
      role="group"
      aria-label="feedback on this agent judgement"
    >
      {(["endorse", "flag"] as const).map((s) => {
        const active = stance === s;
        return (
          <button
            key={s}
            type="button"
            aria-pressed={active}
            aria-label={s === "endorse" ? "endorse this judgement" : "flag this judgement"}
            title={STANCE_TITLE[s]}
            onClick={(e) => {
              // These rows sit inside cards that react to clicks
              // (expand / focus); rating must not also navigate.
              e.stopPropagation();
              click(s);
            }}
            className={cn(
              "text-[11px] leading-none w-[18px] h-[18px] rounded inline-flex items-center justify-center transition-all",
              active ? STANCE_CLS[s].on : STANCE_CLS[s].off,
            )}
          >
            {STANCE_GLYPH[s]}
          </button>
        );
      })}
    </span>
  );
}
