import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useMe, useLogout } from "@/api/auth";
import { gemmaUrl } from "@/lib/gemmaConfig";
import { LoginModal } from "./LoginModal";

export function AppBar() {
  const me = useMe();
  const user = me.data;
  const logout = useLogout();
  const [loginOpen, setLoginOpen] = useState(false);

  return (
    <header className="flex items-center gap-3 h-12 px-4 border-b border-stone-900 bg-stone-100 text-stone-900">
      <Link
        to="/"
        className="flex items-center gap-2 font-semibold text-stone-900 hover:no-underline"
      >
        <span className="inline-block w-2 h-2 rounded-sm bg-orange-500" />
        <span>Gemma</span>
      </Link>

      <nav className="flex items-center gap-1 ml-4">
        <NavTab to="/browser">Datasets</NavTab>
        <NavTab to="/platforms">Platforms</NavTab>
        <NavTab to="/genes">Genes</NavTab>
      </nav>

      <div className="flex-1" />

      <NavTab to="/about">About</NavTab>
      <a
        href={gemmaUrl("/expressionExperiment/showAllExpressionExperiments.html")}
        className="text-sm text-gemma-subtle hover:text-gemma-ink hover:no-underline"
        target="_blank"
        rel="noreferrer"
      >
        Legacy browser
      </a>
      <a
        href="https://pavlidislab.github.io/Gemma/"
        className="text-sm text-gemma-subtle hover:text-gemma-ink hover:no-underline"
        target="_blank"
        rel="noreferrer"
      >
        Docs
      </a>

      {/* Auth surface — in-app sign-in modal posts directly to
          /rest/v2/login and stashes the bearer token. Sign-out
          POSTs /rest/v2/logout + clears the local copy. */}
      <AuthControls
        user={user}
        loading={me.isPending && !me.data}
        onSignIn={() => setLoginOpen(true)}
        onSignOut={() => logout.mutate()}
        signingOut={logout.isPending}
      />
      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
    </header>
  );
}

/**
 * Auth controls: "Sign in" link when anonymous, "Signed in as X ·
 * Sign out" pair when authenticated. Both targets are the legacy
 * Gemma webapp (login.jsp / j_spring_security_logout); we don't
 * own a login form yet. After sign-in the curator returns to this
 * tab and the session cookie carries through.
 *
 * While the /users/me probe is in flight the slot is blank — no
 * placeholder shimmer so the AppBar doesn't jitter on every page
 * mount.
 */
function AuthControls({
  user,
  loading,
  onSignIn,
  onSignOut,
  signingOut,
}: {
  user: { userName?: string | null; email?: string | null } | null | undefined;
  loading: boolean;
  onSignIn: () => void;
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
  return (
    <button
      type="button"
      onClick={onSignIn}
      className="text-sm px-2.5 py-1 rounded border bg-gemma-accent text-white hover:bg-gemma-accent hover:no-underline border-transparent"
      title="sign in to Gemma"
    >
      Sign in
    </button>
  );
}

/** Pill-style nav tab. Uses TanStack Router's data-status attribute
 *  (via `activeProps`) so the active route gets the filled treatment
 *  without us threading the current path manually. */
function NavTab({ to, children }: { to: string; children: ReactNode }) {
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
    </Link>
  );
}
