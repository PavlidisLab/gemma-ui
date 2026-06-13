/**
 * Top-of-panel banner that surfaces the v5 supervisor's curator-follow-
 * up requests — the agent flagging things it couldn't proceed without
 * (paper fetch, ontology fix, strain resolver gap, untrusted URI, …).
 *
 * Each ``EscalationRequest`` renders as a chip. Two tones:
 *
 *   - ``blocks_correction: true`` → red tone. The agent says it CAN'T
 *     proceed without this input — load-bearing for any downstream
 *     completion check.
 *   - ``blocks_correction: false`` → amber tone. Advisory; the agent
 *     would like the input but has emitted something useful without
 *     it.
 *
 * Each chip's title hover shows ``rationale`` + ``suggested_action`` so
 * the curator can read why without expanding anything. The chip itself
 * shows ``kind`` (the discriminator) and a single-line truncation of
 * ``rationale`` for a quick glance.
 *
 * Suppresses entirely when no escalations are present — old packages
 * render identically.
 *
 * Per ``handoffs/PIPELINE_COMMENTARY_SURFACING_2026_06_13.md``.
 */
import type { EscalationRequest } from "@/api/auditTypes";

export interface EscalationBannerProps {
  /** Already-resolved escalation list (via
   *  ``readEscalationRequests``). Empty array suppresses the banner. */
  escalations: EscalationRequest[];
}

/** Human-readable label for the discriminator. Kinds we know about
 *  per the handoff get a friendly label; unknown kinds fall through
 *  to the raw string so a future kind doesn't render as blank. */
const KIND_LABEL: Record<string, string> = {
  fetch_paper: "Fetch paper",
  extend_paper: "Extend paper context",
  ontology_fix: "Ontology fix",
  strain_resolver_gap: "Strain resolver gap",
  uri_normalization: "URI normalization",
  untrusted_uri: "Untrusted URI",
  supervisor_refusal: "Supervisor refusal",
};

function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind;
}

export function EscalationBanner({
  escalations,
}: EscalationBannerProps): JSX.Element | null {
  if (!escalations || escalations.length === 0) return null;
  return (
    <div
      role="region"
      aria-label="Pipeline escalation requests"
      className="rounded border border-slate-200 bg-slate-50/60 dark:border-slate-700 dark:bg-slate-900/40 px-2 py-1.5 space-y-1"
    >
      <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400">
        Agent needs follow-up
      </div>
      <div className="flex flex-wrap items-baseline gap-1.5">
        {escalations.map((e, i) => (
          <EscalationChip key={`${e.kind}-${e.aggregation_key || i}`} esc={e} />
        ))}
      </div>
    </div>
  );
}

function EscalationChip({ esc }: { esc: EscalationRequest }) {
  const blocks = !!esc.blocks_correction;
  const tone = blocks
    ? "border-rose-400 bg-rose-50 text-rose-900 dark:border-rose-700 dark:bg-rose-900/30 dark:text-rose-100"
    : "border-amber-400 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-100";
  const hoverParts: string[] = [];
  if (esc.rationale?.trim()) hoverParts.push(esc.rationale.trim());
  if (esc.suggested_action?.trim()) {
    hoverParts.push(`Suggested: ${esc.suggested_action.trim()}`);
  }
  if (blocks) hoverParts.push("(blocks correction)");
  const title = hoverParts.join("\n\n");
  // Inline rationale snippet — single-line truncation so the chip
  // stays compact while still giving the curator at-a-glance context
  // without hovering. Empty rationale falls back to just the kind.
  const inline = (esc.rationale ?? "").trim();
  return (
    <span
      className={`inline-flex items-baseline gap-1.5 rounded border px-2 py-0.5 text-[11px] max-w-[28rem] ${tone}`}
      title={title || undefined}
    >
      <span className="font-semibold whitespace-nowrap">
        {kindLabel(esc.kind)}
      </span>
      {inline ? (
        <span className="truncate min-w-0 opacity-90">{inline}</span>
      ) : null}
    </span>
  );
}
