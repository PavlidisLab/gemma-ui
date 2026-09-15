import { useState, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useMe, useLogout } from "@/api/auth";
import { GEMMA_1_LABEL, useGemma1Url } from "./gemma1";
import { curationUrl } from "@/lib/appLinks";
import { VisibilityChip } from "@/components/VisibilityChip";
import { AboutModal } from "@/features/about/AboutModal";
import { SearchBox } from "./SearchBox";
import { gemmaLockup } from "@gemma/assets";

export function AppBar() {
  const me = useMe();
  const user = me.data;
  const logout = useLogout();
  const [aboutOpen, setAboutOpen] = useState(false);
  // Hide the AppBar search box once the curator is on /browser —
  // the unified search + filter input lives in the page itself
  // there, and the AppBar copy reads as redundant (and submitting
  // it just re-navigates to the page they're already on).
  const onBrowser = useRouterState({
    select: (s) => s.location.pathname.startsWith("/browser"),
  });
  const gemma1Browse = useGemma1Url(
    "/expressionExperiment/showAllExpressionExperiments.html",
  );

  return (
    <header className="shrink-0 flex items-center gap-3 h-12 px-4 border-b border-stone-900 bg-stone-100 text-stone-900">
      <Link to="/" className="flex shrink-0 items-center hover:no-underline">
        {/* The lockup — one SVG carrying the mark and the outlined
            wordmark. It replaces a mark plus the word set in the UI face,
            which stood in while the mark had no wordmark cut. At 28px tall
            the wordmark's cap height lands at ~17.7px (the lockup is
            1.585x its own cap height), so the word reads a little larger
            than the 19px type it replaces. */}
        <img
          src={gemmaLockup}
          alt="Gemma"
          style={{ height: 28 }}
          className="block w-auto shrink-0"
        />
      </Link>

      <nav className="flex items-center gap-1 ml-4">
        <NavTab to="/browser">Datasets</NavTab>
        <NavTab to="/platforms">Platforms</NavTab>
        {/* Genes and Curation are shown only when signed in, and
            marked so. Curation is a cross-app link into the curator
            dashboard, a separate vite build on a different origin (see
            ``lib/appLinks.ts``). */}
        {user ? (
          <>
            <NavTab
              to="/genes"
              badge={
                <VisibilityChip
                  tone="restricted"
                  label="signed in"
                  title="Visitors who are not signed in don't see this tab."
                />
              }
            >
              Genes
            </NavTab>
            <ExternalNavTab
              href={curationUrl()}
              badge={
                <VisibilityChip
                  tone="restricted"
                  label="signed in"
                  title="Visitors who are not signed in don't see this tab."
                />
              }
            >
              Curation
            </ExternalNavTab>
          </>
        ) : null}
        {/* Administration — gated on GROUP_ADMIN authority (exposed
            on /me as of gemma-rest 4a9605c23f). Hidden for anonymous
            users AND for logged-in non-admins; SystemMonitoringPage's
            own gate still handles direct URL probes either way. */}
        {user?.authorities?.includes("GROUP_ADMIN") ? (
          <NavTab to="/admin/system">Administration</NavTab>
        ) : null}
      </nav>

      {onBrowser ? null : (
        <div className="ml-4">
          <SearchBox variant="compact" />
        </div>
      )}

      <div className="flex-1" />

      <NavButton onClick={() => setAboutOpen(true)}>About</NavButton>
      {gemma1Browse ? (
        <ExtAnchor href={gemma1Browse}>{GEMMA_1_LABEL}</ExtAnchor>
      ) : null}
      <ExtAnchor href="https://pavlidislab.github.io/Gemma/">Docs</ExtAnchor>

      {/* Signed-in identity + sign-out. Signing IN is the footer's
          "Internal" link. Sign-out POSTs /rest/v2/logout + clears the
          local copy. */}
      <AuthControls
        user={user}
        loading={me.isPending && !me.data}
        onSignOut={() => logout.mutate()}
        signingOut={logout.isPending}
      />
      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </header>
  );
}

/**
 * Auth controls: "Signed in as X · Sign out" when authenticated,
 * nothing when anonymous — signing in is the footer's "Internal"
 * link.
 *
 * While the /users/me probe is in flight the slot is blank — no
 * placeholder shimmer so the AppBar doesn't jitter on every page
 * mount.
 */
function AuthControls({
  user,
  loading,
  onSignOut,
  signingOut,
}: {
  user: { userName?: string | null; email?: string | null } | null | undefined;
  loading: boolean;
  onSignOut: () => void;
  signingOut: boolean;
}) {
  if (loading) return null;
  if (user) {
    // Prefer userName; fall back to email; last-resort "(signed
    // in)" so we never show a bare "—" when /me partially
    // populates (e.g., basic-auth principal without a UserDetails
    // backing the bearer).
    const display = user.userName || user.email || "(signed in)";
    return (
      <div className="text-sm inline-flex items-baseline gap-2 text-stone-900">
        <span className="opacity-70">Signed in as</span>
        <span className="font-medium">{display}</span>
        <button
          type="button"
          onClick={onSignOut}
          disabled={signingOut}
          className="text-sm text-stone-900 hover:no-underline opacity-70 hover:opacity-100 bg-transparent border-none cursor-pointer disabled:cursor-progress p-0"
          title="sign out — invalidates the bearer token"
        >
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
    );
  }
  return null;
}

/** Plain anchor variant of NavTab — used when the target leaves the
 *  browser SPA (e.g. cross-app into the curation site). No active
 *  state, since we're never "on" an external app when this bar
 *  renders. Trailing ↗ marks the navigation as leaving the current
 *  origin so curators don't lose their place by accident. */
function ExternalNavTab({
  href,
  children,
  badge,
}: {
  href: string;
  children: ReactNode;
  /** Rendered after the label and glyph — e.g. a VisibilityChip. */
  badge?: ReactNode;
}) {
  return (
    <a
      href={href}
      className="px-2.5 py-1 text-sm rounded text-gemma-subtle hover:text-gemma-ink hover:bg-gemma-grid/40 hover:no-underline"
    >
      {children}
      <ExtGlyph />
      {badge ? <span className="ml-1">{badge}</span> : null}
    </a>
  );
}

/** Plain right-side external anchor — used for the AppBar's
 *  About-row external links (Legacy browser, Docs, …) that open in a
 *  new tab. Bakes in ``target="_blank"`` + ``rel="noopener
 *  noreferrer"`` so callers can't forget either, and stamps the
 *  trailing ↗. */
function ExtAnchor({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="text-sm text-gemma-subtle hover:text-gemma-ink hover:no-underline"
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
      <ExtGlyph />
    </a>
  );
}

/** Tiny North-East arrow glyph used to mark links that leave the
 *  current site / origin. ``aria-hidden`` because the cue is purely
 *  visual — screen readers should rely on the link's own text +
 *  whatever surrounding context already conveys "external". */
function ExtGlyph() {
  return (
    <span aria-hidden className="ml-0.5 text-[0.85em] opacity-60">
      ↗
    </span>
  );
}

/** Button styled like NavTab's resting state — for nav entries that
 *  open an in-app modal (About) rather than navigating to a route, so
 *  there's no active state to track. */
function NavButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-2.5 py-1 text-sm rounded text-gemma-subtle hover:text-gemma-ink hover:bg-gemma-grid/40 bg-transparent border-none cursor-pointer"
    >
      {children}
    </button>
  );
}

/** Pill-style nav tab. Uses TanStack Router's data-status attribute
 *  (via `activeProps`) so the active route gets the filled treatment
 *  without us threading the current path manually. */
function NavTab({
  to,
  children,
  badge,
}: {
  to: string;
  children: ReactNode;
  /** Rendered after the label — e.g. a VisibilityChip. */
  badge?: ReactNode;
}) {
  return (
    <Link
      to={to}
      className="px-2.5 py-1 text-sm rounded text-gemma-subtle hover:text-gemma-ink hover:bg-gemma-grid/40 hover:no-underline"
      activeProps={{
        className:
          "px-2.5 py-1 text-sm rounded text-gemma-ink bg-gemma-grid/60 font-medium hover:no-underline",
      }}
    >
      {children}
      {badge ? <span className="ml-1">{badge}</span> : null}
    </Link>
  );
}
