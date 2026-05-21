import { useEffect, useState } from "react";
import { useMe } from "@/api/session";
import { LoginPage } from "@/features/auth/LoginPage";
import { ExperimentList } from "@/features/landing/ExperimentList";
import { ImportPrompt } from "@/features/landing/ImportPrompt";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { useStickyState } from "@/lib/useStickyState";
import { useResetExperiment } from "@/api/datasets";
import { clearPaperDismissalsForExperiment } from "@/features/proposal/paperDismissal";
import { ProposalsInbox } from "@/features/inbox/ProposalsInbox";
import { AuditsInbox } from "@/features/inbox/AuditsInbox";
import { AuditPreviewPage } from "@/features/audit/AuditPreviewPage";
import { AuditDetailPage } from "@/features/audit/AuditDetailPage";
import { WorkflowPage } from "@/features/workflow/WorkflowPage";
import { PipelinePanel } from "@/features/workflow/PipelinePanel";
import { useGroup } from "@/api/workflow";
import { useAuditsForExperiment } from "@/api/audits";
import { AuditSidebarPanel } from "@/features/audit/AuditSidebarPanel";
import { AuditProvider } from "@/features/audit/AuditContext";
import {
  parseRoute,
  navigate,
  experimentRoute,
  type Route,
  type ExperimentTab,
} from "@/routes";
import {
  onRequestSampleScroll,
  dispatchSamplesScrollRow,
} from "@/lib/scrollToSample";
import {
  onRequestAuditFocus,
  dispatchAuditFocusTarget,
  tabForTargetId,
} from "@/lib/scrollToAuditTarget";
import { parseTargetId } from "@/features/audit/targetIds";
import {
  ExperimentBanner,
  TopBar,
  type TabId,
} from "@/features/experiment/ExperimentBanner";
import { ProposalCardV2 } from "@/features/proposal/ProposalCardV2";
import { ProposalSummaryCard } from "@/features/proposal/ProposalSummaryCard";
import { ProposeProgressPanel } from "@/features/proposal/ProposeProgressPanel";
import { useProposeStream } from "@/api/proposeStream";
import { ToastProvider } from "@/components/ui/Toast";
import { ProposalReviewProvider } from "@/features/proposal/ProposalReviewContext";
import { DesignEditor } from "@/features/design/DesignEditor";
import { SampleDetailsPanel } from "@/features/samples/SampleDetailsPanel";
import { DiagnosticsPanel } from "@/features/diagnostics/DiagnosticsPanel";
import { HistoryPanel } from "@/features/history/HistoryPanel";
import { OverviewPanel } from "@/features/overview/OverviewPanel";
import { QuantitationTypesPanel } from "@/features/quantitation/QuantitationTypesPanel";
import { CommitBar } from "@/features/design/CommitBar";
import { validateDesign } from "@/features/experiment/types";
import {
  DesignDraftProvider,
  useDesignDraft,
} from "@/features/design/DesignDraftContext";
import { NotesDrawer } from "@/features/notes/NotesDrawer";
import {
  useProposalsForExperiment,
  useTriggerProposal,
} from "@/api/proposals";
import { useToast } from "@/components/ui/Toast";
import { Spinner } from "@/components/ui/Spinner";
import {
  useCurationDetails,
  useUpdateCurationDetails,
} from "@/api/curation";
import type { Proposal } from "@/api/types";

/**
 * v0 single-page shell. Hard-coded to GSE277245 for now; routing
 * comes after we have a real experiment-list endpoint to land on.
 *
 * The Design draft buffer (uncommitted edits to factors / FVs /
 * statements / tags) lives in `DesignDraftProvider` so all tabs
 * share one in-progress draft and the `<CommitBar/>` at the bottom
 * is the single point of commit.
 */
/** React-side hook over the hash router in @/routes. */
function useRoute(): Route {
  const [route, setRoute] = useState(parseRoute);
  useEffect(() => {
    const onChange = () => setRoute(parseRoute());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export default function App() {
  const route = useRoute();
  const { data: me, isLoading: meLoading, error: meError } = useMe();

  if (meLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-slate-500 bg-white dark:bg-slate-950 dark:text-slate-400">
        loading session…
      </div>
    );
  }
  if (meError || me === undefined || me === null) {
    return <LoginPage />;
  }

  const reviewer = me.username;
  const fullName = me.full_name;

  if (route.kind === "landing") {
    return (
      <ExperimentList
        reviewer={fullName || reviewer}
        onSelect={(id) => navigate(`#/experiments/${id}`)}
      />
    );
  }

  if (route.kind === "inbox") {
    return <ProposalsInbox reviewer={fullName || reviewer} />;
  }

  if (route.kind === "audits-inbox") {
    return <AuditsInbox reviewer={fullName || reviewer} />;
  }

  if (route.kind === "audit-detail") {
    return <AuditDetailPage auditId={route.auditId} />;
  }

  if (route.kind === "audit-preview") {
    return <AuditPreviewPage />;
  }

  if (route.kind === "workflow") {
    return <WorkflowPage groupId={route.groupId} reviewer={fullName || reviewer} />;
  }

  return (
    <ToastProvider>
      <ProposalReviewProvider>
        {/*
          Key the design-draft provider on the experiment id so an
          experiment switch (e.g. set-navigator member click) unmounts
          + remounts a fresh provider with reset draft / prevSavedRef
          state. Without this, the provider's init effect was
          short-circuiting on the old experiment's non-null draft
          and the background-refetch branch's wasClean check saw a
          spurious dirty diff (old factors vs new saved) → the draft
          stayed pinned to the previous experiment while the rest of
          the page (audit panel, banner, etc.) reflected the new id.
          Same principle as ``Shell``'s implicit per-experiment
          local state — the key forces a clean slate.
        */}
        <DesignDraftProvider
          key={route.id}
          experimentId={route.id}
          reviewer={reviewer}
        >
          <Shell
            experimentId={route.id}
            reviewer={reviewer}
            fullName={fullName}
            initialTab={route.tab}
            groupContext={route.groupContext}
          />
        </DesignDraftProvider>
      </ProposalReviewProvider>
    </ToastProvider>
  );
}

/** Full-width banner that fires when the curator is viewing an
 *  experiment in an inter-curator-audit context. Two detection
 *  paths:
 *    1. Group context — URL ``?group=<id>`` resolves to a Group
 *       whose name matches /inter-curator audit/i.
 *    2. Audit model — the experiment's latest audit's ``model``
 *       field carries the inter-curator pattern ("inter-curator
 *       audit · X's curation applied · Y reviews"). Catches the
 *       case where the curator opened the experiment directly,
 *       without the group context in the URL.
 *
 *  If either fires, the banner shows. The label content prefers
 *  the parsed identities (e.g. "cyan's review of amanda's
 *  curation") when available, falling back to the raw group name.
 *  See HANDOFF_2026-05-19_INTER_CURATOR_AUDIT_FOLLOWUPS §1 (bro's
 *  reply, "viewing chip" ask). */
function ComparisonModeBanner({
  experimentId,
  groupId,
}: {
  experimentId: number;
  groupId: string | undefined;
}) {
  const { data: group } = useGroup(groupId);
  const { data: auditList } = useAuditsForExperiment(experimentId);

  const groupName = group?.name || "";
  const fromGroup = /inter-curator audit/i.test(groupName);

  // Find the most recent audit with an inter-curator-audit model
  // string. Audits are list-fetched per-experiment; the latest is
  // usually the active one but we scan for safety.
  const interCuratorAudit = (auditList?.items ?? []).find((a) =>
    /inter-curator audit/i.test(a.model || ""),
  );
  const fromAudit = !!interCuratorAudit;

  if (!fromGroup && !fromAudit) return null;

  // Parse identities from whichever signal fired. Group name takes
  // precedence when present; audit's model is the fallback. Both
  // patterns share the "X's curation applied · Y reviews" framing
  // (bro encodes the same shape in both surfaces).
  const sourceText =
    (fromGroup ? groupName : interCuratorAudit?.model) || "";
  const m = sourceText.match(
    /(\S+?)'s curation applied\s*·\s*(\S+?)\s*reviews/i,
  );
  const goldCurator = m ? m[1] : null;
  const reviewer = m ? m[2] : null;

  return (
    <div
      className="w-full bg-amber-100 border-b border-amber-300 px-4 py-2 text-sm text-amber-900 dark:bg-amber-900/40 dark:border-amber-700 dark:text-amber-100"
      role="status"
      aria-live="polite"
    >
      <span className="font-semibold uppercase tracking-wide text-[11px] mr-2">
        Viewing
      </span>
      {goldCurator && reviewer ? (
        <span className="text-[13px]">
          <strong>{reviewer}</strong>'s review of{" "}
          <strong>{goldCurator}</strong>'s curation
        </span>
      ) : (
        <span className="font-mono text-[13px]">{sourceText || groupName}</span>
      )}
      <span className="ml-2 text-[11px] opacity-80">
        — design overlay + dispositions belong to this package only
      </span>
    </div>
  );
}

function Shell({
  experimentId,
  reviewer,
  fullName,
  initialTab,
  groupContext,
}: {
  experimentId: number;
  reviewer: string;
  fullName: string;
  initialTab?: string;
  /** Active workflow Group context from the URL ``?group=<id>``.
   *  Threaded into the banner so the inline prev/next cluster knows
   *  which set the curator is walking; preserved on tab-switch
   *  navigations so the context survives. */
  groupContext?: string;
}) {
  // Map a free-form route tab onto the local TabId enum (or onto the
  // notes drawer, which isn't a tab in the bar). Unknown tabs fall
  // back to "overview" — same as no tab specified.
  const initial = mapRouteTab(initialTab);
  const [activeTab, setActiveTab] = useState<TabId>(initial.tab);
  const [notesOpen, setNotesOpen] = useState(initial.notesOpen);

  // React to route changes — App re-renders this Shell with a new
  // ``initialTab`` whenever the hash changes. Without this effect
  // the local tab state was sticky after first mount, so calls like
  // ``navigate(experimentRoute(id, "samples"))`` from elsewhere in
  // the app updated the URL but didn't switch the visible tab. Most
  // visible breakage was the v2 ProposalCard's "review on Samples
  // tab" button (caught 2026-04-29).
  useEffect(() => {
    const next = mapRouteTab(initialTab);
    setActiveTab(next.tab);
    setNotesOpen(next.notesOpen);
  }, [initialTab]);

  const { draft, loadError, staleCacheDiscarded, diff } = useDesignDraft();

  // Guard against accidental navigation away with uncommitted edits.
  // Drafts are persisted to localStorage so a refresh recovers them,
  // but a tab close on a workstation other than the curator's leaves
  // the work stranded — prompt before that happens. The browser
  // shows a generic confirmation; ``returnValue`` non-empty is what
  // triggers it across Chrome / Firefox / Safari.
  useEffect(() => {
    if (!diff.isDirty) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [diff.isDirty]);

  // Listen for "focus the audit target" requests (Apply & focus
  // button on a finding card). The target_id determines which tab
  // the element lives on; assignment-kind targets reroute through
  // the existing requestSampleScroll plumbing so the samples panel
  // only needs one listener (data-bm-shortname). Other kinds get
  // routed via the generic data-audit-target attribute that the
  // FactorList / FactorValueCard / OverviewPanel surfaces stamp on
  // their elements.
  useEffect(() => {
    return onRequestAuditFocus(({ experimentId: reqExpId, targetId }) => {
      if (reqExpId !== experimentId) return;
      const parsed = parseTargetId(targetId);
      if (parsed?.kind === "assignment") {
        // Assignments already route through the samples-scroll plumbing.
        setActiveTab("samples");
        navigate(experimentRoute(experimentId, "samples"));
        dispatchSamplesScrollRow(parsed.biomaterialShortName);
        return;
      }
      const tab = tabForTargetId(targetId);
      if (!tab) return;
      const localTab = mapRouteTab(tab).tab;
      setActiveTab(localTab);
      navigate(experimentRoute(experimentId, tab));
      dispatchAuditFocusTarget(targetId);
    });
  }, [experimentId]);

  // Listen for cross-tab "scroll to sample" requests (audit findings
  // on assignment kind, proposal cards referencing biomaterials).
  // When the request targets THIS experiment, switch to the samples
  // tab and re-dispatch the row-event so SampleDetailsPanel can
  // handle the actual scroll once mounted. Cross-experiment requests
  // route via the hash (callers do that themselves) — keeping this
  // listener experiment-scoped avoids hijacking unrelated events.
  useEffect(() => {
    return onRequestSampleScroll(({ experimentId: targetId, shortName }) => {
      if (targetId !== experimentId) return;
      setActiveTab("samples");
      navigate(experimentRoute(experimentId, "samples"));
      dispatchSamplesScrollRow(shortName);
    });
  }, [experimentId]);

  // In-app navigation guard: hash changes that take the curator off
  // this experiment (back to landing, inbox, or a different
  // experiment) prompt for confirmation when the design has
  // uncommitted edits. Tab switches inside the same experiment are
  // allowed without a prompt — the draft survives.
  useEffect(() => {
    if (!diff.isDirty) return;
    const currentExperimentPrefix = `#/experiments/${experimentId}`;
    function onHashChange(e: HashChangeEvent) {
      const next = new URL(e.newURL).hash;
      if (next.startsWith(currentExperimentPrefix)) return;
      const ok = window.confirm(
        "You have uncommitted changes on this experiment. Leave anyway? (Your draft will be saved locally and restored on return.)",
      );
      if (!ok) {
        // Revert to the previous URL.
        const prev = new URL(e.oldURL).hash;
        window.location.hash = prev;
      }
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [diff.isDirty, experimentId]);

  // ALL hooks must run on every render in the same order. Run the
  // proposals query unconditionally, then branch — putting the
  // 404-redirect AFTER the hook means flipping ``loadError`` between
  // 404 and non-404 across renders doesn't change the hook order.
  // (Earlier this hook was below the conditional return, which
  // would Rules-of-Hooks-violate when loadError flipped.)
  const {
    data,
    isLoading,
    isFetching: proposalsFetching,
    error,
  } = useProposalsForExperiment(experimentId);

  // If the experiment id resolves to nothing in storage, the
  // /design GET 404s. Show the import prompt instead of the
  // generic error.
  if (loadError && /\b404\b/.test(loadError)) {
    return <ImportPrompt experimentId={experimentId} />;
  }

  const externalSource = draft?.external_source ?? null;
  const shortName = draft?.experiment_short_name ?? `experiment ${experimentId}`;
  const pending = (data?.items ?? []).filter((p) => p.status === "pending");
  // Most recent non-pending proposal — surfaces as a slim
  // ProposalSummaryCard above the pending list so the sidebar
  // doesn't go from full v2 card straight to "no proposals" the
  // moment the curator accepts. Mirrors the closed-audit summary
  // treatment. Server's list endpoint orders ``submitted_at`` ASC
  // (storage.py ``list_for_experiment``), so we walk from the end
  // to pick the most recent non-pending. ``findLast`` is the
  // semantic fit; previous code used ``find`` and surfaced the
  // *oldest* rejected proposal once a curator had rejected more
  // than one (the original would persist on top forever).
  const items = data?.items ?? [];
  let recentClosed: Proposal | null = null;
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].status !== "pending") {
      recentClosed = items[i];
      break;
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar
        experimentId={experimentId}
        experimentShortName={shortName}
        reviewer={fullName || reviewer}
      />
      <ComparisonModeBanner
        experimentId={experimentId}
        groupId={groupContext}
      />
      <ExperimentBanner
        experimentId={experimentId}
        shortName={shortName}
        title={draft?.title ?? ""}
        taxon={draft?.taxon ?? ""}
        nSamples={draft?.biomaterials.length ?? 0}
        assay={draft?.assay ?? ""}
        technologyType={draft?.technology_type ?? ""}
        platform={draft?.platform ?? ""}
        platformShortName={draft?.platform_short_name ?? ""}
        platformId={draft?.platform_id ?? null}
        originalPlatform={draft?.original_platform ?? ""}
        originalPlatformShortName={draft?.original_platform_short_name ?? ""}
        originalPlatformId={draft?.original_platform_id ?? null}
        loadedAt={draft?.loaded_at ?? ""}
        loadedBy={draft?.loaded_by ?? ""}
        externalSource={externalSource}
        activeTab={activeTab}
        groupContext={groupContext}
        onTabChange={(tab) => {
          // Keep the URL in sync with the visible tab. Without
          // this, manual tab-bar clicks drift the URL away from
          // ``activeTab``, and a later ``navigate`` to the same
          // route-tab from elsewhere (e.g. ProposalCard's "Preview
          // in samples table") is a no-op — the hash doesn't
          // change so ``hashchange`` doesn't fire and the visible
          // tab stays put. ``groupContext`` rides along so a
          // curator walking a set doesn't lose set context on tab
          // switch.
          setActiveTab(tab);
          navigate(
            experimentRoute(
              experimentId,
              tabIdToRouteTab(tab),
              groupContext,
            ),
          );
        }}
        notesOpen={notesOpen}
        onToggleNotes={() => {
          const next = !notesOpen;
          setNotesOpen(next);
          // ``notes`` is a virtual route-tab that maps back to
          // overview + notesOpen. When closing the drawer, drop
          // back to the current tab.
          navigate(
            experimentRoute(
              experimentId,
              next ? "notes" : tabIdToRouteTab(activeTab),
              groupContext,
            ),
          );
        }}
        commitBar={
          <SharedCommitBar experimentId={experimentId} reviewer={reviewer} />
        }
      />
      {notesOpen ? (
        <NotesDrawer
          experimentId={experimentId}
          reviewer={reviewer}
          onClose={() => setNotesOpen(false)}
        />
      ) : null}

      {staleCacheDiscarded ? (
        <div className="bg-amber-50 border-b border-amber-200 dark:bg-amber-950/40 dark:border-amber-900">
          <div className="mx-auto w-full max-w-[1800px] px-4 py-2 text-xs text-amber-900 flex items-center gap-2 dark:text-amber-200">
            <span className="font-semibold">Stale draft discarded.</span>
            <span>
              You had unsaved changes from a previous session, but the
              experiment has been re-saved on the server since. Starting
              fresh from the current saved state.
            </span>
          </div>
        </div>
      ) : null}

      <MainGrid
        activeTab={activeTab}
        experimentId={experimentId}
        reviewer={reviewer}
        proposalsLoading={isLoading}
        proposalsFetching={proposalsFetching}
        proposalsError={error ? (error as Error).message : null}
        pendingProposals={pending}
        recentClosedProposal={recentClosed}
      />

      <footer className="border-t border-slate-200 bg-white dark:bg-slate-900 dark:border-slate-800">
        <div className="mx-auto w-full max-w-[1800px] px-4 py-1.5 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
          <div className="flex items-center gap-3">
            <span>
              connected to{" "}
              <span className="font-mono">
                {import.meta.env.VITE_GEMMA_CURATION_URL ?? "/rest (proxied)"}
              </span>
            </span>
          </div>
          {/*
            Removed the "⌘K commands" footer hint — the shortcut
            isn't wired (there's no command palette). Bringing it
            back when there's a real palette to open.
          */}
        </div>
      </footer>
    </div>
  );
}

/**
 * Main grid that hosts the active tab body and the proposals
 * sidebar. The sidebar is collapsible and auto-collapses when
 * there are no pending proposals — claws back ~25% of viewport
 * for the editor, which matters when a curator is working on a
 * wide table (Sample Details) or a wide cohort (sample
 * assignment with many FVs).
 */
function MainGrid({
  activeTab,
  experimentId,
  reviewer,
  proposalsLoading,
  proposalsError,
  pendingProposals,
  recentClosedProposal,
  proposalsFetching: _proposalsFetching,
}: {
  activeTab: TabId;
  experimentId: number;
  reviewer: string;
  proposalsLoading: boolean;
  proposalsError: string | null;
  pendingProposals: Proposal[];
  /** Most recently triaged proposal (status !== "pending"), or
   *  null. Renders as a slim ProposalSummaryCard above the pending
   *  list so the sidebar doesn't snap from full card to empty when
   *  the curator accepts. */
  recentClosedProposal: Proposal | null;
  proposalsFetching: boolean;
}) {
  const toast = useToast();
  // Two propose paths in this codebase right now:
  //
  //   - ``useTriggerProposal`` — the existing non-streaming POST. Still
  //     used by ProposalCardV2's "redo with notes" flow, which first
  //     PATCHes a pending proposal to ``needs_changes`` (a separate
  //     mutation) and then fires a fresh propose. The stream endpoint
  //     doesn't change that two-step shape, so the redo path keeps
  //     using the synchronous mutation.
  //
  //   - ``useProposeStream`` — the new SSE-driven path documented in
  //     ``PROGRESS_SSE.md``. Used by the sidebar's ``+ propose``
  //     button so the curator sees live progress + log feed instead
  //     of a 30-90s spinner. ``stream.result``'s ``payload.proposal``
  //     is the canonical result; the hook also invalidates the
  //     proposals query so the pending row lands in the sidebar.
  //
  // Both hit the same proposer service; ``+ propose`` swapping to
  // streaming is purely a UX improvement, not a behavioural one.
  const triggerProposal = useTriggerProposal(experimentId);
  const proposeStream = useProposeStream(experimentId);
  const resetExperiment = useResetExperiment(experimentId);
  // For the reset flow: after the import re-stamps the design
  // server-side and the design query invalidates, the
  // DesignDraftContext's "preserve dirty draft" heuristic would
  // otherwise leave the stale draft in place. Calling ``reload()``
  // nukes the localStorage cache + null-resets the in-memory draft
  // so the loader effect re-seeds from the freshly-fetched saved.
  const { reload: reloadDraft } = useDesignDraft();
  const hasProposals = pendingProposals.length > 0;
  // Demo / dev affordance: re-use cached proposer outputs instead
  // of paying the LLM round-trip again. Persisted across page
  // loads; ``true`` flips ``refresh_cache`` to ``false`` on the
  // next ``+ propose`` so the proposer service replays from disk.
  const [useCachedProposal, setUseCachedProposal] = useStickyState<boolean>(
    "proposer.use-cache",
    false,
  );
  // Sidebar view toggle: Proposals (existing) or Audit (new — see
  // AUDIT_FEATURE.md §UI integration shape, surface B). Sticky so the
  // curator's last choice survives experiment switches. Defaults to
  // proposals — that's the established affordance and most curators
  // will land on a fresh proposal first.
  const [sidebarView, setSidebarView] = useStickyState<"proposals" | "audit">(
    "sidebar.view",
    "proposals",
  );
  // Reset confirmation. Destructive (factors / IC tags wiped); the
  // modal makes the curator pause before re-importing.
  const [resetConfirm, setResetConfirm] = useState(false);
  // Wraps useTriggerProposal so the sidebar button doesn't have to
  // care about toast wiring or error mapping. Pipeline runs are
  // 30-90s for a fresh skeleton, seconds on a cache hit; the
  // mutation's ``isPending`` keeps the button disabled until the
  // submitted proposal lands and the proposals query refetches.
  function requestProposal() {
    // Numeric Gemma ID works as the accession — the pipeline's
    // reference resolver accepts numeric id, GSE accession, or
    // Gemma shortName interchangeably.
    //
    // Body shape mirrors ``useTriggerProposal``'s defaults:
    //   - ``fresh_skeleton: true`` ignores any curated state on the
    //     experiment for this run. Without it the pipeline silently
    //     skips an already-curated experiment and returns an empty
    //     proposal.
    //   - ``refresh_cache`` flips to false when the curator ticks
    //     the "use cache" sidebar checkbox — useful for demos /
    //     dev iteration when the LLM round-trip would just burn
    //     credits.
    //   - ``use_cache`` keeps the **write** side on so future ad-hoc
    //     runs (CLI / scripts) can hit the result we just produced.
    proposeStream.start(String(experimentId), {
      use_cache: true,
      refresh_cache: !useCachedProposal,
      fresh_skeleton: true,
    });
  }
  // Default-open. Curators want the proposals panel visible by
  // default so they notice newly-submitted proposals; if they want
  // the editor full-width they can collapse it explicitly.
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // Sidebar width. Default 320 = Tailwind's old ``lg:w-80``. Curators
  // who want more room for the v2 ProposalCard's verify-N or edit
  // affordances drag the left edge wider; persists via localStorage.
  const SIDEBAR_MIN = 240;
  const SIDEBAR_MAX = 1200;
  const SIDEBAR_DEFAULT = 320;
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try {
      const stored = window.localStorage.getItem("gemma-sidebar-width");
      const n = stored ? parseInt(stored, 10) : NaN;
      return Number.isFinite(n) && n >= SIDEBAR_MIN
        ? Math.min(SIDEBAR_MAX, n)
        : SIDEBAR_DEFAULT;
    } catch {
      return SIDEBAR_DEFAULT;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem("gemma-sidebar-width", String(sidebarWidth));
    } catch {
      // localStorage unavailable — width still works in-memory.
    }
  }, [sidebarWidth]);
  // Drag handler for the resize gutter. Captures the starting cursor
  // X and width, then updates width on mousemove until mouseup. The
  // handler runs only on lg+ layouts (handle is hidden below lg
  // because the aside stacks vertically there).
  function startResize(e: React.MouseEvent<HTMLDivElement>) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    function onMove(ev: MouseEvent) {
      // Drag left → wider. ``startX - ev.clientX`` is positive when
      // the cursor moves left.
      const delta = startX - ev.clientX;
      setSidebarWidth(
        Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startWidth + delta)),
      );
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }
  return (
    <AuditProvider
      experimentId={experimentId}
      reviewer={reviewer}
      showAuditSidebar={() => {
        // A dot click anywhere inside the experiment shell opens the
        // sidebar (if collapsed) and switches to the Audit view so
        // the curator lands on the matching finding card.
        setSidebarOpen(true);
        setSidebarView("audit");
      }}
    >
      <main className="mx-auto w-full max-w-[1800px] px-4 py-4 flex-1 flex gap-4 flex-col lg:flex-row">
        <section className="flex-1 min-w-0 space-y-4">
        {/* CommitBar moved into the ExperimentBanner action row
            (passed as the ``commitBar`` slot, beside Status /
            publish). Earlier sticky-top placement obscured the
            actual page content; inline-in-banner keeps the chip
            visible without stealing real estate. */}

        {activeTab === "overview" ? (
          <OverviewPanel />
        ) : activeTab === "design" ? (
          <DesignEditor experimentId={experimentId} />
        ) : activeTab === "samples" ? (
          <SampleDetailsPanel experimentId={experimentId} />
        ) : activeTab === "diagnostics" ? (
          <DiagnosticsPanel experimentId={experimentId} />
        ) : activeTab === "history" ? (
          <HistoryPanel experimentId={experimentId} />
        ) : activeTab === "pipeline" ? (
          <PipelinePanel experimentId={experimentId} />
        ) : (
          <QuantitationTypesPanel experimentId={experimentId} />
        )}
      </section>

      <aside
        className={
          sidebarOpen
            ? // ``h-`` (not ``max-h-``) so the sticky aside fills
              // the viewport regardless of content height. Without
              // this the resize gutter (anchored ``top-0 bottom-0``
              // on the aside) only reaches as far as the content
              // does, leaving the bottom of the page un-grabbable
              // when there are few findings.
              "shrink-0 space-y-3 relative lg:sticky lg:top-2 lg:self-start lg:h-[calc(100vh-1rem)] lg:overflow-y-auto"
            : "lg:w-10 shrink-0 flex flex-col items-stretch relative lg:sticky lg:top-2 lg:self-start lg:h-[calc(100vh-1rem)]"
        }
        style={
          sidebarOpen
            ? { width: `${sidebarWidth}px` }
            : undefined
        }
      >
        {/* Resize gutter. Sits at the left edge of the open sidebar;
            drag horizontally to widen / narrow. Hidden when the
            sidebar is collapsed (no need) and below lg (where the
            layout stacks vertically — aside is full-width). */}
        {sidebarOpen ? (
          <div
            onMouseDown={startResize}
            className="hidden lg:block absolute -left-1 top-0 bottom-0 w-2 cursor-col-resize z-10 group"
            title="drag to resize the proposals sidebar"
            role="separator"
            aria-orientation="vertical"
          >
            <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-slate-200 group-hover:bg-blue-400 group-active:bg-blue-500 transition-colors" />
          </div>
        ) : null}
        {sidebarOpen ? (
          <div className="card text-xs text-slate-600 px-2 py-1.5 flex flex-col gap-1">
            {/* View toggle — Proposals vs Audit. The two surfaces
                share this real estate; only one is visible at a time.
                Sticky preference (sidebarView) so the curator lands
                back on whichever they last chose. */}
            <div className="flex items-center gap-1">
              <ViewToggleButton
                active={sidebarView === "proposals"}
                onClick={() => setSidebarView("proposals")}
                badge={
                  hasProposals ? pendingProposals.length : undefined
                }
                badgeCls="text-amber-700"
              >
                Proposals
              </ViewToggleButton>
              <ViewToggleButton
                active={sidebarView === "audit"}
                onClick={() => setSidebarView("audit")}
              >
                Audit
              </ViewToggleButton>
              <button
                type="button"
                className="ml-auto px-2 py-1 rounded border border-slate-200 text-[10px] uppercase tracking-wide font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 inline-flex items-center gap-1"
                onClick={() => setSidebarOpen(false)}
                title="collapse sidebar"
                aria-label="collapse sidebar"
              >
                <span aria-hidden>›</span>
                <span>hide</span>
              </button>
            </div>
            {sidebarView === "proposals" ? (
              <>
                {/* Phase 1 deployment hook. Triggers POST
                    /propose/{id} via the SSE stream (proposeStream).
                    Hidden once a pending proposal exists — the
                    proposal card's "redo with notes" is the
                    canonical retry path. */}
                {pendingProposals.length === 0 ||
                proposeStream.status === "running" ? (
                  <button
                    type="button"
                    onClick={requestProposal}
                    disabled={proposeStream.status === "running"}
                    title={
                      proposeStream.status === "running"
                        ? "the proposer is running — watch the log feed below"
                        : "ask the proposer agent to build a fresh proposal for this experiment"
                    }
                    className={
                      "self-start px-1.5 py-0.5 rounded text-[10px] font-medium inline-flex items-center gap-1 " +
                      (proposeStream.status === "running"
                        ? "bg-slate-200 text-slate-500 cursor-progress"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200")
                    }
                  >
                    {proposeStream.status === "running" ? (
                      <>
                        <Spinner />
                        proposing…
                      </>
                    ) : (
                      "+ propose"
                    )}
                  </button>
                ) : null}
                {/* Demo / dev affordances scoped to the proposer:
                    "use cache" replays cached output instead of a
                    fresh LLM call; "reset experiment" strips curation
                    so a fresh skeleton is ready for a re-run. */}
                <div className="flex items-center gap-2 text-[10px] text-slate-500 pt-1 border-t border-slate-100">
                  <label
                    className="inline-flex items-center gap-1 cursor-pointer hover:text-slate-700"
                    title="Replay the cached proposer output instead of running the LLM again. Off = fresh LLM call (refresh_cache=true)."
                  >
                    <input
                      type="checkbox"
                      className="rounded border-slate-300"
                      checked={useCachedProposal}
                      onChange={(e) =>
                        setUseCachedProposal(e.target.checked)
                      }
                    />
                    <span>use cache</span>
                  </label>
                  <span aria-hidden className="text-slate-300">
                    ·
                  </span>
                  <button
                    type="button"
                    className="hover:text-rose-700 underline underline-offset-2 disabled:opacity-50 disabled:no-underline"
                    onClick={() => setResetConfirm(true)}
                    disabled={resetExperiment.isPending}
                    title="Re-import this experiment from real Gemma with curation stripped — clears factors and IC tags. Biomaterials and metadata stay."
                  >
                    {resetExperiment.isPending
                      ? "resetting…"
                      : "reset experiment"}
                  </button>
                </div>
              </>
            ) : null}
          </div>
        ) : (
          /*
            Collapsed state: turn the whole narrow aside into one
            tall click target. Vertical-rl writing mode reads top-
            down; the small chevron at top reinforces "click to
            open". Pending-count badge sits below so it's visible
            without expanding.
          */
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            title={
              sidebarView === "audit"
                ? "Open audit findings"
                : `Open proposals${hasProposals ? ` (${pendingProposals.length} pending)` : ""}`
            }
            className="card lg:flex-1 lg:min-h-[12rem] hover:bg-slate-50 flex flex-col items-center gap-3 py-3 text-slate-600 hover:text-slate-900 transition-colors"
          >
            <span aria-hidden className="text-base leading-none">
              ‹
            </span>
            <span
              className="text-[11px] font-semibold tracking-widest uppercase"
              style={{ writingMode: "vertical-rl" }}
            >
              {sidebarView === "audit" ? "Audit" : "Proposals"}
            </span>
            {sidebarView === "proposals" && hasProposals ? (
              <span className="text-[10px] uppercase tracking-wide font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 mt-auto">
                {pendingProposals.length}
              </span>
            ) : null}
          </button>
        )}

        {sidebarOpen ? (
          sidebarView === "audit" ? (
            <AuditSidebarPanel experimentId={experimentId} />
          ) : proposalsLoading ? (
            <div className="card p-3 text-xs text-slate-500">
              loading proposals…
            </div>
          ) : proposalsError ? (
            <div className="card p-3 text-xs text-rose-700">
              {proposalsError}
              <p className="mt-1 text-slate-500 text-[11px]">
                Is the local server running?{" "}
                <code>./run_mock.sh</code>
              </p>
            </div>
          ) : !hasProposals ? (
            // No pending proposals. Show the most recently triaged
            // one as a slim summary card if there is one (so the
            // sidebar doesn't snap from full v2 card to "agent
            // idle" the moment the curator accepts), then fall
            // through to the progress panel for the next + propose
            // run.
            <>
              {recentClosedProposal ? (
                <ProposalSummaryCard
                  proposal={recentClosedProposal}
                  onRequestRedo={requestProposal}
                />
              ) : null}
              <ProposeProgressPanel
                state={proposeStream}
                onDismiss={proposeStream.reset}
              />
            </>
          ) : (
            <>
              {recentClosedProposal ? (
                <ProposalSummaryCard proposal={recentClosedProposal} />
              ) : null}
              {pendingProposals.map((p) => (
                <ProposalCardV2
                  key={p.proposal_id ?? Math.random()}
                  proposal={p}
                  reviewer={reviewer}
                  triggerProposal={triggerProposal}
                  proposeStream={proposeStream}
                />
              ))}
            </>
          )
        ) : null}
      </aside>
      <ConfirmModal
        open={resetConfirm}
        title="Reset experiment to fresh skeleton?"
        body={
          `Re-imports experiment #${experimentId} from real Gemma and strips ` +
          `curation: factors, IC tags, and FV-source synth tags are cleared. ` +
          `Biomaterials, characteristics, and metadata stay.\n\n` +
          `Equivalent to "mock-gemma import --strip-curation" from the CLI. ` +
          `Any uncommitted draft on the design tab is discarded.`
        }
        confirmLabel={resetExperiment.isPending ? "resetting…" : "reset"}
        destructive
        onConfirm={() => {
          resetExperiment.mutate({
            onSuccess: () => {
              // Force the draft state to follow the freshly-imported
              // design. Without this, the background-refetch sync's
              // clean-draft heuristic preserves any in-flight draft
              // and the curator sees the old factors / tags despite
              // the server having stripped them.
              reloadDraft();
              // The proposal-paper auto-apply flag survives across
              // sessions; reset wipes the design but doesn't drop
              // proposals, so a stale flag would block the auto-add
              // from re-firing on the fresh skeleton. Clear all
              // flags scoped to this experiment.
              clearPaperDismissalsForExperiment(experimentId);
              toast.show("Experiment reset to fresh skeleton.", "success");
              setResetConfirm(false);
            },
            onError: (err) => {
              toast.show(
                `Reset failed: ${(err as Error).message}`,
                "danger",
                8000,
              );
            },
          });
        }}
        onCancel={() => setResetConfirm(false)}
      />
      </main>
    </AuditProvider>
  );
}

/** Renders the shared CommitBar at the bottom of the active tab.
 *  The bar reads its diff + commit/discard handlers from the
 *  draft context, so any edit on any tab surfaces here. */
function SharedCommitBar({
  experimentId,
  reviewer,
}: {
  experimentId: number;
  reviewer: string;
}) {
  const { diff, draft, commit, discard, saving, saveError } = useDesignDraft();
  // Compute the validator state from the draft so the bar can gate
  // commit on baseline correctness without a round-trip to the
  // server. validateDesign is cheap (linear in factors × FVs).
  const validation = draft ? validateDesign(draft) : null;
  // For stamping baseline-override reasons onto curation_note: read
  // the current note (so we can append rather than replace), and
  // get the updater. Both are scoped to this experiment.
  const curation = useCurationDetails(experimentId);
  const updateCuration = useUpdateCurationDetails(experimentId, reviewer);
  return (
    <CommitBar
      diff={diff}
      saving={saving}
      saveError={saveError}
      validation={validation}
      draft={draft}
      onCommit={(overrides) => {
        commit();
        if (overrides.length === 0) return;
        // Stamp override reasons onto curation_note so the audit
        // trail records which baseline gates the curator waived
        // and why. Best-effort — if the curation_note update
        // fails (e.g. 401), the design commit still goes through;
        // we don't want a missed stamp to block the curator's
        // primary action.
        const stamp = formatBaselineOverrideStamp(
          overrides,
          reviewer,
          new Date(),
        );
        const existing = (curation.data?.curation_note ?? "").trimEnd();
        const next = existing ? `${existing}\n${stamp}` : stamp;
        updateCuration.mutate({ curation_note: next });
      }}
      onDiscard={discard}
    />
  );
}

/** Tab-style toggle button for the sidebar's Proposals|Audit switch.
 *  Underlines the active view; dims the inactive one. Optional badge
 *  shows a count (pending proposals, or audit issues) without
 *  forcing a click to see urgency. */
function ViewToggleButton({
  active,
  onClick,
  children,
  badge,
  badgeCls,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  badge?: number;
  badgeCls?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "px-2 py-0.5 text-[11px] font-semibold rounded transition-colors " +
        (active
          ? "bg-slate-100 text-slate-900"
          : "text-slate-500 hover:text-slate-800 hover:bg-slate-50")
      }
      aria-pressed={active}
    >
      {children}
      {typeof badge === "number" ? (
        <span className={"ml-1 " + (badgeCls ?? "text-slate-500")}>
          ({badge})
        </span>
      ) : null}
    </button>
  );
}

function formatBaselineOverrideStamp(
  overrides: { factorLabel: string; reason: string }[],
  reviewer: string,
  when: Date,
): string {
  const date = when.toISOString().slice(0, 10);
  const who = reviewer ? ` by ${reviewer}` : "";
  const items = overrides
    .map((o) => `${o.factorLabel}${o.reason ? ` — ${o.reason}` : ""}`)
    .join("; ");
  return `[${date}] baseline override${who}: ${items}`;
}

/**
 * Reverse of ``mapRouteTab``: turn a local TabId into the
 * route-level slug. ``qt`` (TabId) ⇄ ``quantitation`` (route) is
 * the only divergence; the rest are passthroughs. Used when the UI
 * pushes a new URL after a tab-bar click so the URL stays the
 * single source of truth for "which tab is showing".
 */
function tabIdToRouteTab(tabId: TabId): ExperimentTab {
  if (tabId === "qt") return "quantitation";
  return tabId as ExperimentTab;
}

/**
 * Translate a route-level tab id (loose, comes from a URL the user
 * may have typed or shared) into the local TabId enum used by the
 * tab bar, plus a flag for whether the notes drawer should be open.
 * The route allows ``"proposals"`` as a virtual tab — the proposals
 * sidebar is always visible, so we just land on overview and let the
 * sidebar attract the eye.
 */
function mapRouteTab(tab: string | undefined): {
  tab: TabId;
  notesOpen: boolean;
} {
  if (tab === "notes") return { tab: "overview", notesOpen: true };
  if (tab === "quantitation") return { tab: "qt", notesOpen: false };
  // Tags retired 2026-04-30 — folded into Overview. Existing
  // bookmarks / inbound URLs still resolve to a sensible page.
  if (tab === "tags") return { tab: "overview", notesOpen: false };
  if (
    tab === "overview" ||
    tab === "design" ||
    tab === "samples" ||
    tab === "diagnostics" ||
    tab === "history" ||
    tab === "pipeline" ||
    tab === "qt"
  ) {
    return { tab, notesOpen: false };
  }
  // ``proposals`` and unknown tabs both land on overview; the
  // proposals sidebar is always there.
  return { tab: "overview", notesOpen: false };
}

