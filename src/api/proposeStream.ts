import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { bearerToken, snakeify } from "./client";
import type { Proposal } from "./types";
import type { TriggerProposalBody } from "./proposals";

/**
 * Server-Sent Events client for the proposer service's
 * ``POST /propose/{accession}/stream`` endpoint.
 *
 * Spec: ``PROGRESS_SSE.md`` (top of repo). The agent emits
 * ``ProgressEvent``s in three families:
 *
 *   - ``phase.*`` — pipeline milestones; advance the progress bar.
 *   - ``subtask.*`` — per-factor / per-decision events; carry the
 *     prior phase's progress unchanged.
 *   - ``stream.*`` / ``error.*`` — stream lifecycle events
 *     synthesised by the SSE endpoint itself.
 *
 * Hook is **manually-triggered**: returns a ``start(body)`` function
 * the caller invokes on a ``+ propose`` click. The previous-stream
 * AbortController is cancelled on a new ``start`` so a curator
 * double-click doesn't fan out two simultaneous runs. Same-experiment
 * 409 from the proposer service still applies server-side.
 */

export type ProgressLevel = "debug" | "info" | "warn" | "error";

export interface ProgressEvent {
  schema_version: 1;
  run_id: string;
  timestamp: string;
  event: string;
  level: ProgressLevel;
  message: string;
  progress: number;
  payload: Record<string, unknown>;
}

export type ProposeStreamStatus = "idle" | "running" | "done" | "error";

export interface ProposeStreamState {
  events: ProgressEvent[];
  progress: number;
  status: ProposeStreamStatus;
  error: string | null;
  proposal: Proposal | null;
}

const INITIAL_STATE: ProposeStreamState = {
  events: [],
  progress: 0,
  status: "idle",
  error: null,
  proposal: null,
};

export function useProposeStream(experimentId: number) {
  const qc = useQueryClient();
  const [state, setState] = useState<ProposeStreamState>(INITIAL_STATE);
  const ctlRef = useRef<AbortController | null>(null);

  // Cancel any in-flight stream when the component unmounts so we
  // don't keep reading from a dead React tree. The pipeline keeps
  // running server-side regardless; same-accession 409s gate
  // duplicate runs.
  useEffect(() => {
    return () => {
      ctlRef.current?.abort();
    };
  }, []);

  const reset = useCallback(() => {
    ctlRef.current?.abort();
    ctlRef.current = null;
    setState(INITIAL_STATE);
  }, []);

  const start = useCallback(
    (accession: string, body?: TriggerProposalBody) => {
      // Cancel any prior stream so a rapid double-click doesn't
      // fan out — last call wins.
      ctlRef.current?.abort();
      const ctl = new AbortController();
      ctlRef.current = ctl;
      // Reset state on every start. The previous run's events
      // shouldn't bleed into the next.
      setState({ ...INITIAL_STATE, status: "running" });

      const token = bearerToken();
      void (async () => {
        try {
          const resp = await fetch(
            `/propose/${encodeURIComponent(accession)}/stream`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
              },
              body: JSON.stringify(body ?? {}),
              signal: ctl.signal,
            },
          );
          if (!resp.ok || !resp.body) {
            const text = await resp.text().catch(() => "");
            setState((prev) => ({
              ...prev,
              status: "error",
              error: `HTTP ${resp.status}${text ? `: ${text}` : ""}`,
            }));
            return;
          }
          const reader = resp.body
            .pipeThrough(new TextDecoderStream())
            .getReader();
          let buf = "";
          // SSE event blocks are separated by a blank line.
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += value;
            let idx;
            while ((idx = buf.indexOf("\n\n")) !== -1) {
              const block = buf.slice(0, idx);
              buf = buf.slice(idx + 2);
              for (const line of block.split("\n")) {
                if (!line.startsWith("data:")) continue;
                let ev: ProgressEvent;
                try {
                  // Normalise envelope + payload keys to snake_case so
                  // the bro-side `_camel_keys` flip (phase-2c) is
                  // transparent. snakeify is idempotent on snake input.
                  ev = snakeify(
                    JSON.parse(line.slice(5).trim()),
                  ) as ProgressEvent;
                } catch {
                  continue; // ignore malformed lines rather than crash
                }
                // Schema-version guard: a server bump signals a
                // breaking change; render it as a synthetic error
                // rather than attempting to interpret unknown fields.
                if (ev.schema_version > 1) {
                  setState((prev) => ({
                    ...prev,
                    status: "error",
                    error: `Unsupported event schema_version ${ev.schema_version}; UI is at v1`,
                  }));
                  return;
                }
                setState((prev) => {
                  const next: ProposeStreamState = {
                    ...prev,
                    events: [...prev.events, ev],
                    // Defensive monotonic clamp — events should be
                    // monotonic per spec, but a misordered fragment
                    // shouldn't make the bar walk backwards.
                    progress: Math.max(prev.progress, ev.progress),
                  };
                  if (ev.event === "stream.result") {
                    next.proposal = (ev.payload as { proposal: Proposal })
                      .proposal;
                    next.status = "done";
                  } else if (ev.event === "error.terminal") {
                    next.status = "error";
                    next.error = ev.message || String(ev.payload?.error || "stream errored");
                  }
                  return next;
                });
              }
            }
          }
        } catch (e) {
          if (ctl.signal.aborted) return;
          setState((prev) => ({
            ...prev,
            status: "error",
            error: e instanceof Error ? e.message : String(e),
          }));
        } finally {
          // Refresh the proposals list so the new pending row shows
          // up in the sidebar — same as ``useTriggerProposal``'s
          // invalidation path. Done on both success and error so a
          // partial server-side write still surfaces.
          void Promise.all([
            qc.invalidateQueries({ queryKey: ["proposals"] }),
            qc.invalidateQueries({
              queryKey: ["proposals", experimentId],
            }),
          ]);
        }
      })();
    },
    [experimentId, qc],
  );

  return { ...state, start, reset };
}
