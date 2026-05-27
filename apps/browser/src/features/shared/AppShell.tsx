import type { ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { AppBar } from "./AppBar";
import { Footer } from "./Footer";

export function AppShell({ children }: { children: ReactNode }) {
  // The home route renders its own integrated masthead (large
  // GEMMA + visual + auth) so the standard AppBar would duplicate
  // the brand mark and crowd the page. Hide it there; every other
  // route keeps the slim AppBar for nav consistency.
  const pathname = useRouterState({
    select: (s) => s.location.pathname,
  });
  const onHome = pathname === "/";

  // ``min-h-screen`` + flex-col + ``flex-1`` on main = sticky footer
  // pattern. Previously ``h-full``, which relies on the parent
  // (#root / body / html) being set to 100% — none of them are, so
  // on short pages (e.g. the Datasets table when the viewport is
  // tall) the shell collapsed to content height and the Footer
  // floated mid-screen. ``min-h-screen`` pins the shell to at least
  // the viewport, content can still grow past it.
  return (
    <div className="flex flex-col min-h-screen">
      {onHome ? null : <AppBar />}
      {/* ``flex flex-col`` so children using ``flex-1`` (e.g. the
          BrowserPage's results table + pager column) can fill
          ``main``'s height. Without this, ``h-full`` on a child
          collapsed to its parent's ``auto`` height and the pager
          floated mid-page with empty space below it. */}
      <main className="flex-1 min-h-0 flex flex-col">{children}</main>
      <Footer />
    </div>
  );
}
