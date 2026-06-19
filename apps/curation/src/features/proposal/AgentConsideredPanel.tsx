import { useState } from "react";
import { cn } from "@/lib/cn";
import type { AgentConsidered, ConstantKeyConsidered } from "@/api/types";

/**
 * Quiet "what the agent looked at, didn't propose" panel. Lives
 * above the proposal review surface as curator-supporting context —
 * not a finding, no disposition, no accept/dismiss. The handoff
 * (UIB_HANDOFF_2026_06_11_CONSTANT_KEYS_CONSIDERED.md) places this
 * inside a larger "Agent overview" panel that will also host the
 * methodology / factorial / paper-OA hints once those land; for now
 * the panel hosts just this section and grows when the others
 * arrive.
 *
 * Renders nothing when there's nothing to surface — keeps quiet on
 * proposals that didn't yield any considered-records.
 */
export function AgentConsideredPanel({
  agentConsidered,
}: {
  agentConsidered: AgentConsidered | null | undefined;
}) {
  const constantKeys = agentConsidered?.constant_keys ?? [];
  if (constantKeys.length === 0) return null;
  return (
    <div className="rounded border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/40 p-2 space-y-1.5">
      <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400">
        Agent considered, no URI emitted
      </div>
      <div className="text-[11px] italic text-slate-500 dark:text-slate-400 leading-snug">
        The agent inspected these constant biomaterial characteristics
        but the resolver chain couldn't ground them to an ontology
        URI. Suppressed to avoid free-text-to-free-text noise —
        verify the underlying BM characteristic in Gemma directly if
        you'd like to ground it.
      </div>
      <ul className="space-y-1">
        {constantKeys.map((c, i) => (
          <ConstantKeyRow key={`${c.key}::${c.value}::${i}`} row={c} />
        ))}
      </ul>
    </div>
  );
}

function ConstantKeyRow({ row }: { row: ConstantKeyConsidered }) {
  const [open, setOpen] = useState(false);
  const isMissed = row.resolver_result === "missed";
  return (
    <li className="text-[11px] leading-snug">
      <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
        <span className="font-mono text-slate-700 dark:text-slate-200 px-1 rounded border border-slate-200 dark:border-slate-600 bg-white/70 dark:bg-slate-900/40">
          {row.key}
        </span>
        <span className="text-slate-400 dark:text-slate-500">·</span>
        <span className="font-mono text-slate-700 dark:text-slate-200 px-1 rounded border border-slate-200 dark:border-slate-600 bg-white/70 dark:bg-slate-900/40">
          {row.value}
        </span>
        <span className="text-slate-400 dark:text-slate-500">·</span>
        <span className="text-slate-500 dark:text-slate-400">
          {row.n_samples} sample{row.n_samples === 1 ? "" : "s"}
        </span>
        <span className="text-slate-400 dark:text-slate-500">·</span>
        <span
          className={cn(
            "px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide",
            isMissed
              ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
              : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
          )}
          title={
            isMissed
              ? "Resolver chain ran but no ontology URI matched the value."
              : "Resolver grounded this — surfaced as an actual tag, not here."
          }
        >
          resolver {row.resolver_result}
        </span>
        {row.reason ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="ml-auto text-[10px] text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100 underline-offset-2 hover:underline"
            title={open ? "hide reason" : "show reason"}
          >
            {open ? "hide reason" : "why"}
          </button>
        ) : null}
      </div>
      {open && row.reason ? (
        <div className="mt-1 ml-2 text-[11px] italic text-slate-500 dark:text-slate-400 leading-snug">
          {row.reason}
        </div>
      ) : null}
    </li>
  );
}
