/** Batch controls on a Gemma screening ticket — the UI half of the agents' ticket runner.
 *
 *  Amanda, 2026-10-29: batches are driven from the ticket screen — preview, run next
 *  steps, an agent-run allowance, auto-continue — and the ticket shows where every
 *  experiment is. Gemma has no route an outside runner can claim work through, so the
 *  ticket's own comments carry both directions (agents repo
 *  `gemma_curation_agents/agents/batch_executor/ticket_channel.py`, the format's owner):
 *
 *  - a REQUEST is a person's comment holding `<!-- batch-executor:request {json} -->`;
 *  - a RESULT is gemmaAgent's reply holding `<!-- batch-executor:result {json} -->`, the
 *    per-experiment snapshot shown here.
 *
 *  `scripts/ticket_runner.py` (cron on frink, every few minutes) picks requests up, so a
 *  request is "waiting for the runner" until a result names its event id.
 *
 *  🛑 Remote mode only. Store tickets are different rows that merely share ids
 *  (`ticketsBase`), and the runner reads Gemma's. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { resolveGemmaMode } from "@/lib/gemmaMode";
import { api } from "./client";

export const REQUEST_TAG = "batch-executor:request";
export const RESULT_TAG = "batch-executor:result";
export const AGENT = "gemmaAgent";
export const MAX_AGENT_RUNS = 100;
export type BatchAction = "preview" | "run" | "auto_on" | "auto_off";

export interface TicketEvent {
  id: number;
  type: string;
  occurred_at?: string;
  actor_name?: string | null;
  payload?: string | null;
}

export interface SnapshotExperiment {
  accession: string;
  eid: string;
  stage: string;
  action: string;
  decision: string;
  outcome: string;
  detail: string;
}

export interface BatchSnapshot {
  kind: "preview" | "run";
  request_event_id: number | null;
  at: string;
  who: string;
  next_label: string;
  counts: Record<string, number>;
  auto: { on: boolean; interval_hours?: number; agent_runs?: number; who?: string } | null;
  error: string;
  experiments: SnapshotExperiment[];
  /** The event that carried this snapshot (not part of the JSON). */
  event_id: number;
}

export interface BatchState {
  latest: BatchSnapshot | null;
  /** Preview / run requests newer than the latest result: the runner has not got to them. */
  pending: { id: number; action: BatchAction; who: string; at?: string }[];
  /** Auto-continue as last requested (a newer request wins over the last result). */
  auto: { on: boolean; interval_hours: number; agent_runs: number; who?: string };
}

const BLOCK = /<!--\s*(batch-executor:(?:request|result))\s+(\{[\s\S]*?\})\s*-->/g;

/** Gemma stores a comment as a JSON-encoded string. */
export function commentText(e: TicketEvent): string {
  const p = e.payload;
  if (typeof p !== "string") return "";
  try {
    const v = JSON.parse(p);
    return typeof v === "string" ? v : p;
  } catch {
    return p;
  }
}

function block(text: string, tag: string): Record<string, unknown> | null {
  for (const m of text.matchAll(BLOCK)) {
    if (m[1] === tag) {
      try {
        return JSON.parse(m[2]) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
  }
  return null;
}

function actor(e: TicketEvent): string {
  return (e.actor_name ?? (e as unknown as { actorName?: string }).actorName ?? "") || "";
}

/** The comment a button posts. Mirrors `ticket_channel.render_request`. */
export function renderRequest(action: BatchAction, who: string, agentRuns = 0, intervalHours = 6): string {
  const runs = Math.max(0, Math.min(Math.floor(agentRuns || 0), MAX_AGENT_RUNS));
  const words: Record<BatchAction, string> = {
    preview: "preview the next steps (dry run, nothing written)",
    run: "run the next steps",
    auto_on: `keep running the next steps every ${intervalHours} h`,
    auto_off: "stop running the next steps automatically",
  };
  const spend = action === "run" || action === "auto_on" ? `; curation-agent runs allowed: ${runs}` : "";
  const body = { action, agent_runs: runs, interval_hours: intervalHours };
  return `${who} requested: ${words[action]}${spend}.\n\n<!-- ${REQUEST_TAG} ${JSON.stringify(body)} -->`;
}

/** Fold the ticket's event log into what the panel shows. */
export function batchState(events: TicketEvent[]): BatchState {
  const sorted = [...events].sort((a, b) => a.id - b.id);
  let latest: BatchSnapshot | null = null;
  const requests: { id: number; action: BatchAction; who: string; at?: string; body: Record<string, unknown> }[] = [];
  for (const e of sorted) {
    if (e.type !== "COMMENTED") continue;
    const text = commentText(e);
    const who = actor(e);
    if (who === AGENT) {
      const snap = block(text, RESULT_TAG);
      if (snap) latest = { ...(snap as unknown as BatchSnapshot), event_id: e.id };
    } else if (who) {
      const req = block(text, REQUEST_TAG);
      const action = req?.action as BatchAction | undefined;
      if (req && action && ["preview", "run", "auto_on", "auto_off"].includes(action)) {
        requests.push({ id: e.id, action, who, at: e.occurred_at, body: req });
      }
    }
  }
  const after = latest?.event_id ?? 0;
  const pending = requests
    .filter((r) => r.id > after && (r.action === "preview" || r.action === "run"))
    .map(({ id, action, who, at }) => ({ id, action, who, at }));
  let auto = {
    on: Boolean(latest?.auto?.on),
    interval_hours: latest?.auto?.interval_hours ?? 6,
    agent_runs: latest?.auto?.agent_runs ?? 0,
    who: latest?.auto?.who,
  };
  for (const r of requests) {
    if (r.id <= after) continue;
    if (r.action === "auto_on") {
      auto = { on: true, interval_hours: Number(r.body.interval_hours ?? 6),
               agent_runs: Number(r.body.agent_runs ?? 0), who: r.who };
    } else if (r.action === "auto_off") {
      auto = { ...auto, on: false };
    }
  }
  return { latest, pending, auto };
}

/** Step names, as the agents' `ticket_channel.NEXT_LABELS` spells them (the button
 *  label comes from there; these name the steps in the breakdown beside it). */
export const STEP_LABELS: Record<string, string> = {
  add_geo_data: "Land in Gemma", split_on_landing: "Land in Gemma",
  run_rnaseq_pipeline: "Run RNA-seq pipeline", load_sc_data: "Load single-cell data",
  run_curation_agent: "Run proposer", load_cta: "Load cell types",
  run_sc_annotation: "Run cell-type annotation", aggregate: "Aggregate single-cell data",
  reprocess: "Reprocess for the design", fill_batch_info: "Fetch batch information",
  remove_outliers: "Remove outliers", plan_dea: "Run DEA", run_dea: "Run DEA",
  split_after_curation: "Split experiments",
};

/** What the next run would do automatically: "22 land in Gemma · 2 run RNA-seq
 *  pipeline". Amanda, 2026-10-29: "I don't understand what the land in gemma button
 *  is supposed to do" — it was named after the most common step while the same click
 *  also launched pipelines. */
export function nextRunBreakdown(s: BatchSnapshot | null): string {
  if (!s) return "";
  const n = new Map<string, number>();
  for (const x of s.experiments) {
    if (x.decision !== "run") continue;
    const label = STEP_LABELS[x.action] ?? x.action.replace(/_/g, " ");
    n.set(label, (n.get(label) ?? 0) + 1);
  }
  return [...n.entries()].sort((a, b) => b[1] - a[1])
    .map(([label, k]) => `${k} ${label.charAt(0).toLowerCase()}${label.slice(1)}`).join(" · ");
}

function asEvents(raw: unknown): TicketEvent[] {
  if (Array.isArray(raw)) return raw as TicketEvent[];
  const d = (raw as { data?: unknown } | null)?.data;
  return Array.isArray(d) ? (d as TicketEvent[]) : [];
}

export function batchControlsAvailable(): boolean {
  return resolveGemmaMode().mode === "remote";
}

/** The ticket's event log, polled: the runner replies within minutes. */
export function useBatchState(ticketId: number, enabled = true) {
  return useQuery<BatchState>({
    queryKey: ["ticket", ticketId, "batch-runner"],
    queryFn: async () => batchState(asEvents(await api.get<unknown>(`/rest/v2/tickets/${ticketId}/events`))),
    enabled: enabled && batchControlsAvailable(),
    refetchInterval: (q) => ((q.state.data?.pending.length ?? 0) > 0 ? 5000 : 60000),
  });
}

export interface RunnerStatus {
  running: boolean;
  mode: string;
  finished: boolean;
  step: { i: number; n: number; accession: string; decision: string; action: string } | null;
}

/** Where the runner is, from the agents' service (`GET /batch-runner/{ticket}/status`),
 *  polled while a request is pending. A missing service reads as "unknown", never as
 *  an error the curator must act on. */
export function useRunnerStatus(ticketId: number, enabled: boolean) {
  return useQuery<RunnerStatus | null>({
    queryKey: ["batch-runner-status", ticketId],
    queryFn: async () => {
      try {
        return await api.get<RunnerStatus>(`/batch-runner/${ticketId}/status`);
      } catch {
        return null;
      }
    },
    enabled: enabled && batchControlsAvailable(),
    refetchInterval: enabled ? 5000 : false,
  });
}

/** Post a request comment on the Gemma ticket. */
export function usePostBatchRequest(ticketId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (r: { action: BatchAction; who: string; agentRuns?: number; intervalHours?: number }) => {
      if (!batchControlsAvailable()) {
        throw new Error("Batch controls act on Gemma's tickets; this session is reading the curation store.");
      }
      await api.patch<unknown>(`/rest/v2/tickets/${ticketId}`, {
        comment: renderRequest(r.action, r.who, r.agentRuns ?? 0, r.intervalHours ?? 6),
      });
      // Run it now (Amanda, 2026-10-29: "it's annoying to wait"). The comment above is
      // the record; this only starts the runner on frink. If the agents' service is
      // unreachable the cron pass answers within minutes, so a failure here is not an
      // error the curator has to act on.
      try {
        await api.post<unknown>(`/batch-runner/${ticketId}/kick`, {});
        return { kicked: true };
      } catch {
        return { kicked: false };
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ticket", ticketId, "batch-runner"] }),
  });
}
