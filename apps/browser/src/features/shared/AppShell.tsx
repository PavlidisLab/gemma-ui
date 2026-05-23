import type { ReactNode } from "react";
import { AppBar } from "./AppBar";
import { Footer } from "./Footer";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col h-full">
      <AppBar />
      <main className="flex-1 min-h-0 overflow-auto">{children}</main>
      <Footer />
    </div>
  );
}
