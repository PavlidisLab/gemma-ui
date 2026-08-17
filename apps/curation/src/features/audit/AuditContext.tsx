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
  useResetAuditDispositions,
  usePatchDisposition,
  useReopenAudit,
} from "@/api/audits";
import { useProposalReviewsForExperiment } from "@/api/reviewProposals";
import type {
  AuditFinding,
  AuditFindingDisposition,
  AuditReport,
  CurationReviewKind,
  DismissReason,
  DispositionStatus,
} from "@/api/auditTypes";
import { DesignDraftContext } from "@/features/design/DesignDraftContext";
import { stampForFinding } from "@/features/provenance/stamp";
import { SEVERITY_RANK } from "./auditPresentation";

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

interface AuditContextValue {
  /** Discriminator for the review-kind this provider is wrapping —
   *  ``"audit"`` (review of existing curation, agent-vs-curator
   *  framing) or ``"proposal"`` (agent proposes curation from
   *  scratch, no curator side). Sub-components branch on this for
   *  framing copy + to hide the side-by-side comparison surface.
   *  Defaults to ``"audit"`` for back-compat with existing call
   *  sites. */
  kind: CurationReviewKind;
  /** The experiment this audit belongs to. Surfaced so consumers
   *  (e.g. finding cards needing to address the samples table)
   *  don't have to thread it through props from the Shell. */
  experimentId: number | string;
  /** All audits on this experiment (ordered most-recent-first per the
   *  server contract). Used by the dual-agent review header to render
   *  a prev/next switcher when the curator has run multiple audits
   *  on the same GSE (e.g. hybrid vs oneshot calibration packages).
   *  Length-0 when no audits
   *  yet; length-1 is the common single-audit case. */
  auditList: AuditReport[];
  /** Index into ``auditList`` of the audit currently rendered.
   *  Defaults to 0 (most recent); the header switcher updates this. */
  activeAuditIndex: number;
  setActiveAuditIndex: (i: number) => void;
  /** The audit being shown — override (dev synth) if set, else the
   *  ``auditList[activeAuditIndex]`` (default 0 = most recent), else
   *  null. */
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
   *  those states).
   *
   *  Resolves to the finalize RESPONSE report when a POST fired, or
   *  ``null`` on the no-op / override paths. The caller reads
   *  ``report.materialized`` off it to toast any accepts the backend
   *  safety net had to re-materialize (see ``AuditReport.materialized``). */
  finalize: (notes?: string) => Promise<AuditReport | null>;
  /** Reopen a finalized audit so the curator can keep dispositioning.
   *  No-op + reject if no audit loaded or not finalized. */
  reopen: () => Promise<void>;
  /** Bulk-clear every disposition on this audit so the curator can
   *  re-disposition from scratch. Use case: iterating on an
   *  augmentation / calibration package where the curator already
   *  actioned findings and hit a UI or wire-schema issue. Does NOT
   *  roll back design mutations — the draft carries those; discard
   *  the draft separately to reset the design. */
  resetAllDispositions: () => Promise<void>;
  /** True while a finalize POST is in flight. */
  finalizeSaving: boolean;
  /** True while a reopen POST is in flight. */
  reopenSaving: boolean;
  /** True while a reset-dispositions POST is in flight. */
  resetAllDispositionsSaving: boolean;

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
       *  (added 2026-05-10). Caller gates the
       *  flow through the accept-reason dialog. */
      acceptReason?: import("@/api/auditTypes").AcceptReason;
      /** Required by the server when ``status === "needs_more_info"``.
       *  The Park button gates the status change on the not-sure
       *  dialog so it never sends without a reason. */
      notSureReason?: import("@/api/auditTypes").NotSureReason;
      /** Structured ``AppliedFix`` (per-row edits) or legacy
       *  free-text string. Server accepts both via the union type
       *  the agents side shipped in agents commit ``e9e52ea``. */
      appliedFix?: import("@/api/auditTypes").AppliedFix | string;
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
      /** Structural-vs-detail axes: whether the factor/tag's structure
       *  is right vs whether its details are right, tracked
       *  separately. Independent
       *  of ``status``. The per-element editor PATCHes these alongside
       *  the canonical status/notes/applied_fix flow; the legacy
       *  three-button DispositionBar leaves both null. */
      structureOk?: boolean | null;
      detailsOk?: boolean | null;
      /** Which version won on a matched finding — explicit, never
       *  inferred from status/applied_fix. See auditTypes.MatchVerdict. */
      matchVerdict?: import("@/api/auditTypes").MatchVerdict;
    },
  ) => Promise<void>;
  /** True while a PATCH is in flight (live path only — the override
   *  path is synchronous). Lets the sidebar disable buttons. */
  dispositionSaving: boolean;
  /** PATCH error, if any. Cleared on the next successful patch. */
  dispositionError: string | null;
}

// Exported so render-time tests (``*.render.test.tsx``) can wrap a
// component with their own stub context value without booting the
// full ``AuditProvider`` (which fetches live audit data). The
// production code path still goes through ``AuditProvider`` →
// ``useAudit``; the export is a test affordance, not a new public
// surface for the app.
export const AuditContext = createContext<AuditContextValue | null>(null);
export type { AuditContextValue };

/** Synth reports use this prefix on `audit_id`. The presence of the
 *  prefix routes dispositions through the in-memory path instead of
 *  PATCH — there's nothing to PATCH against on the server. */
export const SYNTH_AUDIT_ID_PREFIX = "synth-";

/** Chip-diff comparison overrides (set by ChipOverrideMount when the
 *  curator picks a ?base= / ?cmp= pair) carry `audit_id: null` plus a
 *  `model: "chip-diff:..."` marker instead of the synth- prefix. Route
 *  these through the in-memory path too — there's no server audit to
 *  PATCH, but dispositions still need to update the override so the
 *  Confirm button greys after a click. */
function isOverrideReport(r: AuditReport | null): boolean {
  if (!r) return false;
  if (r.audit_id && r.audit_id.startsWith(SYNTH_AUDIT_ID_PREFIX)) return true;
  if (r.audit_id == null && typeof r.model === "string"
      && r.model.startsWith("chip-diff:")) return true;
  return false;
  // 2026-06-14: an "any null audit_id → override" branch lived here
  // briefly. Pulled after the agents side verified the wire ships ``auditId``
  // (camelCase) populated, the UI's snakeify converts it to
  // ``audit_id``, and ``report.audit_id`` is never null on a real
  // proposal-review report. The fallback was masking whatever
  // downstream bug actually caused the design review's "3 pending stays 3 pending"
  // symptom; the next instance should land in the live-PATCH branch
  // and surface via the DevTools Network tab, not the in-memory
  // override (which doesn't persist).
}

export function AuditProvider({
  experimentId,
  kind = "audit",
  reviewer = "",
  showAuditSidebar,
  children,
}: {
  experimentId: number | string;
  /** Which review kind this provider wraps. ``"audit"`` (default)
   *  fetches from ``/datasets/{id}/audits``; ``"proposal"`` fetches
   *  from ``/datasets/{id}/proposals``. The underlying wire shape +
   *  disposition / finalize machinery is shared — only the source
   *  endpoint and downstream framing differ. */
  kind?: CurationReviewKind;
  /** Stamped onto PATCH requests as the disposition's `reviewer`.
   *  Pulled from the session in App.tsx. Empty string is acceptable
   *  for dev (server still records the disposition). */
  reviewer?: string;
  /** Wired to MainGrid's sidebar-view setter. Called when an inline
   *  dot is clicked so the curator gets context immediately. */
  showAuditSidebar: () => void;
  children: ReactNode;
}) {
  // Call both hooks unconditionally to keep hook order stable across
  // ``kind`` flips; the unused one is gated off via ``enabled`` so
  // only one HTTP request fires. Same query-key namespace as the
  // direct callers, so cache + invalidations stay consistent.
  const audits = useAuditsForExperiment(experimentId, {
    enabled: kind === "audit",
  });
  const proposals = useProposalReviewsForExperiment(experimentId, {
    enabled: kind === "proposal",
  });
  const {
    data: liveReports,
    isLoading: liveLoading,
    error: liveError,
  } = kind === "audit" ? audits : proposals;
  const patchDisposition = usePatchDisposition(experimentId);
  // Read through the context rather than ``useDesignDraft()`` — that
  // hook throws outside a provider, and the stamp is an enrichment
  // that must never be the reason a disposition fails to save. Both
  // production mounts sit inside DesignDraftProvider; test harnesses
  // that boot this provider alone simply send no stamp.
  const designDraft = useContext(DesignDraftContext);
  const finalizeAudit = useFinalizeAudit(experimentId);
  const reopenAudit = useReopenAudit(experimentId);
  const resetDispositions = useResetAuditDispositions(experimentId);

  const [override, setOverride] = useState<AuditReport | null>(null);
  const [activeFindingKey, setActiveFindingKey] = useState<string | null>(null);
  const [activeAuditIndex, setActiveAuditIndex] = useState(0);

  // Reset override + audit-switch index on experiment change so state
  // doesn't leak from GSE A into GSE B.
  useEffect(() => {
    setOverride(null);
    setActiveFindingKey(null);
    setActiveAuditIndex(0);
  }, [experimentId]);

  const auditList = liveReports?.items ?? [];
  // Clamp the index in case the audit list shrinks (e.g. server
  // dropped one) — keeps the selection valid without throwing.
  const safeIndex = Math.min(
    Math.max(0, activeAuditIndex),
    Math.max(0, auditList.length - 1),
  );
  const liveReport = auditList[safeIndex] ?? null;
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
    // Append-only disposition log: multiple rows per target_id can
    // exist (e.g. accept → undo → re-accept). The latest one wins.
    // Iterate sorted newest-first by ``reviewed_at`` and set only if
    // the key isn't already in the map — guarantees the latest wins
    // regardless of how the server orders the list. Bug caught
    // 2026-05-25: previous version used iteration-order ``set``,
    // which produced wrong answers when the server returned newest-
    // first (Apply All would PATCH 3 dispositions, but the local
    // map kept reading the older "pending" row, so the button
    // never disabled).
    const sorted = [...(report.dispositions ?? [])].sort((a, b) => {
      const ta = a.reviewed_at ? Date.parse(a.reviewed_at) : 0;
      const tb = b.reviewed_at ? Date.parse(b.reviewed_at) : 0;
      return tb - ta;
    });
    for (const d of sorted) {
      if (!m.has(d.target_id)) m.set(d.target_id, d);
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
        appliedFix?: import("@/api/auditTypes").AppliedFix | string;
        firstSeenAt?: string;
        resolvedAt?: string;
        inheritedFrom?: string;
        structureOk?: boolean | null;
        detailsOk?: boolean | null;
        matchVerdict?: import("@/api/auditTypes").MatchVerdict;
      } = {},
    ) => {
      if (!report) return;
      const notes = extras.notes ?? "";
      if (isOverrideReport(report)) {
        // In-memory path. Synthesize a disposition entry and merge
        // into the override report. ``reviewed_at`` mirrors what the
        // server would stamp. The override path doesn't model the
        // analytics-only fields (dismiss_reason, applied_fix,
        // first_seen_at) — they exist on the wire so the agents side can
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
          // Seed from the rendered report when the override state itself
          // is null but `report` came in as an override-shaped object
          // (chip-diff overrides set via setOverrideReport land here on
          // initial mount). Falling back to `report` avoids the silent
          // no-op that previously left the Confirm button stuck active.
          const base = cur ?? report;
          if (!base) {
            console.warn(
              "setDisposition: no base override report to mutate (target_id=%s)",
              targetId,
            );
            return cur;
          }
          const filtered = (base.dispositions ?? []).filter(
            (d) => d.target_id !== targetId,
          );
          return { ...base, dispositions: [...filtered, next] };
        });
        return;
      }
      // Live path. PATCH the server; on success the query
      // invalidates and the report re-renders with the refreshed
      // disposition list. The mutation throws on failure so a
      // ``saving…`` UI surface naturally surfaces an error.
      if (!report.audit_id) {
        console.warn(
          "setDisposition: live path but report has no audit_id (target_id=%s, report.model=%s) — neither synth- nor chip-diff override shape; nothing to PATCH",
          targetId,
          report.model,
        );
        return;
      }
      // Resolve the finding's issue_code from the report so the server
      // validator can gate reason chips by code (chip-gap closure,
      // 2026-05-16). Empty string if the finding isn't found — server
      // will reject, which is the right failure mode (mis-routed
      // disposition).
      const finding = (report.findings ?? []).find(
        (f) => f.target_id === targetId,
      );
      const patch: import("@/api/auditTypes").AuditFindingDispositionPatch = {
        target_id: targetId,
        status,
        reviewer,
        notes,
        issue_code: finding?.issue_code ?? "",
      };
      if (extras.dismissReason) patch.dismiss_reason = extras.dismissReason;
      if (extras.acceptReason) patch.accept_reason = extras.acceptReason;
      if (extras.notSureReason) patch.not_sure_reason = extras.notSureReason;
      if (extras.appliedFix) patch.applied_fix = extras.appliedFix;
      if (extras.firstSeenAt) patch.first_seen_at = extras.firstSeenAt;
      if (extras.resolvedAt) patch.resolved_at = extras.resolvedAt;
      if (extras.inheritedFrom) patch.inherited_from = extras.inheritedFrom;
      if (extras.structureOk !== undefined) patch.structure_ok = extras.structureOk;
      if (extras.detailsOk !== undefined) patch.details_ok = extras.detailsOk;
      if (extras.matchVerdict) patch.match_verdict = extras.matchVerdict;
      // 🛑 Provenance stamp — WHICH annotation this was about. This is
      // the only moment anything knows: the curator is looking at one
      // finding and one annotation, and every later reader has to
      // reconstruct that pairing from labels and URIs. Reading the
      // draft rather than the saved design on purpose — an accept that
      // just added the tag is in the draft and won't reach the server
      // until commit. Silently absent when the design can't say which
      // annotation is meant; see ``stampForFinding``.
      const stamp = stampForFinding(finding, designDraft?.draft);
      if (stamp?.gemma_factor_id != null) {
        patch.gemma_factor_id = stamp.gemma_factor_id;
      }
      if (stamp?.local_factor_id) patch.local_factor_id = stamp.local_factor_id;
      if (stamp?.category_uri) patch.category_uri = stamp.category_uri;
      if (stamp?.value_uri) patch.value_uri = stamp.value_uri;
      const refreshed = await patchDisposition.mutateAsync({
        auditId: report.audit_id,
        patch,
      });
      // Same "smoking-gun" check usePatchDisposition's onSuccess already
      // runs (audits.ts) — that one only console.warns for diagnostics.
      // Throwing here turns a silent server-side drop into a real
      // mutation failure so every existing call-site catch/toast picks
      // it up automatically, instead of the curator finding out only
      // when they later notice the finding is still pending (2026-07-30:
      // "it didn't fully record some of my dispositions again").
      const persisted = refreshed.dispositions?.some(
        (d) => d.target_id === targetId,
      );
      if (!persisted) {
        throw new Error(
          "Disposition didn't persist — the server accepted the request but the refreshed report doesn't show it. Try again.",
        );
      }
    },
    [report, reviewer, patchDisposition, designDraft],
  );

  // Lifecycle (finalize / reopen). Both no-op on the override
  // (synth) path — there's nothing to PATCH against; we just
  // pretend there's no audit to close. Callers are gated by
  // `isFinalized` already, so this only catches stray double-clicks.
  const finalize = useCallback(
    async (notes?: string): Promise<AuditReport | null> => {
      if (!report || !report.audit_id) return null;
      if (isOverrideReport(report)) return null;
      if (report.finalized_at) return null;
      return await finalizeAudit.mutateAsync({
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
  const resetAllDispositions = useCallback(async () => {
    if (!report || !report.audit_id) return;
    if (isOverrideReport(report)) return;
    await resetDispositions.mutateAsync({ auditId: report.audit_id });
  }, [report, resetDispositions]);

  const value: AuditContextValue = {
    kind,
    experimentId,
    auditList,
    activeAuditIndex: safeIndex,
    setActiveAuditIndex,
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
    resetAllDispositions,
    resetAllDispositionsSaving: resetDispositions.isPending,
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
