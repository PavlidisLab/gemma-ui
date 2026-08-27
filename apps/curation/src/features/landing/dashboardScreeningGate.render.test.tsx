/**
 * @vitest-environment jsdom
 *
 * "+ New screening ticket" is greyed while the consumer is shelved.
 *
 * The form mints a `type=SCREENING` ticket carrying a plain-language
 * instruction and an empty `targets`. Nothing turns that instruction
 * into candidates — measured 2026-08-27 across both agent repos, where
 * every SCREENING producer POSTs an already-populated ticket instead.
 * So the button would hand a curator a ticket that goes nowhere.
 *
 * 🛑 Greyed, NOT hidden. A curator who cannot see the affordance cannot
 * tell "not built yet" from "I lack the permission" or "it moved", and
 * the tooltip is the only thing that answers that. Pinned here because
 * the cheap way to disable a button is to delete it, and that loses the
 * answer.
 *
 * The `ml-auto` hand-off between this button and the import one is
 * pinned by `dashboardImportGate` and is unaffected: disabling a button
 * does not move it.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { CuratorDashboard } from "./CuratorDashboard";
import {
  SCREENING_TICKET_CREATE_ENABLED,
  SCREENING_TICKET_DISABLED_TITLE,
} from "@/features/tickets/CreateScreeningTicketModal";

// Same shim as dashboardImportGate: this jsdom has no localStorage and
// the dashboard mounts the theme menu, which reads it.
if (!window.localStorage) {
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    },
  });
}

vi.mock("@/api/datasets", async (orig) => {
  const actual = await orig<typeof import("@/api/datasets")>();
  return {
    ...actual,
    useDatasets: () => ({ data: [], isLoading: false, isError: false }),
  };
});

vi.mock("@/api/tickets", async (orig) => {
  const actual = await orig<typeof import("@/api/tickets")>();
  return {
    ...actual,
    useTickets: () => ({ data: [], isLoading: false, isFetching: false }),
  };
});

function open() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <CuratorDashboard reviewer="local-curator" onSelect={vi.fn()} />
    </QueryClientProvider>,
  );
}

const screeningButton = () =>
  screen.getByRole("button", { name: /new screening ticket/i });

describe("dashboard — screening-ticket create gate", () => {
  beforeEach(() => open());
  afterEach(cleanup);

  it("still shows the button — greyed is not hidden", () => {
    expect(screeningButton()).toBeTruthy();
  });

  it("disables it while the consumer is shelved", () => {
    expect((screeningButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it("says why, because a greyed control with no reason is a dead end", () => {
    expect(screeningButton().getAttribute("title")).toBe(
      SCREENING_TICKET_DISABLED_TITLE,
    );
  });

  it("does not open the create modal when clicked", () => {
    fireEvent.click(screeningButton());
    // The modal renders a dialog via createPortal; nothing should mount.
    // Match its HEADING, not its text — the button's own label is
    // "+ New screening ticket" and a text query matches that instead,
    // passing whether or not the modal opened.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.queryByRole("heading", { name: /new screening ticket/i }),
    ).toBeNull();
  });

  it("keeps the gate a single const, not a hardcoded false", () => {
    // If someone flips the const, the button must follow. Pinning the
    // wiring rather than the value: the park affordance drifted exactly
    // this way, with per-file `false` gates beside the real one.
    expect((screeningButton() as HTMLButtonElement).disabled).toBe(
      !SCREENING_TICKET_CREATE_ENABLED,
    );
  });
});
