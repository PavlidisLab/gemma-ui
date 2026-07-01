/**
 * @vitest-environment jsdom
 *
 * Render tests for the "Proposer details" popup's Paper section — the
 * per-GSE paper-fetch status added 2026-06-30. Pins: the Paper section
 * renders the fetch_status pill + availability chips + source/pmid, a
 * degraded fetch (rate_limited) is surfaced distinctly from a genuine
 * "no paper", and the section is absent when no paper_availability is
 * present (older proposals).
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import type { RunProvenance } from "@/api/auditTypes";
import {
  ProposerDetailsDialog,
  hasProposerDetails,
} from "./ProposerDetailsDialog";

function prov(overrides: Partial<RunProvenance> = {}): RunProvenance {
  return { model: "claude-sonnet-4-6", ...overrides };
}

describe("ProposerDetailsDialog — Paper section", () => {
  it("renders fetch_status, availability chips, source and pmid", () => {
    render(
      <ProposerDetailsDialog
        open
        onClose={() => {}}
        provenance={prov({
          paper_availability: {
            paper_available: true,
            full_text_available: true,
            source: "author_title_search",
            pmid: "41673139",
            fetch_status: "found",
          },
        })}
      />,
    );
    expect(screen.getByText("Paper")).toBeTruthy();
    expect(screen.getByText("found")).toBeTruthy();
    expect(screen.getByText("author_title_search")).toBeTruthy();
    expect(screen.getByText("41673139")).toBeTruthy();
    expect(screen.getByText("full text")).toBeTruthy();
  });

  it("surfaces a rate_limited fetch (degraded) distinctly", () => {
    render(
      <ProposerDetailsDialog
        open
        onClose={() => {}}
        provenance={prov({
          paper_availability: {
            paper_available: false,
            fetch_status: "rate_limited",
          },
        })}
      />,
    );
    const pill = screen.getByText("rate_limited");
    expect(pill).toBeTruthy();
    // amber = degraded fetch, worth curator attention.
    expect(pill.className).toMatch(/amber/);
  });

  it("omits the Paper section when no paper_availability is present", () => {
    render(
      <ProposerDetailsDialog
        open
        onClose={() => {}}
        provenance={prov({ run_id: "r1" })}
      />,
    );
    expect(screen.queryByText("Paper")).toBeNull();
  });

  it("hasProposerDetails is true when only paper_availability is present", () => {
    expect(
      hasProposerDetails({
        paper_availability: { fetch_status: "no_paper" },
      }),
    ).toBe(true);
  });
});
