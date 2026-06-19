import { test, expect, type Route } from "@playwright/test";
import { installErrorGuards, gotoSeedExperiment } from "./_helpers";

/**
 * Gene-taxon disambiguation in the design-tab term picker.
 * UIB_HANDOFF_2026_06_18_ANNOTATION_SEARCH_GENE_TAXON, test plan.
 *
 * Anchor: a curator searches ``kras`` and must see the human and mouse
 * genes as DISTINCT rows (``H.s.`` / ``M.m.`` suffix) rather than one
 * undifferentiated ``KRAS``.
 *
 * Status: SKIP-GATED. Two preconditions before this runs green:
 *   1. Live taxon data — gene hits only carry ``taxon_*`` once frink
 *      ships the 2026-06-18 backend change (the route-mock below makes
 *      the spec hermetic, so this is satisfied here).
 *   2. A picker-driving harness — opening the OntologyTermPicker
 *      typeahead means entering the design editor's FV edit flow, which
 *      the e2e suite doesn't yet have a stable helper for. The
 *      interaction below is a documented best-effort; validate the
 *      selectors against the running app before relying on it.
 *
 * Run locally with TERM_PICKER_TAXON_E2E=1 once the harness lands. Until
 * then the abbreviation + clustering logic is covered by the unit tests
 * (`src/lib/taxon.test.ts`, `src/api/annotations.test.ts`).
 */
const ENABLED = !!process.env.TERM_PICKER_TAXON_E2E;

// Four-species `kras` fixture mirroring the live frink shape (camelCase
// on the wire; client.ts snakeifies before the React tree sees it).
const KRAS_FIXTURE = [
  geneRow("KRAS", "Homo sapiens", "human", 3845, 120),
  geneRow("Kras", "Mus musculus", "mouse", 16653, 60),
  geneRow("Kras", "Rattus norvegicus", "rat", 24525, 12),
  geneRow("kras", "Danio rerio", "zebrafish", 30033, 4),
];

function geneRow(
  value: string,
  scientific: string,
  common: string,
  geneId: number,
  usage: number,
) {
  return {
    value,
    valueUri: `http://purl.org/commons/record/ncbi_gene/${geneId}`,
    category: "gene",
    categoryUri: null,
    usageCount: usage,
    taxonId: 9606,
    taxonCommonName: common,
    taxonScientificName: scientific,
  };
}

test.describe("Term picker — gene taxon disambiguation", () => {
  test.skip(!ENABLED, "needs TERM_PICKER_TAXON_E2E + design-picker harness");
  test.beforeEach(({ page }) => installErrorGuards(page));

  // Re-tag @critical once the picker harness + live taxon data land.
  test("kras yields distinct H.s. and M.m. rows", async ({ page }) => {
    await page.route("**/rest/v2/annotations/search*", (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(KRAS_FIXTURE),
      }),
    );

    await gotoSeedExperiment(page, "design");

    // TODO(picker-harness): open an FV term slot → typeahead, type
    // "kras". Placeholder interaction; refine against the running app.
    const input = page.locator('input[placeholder*="term" i]').first();
    await input.click();
    await input.fill("kras");

    const dropdown = page.getByRole("listitem");
    await expect(dropdown.filter({ hasText: "H.s." })).toBeVisible();
    await expect(dropdown.filter({ hasText: "M.m." })).toBeVisible();

    // Human row first (usage + species priority), mouse after it.
    const rows = await dropdown.allInnerTexts();
    const hsIdx = rows.findIndex((t) => t.includes("H.s."));
    const mmIdx = rows.findIndex((t) => t.includes("M.m."));
    expect(hsIdx).toBeGreaterThanOrEqual(0);
    expect(mmIdx).toBeGreaterThan(hsIdx);
  });
});
