/**
 * Liveness pill for the two backends the curation UI talks to:
 * Gemma curation REST + the agent service. Lives in the TopBar next
 * to ModeChip (lifecycle / mode info on the left; liveness on the
 * right). Click → popover with per-service URL, status, and last-
 * check timestamp.
 *
 * Why colocate with ModeChip rather than tuck into the experiment
 * banner: curators land on the curation UI from many surfaces
 * (landing, inboxes, experiment shell). The TopBar is the only
 * persistent chrome — sticking health here means a degraded backend
 * is visible the moment the page loads, before the curator picks an
 * experiment.
 *
 * The bottom "connected to /rest (proxied)" footer was load-bearing
 * for the same audience but rendered below the experiment grid and
 * was effectively invisible (Paul, 2026-05-23). Its info folds into
 * this chip's popover so nothing is lost.
 */

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { useServicesHealth, type ServiceStatus } from "@/api/health";

type Severity = "ok" | "degraded" | "down" | "unknown";

function rollup(
  localApi: ServiceStatus,
  gemma: ServiceStatus,
  agent: ServiceStatus,
): Severity {
  const all = [localApi, gemma, agent];
  if (all.some((s) => s === "unknown")) return "unknown";
  // local_api is the default upstream — if it's down the UI is
  // mostly broken. agent down ⇒ proposals/audits fail. gemma-rest
  // down ⇒ diagnostics + live audit trail fall back to local_api,
  // which is degraded but functional.
  const upCount = all.filter((s) => s === "up").length;
  if (upCount === 3) return "ok";
  if (upCount === 0) return "down";
  return "degraded";
}

export function HealthChip() {
  const { data } = useServicesHealth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(ev: MouseEvent) {
      if (ref.current && !ref.current.contains(ev.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const localApi = data?.localApi ?? "unknown";
  const gemma = data?.gemma ?? "unknown";
  const agent = data?.agent ?? "unknown";
  const severity = rollup(localApi, gemma, agent);

  const palette: Record<Severity, string> = {
    ok:
      "bg-emerald-100 text-emerald-900 border-emerald-400 dark:bg-emerald-900/40 dark:text-emerald-100 dark:border-emerald-600",
    degraded:
      "bg-amber-100 text-amber-900 border-amber-400 dark:bg-amber-900/50 dark:text-amber-100 dark:border-amber-600",
    down:
      "bg-rose-200 text-rose-900 border-rose-500 dark:bg-rose-900/60 dark:text-rose-100 dark:border-rose-500",
    unknown:
      "bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-700 dark:text-slate-200 dark:border-slate-600",
  };

  const label: Record<Severity, string> = {
    ok: "live",
    degraded: "degraded",
    down: "down",
    unknown: "checking…",
  };

  const titleHint =
    severity === "ok"
      ? "All three backends reachable — proposals, audits, diagnostics all runnable."
      : severity === "degraded"
        ? "Some backends are unreachable — click for details."
        : severity === "down"
          ? "None of the backends are reachable — most features will fail."
          : "Checking backends…";

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-[11px] font-mono uppercase tracking-wide font-semibold",
          palette[severity],
        )}
        title={titleHint}
      >
        <StatusDot status={severity} />
        <span className="normal-case">{label[severity]}</span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Backend health"
          className="absolute right-0 top-full mt-1 z-50 w-80 rounded border border-slate-300 bg-white shadow-lg p-3 text-xs space-y-2 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100"
        >
          <div className="flex items-baseline justify-between">
            <span className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400">
              Backend health
            </span>
            <span
              className={cn(
                "inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide border",
                palette[severity],
              )}
            >
              {label[severity]}
            </span>
          </div>

          <dl className="space-y-1.5">
            <ServiceRow
              label="local_api"
              status={localApi}
              path="/rest/v2 (default)"
              hint="curation DB / FastAPI mock — default upstream for /rest/v2/* (datasets, design, workflow, audit trail fallback)"
            />
            <ServiceRow
              label="gemma-rest"
              status={gemma}
              path="/rest/v2 (fallback)"
              hint="live Gemma 2.0 REST — diagnostics (SVD, sample-correlation, mean-variance) + canonical experiment audit trail"
            />
            <ServiceRow
              label="agent"
              status={agent}
              path="/propose, /audit, /find-*"
              hint="proposer + auditor + find-publication/term"
            />
          </dl>

          <p className="text-[10px] text-slate-500 dark:text-slate-400 pt-1 border-t border-slate-200 dark:border-slate-700">
            {data?.checkedAt
              ? `Last checked ${formatRelative(data.checkedAt)}.`
              : "Checking…"}{" "}
            Probes hit each service's <code>/openapi.json</code> every
            15s.
          </p>

          {severity !== "ok" && severity !== "unknown" ? (
            <p
              className={
                severity === "down"
                  ? "text-rose-700 dark:text-rose-300 leading-snug"
                  : "text-amber-800 dark:text-amber-200 leading-snug"
              }
            >
              {localApi === "down"
                ? "local_api down → most read paths fail (datasets, workflow, design). Start the curation backend."
                : agent === "down"
                  ? "Agent down → Request proposal / Run audit will fail. Start the proposer service."
                  : gemma === "down"
                    ? "gemma-rest down → diagnostics (SVD/sample-correlation/mean-variance) and the canonical live audit trail unavailable. Audit trail falls back to local_api."
                    : ""}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ServiceRow({
  label,
  status,
  path,
  hint,
}: {
  label: string;
  status: ServiceStatus;
  path: string;
  hint: string;
}) {
  const pill =
    status === "up"
      ? "bg-emerald-100 text-emerald-900 border-emerald-400 dark:bg-emerald-900/40 dark:text-emerald-100 dark:border-emerald-600"
      : status === "down"
        ? "bg-rose-200 text-rose-900 border-rose-500 dark:bg-rose-900/60 dark:text-rose-100 dark:border-rose-500"
        : "bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-700 dark:text-slate-200 dark:border-slate-600";
  return (
    <div className="grid grid-cols-[7rem_1fr_auto] gap-x-2 items-baseline" title={hint}>
      <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="font-mono text-[11px] break-all text-slate-700 dark:text-slate-300">
        {path}
      </dd>
      <dd>
        <span
          className={cn(
            "inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide border",
            pill,
          )}
        >
          {status}
        </span>
      </dd>
    </div>
  );
}

function StatusDot({ status }: { status: Severity }) {
  const cls: Record<Severity, string> = {
    ok: "bg-emerald-500",
    degraded: "bg-amber-500",
    down: "bg-rose-500 animate-pulse",
    unknown: "bg-slate-400",
  };
  return (
    <span
      aria-hidden
      className={cn("inline-block w-1.5 h-1.5 rounded-full", cls[status])}
    />
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const ds = Math.max(0, Math.round((now - then) / 1000));
  if (ds < 5) return "just now";
  if (ds < 60) return `${ds}s ago`;
  const dm = Math.round(ds / 60);
  if (dm < 60) return `${dm}m ago`;
  const dh = Math.round(dm / 60);
  return `${dh}h ago`;
}
