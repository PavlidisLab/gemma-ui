import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  useAuditsForExperiment,
  usePatchDisposition,
} from "@/api/audits";
import type {
  AuditFinding,
  AuditFindingDisposition,
  AuditReport,
  DispositionStatus,
  Severity,
} from "@/api/auditTypes";

/**
 * Per-experiment audit state.
 *
 * Surfaces the **most recent** audit report for the current
 * experiment (live from `useAuditsForExperiment`) plus a dev override
 * slot the sidebar's "Synthesize from draft" button writes into. The
 * dots and the sidebar both read whichever is set — override wins
 * when present, otherwise the live data does.
 *
 * `findingsByTarget` is the index inline dots query against — keyed
 * on `AuditFinding.target_id`. A target may have multiple findings
 * (e.g. a factor flagged for two issues); the dot picks the
 * highest-severity one for its color and surfaces all of them in
 * the tooltip / sidebar.
 *
 * `activeFindingKey` lets a dot click "scroll to + expand" the
 * matching card in the sidebar without prop-drilling refs.
 *
 * Dispositions:
 *  - **Live report** → `setDisposition()` fires PATCH and refetches.
 *    The disposition lives on the server.
 *  - **Override (synth) report** → `setDisposition()` mutates the
 *    in-memory override. Stays local; cleared when the override is
 *    cleared.
 *
 *  This branching is invisible to consumers — both the sidebar
 *  cards and the inline dots just call `setDisposition` and the
 *  state reconciles. The branch is detected by audit_id prefix
 *  (`synth-…` for the dev synth path).
 */
const SEVERITY_RANK: Record<Severity, number> = {
  blocker: 0,
  major: 1,
  minor: 2,
  ok: 3,
};

interface AuditContextValue {
  /** The audit being shown — override (dev synth) if set, else most
   *  recent live audit, else null. */
  report: AuditReport | null;
  /** Override the live data with an in-memory report (e.g. dev
   *  synth). Pass null to clear the override and fall back to
   *  whatever live data is loaded. */
  setOverrideReport: (next: AuditReport | null) => void;
  /** True when a dev override is active (so the sidebar can flag
   *  it and show a "clear override" affordance). */
  hasOverride: boolean;
  /** True when `useAuditsForExperiment` is mid-flight on the initial
   *  load. Sidebar surfaces this as "loading audit…" before deciding
   *  whether to render empty-state or a real report. */
  loading: boolean;
  /** Live load error from `useAuditsForExperiment`, if any. */
  error: string | null;

  /** Sidebar-view setter, lifted out of MainGrid so a dot click can
   *  flip the sidebar from Proposals → Audit. */
  showAuditSidebar: () => void;

  /** target_id → all findings on that target. Sorted highest-severity
   *  first within each list. Empty map when no report. */
  findingsByTarget: Map<string, AuditFinding[]>;
  /** target_id → latest curator disposition. Empty map when no
   *  report or no dispositions yet. */
  dispositionByTarget: Map<string, AuditFindingDisposition>;

  /** Last clicked finding key, used by the sidebar to auto-expand /
   *  scrollIntoView. Null if no recent click; cleared after use. */
  activeFindingKey: string | null;
  setActiveFindingKey: (key: string | null) => void;

  /** Disposition writer. Branches on whether the current report is
   *  a live (server-backed) audit or an in-memory override. Returns
   *  a promise so the caller can show a "saving…" state if it wants;
   *  resolves once the local state has updated. */
  setDisposition: (
    targetId: string,
    status: DispositionStatus,
    notes?: string,
  ) => Promise<void>;
  /** True while a PATCH is in flight (live path only — the override
   *  path is synchronous). Lets the sidebar disable buttons. */
  dispositionSaving: boolean;
  /** PATCH error, if any. Cleared on the next successful patch. */
  dispositionError: string | null;
}

const AuditContext = createContext<AuditContextValue | null>(null);

/** Synth reports use this prefix on `audit_id`. The presence of the
 *  prefix routes dispositions through the in-memory path instead of
 *  PATCH — there's nothing to PATCH against on the server. */
export const SYNTH_AUDIT_ID_PREFIX = "synth-";

function isOverrideReport(r: AuditReport | null): boolean {
  return !!r?.audit_id && r.audit_id.startsWith(SYNTH_AUDIT_ID_PREFIX);
}

export function AuditProvider({
  experimentId,
  reviewer = "",
  showAuditSidebar,
  children,
}: {
  experimentId: number;
  /** Stamped onto PATCH requests as the disposition's `reviewer`.
   *  Pulled from the session in App.tsx. Empty string is acceptable
   *  for dev (server still records the disposition). */
  reviewer?: string;
  /** Wired to MainGrid's sidebar-view setter. Called when an inline
   *  dot is clicked so the curator gets context immediately. */
  showAuditSidebar: () => void;
  children: ReactNode;
}) {
  const {
    data: liveReports,
    isLoading: liveLoading,
    error: liveError,
  } = useAuditsForExperiment(experimentId);
  const patchDisposition = usePatchDisposition(experimentId);

  const [override, setOverride] = useState<AuditReport | null>(null);
  const [activeFindingKey, setActiveFindingKey] = useState<string | null>(null);

  // Reset override on experiment change so a synth loaded for GSE A
  // doesn't leak into GSE B.
  useEffect(() => {
    setOverride(null);
    setActiveFindingKey(null);
  }, [experimentId]);

  const liveReport = liveReports?.items?.[0] ?? null;
  const report = override ?? liveReport;

  const findingsByTarget = useMemo(() => {
    const m = new Map<string, AuditFinding[]>();
    if (!report) return m;
    for (const f of report.findings) {
      const list = m.get(f.target_id) ?? [];
      list.push(f);
      m.set(f.target_id, list);
    }
    for (const list of m.values()) {
      list.sort(
        (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
      );
    }
    return m;
  }, [report]);

  const dispositionByTarget = useMemo(() => {
    const m = new Map<string, AuditFindingDisposition>();
    if (!report) return m;
    for (const d of report.dispositions ?? []) {
      m.set(d.target_id, d);
    }
    return m;
  }, [report]);

  const setDisposition = useCallback(
    async (
      targetId: string,
      status: DispositionStatus,
      notes: string = "",
    ) => {
      if (!report) return;
      if (isOverrideReport(report)) {
        // In-memory path. Synthesize a disposition entry and merge
        // into the override report. ``reviewed_at`` mirrors what the
        // server would stamp.
        const next: AuditFindingDisposition = {
          target_id: targetId,
          status,
          reviewer,
          reviewed_at: new Date().toISOString(),
          notes,
        };
        setOverride((cur) => {
          if (!cur) return cur;
          const filtered = (cur.dispositions ?? []).filter(
            (d) => d.target_id !== targetId,
          );
          return { ...cur, dispositions: [...filtered, next] };
        });
        return;
      }
      // Live path. PATCH the server; on success the query
      // invalidates and the report re-renders with the refreshed
      // disposition list. The mutation throws on failure so a
      // ``saving…`` UI surface naturally surfaces an error.
      if (!report.audit_id) return;
      await patchDisposition.mutateAsync({
        auditId: report.audit_id,
        patch: { target_id: targetId, status, reviewer, notes },
      });
    },
    [report, reviewer, patchDisposition],
  );

  const value: AuditContextValue = {
    report,
    setOverrideReport: setOverride,
    hasOverride: override !== null,
    loading: liveLoading,
    error: liveError ? (liveError as Error).message : null,
    showAuditSidebar,
    findingsByTarget,
    dispositionByTarget,
    activeFindingKey,
    setActiveFindingKey,
    setDisposition,
    dispositionSaving: patchDisposition.isPending,
    dispositionError: patchDisposition.error
      ? (patchDisposition.error as Error).message
      : null,
  };

  return (
    <AuditContext.Provider value={value}>{children}</AuditContext.Provider>
  );
}

/** Strict consumer — throws when used outside an `AuditProvider`. */
export function useAudit(): AuditContextValue {
  const v = useContext(AuditContext);
  if (!v) {
    throw new Error("useAudit must be used inside <AuditProvider>");
  }
  return v;
}

/** Lenient consumer — returns null when no provider is mounted.
 *  Use for components that may render outside the experiment shell
 *  (e.g. the standalone AuditPreviewPage). */
export function useAuditOptional(): AuditContextValue | null {
  return useContext(AuditContext);
}

/** Stable key for a finding inside the sidebar's card list and the
 *  context's `activeFindingKey`. Mirrors the key used in
 *  AuditSidebarPanel's `CompactFindingCard` keys + AuditReportView's
 *  cards. Keep them in sync — divergence breaks scroll-to-finding. */
export function findingKey(f: AuditFinding): string {
  return `${f.target_kind}:${f.target_id}:${f.issue_code}`;
}

/** Helper: scroll-to-and-focus a target's primary finding in the
 *  sidebar. Used by inline dot click handlers. Encapsulates the
 *  showSidebar + setActiveFindingKey pair so callers don't need to
 *  remember both.
 *
 *  Returns a no-op when no provider is mounted — lets dot
 *  components call this unconditionally. */
export function useFocusFinding(): (targetId: string) => void {
  const ctx = useAuditOptional();
  return useCallback(
    (targetId: string) => {
      if (!ctx) return;
      const list = ctx.findingsByTarget.get(targetId);
      if (!list || list.length === 0) return;
      ctx.showAuditSidebar();
      ctx.setActiveFindingKey(findingKey(list[0]));
    },
    [ctx],
  );
}
