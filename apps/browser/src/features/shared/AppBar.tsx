import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { getMyself } from "@/api/endpoints";
import { gemmaUrl } from "@/lib/gemmaConfig";
import { SkinSwitcher } from "@/lib/skin/SkinSwitcher";

export function AppBar() {
  const me = useQuery({ queryKey: ["me"], queryFn: ({ signal }) => getMyself(signal) });
  const user = me.data;

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

      {user ? (
        <div className="text-sm" style={{ color: "rgb(var(--skin-titlebar-text))" }}>
          <span style={{ opacity: 0.7 }}>Signed in as </span>
          <span className="font-medium">{user.userName}</span>
        </div>
      ) : null}
      <SkinSwitcher />
    </header>
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
