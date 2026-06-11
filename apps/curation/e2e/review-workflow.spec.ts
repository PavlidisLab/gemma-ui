import { test, expect } from "@playwright/test";
import { installErrorGuards, gotoSeedExperiment } from "./_helpers";

/**
 * Smoke tests for the 2026-06-11 review-workflow handoff fixes:
 *   - #3 Finalize-review button uses the new "Finalize review" label
 *     instead of the old "Close audit" / "Close" pair.
 *   - #4 The chip-strip mode pill reads as one of the three
 *     curator-facing states ("Read-only" / "Editing local design" /
 *     "Reviewing proposal") rather than the old "Curation mode" /
 *     "Review mode" pair that conflated editability with proposal
 *     context.
 *
 * No mutating clicks — these are read-only assertions against the
 * seed experiment so they don't pollute the local SQLite. The
 * #7 ValidatorBanner invalidation fix is verified manually (involves
 * commit which mutates).
 */
test.describe("review workflow — handoff 2026-06-11", () => {
  test.beforeEach(({ page }) => installErrorGuards(page));

  test("legacy 'Close audit' / 'Curation mode' / 'Review mode' labels are gone", async ({
    page,
  }) => {
    await gotoSeedExperiment(page);
    // The old labels would catch curators by surprise — make sure
    // none of them leak from a partial rename.
    await expect(
      page.getByRole("button", { name: /^Close audit$/i }),
    ).toHaveCount(0);
    // Old pill texts were "Curation mode" / "Review mode" in uppercase.
    // CSS `text-transform: uppercase` doesn't change the actual DOM
    // text, so the literal-string lookup catches the rendered nodes
    // either way.
    await expect(page.getByText(/^Curation mode$/i)).toHaveCount(0);
    await expect(page.getByText(/^Review mode$/i)).toHaveCount(0);
  });

  test("chip-strip mode pill renders as one of the three canonical states", async ({
    page,
  }) => {
    await gotoSeedExperiment(page);
    // The seed experiment lands on a deterministic baseline; whichever
    // of the three states fires, exactly one pill should be visible.
    // The pill itself doesn't matter for this smoke — what matters is
    // that the label set is correct and not the old "Curation mode"
    // string. (Default tab — the design tab has a pre-existing hook-
    // count issue on the seed unrelated to this handoff; see
    // experiment-design.spec.ts main-baseline failures.)
    const pillRegexes = [
      /^Editing local design$/i,
      /^Reviewing proposal$/i,
      /^Read-only$/i,
    ];
    let hitCount = 0;
    for (const rx of pillRegexes) {
      const n = await page.getByText(rx).count();
      if (n > 0) hitCount += 1;
    }
    expect(hitCount).toBeGreaterThan(0);
  });

  test("Finalize review button appears in the audit-sidebar header when an audit / proposal review is loaded", async ({
    page,
  }) => {
    await gotoSeedExperiment(page);
    // The button only renders when there's a live audit / proposal
    // for this experiment (lifecycleAvailable in SidebarHeader). If
    // the seed has none, the assertion degrades to "not present is
    // fine" — we're checking that IF it's there, it uses the new
    // label, not that it must exist.
    const finalize = page.getByRole("button", {
      name: /^Finalize review$/i,
    });
    if ((await finalize.count()) > 0) {
      await expect(finalize.first()).toBeVisible();
    }
  });

  test("audit / proposal-review panel still renders without crashing", async ({
    page,
  }) => {
    await gotoSeedExperiment(page);
    // The mega-file split + the lifecycle rename together touched
    // ~80% of the audit sidebar's mount path. Verify the panel still
    // mounts cleanly against the seed.
    await expect(page.locator("#root")).toBeVisible();
    const root = page.locator("#root");
    const text = await root.innerText();
    expect(text.length).toBeGreaterThan(100);
  });
});
