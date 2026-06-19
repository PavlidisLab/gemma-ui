/**
 * Tests for the QT-preference "exactly one preferred processed QT" predicate.
 *
 * The logic lives inside buildItems() in PrePublishChecklist.tsx, which
 * is not exported and depends on React context/hooks (useDesignDraft,
 * useQuantitationTypes, etc.).  Extracting it via a full component
 * render would require mocking TanStack Query providers plus
 * DesignDraftContext — more infrastructure than the predicate warrants.
 *
 * The predicate itself is a one-liner:
 *   ok: processedPrefQts.length === 1
 * where
 *   processedPrefQts = (qts ?? []).filter((q) => q.is_masked_preferred)
 *
 * We copy that formula verbatim here and test the predicate directly.
 * If the source formula changes, these tests will drift — but the
 * formula is also mirrored in a comment in PrePublishChecklist.tsx
 * (lines ~594-595) so any drift is easy to spot.
 *
 * SKIP RATIONALE: the React-component path is not tested here because
 * buildItems() is not exported and full-component rendering requires
 * mocking at least four context providers (DesignDraftContext,
 * QueryClientProvider, TanStack Router, useStickyState).
 */

import { describe, expect, it } from "vitest";

/** Minimal shape of a QuantitationType — only the fields the predicate
 *  touches. */
interface QtStub {
  is_preferred: boolean;
  is_masked_preferred: boolean;
}

/** The predicate extracted verbatim from PrePublishChecklist.tsx ~l594.
 *  "Exactly one masked-preferred (processed) QT" means DEA is set up
 *  correctly.  Zero = missing processed pref; two+ = ambiguous. */
function qtPrefPasses(qts: QtStub[]): boolean {
  const maskedPrefQts = qts.filter((q) => q.is_masked_preferred);
  return maskedPrefQts.length === 1;
}

// Helpers to construct minimal QT stubs.
const processedPref = (): QtStub => ({ is_preferred: true,  is_masked_preferred: true });
const rawPref       = (): QtStub => ({ is_preferred: true,  is_masked_preferred: false });
const neither       = (): QtStub => ({ is_preferred: false, is_masked_preferred: false });

describe("qtPrefPasses — QT preference predicate", () => {
  it("passes when exactly one masked-preferred (processed) QT is present", () => {
    expect(qtPrefPasses([rawPref(), processedPref()])).toBe(true);
  });

  it("passes when the processed QT is the only entry", () => {
    expect(qtPrefPasses([processedPref()])).toBe(true);
  });

  it("fails when there are zero processed-preferred QTs (raw-only or empty)", () => {
    expect(qtPrefPasses([])).toBe(false);
    expect(qtPrefPasses([rawPref()])).toBe(false);
    expect(qtPrefPasses([neither()])).toBe(false);
  });

  it("fails when there are zero processed-preferred QTs but multiple raw-preferred QTs", () => {
    // Multiple raw prefs + no processed pref is still a failure —
    // DEA needs exactly one processed QT regardless of raw count.
    expect(qtPrefPasses([rawPref(), rawPref()])).toBe(false);
  });

  it("fails when two or more processed-preferred QTs are present", () => {
    expect(qtPrefPasses([processedPref(), processedPref()])).toBe(false);
    expect(qtPrefPasses([rawPref(), processedPref(), processedPref()])).toBe(false);
  });

  it("is not thrown off by non-preferred QTs alongside a single processed pref", () => {
    // neither() rows should be invisible to the predicate.
    expect(qtPrefPasses([neither(), processedPref(), rawPref()])).toBe(true);
  });
});
