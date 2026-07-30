import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { bearerToken, snakeify } from "./client";
import type { AuditReport, AuditRequest } from "./auditTypes";

/**
 * Server-Sent Events client for the audit pipeline's
 * `POST /audit/{accession}/stream` endpoint (the agents-side Step 6).
 *
 * Mirrors `useProposeStream` exactly — same envelope shape
 * (`schema_version`, `run_id`, `timestamp`, `event`, `level`,
 * `message`, `progress`, `payload`), same pattern (manual `start`
 * trigger, AbortController on unmount / restart, idempotent reset).
 *
 * The terminal `stream.result` payload carries the persisted
 * `AuditReport`; `error.terminal` mirrors the proposer convention.
 *
 * On stream completion (success or error) the per-experiment audit
 * list query gets invalidated so the sidebar picks up the new
 * report immediately.
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

export type AuditStreamStatus = "idle" | "running" | "done" | "error";

export interface AuditStreamState {
  events: ProgressEvent[];
  progress: number;
  status: AuditStreamStatus;
  error: string | null;
  /** Set on `stream.result`. The persisted `AuditReport` from the
   *  agent service — already POSTed to the mock by the time the
   *  event lands, so the UI doesn't need a follow-up GET. */
  report: AuditReport | null;
}

const INITIAL_STATE: AuditStreamState = {
  events: [],
  progress: 0,
  status: "idle",
  error: null,
  report: null,
};

export function useAuditStream(experimentId: number | string) {
  const qc = useQueryClient();
  const [state, setState] = useState<AuditStreamState>(INITIAL_STATE);
  const ctlRef = useRef<AbortController | null>(null);

  // Cancel any in-flight stream on unmount so we don't keep reading
  // from a dead React tree. The pipeline keeps running server-side
  // regardless; same-accession 409s gate duplicate runs.
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
    (accession: string, body?: AuditRequest) => {
      // Cancel any prior stream — last call wins, so a double-click
      // on the trigger button doesn't fan out two parallel SSEs.
      ctlRef.current?.abort();
      const ctl = new AbortController();
      ctlRef.current = ctl;
      setState({ ...INITIAL_STATE, status: "running" });

      const token = bearerToken();
      void (async () => {
        try {
          const resp = await fetch(
            `/audit/${encodeURIComponent(accession)}/stream`,
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
                  // the agents-side `_camel_keys` flip (phase-2c) is
                  // transparent. snakeify is idempotent on snake input.
                  ev = snakeify(
                    JSON.parse(line.slice(5).trim()),
                  ) as ProgressEvent;
                } catch {
                  continue;
                }
                if (ev.schema_version > 1) {
                  setState((prev) => ({
                    ...prev,
                    status: "error",
                    error: `Unsupported event schema_version ${ev.schema_version}; UI is at v1`,
                  }));
                  return;
                }
                setState((prev) => {
                  const next: AuditStreamState = {
                    ...prev,
                    events: [...prev.events, ev],
                    progress: Math.max(prev.progress, ev.progress),
                  };
                  if (ev.event === "stream.result") {
                    next.report = (ev.payload as { report: AuditReport })
                      .report;
                    next.status = "done";
                  } else if (ev.event === "error.terminal") {
                    next.status = "error";
                    next.error =
                      ev.message ||
                      String(ev.payload?.error || "stream errored");
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
          // Refresh the per-experiment audit list + the cross-
          // experiment inbox + this experiment's design (judges may
          // change the curation but for now they don't — invalidating
          // is cheap insurance). Done on both success and error so a
          // partial server-side write still surfaces.
          void Promise.all([
            qc.invalidateQueries({
              queryKey: ["audits", "by-experiment", experimentId],
            }),
            qc.invalidateQueries({ queryKey: ["audits", "inbox"] }),
          ]);
        }
      })();
    },
    [experimentId, qc],
  );

  return { ...state, start, reset };
}
