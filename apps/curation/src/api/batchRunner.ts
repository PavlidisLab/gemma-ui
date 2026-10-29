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
    refetchInterval: (q) => ((q.state.data?.pending.length ?? 0) > 0 ? 15000 : 60000),
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
      return await api.patch<unknown>(`/rest/v2/tickets/${ticketId}`, {
        comment: renderRequest(r.action, r.who, r.agentRuns ?? 0, r.intervalHours ?? 6),
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ticket", ticketId, "batch-runner"] }),
  });
}
