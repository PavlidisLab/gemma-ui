/**
 * @vitest-environment jsdom
 *
 * The abstract card. What it must show, and what it must never let a
 * reader mistake for curation.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PubmedLink } from "./PubmedPopover";
import type { PubmedAbstract } from "@/api/pubmed";

const state = vi.hoisted(() => ({
  data: null as PubmedAbstract | null,
  isLoading: false,
  error: null as Error | null,
}));

vi.mock("@/api/pubmed", async (orig) => {
  const actual = await orig<typeof import("@/api/pubmed")>();
  return {
    ...actual,
    usePubmedAbstract: () => ({
      data: state.data,
      isLoading: state.isLoading,
      error: state.error,
    }),
  };
});

const record = (over: Partial<PubmedAbstract> = {}): PubmedAbstract => ({
  pmid: "29024657",
  title: "Detecting Activated Cell Populations",
  journal: "Methods Mol Biol",
  year: "2017",
  sections: [{ label: null, text: "Neurons respond to stimulation." }],
  mesh: [
    { descriptor: "Amygdala", ui: "D000679", major: false, qualifiers: [] },
    {
      descriptor: "Mice, Inbred C57BL",
      ui: "D008810",
      major: true,
      qualifiers: ["genetics"],
    },
  ],
  ...over,
});

function open() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <PubmedLink pmid="29024657" />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /PMID 29024657/ }));
}

describe("PubmedLink / PubmedPopover", () => {
  beforeEach(() => {
    cleanup();
    state.data = record();
    state.isLoading = false;
    state.error = null;
  });

  it("costs nothing until it is opened", () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <PubmedLink pmid="29024657" />
      </QueryClientProvider>,
    );
    // The chip alone — no card, so no fetch. A page of publication rows
    // must not fire a request per row on render.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the abstract and the MeSH headings", async () => {
    open();
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    expect(screen.getByText(/Neurons respond to stimulation/)).toBeTruthy();
    expect(screen.getByText(/Amygdala/)).toBeTruthy();
    expect(screen.getByText(/Mice, Inbred C57BL/)).toBeTruthy();
  });

  it("stars a major heading and links it to the MeSH browser", async () => {
    open();
    const major = await waitFor(() =>
      screen.getByTitle("Mice, Inbred C57BL — genetics"),
    );
    expect(major.textContent).toBe("Mice, Inbred C57BL*");
    expect(major.getAttribute("href")).toBe(
      "https://meshb.nlm.nih.gov/record/ui?ui=D008810",
    );
  });

  it("🛑 says whose claim the MeSH headings are", async () => {
    open();
    // These are NLM's index terms for the paper, not annotations of the
    // experiment. A curator who reads them as curation would "fix" the
    // design to match them.
    await waitFor(() =>
      expect(screen.getByText(/assigned by NLM to the paper/)).toBeTruthy(),
    );
  });

  it("keeps the PubMed link-out, inside the card", async () => {
    open();
    const link = await waitFor(() =>
      screen.getByRole("link", { name: /open in PubMed/ }),
    );
    expect(link.getAttribute("href")).toBe(
      "https://pubmed.ncbi.nlm.nih.gov/29024657/",
    );
  });

  it("an abstract-less record says so rather than rendering blank", async () => {
    state.data = record({ sections: [] });
    open();
    await waitFor(() =>
      expect(screen.getByText(/No abstract in PubMed/)).toBeTruthy(),
    );
    // MeSH still renders — the two are independent.
    expect(screen.getByText(/Amygdala/)).toBeTruthy();
  });

  it("surfaces the failure instead of an empty card", async () => {
    state.data = null;
    state.error = new Error("PubMed efetch 503");
    open();
    await waitFor(() => expect(screen.getByText(/efetch 503/)).toBeTruthy());
  });

  it("closes on Escape", async () => {
    open();
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("renders nothing at all without a PMID", () => {
    const qc = new QueryClient();
    const { container } = render(
      <QueryClientProvider client={qc}>
        <PubmedLink pmid="" />
      </QueryClientProvider>,
    );
    expect(container.textContent).toBe("");
  });
});
