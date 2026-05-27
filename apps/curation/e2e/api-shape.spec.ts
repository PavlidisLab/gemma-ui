import { test, expect } from "@playwright/test";

/**
 * API-shape smoke tests — the dashboard's mount-time queries hit a
 * handful of endpoints. We hit them directly via Playwright's
 * ``request`` fixture (no UI) and verify they return well-formed
 * data so any UI-side render failure can be triangulated against a
 * known-good backend.
 *
 * Run via the Vite proxy at ``/local-api/*`` so we exercise the
 * same path the React app takes.
 */
test.describe("Backend smoke (via Vite proxy)", () => {
  test("/local-api/health returns 200", async ({ request }) => {
    const r = await request.get("/local-api/health");
    expect(r.status()).toBe(200);
    const j = await r.json();
    expect(j).toHaveProperty("kind");
  });

  test("/local-api/rest/v2/me returns 200 (null body is OK)", async ({ request }) => {
    const r = await request.get("/local-api/rest/v2/me");
    expect(r.status()).toBe(200);
  });

  test("/local-api/rest/v2/groups returns an array", async ({ request }) => {
    const r = await request.get("/local-api/rest/v2/groups");
    expect(r.status()).toBe(200);
    const j = await r.json();
    expect(Array.isArray(j)).toBe(true);
  });

  test("/local-api/rest/v2/tickets returns an array", async ({ request }) => {
    const r = await request.get("/local-api/rest/v2/tickets");
    expect(r.status()).toBe(200);
    const j = await r.json();
    expect(Array.isArray(j)).toBe(true);
  });

  test("/local-api/rest/v2/datasets returns an envelope", async ({ request }) => {
    const r = await request.get("/local-api/rest/v2/datasets?limit=3");
    expect(r.status()).toBe(200);
    const j = await r.json();
    expect(j).toHaveProperty("data");
    expect(j).toHaveProperty("totalElements");
  });

  test("seed experiment is fetchable", async ({ request }) => {
    const r = await request.get("/local-api/rest/v2/datasets/89342");
    expect(r.status()).toBe(200);
  });

  test("/local-api/rest/v2/datasets contains GSE277245.1", async ({ request }) => {
    const r = await request.get("/local-api/rest/v2/datasets?limit=100");
    const j = await r.json();
    const accs: string[] = j.data.map((d: { shortName: string }) => d.shortName);
    expect(accs).toContain("GSE277245.1");
  });

  test("'work_tickets' routes from the rollback are gone", async ({ request }) => {
    // GET /local/tickets used to be the parallel apparatus's list
    // endpoint. After the rollback it's 404 (Vite proxy strips
    // /local-api, upstream serves nothing on /local/tickets).
    const r = await request.get("/local-api/local/tickets");
    expect([404, 405]).toContain(r.status());
  });

  test("/local-api/openapi.json lists no /local/tickets routes", async ({ request }) => {
    const r = await request.get("/local-api/openapi.json");
    expect(r.status()).toBe(200);
    const j = await r.json();
    const paths = Object.keys(j.paths ?? {});
    expect(paths.filter((p) => p.startsWith("/local/tickets"))).toEqual([]);
  });

  test("/local-api/openapi.json keeps legacy /rest/v2/tickets routes", async ({ request }) => {
    const r = await request.get("/local-api/openapi.json");
    const j = await r.json();
    const paths = Object.keys(j.paths ?? {});
    expect(paths.some((p) => p.startsWith("/rest/v2/tickets"))).toBe(true);
  });
});
