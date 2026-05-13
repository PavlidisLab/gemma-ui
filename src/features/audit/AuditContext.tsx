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
  useFinalizeAudit,
  usePatchDisposition,
  useReopenAudit,
} from "@/api/audits";
import type {
  AuditFinding,
  AuditFindingDisposition,
  AuditReport,
  DismissReason,
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
  /** The experiment this audit belongs to. Surfaced so consumers
   *  (e.g. finding cards needing to address the samples table)
   *  don't have to thread it through props from the Shell. */
  experimentId: number;
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
  /** factor category label (lowercase) → server-computed alignment
   *  from the audit's comparison_proposal. Used by inline design-
   *  editor indicators (GemmaMatchDot) without re-deriving per
   *  consumer. Empty map when no report or no comparison_proposal. */
  gemmaMatchByFactorLabel: Map<string, "exact" | "close" | "new">;

  /** Last clicked finding key, used by the sidebar to auto-expand /
   *  scrollIntoView. Null if no recent click; cleared after use. */
  activeFindingKey: string | null;
  setActiveFindingKey: (key: string | null) => void;

  /** True when the current report has been finalized by some
   *  curator. Read-side: disable disposition controls; show
   *  "closed by X" + a Reopen affordance instead of the close
   *  button. PATCHes against a finalized audit return 409 — the UI
   *  uses this flag to avoid even attempting them. */
  isFinalized: boolean;
  /** ISO 8601 of the finalize event, when finalized. */
  finalizedAt: string | null;
  /** Reviewer who finalized, when finalized. */
  finalizedBy: string | null;
  /** Finalize the current audit. Optional notes carried through to
   *  the server's audit_events row. No-op + reject if no audit
   *  loaded or already finalized (caller should hide the button in
   *  those states). */
  finalize: (notes?: string) => Promise<void>;
  /** Reopen a finalized audit so the curator can keep dispositioning.
   *  No-op + reject if no audit loaded or not finalized. */
  reopen: () => Promise<void>;
  /** True while a finalize POST is in flight. */
  finalizeSaving: boolean;
  /** True while a reopen POST is in flight. */
  reopenSaving: boolean;

  /** Disposition writer. Branches on whether the current report is
   *  a live (server-backed) audit or an in-memory override. Returns
   *  a promise so the caller can show a "saving…" state if it wants;
   *  resolves once the local state has updated.
   *
   *  Extras mirror the optional fields on `AuditFindingDispositionPatch`
   *  (see AUDIT_DISPOSITIONS.md) — pass them when applicable, omit
   *  otherwise. Server validates `dismiss_reason` is present when
   *  status=dismissed; the dismiss-chip dialog enforces this on the
   *  client. */
  setDisposition: (
    targetId: string,
    status: DispositionStatus,
    extras?: {
      notes?: string;
      dismissReason?: DismissReason;
      /** Required by the server when ``status === "accepted"`` and
       *  the finding's ``issue_code`` is in the agent-extra family
       *  (added 2026-05-10 per
       *  AUDIT_DISPOSITION_REASONS_HANDOFF.md). Caller gates the
       *  flow through the accept-reason dialog. */
      acceptReason?: import("@/api/auditTypes").AcceptReason;
      /** Required by the server when ``status === "needs_more_info"``.
       *  The Park button gates the status change on the not-sure
       *  dialog so it never sends without a reason. */
      notSureReason?: import("@/api/auditTypes").NotSureReason;
      appliedFix?: string;
      firstSeenAt?: string;
      /** Stamp the finding as accepted+resolved (two-step accept,
       *  Ask #6). Only valid with status=accepted; the server
       *  validates and returns 422 otherwise. The UI gates this:
       *  Accept = parked, Mark resolved = resolved. */
      resolvedAt?: string;
      /** Parent finding's `target_id` when this disposition is being
       *  cascaded from a factor to its subsumed FV children. Omit for
       *  direct curator dispositions. */
      inheritedFrom?: string;
    },
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
  const finalizeAudit = useFinalizeAudit(experimentId);
  const reopenAudit = useReopenAudit(experimentId);

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

  const gemmaMatchByFactorLabel = useMemo(() => {
    const m = new Map<string, "exact" | "close" | "new">();
    const cp = report?.evidence?.comparison_proposal;
    if (!cp) return m;
    for (const f of cp.factors ?? []) {
      if (f.match_type) {
        m.set(
          f.category.label.toLowerCase(),
          f.match_type as "exact" | "close" | "new",
        );
      }
    }
    return m;
  }, [report]);

  const setDisposition = useCallback(
    async (
      targetId: string,
      status: DispositionStatus,
      extras: {
        notes?: string;
        dismissReason?: DismissReason;
        acceptReason?: import("@/api/auditTypes").AcceptReason;
        notSureReason?: import("@/api/auditTypes").NotSureReason;
        appliedFix?: string;
        firstSeenAt?: string;
        resolvedAt?: string;
        inheritedFrom?: string;
      } = {},
    ) => {
      if (!report) return;
      const notes = extras.notes ?? "";
      if (isOverrideReport(report)) {
        // In-memory path. Synthesize a disposition entry and merge
        // into the override report. ``reviewed_at`` mirrors what the
        // server would stamp. The override path doesn't model the
        // analytics-only fields (dismiss_reason, applied_fix,
        // first_seen_at) — they exist on the wire so my brother can
        // aggregate, and the in-memory dev path doesn't simulate that.
        const next: AuditFindingDisposition = {
          target_id: targetId,
          status,
          reviewer,
          reviewed_at: new Date().toISOString(),
          notes,
          // Mirror resolved_at on the synth path so the parked vs
          // resolved UX still works in dev mode without a server.
          // Other analytics-only fields (dismiss_reason, applied_fix,
          // first_seen_at) stay omitted — the override path doesn't
          // simulate aggregation.
          resolved_at: extras.resolvedAt ?? null,
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
      const patch: import("@/api/auditTypes").AuditFindingDispositionPatch = {
        target_id: targetId,
        status,
        reviewer,
        notes,
      };
      if (extras.dismissReason) patch.dismiss_reason = extras.dismissReason;
      if (extras.acceptReason) patch.accept_reason = extras.acceptReason;
      if (extras.notSureReason) patch.not_sure_reason = extras.notSureReason;
      if (extras.appliedFix) patch.applied_fix = extras.appliedFix;
      if (extras.firstSeenAt) patch.first_seen_at = extras.firstSeenAt;
      if (extras.resolvedAt) patch.resolved_at = extras.resolvedAt;
      if (extras.inheritedFrom) patch.inherited_from = extras.inheritedFrom;
      await patchDisposition.mutateAsync({
        auditId: report.audit_id,
        patch,
      });
    },
    [report, reviewer, patchDisposition],
  );

  // Lifecycle (finalize / reopen). Both no-op on the override
  // (synth) path — there's nothing to PATCH against; we just
  // pretend there's no audit to close. Callers are gated by
  // `isFinalized` already, so this only catches stray double-clicks.
  const finalize = useCallback(
    async (notes?: string) => {
      if (!report || !report.audit_id) return;
      if (isOverrideReport(report)) return;
      if (report.finalized_at) return;
      await finalizeAudit.mutateAsync({
        auditId: report.audit_id,
        reviewer,
        notes,
      });
    },
    [report, reviewer, finalizeAudit],
  );
  const reopen = useCallback(async () => {
    if (!report || !report.audit_id) return;
    if (isOverrideReport(report)) return;
    if (!report.finalized_at) return;
    await reopenAudit.mutateAsync({
      auditId: report.audit_id,
      reviewer,
    });
  }, [report, reviewer, reopenAudit]);

  const value: AuditContextValue = {
    experimentId,
    report,
    setOverrideReport: setOverride,
    hasOverride: override !== null,
    loading: liveLoading,
    error: liveError ? (liveError as Error).message : null,
    showAuditSidebar,
    findingsByTarget,
    dispositionByTarget,
    gemmaMatchByFactorLabel,
    activeFindingKey,
    setActiveFindingKey,
    isFinalized: !!report?.finalized_at,
    finalizedAt: report?.finalized_at ?? null,
    finalizedBy: report?.finalized_by ?? null,
    finalize,
    reopen,
    finalizeSaving: finalizeAudit.isPending,
    reopenSaving: reopenAudit.isPending,
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
