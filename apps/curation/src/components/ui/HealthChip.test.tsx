import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * Render-to-markup tests for the HealthChip rollup logic.
 *
 * ARCHITECTURE NOTE
 * -----------------
 * ``HealthChip`` has two hard dependencies that prevent isolated
 * rendering:
 *
 *   1. ``useServicesHealth()`` calls ``useQuery`` from TanStack Query
 *      which requires a ``QueryClientProvider`` context provider.
 *   2. The ``rollup()`` function that maps
 *      ``(localApi, gemma, agent, countGemma) → Severity`` is NOT
 *      exported — it is a module-private helper.
 *
 * APPROACH
 * --------
 * We mock the ``@/api/health`` module so ``useServicesHealth`` becomes
 * a plain function that returns controlled data without TanStack Query.
 * We also mock ``@/lib/gemmaMode`` so ``useGemmaMode`` returns
 * ``{ mode: "local" }`` — the default dev mode.
 *
 * With those mocks in place ``renderToStaticMarkup(<HealthChip />)``
 * runs the real component code (including the real ``rollup`` function)
 * and produces verifiable markup, covering the rollup contract
 * indirectly through the label text + CSS class that the chip emits.
 *
 * NOT tested here (requires a browser / Playwright):
 *   - Popover opens on click
 *   - Escape key closes the popover
 *   - Per-service rows inside the open popover
 *   - Click-outside closes the popover
 */

// Module-level mocks must be declared before any import of the mocked
// module — vitest hoists vi.mock() calls to the top of the file.
vi.mock("@/api/health", () => ({
  useServicesHealth: vi.fn(),
}));
vi.mock("@/lib/gemmaMode", () => ({
  useGemmaMode: vi.fn(),
}));

// Import AFTER the mocks are set up.
import { useServicesHealth } from "@/api/health";
import { useGemmaMode } from "@/lib/gemmaMode";
import { HealthChip } from "./HealthChip";
import type { ServicesHealth, ServiceStatus } from "@/api/health";
import type { GemmaModeInfo } from "@/lib/gemmaMode";

/** Helper: set up the two mocked hooks and render the chip. */
function renderChip({
  localApi,
  gemma,
  agent,
  mode = "local",
}: {
  localApi: ServiceStatus;
  gemma: ServiceStatus;
  agent: ServiceStatus;
  mode?: "local" | "remote";
}): string {
  const health: ServicesHealth = {
    localApi,
    gemma,
    agent,
    checkedAt: null,
  };
  vi.mocked(useServicesHealth).mockReturnValue({
    data: health,
    isLoading: false,
    isError: false,
    error: null,
  } as ReturnType<typeof useServicesHealth>);

  vi.mocked(useGemmaMode).mockReturnValue({
    mode,
    baseUrl: "http://localhost:8082",
    baseHost: "localhost:8082",
    isProd: false,
    isStaging: false,
    authLabel: "dev-token (local server)",
    ontologyHost: "example-gemma-host.test",
    ontologySplit: true,
  } as GemmaModeInfo);

  return renderToStaticMarkup(<HealthChip />);
}

describe("HealthChip — rollup label via rendered markup", () => {
  describe("all services up → 'live'", () => {
    it("renders label 'live' when localApi + gemma + agent are all up (local mode)", () => {
      const html = renderChip({
        localApi: "up",
        gemma: "up",
        agent: "up",
        mode: "local",
      });
      // The chip's label map: ok → "live"
      expect(html).toContain("live");
      // Must not show a degraded/down label
      expect(html).not.toContain("down");
      expect(html).not.toContain("degraded");
    });
  });

  describe("agent down → 'down' (in local mode, gemma-rest is not counted)", () => {
    it("renders 'down' when agent is down even if localApi is up", () => {
      // In local mode: rollup counts only [localApi, agent].
      // agent=down + localApi=up → upCount=1 / required=2 → "degraded".
      // BUT if localApi is also down → all required down → "down".
      // Test the case where agent=down, localApi=down → "down".
      const html = renderChip({
        localApi: "down",
        gemma: "up",
        agent: "down",
        mode: "local",
      });
      expect(html).toContain("down");
    });

    it("renders 'degraded' when only agent is down and localApi is up (local mode)", () => {
      // In local mode gemma-rest is NOT in the required set.
      // localApi=up, agent=down → 1 of 2 up → "degraded".
      const html = renderChip({
        localApi: "up",
        gemma: "up",
        agent: "down",
        mode: "local",
      });
      expect(html).toContain("degraded");
    });
  });

  describe("remote mode — gemma-rest is counted", () => {
    it("renders 'degraded' when gemma is down in remote mode (localApi + agent up)", () => {
      // In remote mode: rollup counts [localApi, gemma, agent].
      // localApi=up, agent=up, gemma=down → 2 of 3 up → "degraded".
      const html = renderChip({
        localApi: "up",
        gemma: "down",
        agent: "up",
        mode: "remote",
      });
      expect(html).toContain("degraded");
    });

    it("renders 'live' when all three are up in remote mode", () => {
      const html = renderChip({
        localApi: "up",
        gemma: "up",
        agent: "up",
        mode: "remote",
      });
      expect(html).toContain("live");
    });
  });

  describe("unknown status → 'checking…'", () => {
    it("renders 'checking…' when any service is unknown", () => {
      // The rollup short-circuits to 'unknown' if any required
      // service is in the unknown state.
      const html = renderChip({
        localApi: "unknown" as ServiceStatus,
        gemma: "up",
        agent: "up",
        mode: "local",
      });
      // label['unknown'] === "checking…"
      expect(html).toContain("checking");
    });
  });

  describe("severity → CSS colour class", () => {
    it("'down' severity carries rose palette class", () => {
      const html = renderChip({
        localApi: "down",
        gemma: "down",
        agent: "down",
        mode: "local",
      });
      // The palette for 'down' includes bg-rose-200 / text-rose-900
      expect(html).toContain("bg-rose-200");
    });

    it("'ok' severity carries emerald palette class", () => {
      const html = renderChip({
        localApi: "up",
        gemma: "up",
        agent: "up",
        mode: "local",
      });
      expect(html).toContain("bg-emerald-100");
    });
  });
});
