/**
 * Systems Monitoring page — replaces the legacy
 * `pages/admin/systemStats.jsp` + `pages/admin/activeUsers.jsp`.
 * Eight sections in a responsive grid; admin-gated.
 *
 * The page polls each endpoint on its own cadence (defined in
 * `./api.ts`). When the browser tab becomes hidden, react-query's
 * `refetchIntervalInBackground: false` pauses the polls
 * automatically; on focus they resume.
 *
 * Auth model: anything with `credentials: "include"` rides along
 * any Spring session cookie set by a legacy Gemma login. If the
 * admin endpoints 401/403, the gate surfaces a clear "sign in as
 * GROUP_ADMIN on the Gemma webapp" message — we don't proxy a
 * login form ourselves yet.
 *
 * Inspiration: the legacy JSPs (`gemma-web/.../systemStats.jsp`,
 * `gemma-web/.../activeUsers.jsp`) — same goal, modern surface.
 * Reference: `~/Dev/eclipseworkspace/Gemma/handoffs/HANDOFF_SYSTEMS_MONITORING_UI.md`.
 */

import { ApiError } from "@/api/client";
import { useSystemSnapshot } from "./api";
import { HeaderSection } from "./sections/HeaderSection";
import { JvmSection } from "./sections/JvmSection";
import { HibernateSection } from "./sections/HibernateSection";
import { CachesSection } from "./sections/CachesSection";
import { JobsSection } from "./sections/JobsSection";
import { SessionsSection } from "./sections/SessionsSection";
import { IndicesSection } from "./sections/IndicesSection";
import { OntologiesSection } from "./sections/OntologiesSection";

export function SystemMonitoringPage() {
  // Use /admin/system as the canary for the admin gate. If it
  // 401/403s the curator isn't authorized; render the gate UI
  // instead of the dashboard so we don't blast eight failed
  // requests at the server.
  const canary = useSystemSnapshot(30_000);

  // Don't hard-block on canary.isLoading — header (/info, /health)
  // is anonymous-safe, so we render it underneath any state.
  const authError =
    canary.error instanceof ApiError &&
    (canary.error.status === 401 || canary.error.status === 403);

  return (
    <div className="mx-auto w-full max-w-[1800px] px-4 py-4 space-y-3">
      <HeaderSection />

      {authError ? (
        <AdminGate status={(canary.error as ApiError).status} />
      ) : (
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
      )}
    </div>
  );
}

function AdminGate({ status }: { status: number }) {
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/30 dark:border-amber-700 px-4 py-5 text-sm">
      <p className="font-semibold text-amber-900 dark:text-amber-100 mb-1">
        Admin sign-in required
      </p>
      <p className="text-amber-900 dark:text-amber-200">
        These endpoints require <code>GROUP_ADMIN</code>. Got HTTP{" "}
        <span className="font-mono">{status}</span> from{" "}
        <code>/admin/system</code>. Sign in on the legacy Gemma
        webapp (admin login lives there for now) and reload this
        page — the session cookie carries through.
      </p>
    </div>
  );
}
