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

  // ``h-screen`` — the shell is exactly one viewport and does not
  // grow. The AppBar and Footer are siblings of ``main`` at fixed
  // height, so they stay put and the page scrolls between them
  // rather than carrying the chrome off the top and bottom.
  //
  // Was ``min-h-screen``, which let the whole document scroll: on a
  // long dataset page the nav and the build stamp both disappeared,
  // and on the Browser you could lose the pager. (Before that it was
  // ``h-full``, which relies on #root / body / html being 100% —
  // none of them are — so short pages collapsed to content height
  // and the Footer floated mid-screen.)
  //
  // ``overflow-hidden`` on the shell so nothing escapes the viewport.
  // ``main`` itself does NOT scroll: every page already owns its own
  // scroller — ``h-full overflow-auto`` (Home, Dataset, Gene,
  // Platform detail) or ``flex-1 min-h-0`` (Browser, Platforms). A
  // scrollbar on ``main`` competes with theirs, and on Platforms it
  // broke the sticky table header, which then scrolled with the rows
  // and landed on top of the first one.
  return (
    <div className="flex flex-col h-screen overflow-hidden">
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
