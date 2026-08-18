/**
 * @vitest-environment jsdom
 *
 * The baseline states what you are looking at; it does not ask.
 *
 * Offering a choice of baselines never resolved the divergence between
 * the five places the curated set lives — it handed that divergence to
 * the curator to adjudicate, per experiment, with no indication of
 * which copy was current. What replaces it is a statement: the curation
 * on screen, and the version it was synced from
 * (`UI_BASELINE_MUST_DEFAULT_TO_GOLD_2026_08_17`).
 *
 * The comparator stays a dropdown on purpose. Picking what to compare
 * against is real work; being asked which copy to trust is not.
 *
 * 🛑 That statement makes no claim about staleness, and these tests
 * hold it to that. The version names a build of the whole set, so a
 * page keyed on it warns 499 times for one real edit.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Design } from "@/features/experiment/types";

vi.mock("./useChipState", () => ({ useChipState: vi.fn() }));
vi.mock("./useSourceAvailability", () => ({
  useCurations: vi.fn(),
  useSourceUniverse: vi.fn(),
}));
vi.mock("./useChipDiff", () => ({ useChipDiffSummary: vi.fn() }));

import { ChipStrip } from "./ChipStrip";
import { useChipState } from "./useChipState";
import { useCurations, useSourceUniverse } from "./useSourceAvailability";
import { useChipDiffSummary } from "./useChipDiff";
import { DesignDraftContext } from "@/features/design/DesignDraftContext";

const useChipStateMock = useChipState as ReturnType<typeof vi.fn>;
const useCurationsMock = useCurations as ReturnType<typeof vi.fn>;
const useSourceUniverseMock = useSourceUniverse as ReturnType<typeof vi.fn>;
const useChipDiffSummaryMock = useChipDiffSummary as ReturnType<typeof vi.fn>;

function savedWith(version: string | null): Design {
  const d: Design = {
    experiment_id: 42,
    experiment_short_name: "GSE96826",
    factors: [],
    biomaterials: [],
    tags: [],
  };
  if (version) (d as unknown as { gold_data_version: string }).gold_data_version = version;
  return d;
}

function renderStrip({
  baseline = "current",
  version = "pg500-2873cc08b06b" as string | null,
  dirty = false,
}: {
  baseline?: string;
  version?: string | null;
  dirty?: boolean;
} = {}) {
  useChipStateMock.mockReturnValue({
    baseline,
    comparator: "agent_proposal",
    setBaseline: vi.fn(),
    setComparator: vi.fn(),
    pinnedBaseline: null,
    pinnedBaselineUnavailable: false,
  });
  useCurationsMock.mockReturnValue({ data: [] });
  useSourceUniverseMock.mockReturnValue({
    sources: ["current", "empty", "preboard", "live", "agent_proposal"],
    availability: {
      current: { available: true, reason: "", comingSoon: false },
      empty: { available: true, reason: "", comingSoon: false },
      preboard: { available: true, reason: "", comingSoon: false },
      live: { available: true, reason: "", comingSoon: false },
      agent_proposal: { available: true, reason: "", comingSoon: false },
    },
    isLoading: false,
  });
  useChipDiffSummaryMock.mockReturnValue({ summary: null, isLoading: false });

  const draftValue = {
    saved: savedWith(version),
    curatingOnTopOf: null,
    diff: { isDirty: dirty },
  };
  return render(
    <DesignDraftContext.Provider
      value={draftValue as unknown as never}
    >
      <ChipStrip experimentId={42} flow="review" tab="design" />
    </DesignDraftContext.Provider>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe("the baseline is a statement, not a question", () => {
  it("renders the baseline as a label, never as a dropdown", () => {
    renderStrip();
    const strip = screen.getByRole("region", {
      name: /Comparison source selection/i,
    });
    // Exactly one dropdown remains, and it is the comparator.
    const dropdowns = strip.querySelectorAll('button[aria-haspopup="listbox"]');
    expect(dropdowns).toHaveLength(1);
    expect(screen.getByText("Viewing:")).toBeTruthy();
  });

  it("does not spend a chip repeating a constant", () => {
    // ``current`` is the baseline on every review, so "current curation"
    // was the same words on every experiment — beside the version, which
    // is the part that varies. The label stays; the constant goes.
    renderStrip();
    expect(screen.getByText("Viewing:")).toBeTruthy();
    expect(screen.queryByText("current curation")).toBeNull();
  });

  it("names the source again when there is no version to state", () => {
    // The label must never be left with nothing after it.
    renderStrip({ version: null });
    expect(screen.getByText("current curation")).toBeTruthy();
  });

  it("still names a seed when a ticket pinned one", () => {
    // The pin is a real fact — what this curation was built on top of —
    // and removing the picker must not stop the strip reporting it.
    renderStrip({ baseline: "polished:gold" });
    expect(screen.getByText("Gold polished")).toBeTruthy();
  });
});

describe("the version statement that replaced the picker", () => {
  it("states the version the curation on screen carries", () => {
    renderStrip({ version: "pg500-2873cc08b06b" });
    expect(screen.getByText("pg500-2873cc08b06b")).toBeTruthy();
  });

  it("never calls the version gold", () => {
    // 🛑 The stamp names the snapshot the base design was synced from.
    // Whether that snapshot is anybody's gold is a separate claim, and
    // not one this chip can make (Paul, 2026-08-17).
    renderStrip({ version: "pg500-2873cc08b06b" });
    const chip = screen.getByText("pg500-2873cc08b06b");
    expect(chip.getAttribute("title")?.toLowerCase()).not.toContain("gold");
  });

  it("claims nothing about whether this dataset is current", () => {
    // 🛑 The stamp names a build of the whole curated set. One dataset
    // being edited moves it for all 500, so comparing a page against it
    // warns 499 times for one real change — measured, cab 2026-08-17.
    // The chip states what it knows and stops.
    renderStrip({ version: "pg500-2873cc08b06b" });
    const chip = screen.getByText("pg500-2873cc08b06b");
    expect(chip.textContent).not.toContain("⚠");
    expect(chip.getAttribute("title")).toContain("not this dataset alone");
  });

  it("never warns off a corpus-level version, whatever the store reports", () => {
    // The regression this is here for: the store is about to start
    // returning a non-null corpus `current_version`. Nothing on this
    // page may key on it. A per-dataset comparison needs a per-dataset
    // field, and the chip stays neutral until one exists.
    const { container } = renderStrip({ version: "pg500-3e60bef6ef77" });
    expect(container.textContent).not.toContain("⚠");
    expect(container.querySelector(".border-amber-400")).toBeNull();
  });

  it("says nothing at all when the design carries no stamp", () => {
    // 34 of 534 base rows are unstamped. An absent version is not a
    // stale one, and "unknown" beside every other chip is noise.
    renderStrip({ version: null });
    expect(screen.queryByText(/pg500-/)).toBeNull();
  });
});

describe("an edited design is not the version it was synced from", () => {
  it("says so the moment the draft is dirty", () => {
    renderStrip({ version: "pg500-2873cc08b06b", dirty: true });
    const chip = screen.getByText(/pg500-2873cc08b06b/);
    expect(chip.textContent).toContain("your edits");
    expect(chip.getAttribute("title")).toContain("uncommitted edits");
  });

  it("states the version plainly while the draft is clean", () => {
    renderStrip({ version: "pg500-2873cc08b06b", dirty: false });
    const chip = screen.getByText("pg500-2873cc08b06b");
    expect(chip.textContent).not.toContain("your edits");
  });
});
