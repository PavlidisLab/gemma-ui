/**
 * Render-test helpers — wrap a finding-card component inside the
 * minimal context stack the production hook chain expects, with all
 * server-data dependencies stubbed out.
 *
 * Use case: ``CompactFindingCard`` / ``FindingActionRow`` /
 * ``ComparisonFactorCard`` all read from ``AuditContext`` +
 * ``DesignDraftContext`` + ``ToastContext`` via hooks; a real
 * ``<AuditProvider>`` boots fetches, parses live audit JSON, and is
 * way more than a fixture-driven render test needs. This helper
 * builds throwaway context values from a few overrideable fields.
 *
 * Keep this file presentation-only — no fetches, no real timers,
 * no router. Tests own their own assertions; this just gets the
 * component mounted.
 */
import type { ReactElement } from "react";
import { render, type RenderOptions } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi } from "vitest";

import type {
  AuditFinding,
  AuditFindingDisposition,
  AuditReport,
} from "@/api/auditTypes";
import type { Design } from "@/features/experiment/types";

import { AuditContext, type AuditContextValue } from "./AuditContext";
import { DesignDraftContext } from "@/features/design/DesignDraftContext";
import type { DesignDraftValue } from "@/features/design/DesignDraftContext";
import { ToastContext, type ToastContextValue } from "@/components/ui/Toast";

/** Build a stub audit-context value populated enough for finding-
 *  card render paths. Anything else stays at a typed zero-value
 *  (empty Map, no-op async fn, etc.) so individual tests can
 *  override just the slice they care about. */
export function makeAuditCtx(
  partial: {
    findings?: AuditFinding[];
    dispositions?: AuditFindingDisposition[];
    report?: AuditReport | null;
    setDisposition?: AuditContextValue["setDisposition"];
  } = {},
): AuditContextValue {
  const findings = partial.findings ?? [];
  const dispositions = partial.dispositions ?? [];
  const findingsByTarget = new Map<string, AuditFinding[]>();
  for (const f of findings) {
    const list = findingsByTarget.get(f.target_id) ?? [];
    list.push(f);
    findingsByTarget.set(f.target_id, list);
  }
  const dispositionByTarget = new Map<string, AuditFindingDisposition>();
  for (const d of dispositions) {
    dispositionByTarget.set(d.target_id, d);
  }
  const report: AuditReport | null =
    partial.report !== undefined
      ? partial.report
      : ({
          audit_id: "test-audit-1",
          experiment_id: 1,
          experiment_short_name: "GSE0",
          model: "test-model",
          submitted_at: new Date(0).toISOString(),
          findings,
          evidence: { comparison_proposal: null },
        } as unknown as AuditReport);
  return {
    kind: "audit",
    experimentId: 1,
    auditList: report ? [report] : [],
    activeAuditIndex: 0,
    setActiveAuditIndex: vi.fn(),
    report,
    setOverrideReport: vi.fn(),
    hasOverride: false,
    loading: false,
    error: null,
    showAuditSidebar: vi.fn(),
    findingsByTarget,
    dispositionByTarget,
    gemmaMatchByFactorLabel: new Map(),
    activeFindingKey: null,
    setActiveFindingKey: vi.fn(),
    isFinalized: false,
    finalizedAt: null,
    finalizedBy: null,
    finalize: vi.fn().mockResolvedValue(null),
    reopen: vi.fn().mockResolvedValue(undefined),
    resetAllDispositions: vi.fn().mockResolvedValue(undefined),
    finalizeSaving: false,
    reopenSaving: false,
    resetAllDispositionsSaving: false,
    setDisposition: partial.setDisposition ?? vi.fn().mockResolvedValue(undefined),
    dispositionSaving: false,
    dispositionError: null,
  } as unknown as AuditContextValue;
}

/** Bare-bones design draft. Render tests that care about the
 *  goldEmpty downgrade pass a populated ``draft.tags`` /
 *  ``draft.factors``; everything else is no-op. */
export function makeDraftCtx(
  draft: Design | null = null,
  overrides: Partial<DesignDraftValue> = {},
): DesignDraftValue {
  const noop = vi.fn();
  return {
    draft,
    baseline: draft,
    apply: noop,
    discard: noop,
    save: vi.fn().mockResolvedValue(undefined),
    saving: false,
    saveError: null,
    diff: { isDirty: false, factors: [], tags: [] } as unknown,
    baselineKey: "test-baseline",
    baselineLabel: "test",
    ...overrides,
  } as unknown as DesignDraftValue;
}

/** Minimal toast stub — captures the call so a test can assert on it. */
export function makeToastCtx() {
  const show = vi.fn<ToastContextValue["show"]>();
  return { show };
}

interface RenderWithProvidersOptions extends RenderOptions {
  audit?: AuditContextValue;
  draft?: DesignDraftValue;
  toast?: ToastContextValue;
}

/** Mount a component inside the (audit, draft, toast) provider stack
 *  — what every finding-card render test needs. Returns the standard
 *  RTL helpers + the toast stub so tests can assert on toasts. */
export function renderWithProviders(
  ui: ReactElement,
  opts: RenderWithProvidersOptions = {},
) {
  const audit = opts.audit ?? makeAuditCtx();
  const draft = opts.draft ?? makeDraftCtx();
  const toast = opts.toast ?? makeToastCtx();
  const rest = { ...opts };
  delete (rest as Record<string, unknown>).audit;
  delete (rest as Record<string, unknown>).draft;
  delete (rest as Record<string, unknown>).toast;
  // A QueryClient, because leaf chrome inside these cards may fetch —
  // a gene chip resolves its species from the gene catalogue. Retries
  // off and no network in jsdom, so every such query resolves to the
  // component's null-tolerant fallback path.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const utils = render(
    <QueryClientProvider client={queryClient}>
    <ToastContext.Provider value={toast}>
      <AuditContext.Provider value={audit}>
        <DesignDraftContext.Provider value={draft}>
          {ui}
        </DesignDraftContext.Provider>
      </AuditContext.Provider>
    </ToastContext.Provider>
    </QueryClientProvider>,
    rest,
  );
  return { ...utils, audit, draft, toast };
}
