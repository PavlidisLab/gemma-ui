/**
 * @vitest-environment jsdom
 *
 * What the mode chip tells a curator about where their writes land.
 *
 * Two defects this pins, both shipped and both invisible without a
 * test at this level:
 *
 * 1. **Production rendered in the mildest tier.** ``gemma2.msl.ubc.ca``
 *    was in neither ``PROD_GEMMA_HOSTS`` nor the staging substring
 *    test, so the host every remote-mode recipe points at got the sky
 *    "remote host" chip with no production warning.
 * 2. **The popover promised a confirmation that does not exist.** It
 *    said "each PUT/POST/DELETE will require an explicit
 *    confirmation"; no write path in the app consults ``isProd`` or
 *    ``mode``, so nothing confirms anything.
 *
 * The tier assertions key on the popover COPY rather than a palette
 * class — a colour can be restyled without the claim changing, and it
 * is the claim that has to stay true.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/gemmaMode", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/gemmaMode")>("@/lib/gemmaMode");
  return { ...actual, useGemmaMode: vi.fn() };
});

import { resolveGemmaMode, useGemmaMode } from "@/lib/gemmaMode";
import { ModeChip } from "./ModeChip";

/** Drive the chip with the REAL resolver, so a change to the tier
 *  rule shows up here rather than in a hand-built fixture that agrees
 *  with whatever the rule used to be. */
async function openChipFor(runtime: Parameters<typeof resolveGemmaMode>[0]) {
  vi.mocked(useGemmaMode).mockReturnValue(resolveGemmaMode(runtime));
  render(<ModeChip />);
  await userEvent.click(screen.getByRole("button"));
  return screen.getByRole("dialog", { name: "Backend mode" });
}

const GEMMA2 = { mode: "remote" as const, gemmaBaseUrl: "https://gemma2.msl.ubc.ca" };

beforeEach(() => {
  vi.mocked(useGemmaMode).mockReset();
});

describe("ModeChip — tier", () => {
  it("names gemma2 as production", async () => {
    const pop = await openChipFor(GEMMA2);
    expect(pop.textContent).toContain("Production Gemma");
    expect(pop.textContent).not.toContain("Unrecognized");
  });

  it("shows the host verbatim, prefix and all", async () => {
    // Stripping "staging-" for brevity made a staging host read as the
    // prod one. The chip button carries the full name now.
    vi.mocked(useGemmaMode).mockReturnValue(
      resolveGemmaMode({
        mode: "remote",
        gemmaBaseUrl: "https://staging-gemma.msl.ubc.ca",
      }),
    );
    render(<ModeChip />);
    expect(screen.getByRole("button").textContent).toContain(
      "staging-gemma.msl.ubc.ca",
    );
  });

  it("falls closed on a host it does not recognize", async () => {
    const pop = await openChipFor({
      mode: "remote",
      gemmaBaseUrl: "http://localhost:8081",
    });
    expect(pop.textContent).toContain("Unrecognized Gemma host");
    expect(pop.textContent).toContain("treat anything you write here as real");
  });

});

/**
 * 🛑 Four tests lived here asserting the chip's prose — "Local curation
 * store", "local SQLite DB", "Nothing asks you to confirm", "straight
 * at this host", "GEEQ recalculate", "outlier flags". The prose is gone
 * (Paul, 2026-08-29: the curator does not need spoonfeeding), so they
 * went with it rather than being rewritten.
 *
 * They are worth a note because they PASSED while the sentences they
 * pinned were false. A test that a string is present cannot tell you
 * the string is true, and this one held four claims steady through the
 * routing change that falsified them. Pin what the chip resolves —
 * mode, host, tier — not what it says.
 */
describe("ModeChip — what it claims about writes", () => {
  it("says nothing about host-bound writes in local mode", async () => {
    const pop = await openChipFor({ mode: "local" });
    expect(pop.textContent).not.toContain("straight at this host");
  });
});
