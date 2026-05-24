import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useMe, useLogout } from "@/api/auth";
import { gemmaUrl } from "@/lib/gemmaConfig";
import { SkinSwitcher } from "@/lib/skin/SkinSwitcher";
import { LoginModal } from "./LoginModal";

export function AppBar() {
  const me = useMe();
  const user = me.data;
  const logout = useLogout();
  const [loginOpen, setLoginOpen] = useState(false);

  return (
    <header
      className="flex items-center gap-3 h-14 px-4 border-b border-gemma-grid bg-surface"
      style={{
        // ExtJS skin paints the titlebar via gradient + dark text;
        // declared inline so the AppBar picks up the skin without
        // each new skin needing a Tailwind override block.
        background:
          "linear-gradient(to bottom, rgb(var(--skin-titlebar-from)) 0%, rgb(var(--skin-titlebar-to)) 100%)",
        color: "rgb(var(--skin-titlebar-text))",
      }}
    >
      <Link
        to="/"
        className="flex items-center gap-2 font-semibold hover:no-underline"
        style={{ color: "rgb(var(--skin-titlebar-text))" }}
      >
        <span className="inline-block w-2 h-2 rounded-full bg-gemma-accent" />
        <span>Gemma</span>
      </Link>

      <nav className="flex items-center gap-1 ml-4">
        <NavTab to="/browser">Datasets</NavTab>
        <NavTab to="/platforms">Platforms</NavTab>
        <NavTab to="/genes">Genes</NavTab>
        <NavTab to="/summary">Summary</NavTab>
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
      <SkinSwitcher />
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
  user: { userName?: string | null } | null | undefined;
  loading: boolean;
  onSignIn: () => void;
  onSignOut: () => void;
  signingOut: boolean;
}) {
  if (loading) return null;
  if (user) {
    return (
      <div
        className="text-sm inline-flex items-baseline gap-2"
        style={{ color: "rgb(var(--skin-titlebar-text))" }}
      >
        <span style={{ opacity: 0.7 }}>Signed in as</span>
        <span className="font-medium">{user.userName ?? "—"}</span>
        <button
          type="button"
          onClick={onSignOut}
          disabled={signingOut}
          className="text-sm hover:no-underline opacity-70 hover:opacity-100 bg-transparent border-none cursor-pointer disabled:cursor-progress p-0"
          title="sign out — invalidates the bearer token"
          style={{ color: "rgb(var(--skin-titlebar-text))" }}
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
