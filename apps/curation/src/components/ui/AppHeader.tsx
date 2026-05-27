/**
 * Top app chrome — appears on every full-page surface so the
 * curator never lands on a screen with no way home.
 *
 * Unified 2026-05-26 with the browser app's ``AppBar`` (see
 * ``apps/browser/src/features/shared/AppBar.tsx``) so Gemma feels
 * like one product across browse + curation + admin. Slim h-12
 * Gemma-1-style bar; same brand mark + tab treatment as the
 * browser side.
 *
 * Nav tabs reflect the global Gemma sitemap, not curation-internal
 * routes:
 *   - Browse → cross-app link to the browser site
 *   - Curation → in-app link to the curator dashboard (active)
 *   - Administration → cross-app link to the admin surface
 *
 * Admin gating: the Administration tab is unconditionally visible
 * during the unification rollout. In the final product it will be
 * gated on an admin role flag that ``/me`` doesn't yet expose; see
 * the TODO below — wire ``user.is_admin`` (or equivalent) when the
 * backend adds the field.
 */
import { type ReactNode, useEffect, useState } from "react";
import { ModeChip } from "@/components/ui/ModeChip";
import { HealthChip } from "@/components/ui/HealthChip";
import { SettingsMenu } from "@/features/settings/SettingsMenu";
import { useLogout } from "@/api/session";
import { navigate } from "@/routes";
import { browserUrl, adminUrl } from "@/lib/appLinks";

export function AppHeader({
  reviewer,
  children,
}: {
  reviewer: string;
  /** Optional slot for sub-route breadcrumb crumbs / context chips.
   *  Rendered immediately after the nav tab cluster. */
  children?: ReactNode;
}) {
  const logout = useLogout();
  return (
    <header className="flex items-center gap-3 h-12 px-4 border-b border-stone-900 bg-stone-100 text-stone-900 dark:bg-slate-900 dark:text-slate-100 dark:border-slate-700 shrink-0">
      {/* Brand + section title. Clicking returns to the curator
          dashboard. We render "Gemma Curation" as a single label
          (rather than a separate "Curation" nav tab) so the title
          itself communicates which app the curator is in — no
          redundant tab, no double-click target on top of the brand
          mark. Per Paul 2026-05-27. */}
      <button
        type="button"
        onClick={() => navigate("#/")}
        className="flex items-center gap-2 font-semibold text-stone-900 dark:text-slate-100 bg-transparent border-none cursor-pointer p-0"
        title="Curator dashboard"
      >
        <span className="inline-block w-2 h-2 rounded-sm bg-orange-500" />
        <span>Gemma Curation</span>
      </button>

      {/* Always-visible "back to dashboard" affordance. The brand
          title above also routes home, but it reads as a section
          label rather than a navigation action when the curator is
          several pages deep (inside an experiment, on the audits
          inbox, etc.). The explicit ← Dashboard chip here gives a
          one-click escape that's labelled by intent. Hidden on the
          dashboard itself so it doesn't loop back on itself. */}
      <BackToDashboardLink />

      {children}

      <div className="flex-1" />

      {/* Cross-app nav lives on the RIGHT so a curator's eye-line
          (and click-line) is anchored to the left, where the
          dashboard / breadcrumb / contextual chips live. Moves the
          accidental "I clicked Browse and got dropped out of the
          curation app" risk away from natural reading order. Per
          Paul 2026-05-27. */}
      <nav className="flex items-center gap-1">
        <ExternalNavTab href={browserUrl("/browser")}>Browse</ExternalNavTab>
        {/* TODO: gate on user.is_admin once /me exposes a role
            flag. Visible to everyone for now per Paul 2026-05-26. */}
        <ExternalNavTab href={adminUrl()}>Administration</ExternalNavTab>
      </nav>

      <div className="flex items-center gap-3 text-xs text-stone-700 dark:text-slate-300 shrink-0">
        <span>
          signed in as <span className="font-medium">{reviewer}</span>
        </span>
        <ModeChip />
        <HealthChip />
        <SettingsMenu />
        <button
          type="button"
          className="text-stone-500 hover:text-stone-900 underline dark:text-slate-400 dark:hover:text-slate-100 bg-transparent border-none cursor-pointer p-0"
          onClick={() => logout.mutate()}
        >
          sign out
        </button>
      </div>
    </header>
  );
}

/** "← Dashboard" affordance. Renders nothing when the curator is
 *  already on the dashboard (#/ or empty hash). Subscribes to
 *  ``hashchange`` so it appears / disappears as routes change without
 *  a remount. */
function BackToDashboardLink() {
  const onDashboard = useHashMatches(["#/"]);
  // ``useHashMatches`` returns true on bare "#/" — exactly the case
  // where we DON'T want to render the back-link.
  if (onDashboard) return null;
  return (
    <button
      type="button"
      onClick={() => navigate("#/")}
      title="Back to the curator dashboard"
      className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded border border-stone-300 text-stone-700 hover:bg-stone-200/60 hover:text-stone-900 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700/40 dark:hover:text-slate-100 bg-transparent cursor-pointer"
    >
      <span aria-hidden>←</span>
      <span>Dashboard</span>
    </button>
  );
}

/** Cross-app NavTab. Plain anchor — leaves the curation app, so we
 *  don't try to keep it inside the SPA. Same visual as HashNavTab in
 *  its inactive state (we're never "on" an external app when this
 *  bar renders). Trailing ↗ glyph signals the navigation leaves the
 *  current origin — matches the browser AppBar's external-link
 *  treatment. */
function ExternalNavTab({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="px-2.5 py-1 text-sm rounded text-stone-600 hover:text-stone-900 hover:bg-stone-200/60 hover:no-underline dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-700/40"
    >
      {children}
      <span aria-hidden className="ml-0.5 text-[0.85em] opacity-60">
        ↗
      </span>
    </a>
  );
}

/** Returns true when ``window.location.hash`` starts with any of the
 *  given prefixes. Subscribes to ``hashchange`` so the active-tab
 *  highlight tracks navigation. */
function useHashMatches(prefixes: string[]): boolean {
  const [hash, setHash] = useState(() =>
    typeof window === "undefined" ? "" : window.location.hash || "#/",
  );
  useEffect(() => {
    const onChange = () => setHash(window.location.hash || "#/");
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  const h = hash || "#/";
  return prefixes.some((p) => (p === "#/" ? h === "#/" || h === "" : h.startsWith(p)));
}
