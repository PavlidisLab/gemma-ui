/**
 * Backend-mode chip for the global header.
 *
 * Visible on every page (AppHeader) so a curator can never lose track
 * of which backend they are pointed at. Three tiers:
 *
 *   - LOCAL (slate) — the local curation store. Full capability set;
 *     writes land in the local SQLite DB.
 *   - REMOTE / unverified (amber) — a Gemma host not on the known
 *     production list. We cannot say what is behind it.
 *   - REMOTE / prod (red) — a known production Gemma host.
 *
 * 🛑 Two things this popover said that were not true. Both are fixed
 * here rather than softened:
 *
 * 1. It promised, on the prod and staging tiers, that "each
 *    PUT/POST/DELETE will require an explicit confirmation". No write
 *    path in this app consults ``isProd`` or ``mode`` — this component
 *    is the only reader of either — so no such confirmation exists.
 *    The chip is where a curator goes to find out whether their writes
 *    are guarded, which makes it the worst place to promise a guard.
 * 2. The prod tier could not fire for the host we actually point at.
 *    ``gemma2.msl.ubc.ca`` matched neither the prod set nor the
 *    staging substring test, so production rendered in the mildest
 *    remote tier. Unrecognized hosts now fail closed to amber, and
 *    the mild sky tier is gone.
 *
 * Click → expands a popover with the full base URL, the auth method,
 * the tier rationale, and how to switch.
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
    : info.isUnverified
      ? "unverified"
      : "local";

  const palette = {
    local:
      "bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-700 dark:text-slate-200 dark:border-slate-600",
    unverified:
      "bg-amber-100 text-amber-900 border-amber-400 dark:bg-amber-900/50 dark:text-amber-100 dark:border-amber-600",
    prod:
      "bg-rose-200 text-rose-900 border-rose-500 dark:bg-rose-900/60 dark:text-rose-100 dark:border-rose-500",
  }[severity];

  const label = info.mode.toUpperCase();
  // Verbatim. The chip used to strip a leading "staging-" to stay
  // short, which rendered staging-gemma.msl.ubc.ca as the prod
  // hostname — the one pair of hosts that must never read alike.
  const hostLabel = info.baseHost;

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
        <span className="normal-case font-normal">{hostLabel}</span>
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
              <strong>Production Gemma.</strong> This host serves the
              live corpus — the same database the public site reads.
            </p>
          ) : severity === "unverified" ? (
            <p className="text-amber-800 dark:text-amber-200 leading-snug">
              <strong>Unrecognized Gemma host.</strong> Not on the known
              production list — and a hostname cannot tell a sandbox
              from production, so treat anything you write here as real
              until someone has checked which database is behind it.
            </p>
          ) : null}

          {/* 🛑 The prose that used to sit here — a "where this page's
              data comes from" grid, a paragraph on ticket stores, and a
              list of every write that reaches the host — is gone. Paul,
              2026-08-29: *"I would leave out all that friggin prose in
              the first place — the curator doesn't need spoonfeeding."*

              It was also unmaintainable by construction. It restated
              `docs/CONFIGURATION.md` in its own words, so the same day
              the routing moved it was making four false claims: that
              tickets are "always the curation store, in both modes"
              (the remote queue is Gemma's), that a Gemma ticket "does
              not appear in this queue" (it is the only thing that
              does), and that short-name, publish and the whole-design
              save "post straight at this host" (the first two moved to
              `/curation/v1`; the third is refused).

              A chip's job is to say WHICH backend and WHERE. What each
              service serves belongs in CONFIGURATION.md, once. */}

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
