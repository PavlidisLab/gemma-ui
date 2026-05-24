/**
 * Systems Monitoring page — replaces the legacy
 * `pages/admin/systemStats.jsp` + `pages/admin/activeUsers.jsp`.
 * Eight sections in a responsive grid; admin-gated.
 *
 * Auth model: every admin endpoint requires GROUP_ADMIN. A
 * non-admin (anonymous or signed in without admin) lands on the
 * **login challenge** below — not the dashboard. We don't render
 * any of the page chrome behind the gate, so a curious URL probe
 * doesn't leak build / health / hostname info.
 *
 * `/admin/caches` is the canary for the gate decision because it's
 * the most reliably deployed admin endpoint across Gemma builds
 * (`/admin/system` is newer and 404s on older JARs).
 *
 * Auth itself is the legacy Gemma sign-in (login form on the
 * Gemma webapp; sets a Spring session cookie that
 * `credentials: "include"` carries through). The challenge below
 * opens that sign-in page; after signing in the curator returns
 * here.
 *
 * Inspiration: the legacy JSPs (`gemma-web/.../systemStats.jsp`,
 * `gemma-web/.../activeUsers.jsp`). Reference:
 * `~/Dev/eclipseworkspace/Gemma/handoffs/HANDOFF_SYSTEMS_MONITORING_UI.md`.
 */

import { useEffect, useState } from "react";
import { ApiError } from "@/api/client";
import { gemmaUrl } from "@/lib/gemmaConfig";
import { useCacheList } from "./api";
import { HeaderSection } from "./sections/HeaderSection";
import { JvmSection } from "./sections/JvmSection";
import { HibernateSection } from "./sections/HibernateSection";
import { CachesSection } from "./sections/CachesSection";
import { JobsSection } from "./sections/JobsSection";
import { SessionsSection } from "./sections/SessionsSection";
import { IndicesSection } from "./sections/IndicesSection";
import { OntologiesSection } from "./sections/OntologiesSection";

export function SystemMonitoringPage() {
  const canary = useCacheList();

  const authError =
    canary.error instanceof ApiError &&
    (canary.error.status === 401 || canary.error.status === 403);

  // First-mount loading state: don't flash the gate (or the
  // dashboard) before we know which to show. Hold a centered
  // loading until the canary settles.
  const initialLoading = canary.isPending && !canary.data && !canary.error;

  if (initialLoading) {
    return <CenteredLoading />;
  }

  if (authError) {
    return <LoginChallenge status={(canary.error as ApiError).status} />;
  }

  return (
    <div className="mx-auto w-full max-w-[1800px] px-4 py-4 space-y-3">
      <HeaderSection />
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        <JvmSection />
        <HibernateSection />
        <CachesSection />
        <JobsSection />
        <SessionsSection />
        <IndicesSection />
        <div className="md:col-span-2 xl:col-span-3">
          <OntologiesSection />
        </div>
      </div>
    </div>
  );
}

function CenteredLoading() {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center gap-3 text-slate-500 dark:text-slate-400">
      <div
        className="w-8 h-8 rounded-full border-2 border-slate-200 border-t-blue-600 dark:border-slate-700 dark:border-t-blue-400 animate-spin"
        aria-label="checking access"
      />
      <div className="text-sm">Checking access…</div>
    </div>
  );
}

/**
 * Full-page login challenge. Nothing else renders behind this gate
 * — not the build header, not the health pill. The legacy Gemma
 * sign-in form lives on the Gemma webapp at `/login.jsp`; opens in
 * a new tab so the curator can sign in and come back without
 * losing context.
 *
 * After clicking the button, polling the canary every 5s in the
 * background lets us auto-detect a successful sign-in (session
 * cookie now valid) and reveal the dashboard without a manual
 * page reload. Reasonable — the cookie is set on a same-origin
 * proxy so it lands on the next probe.
 */
function LoginChallenge({ status }: { status: number }) {
  const loginUrl = gemmaUrl("/login.jsp");
  const [opened, setOpened] = useState(false);

  // Once the curator hits "sign in", start an accelerated re-poll
  // so the page reveals itself the moment the cookie lands. The
  // hook's normal interval still runs; this just shortens the
  // window between the user signing in and the dashboard
  // appearing.
  useEffect(() => {
    if (!opened) return;
    const id = window.setInterval(() => {
      // The canary query is stale-by-default at 60s; nudging it
      // via refetchQueries would require pulling the qc here. The
      // simplest reliable signal: just force a window event that
      // react-query treats as focus, which retriggers the query.
      window.dispatchEvent(new Event("focus"));
    }, 5_000);
    return () => window.clearInterval(id);
  }, [opened]);

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <div className="max-w-md w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-md p-6 space-y-4">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 inline-flex items-center justify-center text-lg"
          >
            ⛔
          </span>
          <div>
            <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Admin sign-in required
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              The Systems Monitoring page is only available to
              <code className="mx-1">GROUP_ADMIN</code>members.
            </p>
          </div>
        </div>

        <p className="text-sm text-slate-700 dark:text-slate-300">
          Sign in on the Gemma webapp — the session cookie carries
          through automatically once you're authenticated.
        </p>

        <a
          href={loginUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => setOpened(true)}
          className="block text-center w-full px-3 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium"
        >
          Sign in on Gemma →
        </a>

        {opened ? (
          <p className="text-[11px] text-slate-500 dark:text-slate-400 text-center">
            Waiting for your session to land… this page reveals
            itself the moment the cookie shows up.
          </p>
        ) : null}

        <div className="pt-2 border-t border-slate-100 dark:border-slate-700 text-[11px] text-slate-500 dark:text-slate-400 font-mono">
          /admin/caches → HTTP {status}
        </div>
      </div>
    </div>
  );
}
