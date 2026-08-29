/**
 * UI-level round-trip for the Set Export bundle.
 *
 * Complements ``apps/curation/src/features/workflow/exportSet.test.ts``
 * (vitest unit tests for the pure ``buildSetExport`` function) by
 * exercising the full user flow:
 *
 *     Export-Set button click
 *       → exportSetAsGzip()
 *       → gzipJson() + triggerDownload()
 *       → browser download fires
 *       → bundle is a valid gzipped JSON with the polished design
 *
 * The vitest tests prove the function returns the polished design when
 * present; this spec proves the actual user click path produces the
 * same bundle as a real file the curator could ship.
 *
 * Mock strategy: hermetic via ``page.route()`` — the spec does NOT
 * depend on what's in the seed sqlite. The polished endpoint returns a
 * known POLISHED_DESIGN with factor ``age``; if anything in the
 * pipeline regresses to the snapshot path the bundle would contain
 * factor ``developmental stage`` (the snapshot fixture) and the
 * assertion fails.
 *
 * 2026-05-29 GSE269647 incident: see the commit ``0975321`` notes.
 */
import { test, expect, Route } from "@playwright/test";
import { installErrorGuards } from "./_helpers";
import * as zlib from "node:zlib";
import * as fs from "node:fs/promises";

const GROUP_ID = "00000000-0000-0000-0000-000000000050";
const EXPERIMENT_ID = 91672;
const CURATOR = "local-curator";

const GROUP = {
  id: GROUP_ID,
  name: "export-set roundtrip e2e",
  type: "review",
  taskKind: "review_audit",
  description: "Hermetic e2e fixture group — one member experiment.",
  createdBy: CURATOR,
  createdAt: "2026-05-29T00:00:00Z",
  finalizedAt: null,
  finalizedBy: null,
  finalizedNotes: null,
  memberIds: [String(EXPERIMENT_ID)],
  memberCount: 1,
  memberSummaries: null,
  memberStatusCounts: { done: 0, in_progress: 0, untouched: 1 },
};

const DATASET_META = {
  id: EXPERIMENT_ID,
  short_name: "GSE269647",
  external_database: "GEO",
  accession: "GSE269647",
  external_uri: null,
  title: "polished view",
  description: "",
  taxon: "mouse",
  technology_type: "SEQUENCING",
};

/** What the curator polished to. The bundle MUST reflect this. */
const POLISHED_DESIGN = {
  experiment_id: EXPERIMENT_ID,
  short_name: "GSE269647",
  external_source: { database: "GEO", accession: "GSE269647", uri: null },
  title: "polished view",
  description: "",
  taxon: "mouse",
  assay: "bulk RNA-seq",
  technology_type: "SEQUENCING",
  platform: { short_name: "Generic_mouse_ncbilds" },
  publications: [],
  factors: [
    {
      id: 999,
      name: "age",
      category: { label: "age", uri: null },
      type: "categorical",
      factor_values: [
        {
          id: 9991,
          free_text_label: "young",
          is_baseline: true,
          statements: [
            {
              subject: { label: "young adult stage", uri: null },
              predicate: null,
              object: null,
            },
          ],
          biomaterial_short_names: [],
        },
      ],
    },
  ],
  biomaterials: [],
  tags: [],
};

/** Distinct shape — used to confirm the bundle did NOT pull from
 *  the snapshot path. If this label leaks into the bundle the
 *  regression is back. */
const STALE_SNAPSHOT_DESIGN = {
  ...POLISHED_DESIGN,
  factors: [
    {
      id: 888,
      name: "developmental stage",
      category: { label: "developmental stage", uri: null },
      type: "categorical",
      factor_values: [
        {
          id: 8881,
          free_text_label: "young",
          is_baseline: true,
          statements: [],
          biomaterial_short_names: [],
        },
      ],
    },
  ],
};

function fulfillJson(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function installApiMocks(page: import("@playwright/test").Page) {
  // Playwright route precedence: the MOST RECENTLY registered route
  // runs first. Register catch-alls FIRST so the specific routes below
  // override them.

  // Catch-all — anything not matched below returns an empty list. Stops
  // unmocked widgets from crashing the page.
  // Two prefixes now: `/rest/v2` is Gemma's, `/curation/v1` is the
  // store's (moved 2026-08-29). Both need catching or an unmocked
  // widget reaches the network.
  await page.route(`**/rest/v2/**`, (route) => fulfillJson(route, []));
  await page.route(`**/curation/v1/**`, (route) => fulfillJson(route, []));

  // The paginated datasets endpoint expects ``{data: [...], total_elements,
  // offset, limit}`` — return the empty version explicitly so the
  // catch-all doesn't return a bare array that breaks the adapter.
  await page.route(`**/rest/v2/datasets?**`, (route) =>
    fulfillJson(route, { data: [], total_elements: 0, offset: 0, limit: 50 }),
  );
  await page.route(`**/rest/v2/datasets/pipeline-status`, (route) =>
    fulfillJson(route, {}),
  );
  await page.route(`**/curation/v1/tickets*`, (route) => fulfillJson(route, []));

  // Dataset meta — fetchDesignSnapshot composes it in if the snapshot
  // path runs; harmless to mock unconditionally.
  await page.route(
    new RegExp(`/rest/v2/datasets/${EXPERIMENT_ID}(\\?|$)`),
    (route) => fulfillJson(route, DATASET_META),
  );

  // Audits + proposals — buildSetExport pulls these for the review
  // status. Empty is fine; the export still produces a valid bundle.
  await page.route(`**/curation/v1/datasets/${EXPERIMENT_ID}/audits*`, (route) =>
    fulfillJson(route, { items: [], total: 0 }),
  );
  await page.route(`**/curation/v1/datasets/${EXPERIMENT_ID}/proposals*`, (route) =>
    fulfillJson(route, { items: [], total: 0 }),
  );

  // Snapshot fallback path — returns the WRONG factor on purpose. If
  // anything bypasses the polished route, the bundle will contain
  // ``developmental stage`` and the assertion fails (regression pin).
  await page.route(`**/rest/v2/datasets/${EXPERIMENT_ID}/design`, (route) =>
    fulfillJson(route, STALE_SNAPSHOT_DESIGN),
  );

  // Polished design — the canonical source for Export Set.
  await page.route(
    `**/curation/v1/datasets/${EXPERIMENT_ID}/polished/${CURATOR}`,
    (route) => fulfillJson(route, POLISHED_DESIGN),
  );

  // Group list (sidebar) — register before the specific group lookup so
  // it doesn't accidentally swallow ``/groups/<id>`` requests.
  await page.route(`**/curation/v1/groups`, (route) => fulfillJson(route, [GROUP]));
  await page.route(`**/curation/v1/groups\\?**`, (route) =>
    fulfillJson(route, [GROUP]),
  );

  // Group lookup (the load-bearing one) — registered LAST so it wins
  // for ``/groups/<id>`` and ``/groups/<id>?include_summaries=true``.
  await page.route(`**/curation/v1/groups/${GROUP_ID}**`, (route) =>
    fulfillJson(route, GROUP),
  );
}

test.describe("Export Set bundle round-trip (UI)", () => {
  test.beforeEach(async ({ page }) => {
    installErrorGuards(page);
    await installApiMocks(page);
  });

  test("Export Set still downloads a bundle when polished returns 404", async ({
    page,
  }) => {
    // When polished is missing, exportSet falls back to
    // ``fetchDesignSnapshot``. The fallback's design shape depends on
    // the G2Design wire schema, which isn't worth mocking here — the
    // vitest unit tests already pin the fallback contract. What the
    // e2e proves is that the UI doesn't crash and the bundle is still
    // produced + downloadable when polished 404s.
    await page.route(
      `**/curation/v1/datasets/${EXPERIMENT_ID}/polished/${CURATOR}`,
      (route) =>
        route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ detail: "no polished design" }),
        }),
    );

    await page.goto(`/#/workflow/${GROUP_ID}`);
    const exportBtn = page.getByRole("button", { name: /^Export Set$/ });
    await expect(exportBtn).toBeVisible({ timeout: 10_000 });

    const downloadPromise = page.waitForEvent("download", { timeout: 10_000 });
    await exportBtn.click();
    const download = await downloadPromise;

    const downloadPath = await download.path();
    const gz = await fs.readFile(downloadPath!);
    const text = zlib.gunzipSync(gz).toString("utf-8");
    const bundle = JSON.parse(text);

    expect(bundle.bundle_kind).toBe("gemma_curation_set_export");
    expect(bundle.curator).toBe(CURATOR);
    expect(bundle.experiments).toHaveLength(1);
  });

  test("Export Set click downloads a gzipped JSON bundle reflecting the polished Design", async ({
    page,
  }) => {
    await page.goto(`/#/workflow/${GROUP_ID}`);

    // The Export Set button only mounts once the group + member list
    // have resolved. Wait for it explicitly.
    const exportBtn = page.getByRole("button", { name: /^Export Set$/ });
    await expect(exportBtn).toBeVisible({ timeout: 10_000 });
    await expect(exportBtn).toBeEnabled();

    // Set up the download listener BEFORE clicking — the download
    // event fires synchronously from triggerDownload().
    const downloadPromise = page.waitForEvent("download", { timeout: 10_000 });
    await exportBtn.click();
    const download = await downloadPromise;

    // Filename shape: gemma-set-<slug>-<stamp>.json.gz
    const filename = download.suggestedFilename();
    expect(filename).toMatch(/^gemma-set-export-set-roundtrip-e2e-.*\.json\.gz$/);

    // Decompress + parse.
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    const gz = await fs.readFile(downloadPath!);
    const text = zlib.gunzipSync(gz).toString("utf-8");
    const bundle = JSON.parse(text);

    // Top-level shape.
    expect(bundle.bundle_kind).toBe("gemma_curation_set_export");
    expect(typeof bundle.exported_at).toBe("string");
    expect(bundle.curator).toBe(CURATOR);
    expect(Array.isArray(bundle.experiments)).toBe(true);
    expect(bundle.experiments).toHaveLength(1);

    // Polished-wins assertion: the bundle's only experiment carries
    // the ``age`` factor from POLISHED_DESIGN, not ``developmental
    // stage`` from STALE_SNAPSHOT_DESIGN. If this fails the snapshot
    // path has crept back in.
    const exp = bundle.experiments[0];
    expect(exp.experiment_id).toBe(EXPERIMENT_ID);
    const factorLabels = (exp.design?.factors ?? []).map(
      (f: { category?: { label?: string } }) => f.category?.label,
    );
    expect(factorLabels).toContain("age");
    expect(factorLabels).not.toContain("developmental stage");

    // FV statements survive the gzip round-trip — load-bearing for
    // any downstream tool that matches FVs on statement URIs.
    const firstFV = exp.design?.factors?.[0]?.factor_values?.[0];
    expect(firstFV?.free_text_label).toBe("young");
    expect(firstFV?.statements).toHaveLength(1);
    expect(firstFV?.statements?.[0]?.subject?.label).toBe("young adult stage");
  });
});
