/** Batch automation controls on a Gemma screening ticket.
 *
 *  Amanda, 2026-10-29: "a button … that says 'run next steps'", an agent-run allowance,
 *  preview (dry run) and auto-continue on each batch screen, and the ticket updating to
 *  show where the experiments are — the top button naming the next step ("Run RNA-seq
 *  pipeline", "Run proposer", …). The buttons post request comments; the agents' ticket
 *  runner on frink answers within minutes (see `@/api/batchRunner`).
 *
 *  Reuse (repo rule "Don't make new UI components"): the buttons are `.btn`, the tallies
 *  are `Pill` (neutral variant added for them), the spend confirmation is `ConfirmModal`,
 *  and the per-experiment position is a column in TriageView's existing table rather
 *  than a table here. Checked TicketDetailPage's NextActionBar first: it drives the
 *  curation store's `/actions` route, which Gemma tickets cannot use (`assertStoreTickets`),
 *  and has no allowance / preview / auto controls — a different contract, so a sibling. */
import { useState } from "react";
import {
  batchControlsAvailable,
  useBatchState,
  usePostBatchRequest,
  type BatchAction,
} from "@/api/batchRunner";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Pill } from "@/components/ui/Pill";

const COST_PER_AGENT_RUN = "≈ $0.66–0.90";

function when(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function BatchRunnerPanel({ ticketId, who, included }: {
  ticketId: number;
  who: string;
  /** Targets marked Include. Only those move on: the runner reads the ticket's INCLUDE
   *  targets (Amanda, 2026-10-29: "all the subsequent steps only happen after we've
   *  decided to include an experiment"). */
  included: number;
}) {
  const state = useBatchState(ticketId);
  const post = usePostBatchRequest(ticketId);
  const [agentRuns, setAgentRuns] = useState(0);
  const [hours, setHours] = useState(6);
  const [confirm, setConfirm] = useState<BatchAction | null>(null);

  if (!batchControlsAvailable()) {
    return (
      <div className="text-xs text-slate-500 dark:text-slate-400 pt-2">
        Batch automation acts on Gemma's tickets; this session reads the curation store.
      </div>
    );
  }
  const s = state.data;
  const latest = s?.latest ?? null;
  const pending = s?.pending ?? [];
  const auto = s?.auto ?? { on: false, interval_hours: 6, agent_runs: 0 };
  const waiting = (a: BatchAction) => pending.some((p) => p.action === a);
  const send = (action: BatchAction) => post.mutate({ action, who, agentRuns, intervalHours: hours });
  const ask = (action: BatchAction) =>
    (action === "run" || action === "auto_on") && agentRuns > 0 ? setConfirm(action) : send(action);

  return (
    <div className="pt-2 space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" className="btn text-xs" disabled={post.isPending || waiting("preview")}
                onClick={() => ask("preview")}
                title="Dry run: shows what the next run would do for each experiment. Writes nothing.">
          {waiting("preview") ? "Preview requested…" : "Preview next steps"}
        </button>
        <button type="button" className="btn primary text-xs" disabled={post.isPending || waiting("run") || included === 0}
                onClick={() => ask("run")}
                title="Advance every experiment one step, under the executor's locks and guards.">
          {waiting("run") ? "Run requested…" : latest?.next_label || "Run next steps"}
        </button>
        <label className="text-xs text-slate-600 dark:text-slate-300 flex items-center gap-1"
               title={`Curation-agent runs a run may spend (${COST_PER_AGENT_RUN} each). 0 = none.`}>
          agent runs
          <input type="number" min={0} max={100} value={agentRuns}
                 onChange={(e) => setAgentRuns(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                 className="w-14 rounded border border-slate-300 dark:border-slate-600 bg-transparent px-1 py-0.5" />
        </label>
        {auto.on ? (
          <button type="button" className="btn text-xs" disabled={post.isPending} onClick={() => ask("auto_off")}
                  title="Stop the automatic runs. A run already going finishes.">
            Stop auto-continue
          </button>
        ) : (
          <>
            <button type="button" className="btn text-xs" disabled={post.isPending} onClick={() => ask("auto_on")}
                    title="Keep running the next steps on a schedule until stopped.">
              Auto-continue
            </button>
            <select value={hours} onChange={(e) => setHours(Number(e.target.value))} aria-label="auto-continue interval"
                    className="text-xs rounded border border-slate-300 dark:border-slate-600 bg-transparent px-1 py-0.5">
              {[2, 6, 12, 24].map((h) => <option key={h} value={h}>every {h} h</option>)}
            </select>
          </>
        )}
      </div>

      <div className="text-xs text-slate-600 dark:text-slate-300">
        {included === 0
          ? "Nothing is marked Include yet. These controls advance only the experiments you include; decide in the table below first."
          : `These controls advance the ${included} experiment${included === 1 ? "" : "s"} marked Include; the rest wait for your decision.`}
      </div>
      <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1 flex-wrap">
        <span>
          {latest
            ? `Last ${latest.kind === "preview" ? "preview" : "run"} by ${latest.who}, ${when(latest.at)}.`
            : state.isLoading ? "loading…" : "No runs yet — start with a preview."}
        </span>
        {latest
          ? Object.entries(latest.counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
              <Pill key={k} variant="neutral">{k.replace(/_/g, " ")} · {v}</Pill>
            ))
          : null}
      </div>
      {auto.on ? (
        <div className="text-xs text-emerald-700 dark:text-emerald-400">
          Auto-continue is on: every {auto.interval_hours} h, {auto.agent_runs} agent run(s) per run
          {auto.who ? `, started by ${auto.who}` : ""}.
        </div>
      ) : null}
      {pending.length ? (
        <div className="text-xs text-amber-700 dark:text-amber-400">
          Waiting for the runner (it checks every few minutes): {pending.map((p) => `${p.action} by ${p.who}`).join(", ")}.
        </div>
      ) : null}
      {latest?.error ? (
        <div className="text-xs text-rose-700 dark:text-rose-400">The last run did not finish: {latest.error}</div>
      ) : null}
      {post.isError ? <div className="text-xs text-rose-700">request failed: {(post.error as Error).message}</div> : null}

      <ConfirmModal
        open={confirm !== null}
        title="Spend on the curation agent?"
        body={`Allow up to ${agentRuns} curation-agent run(s), ${COST_PER_AGENT_RUN} each on Sonnet` +
          (confirm === "auto_on" ? `, on every automatic run (every ${hours} h) until auto-continue is stopped.` : ".")}
        confirmLabel="allow and run"
        destructive={false}
        onConfirm={() => { if (confirm) send(confirm); setConfirm(null); }}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
