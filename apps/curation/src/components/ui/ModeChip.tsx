/**
 * Build-time backend-mode chip for the global header.
 *
 * Visible on every page (TopBar) so a curator can never lose track
 * of which backend their writes will land on. Three severity tiers:
 *
 *   - LOCAL (slate) — talking to the local standalone server. No
 *     warning; full capability set.
 *   - REMOTE / staging (amber) — talking to staging Gemma. Today's
 *     staging shares the prod DB; chip popover spells that out.
 *   - REMOTE / prod (red) — talking to prod Gemma. Big red warning;
 *     every write goes through a confirmation modal (per §5 of the
 *     local-vs-remote handoff).
 *
 * Click → expands a popover with the full base URL, the auth method,
 * the severity rationale, and a copy-of-the-other-mode hint.
 */

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { useGemmaMode } from "@/lib/gemmaMode";

export function ModeChip() {
  const info = useGemmaMode();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Outside-click + Escape close.
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

  const severity = info.isProd
    ? "prod"
    : info.isStaging
      ? "staging"
      : info.mode === "remote"
        ? "remote-other"
        : "local";

  const palette = {
    local:
      "bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-700 dark:text-slate-200 dark:border-slate-600",
    "remote-other":
      "bg-sky-100 text-sky-900 border-sky-400 dark:bg-sky-900/40 dark:text-sky-100 dark:border-sky-600",
    staging:
      "bg-amber-100 text-amber-900 border-amber-400 dark:bg-amber-900/50 dark:text-amber-100 dark:border-amber-600",
    prod:
      "bg-rose-200 text-rose-900 border-rose-500 dark:bg-rose-900/60 dark:text-rose-100 dark:border-rose-500",
  }[severity];

  const label = info.mode.toUpperCase();
  // Strip a leading "staging-" prefix in the chip text so the chip
  // stays short; the popover carries the full host.
  const shortHost =
    info.baseHost === "(unset)"
      ? "(unset)"
      : info.baseHost.replace(/^staging-/, "");

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-baseline gap-1.5 px-2 py-0.5 rounded border text-[11px] font-mono uppercase tracking-wide font-semibold",
          palette,
          severity === "prod" && "animate-pulse-prod",
        )}
        title={`${label} · ${info.baseHost} — click for details`}
      >
        <span>{label}</span>
        <span className="opacity-70">·</span>
        <span className="normal-case font-normal">{shortHost}</span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Backend mode"
          className="absolute right-0 top-full mt-1 z-50 w-80 rounded border border-slate-300 bg-white shadow-lg p-3 text-xs space-y-2 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100"
        >
          <div className="flex items-baseline justify-between">
            <span className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400">
              Backend mode
            </span>
            <span
              className={cn(
                "inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide border",
                palette,
              )}
            >
              {label}
            </span>
          </div>

          <dl className="space-y-1.5">
            <div className="grid grid-cols-[5rem_1fr] gap-x-2 items-baseline">
              <dt className="text-slate-500 dark:text-slate-400">URL</dt>
              <dd className="font-mono text-[11px] break-all">
                {info.baseUrl}
              </dd>
            </div>
            <div className="grid grid-cols-[5rem_1fr] gap-x-2 items-baseline">
              <dt className="text-slate-500 dark:text-slate-400">Auth</dt>
              <dd>{info.authLabel}</dd>
            </div>
            {info.ontologySplit ? (
              <div className="grid grid-cols-[5rem_1fr] gap-x-2 items-baseline">
                <dt className="text-slate-500 dark:text-slate-400">Gemma REST</dt>
                <dd className="font-mono text-[11px] break-all">
                  {info.ontologyUrl}
                </dd>
              </div>
            ) : null}
          </dl>

          {severity === "prod" ? (
            <p className="text-rose-700 dark:text-rose-300 leading-snug">
              <strong>Production data.</strong> Every write modifies the
              live Gemma database. Each PUT/POST/DELETE will require an
              explicit confirmation.
            </p>
          ) : severity === "staging" ? (
            <p className="text-amber-800 dark:text-amber-200 leading-snug">
              <strong>Staging Gemma.</strong> Note that today's staging
              shares the prod database — writes here land in real Gemma.
              Same confirmation flow as prod-mode applies.
            </p>
          ) : severity === "remote-other" ? (
            <p className="text-sky-800 dark:text-sky-200 leading-snug">
              Remote Gemma host. Capability set is narrower than local;
              read-mostly. Confirmation modals fire on writes.
            </p>
          ) : (
            <p className="text-slate-600 dark:text-slate-300 leading-snug">
              Local standalone curation server. Full capability set —
              audits, dispositions, design edits, inter-curator-audit
              packages. Writes land in the local SQLite DB.
            </p>
          )}

          {info.baseUrl === "(unset)" ? (
            <p className="text-rose-700 dark:text-rose-300 leading-snug">
              <strong>VITE_GEMMA_BASE_URL is unset.</strong> Remote
              mode requires it. Set in <code>.env</code> and rebuild.
            </p>
          ) : null}

          <p className="text-[10px] text-slate-500 dark:text-slate-400 pt-1 border-t border-slate-200 dark:border-slate-700">
            {info.mode === "local" ? (
              <>
                Hosts reflect the running local-api&rsquo;s config. To change
                them, edit <code>GEMMA_BASE_URL</code> /{" "}
                <code>GEMMA_ONTOLOGY_URL</code> in <code>.env</code> and{" "}
                <code>docker compose down &amp;&amp; up</code> — no SPA rebuild
                needed.
              </>
            ) : (
              <>
                Mode is build-time. To switch, set <code>VITE_GEMMA_MODE</code>{" "}
                + <code>VITE_GEMMA_BASE_URL</code> in <code>.env</code> and
                restart the dev server (or rebuild).
              </>
            )}
          </p>
        </div>
      ) : null}
    </div>
  );
}
