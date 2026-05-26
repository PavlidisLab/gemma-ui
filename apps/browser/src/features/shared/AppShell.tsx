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

  return (
    <div className="flex flex-col h-full">
      {onHome ? null : <AppBar />}
      <main className="flex-1 min-h-0 overflow-auto">{children}</main>
      <Footer />
    </div>
  );
}
