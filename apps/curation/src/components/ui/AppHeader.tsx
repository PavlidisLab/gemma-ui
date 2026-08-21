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
 * Admin gating: the Administration tab is gated on the
 * ``GROUP_ADMIN`` authority exposed on ``/me`` (gemma-rest
 * 4a9605c23f, 2026-06-07). Hidden for non-admins; the browser app's
 * SystemMonitoringPage handles the case where someone gets to the
 * URL directly anyway.
 */
import { type ReactNode, useEffect, useState } from "react";
import { ModeChip } from "@/components/ui/ModeChip";
import { HealthChip } from "@/components/ui/HealthChip";
import { SettingsMenu } from "@/features/settings/SettingsMenu";
import { useLogout, useMe } from "@/api/session";
import { TicketContextChip } from "@/features/experiment/ExperimentBanner";
import { navigate } from "@/routes";
import { ExperimentQuickSearch } from "@/features/landing/ExperimentQuickSearch";
import { browserUrl, adminUrl } from "@/lib/appLinks";

export function AppHeader({
  reviewer,
  children,
  ticketContext,
  experimentId,
  experimentLabel,
}: {
  reviewer: string;
  /** Optional slot for sub-route breadcrumb crumbs / context chips.
   *  Rendered immediately after the nav tab cluster. */
  children?: ReactNode;
  /** Ticket id (numeric or numeric-string) when the current surface
   *  was entered from a ticket detail page. When supplied with
   *  ``experimentId``, the header renders the ``TicketContextChip``
   *  (title + member count + popover with prev/next + filter + Open
   *  ticket ↗) right next to the Dashboard button. Design review 2026-06-14:
   *  consolidated from a separate breadcrumb + the experiment
   *  banner's right-side chip into a single header-level affordance.
   *  The breadcrumb IS the dropdown UI now. */
  ticketContext?: number | string | null;
  /** Numeric experiment id — required for the ticket popover's
   *  "current member" highlight + prev/next anchor. When omitted
   *  (non-experiment routes) the ticket chip suppresses. */
  experimentId?: number | string | null;
  /** The experiment being curated, rendered as "Curating <label>".
   *  TAKES OVER the brand label rather than sitting beside it — this is
   *  the only row that stays pinned, and the banner that otherwise
   *  carries the accession scrolls away. Omit on non-experiment routes
   *  (dashboard, inboxes, ticket pages) to get the brand words back.
   *
   *  A node, not a string, because the accession is EDITABLE: App
   *  passes the same ``ShortNameEditor`` the banner used to own, so
   *  de-duplicating the accession didn't cost the rename affordance.
   *  That is also why the label sits OUTSIDE the brand button when
   *  it's present — the editor has its own buttons, and a button
   *  inside a button is invalid. Going home is the ← Dashboard chip
   *  next to it, which is always there off the dashboard. */
  experimentLabel?: ReactNode;
}) {
  const logout = useLogout();
  const me = useMe();
  const isAdmin = me.data?.authorities?.includes("GROUP_ADMIN") ?? false;
  const onDashboard = useHashMatches(["#/"]);
  return (
    // ``min-h-12`` rather than a fixed ``h-12``, and ``flex-wrap`` on
    // the bar itself: on a 1400px window the contents of this header
    // (brand + ticket chip + chip strip + nav + session cluster) need
    // more width than exists, and without the wrap the surplus ran off
    // the right edge — "sign out" and half the mode chip were simply
    // unreachable, while the chip strip crushed itself into three
    // ragged lines trying to make room. Wrapping breaks it where it
    // reads as a break: context (dashboard / ticket / strip) on the
    // first line, nav + session on the second. A fixed height made the
    // overflow spill above and below the bar instead of growing it.
    <header className="flex flex-wrap items-center gap-x-3 gap-y-1 min-h-12 py-1 px-4 border-b border-stone-900 bg-stone-100 text-stone-900 dark:bg-slate-900 dark:text-slate-100 dark:border-slate-700 shrink-0">
      {/* Brand + section title. Clicking returns to the curator
          dashboard. We render "Gemma Curation" as a single label
          (rather than a separate "Curation" nav tab) so the title
          itself communicates which app the curator is in — no
          redundant tab, no double-click target on top of the brand
          mark. Per design review 2026-05-27.

          Inside an experiment the label becomes "Curating GSE33744"
          (Paul, 2026-08-16). This is the ONLY row that stays pinned, and
          the accession otherwise lives only in the experiment banner,
          which scrolls away — Design and Samples are both long enough to
          leave a curator editing factor values with nothing on screen
          naming the dataset.

          It REPLACES the brand words rather than sitting beside them.
          This header is already tight enough to wrap at 1400px, so the
          slot has to pay for itself: "which app am I in" is answered by
          the orange mark, by the ← Dashboard chip and by the whole
          surrounding chrome, and it is answered on every page. Which
          dataset am I editing is answered nowhere else once the banner
          scrolls. */}
      {experimentLabel ? (
        <span className="flex items-center gap-2 font-semibold text-stone-900 dark:text-slate-100 shrink-0 whitespace-nowrap">
          <span className="inline-block w-2 h-2 rounded-sm bg-orange-500" />
          <span className="font-normal text-stone-600 dark:text-slate-400">
            Curating
          </span>
          {experimentLabel}
        </span>
      ) : (
        <button
          type="button"
          onClick={() => navigate("#/")}
          className="flex items-center gap-2 font-semibold text-stone-900 dark:text-slate-100 bg-transparent border-none cursor-pointer p-0 shrink-0 whitespace-nowrap"
          title="Curator dashboard"
        >
          <span className="inline-block w-2 h-2 rounded-sm bg-orange-500" />
          <span>Gemma Curation</span>
        </button>
      )}

      {/* Always-visible "back to dashboard" affordance. The brand
          title above also routes home, but it reads as a section
          label rather than a navigation action when the curator is
          several pages deep (inside an experiment, on the audits
          inbox, etc.). The explicit ← Dashboard chip here gives a
          one-click escape that's labelled by intent. Hidden on the
          dashboard itself so it doesn't loop back on itself. */}
      <BackToDashboardLink />
      {ticketContext != null && experimentId != null ? (
        <span className="ml-1">
          <TicketContextChip
            experimentId={experimentId}
            ticketContext={String(ticketContext)}
          />
        </span>
      ) : null}

      {children}

      {/* Nav + session travel together as ONE flex item, right-aligned
          by ``ml-auto`` rather than by a ``flex-1`` spacer element. Two
          reasons, both about the wrap: a spacer eats the leftover of
          whichever line it happens to land on, so the clusters after it
          start the next line hard against the left margin; and left to
          themselves the two clusters wrap independently, putting
          "Browse / Administration" on one line and "signed in as …" on
          the next. One item, one line, always to the right — whether or
          not it shares that line with the chip strip.

          Cross-app nav lives on the RIGHT so a curator's eye-line (and
          click-line) is anchored to the left, where the dashboard /
          breadcrumb / contextual chips live. Moves the accidental "I
          clicked Browse and got dropped out of the curation app" risk
          away from natural reading order. Per Design review
          2026-05-27. */}
      <div className="flex items-center gap-3 shrink-0 ml-auto">
        {/* Find an experiment from anywhere — Paul, 2026-08-20: "we
            have room here to add a search-for-experiment box that works
            like the one on the dashboard". It IS the one on the
            dashboard: same component, compact variant, so the
            single-hit jump, the ticket-context resolution and the
            catalogue-loading guard cannot drift between the two.

            Suppressed ON the dashboard, which already carries the
            full-width version a few pixels below — two search boxes for
            one catalogue is the curator wondering which one is real. */}
        {onDashboard ? null : (
          <ExperimentQuickSearch
            variant="compact"
            onSelect={(id, ticketId) =>
              navigate(
                `#/experiments/${id}${ticketId ? `?ticket=${ticketId}` : ""}`,
              )
            }
          />
        )}
        <nav className="flex items-center gap-1 whitespace-nowrap">
          <ExternalNavTab href={browserUrl("/browser")}>Browse</ExternalNavTab>
          {isAdmin ? (
            <ExternalNavTab href={adminUrl()}>Admin</ExternalNavTab>
          ) : null}
        </nav>

        <div className="flex items-center gap-3 text-xs text-stone-700 dark:text-slate-300">
          {/* The identity IS the sign-out control (Paul, 2026-08-16).
              This was "signed in as <name>" as static text plus a
              separate "sign out" link — two items and a four-word
              preamble for one piece of information and one action, on a
              row that wraps at 1400px. Who you are and how to stop being
              them are the same control everywhere else on the web, and
              the tooltip carries the sentence the preamble used to. */}
          <button
            type="button"
            className="font-medium text-stone-700 hover:text-stone-900 underline decoration-dotted underline-offset-2 dark:text-slate-300 dark:hover:text-slate-100 bg-transparent border-none cursor-pointer p-0 whitespace-nowrap"
            title={`Signed in as ${reviewer} — click to sign out`}
            onClick={() => logout.mutate()}
          >
            {reviewer}
          </button>
          <ModeChip />
          <HealthChip />
          <SettingsMenu />
        </div>
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
      className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded border border-stone-300 text-stone-700 hover:bg-stone-200/60 hover:text-stone-900 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700/40 dark:hover:text-slate-100 bg-transparent cursor-pointer shrink-0 whitespace-nowrap"
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
