import { startTransition, useEffect, useRef, useState, type ReactNode } from "react";
import { useActiveBaselineSource } from "@/features/comparison/useActiveBaselineSource";
import { useMe } from "@/api/session";
import { LoginPage } from "@/features/auth/LoginPage";
import { PreboardingDetailPage } from "@/features/preboarding/PreboardingDetailPage";
import { ExperimentList } from "@/features/landing/ExperimentList";
import { CuratorDashboard } from "@/features/landing/CuratorDashboard";
import { TicketDetailPage } from "@/features/tickets/TicketDetailPage";
import { ImportPrompt } from "@/features/landing/ImportPrompt";
import { useStickyState } from "@/lib/useStickyState";
import { ProposalsInbox } from "@/features/inbox/ProposalsInbox";
import { AuditsInbox } from "@/features/inbox/AuditsInbox";
import { AuditPreviewPage } from "@/features/audit/AuditPreviewPage";
import { ProposalPreviewPage } from "@/features/proposal/ProposalPreviewPage";
import { AuditDetailPage } from "@/features/audit/AuditDetailPage";
import { WorkflowPage } from "@/features/workflow/WorkflowPage";
import { PipelinePanel } from "@/features/workflow/PipelinePanel";
import { LeaveJobGuard } from "@/features/leaveGuard/LeaveJobGuard";
import { useAuditsForExperiment } from "@/api/audits";
import { useProposalReviewsForExperiment } from "@/api/reviewProposals";
import { AuditSidebarPanel } from "@/features/audit/AuditSidebarPanel";
import { AuditProvider } from "@/features/audit/AuditContext";
import { ChipStrip } from "@/features/comparison/ChipStrip";
import { useChipState } from "@/features/comparison/useChipState";
import { useChipDesignPair } from "@/features/comparison/useChipDiff";
import { FlowProvider, useIsReadOnly } from "@/features/comparison/FlowContext";
import { ChipOverrideMount } from "@/features/comparison/ChipOverrideMount";
import { useTicket } from "@/api/tickets";
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
import { AppHeader } from "@/components/ui/AppHeader";
import { PageMask } from "@gemma/ui";
import { useProposeStream } from "@/api/proposeStream";
import { useAuditStream } from "@/api/auditStream";
import { useServicesHealth } from "@/api/health";
import {
  useProposeSchema,
  useAuditSchema,
  warnOnSchemaDrift,
  UI_PROPOSAL_FIELDS,
  UI_AUDIT_FIELDS,
} from "@/api/agentSchema";
import {
  AgentRunDialog,
  type AgentRunRequest,
} from "@/components/AgentRunDialog";
import { ToastProvider } from "@/components/ui/Toast";
import { ProposalReviewProvider } from "@/features/proposal/ProposalReviewContext";
import { DesignEditor } from "@/features/design/DesignEditor";
import { SampleDetailsPanel } from "@/features/samples/SampleDetailsPanel";
import { DiagnosticsPanel } from "@/features/diagnostics/DiagnosticsPanel";
import { QualityControlPanel } from "@/features/diagnostics/QualityControlPanel";
import { HistoryPanel } from "@/features/history/HistoryPanel";
import { OverviewPanel } from "@/features/overview/OverviewPanel";
import { QuantitationTypesPanel } from "@/features/quantitation/QuantitationTypesPanel";
import { SingleCellPanel } from "@/features/singlecell/SingleCellPanel";
import { CommitBar } from "@/features/design/CommitBar";
import { validateDesign } from "@/features/experiment/types";
import {
  DesignDraftProvider,
  useDesignDraft,
} from "@/features/design/DesignDraftContext";
import { NotesDrawer } from "@/features/notes/NotesDrawer";
import { Spinner } from "@/components/ui/Spinner";
import {
  useCurationDetails,
  useUpdateCurationDetails,
} from "@/api/curation";

/**
 * v0 single-page shell. Hard-coded to GSE277245 for now; routing
 * comes after we have a real experiment-list endpoint to land on.
 *
 * The Design draft buffer (uncommitted edits to factors / FVs /
 * statements / tags) lives in `DesignDraftProvider` so all tabs
 * share one in-progress draft and the `<CommitBar/>` at the bottom
 * is the single point of commit.
 */
/** React-side hook over the hash router in @/routes.
 *  The hashchange event fires synchronously inside ``navigate``'s
 *  ``window.location.hash = …`` assignment, so without
 *  ``startTransition`` the resulting render is part of the same
 *  click-handler tick — Chrome flags a 500+ms violation on
 *  landing → sample-details transitions because the experiment
 *  shell + big sample table render inline. Marking the route
 *  update as a transition lets React deprioritize that render so
 *  the click handler returns immediately and the browser paints
 *  the click acknowledgment first. The old page stays visible for
 *  a frame while the new one streams in. */
function useRoute(): Route {
  const [route, setRoute] = useState(parseRoute);
  useEffect(() => {
    const onChange = () => {
      startTransition(() => setRoute(parseRoute()));
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export default function App() {
  const route = useRoute();
  const { data: me, isLoading: meLoading, error: meError } = useMe();

  if (meLoading) {
    return <PageMask label="loading session…" />;
  }
  if (meError || me === undefined || me === null) {
    return <LoginPage />;
  }

  const reviewer = me.username;
  const fullName = me.full_name;

  if (route.kind === "landing") {
    return (
      <CuratorDashboard
        reviewer={fullName || reviewer}
        onSelect={(id) => navigate(`#/experiments/${id}`)}
      />
    );
  }

  if (route.kind === "all-experiments") {
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
    return (
      <AuditDetailPage auditId={route.auditId} reviewer={fullName || reviewer} />
    );
  }

  if (route.kind === "audit-preview") {
    return <AuditPreviewPage />;
  }

  if (route.kind === "proposal-preview") {
    return <ProposalPreviewPage />;
  }

  if (route.kind === "workflow") {
    return <WorkflowPage groupId={route.groupId} reviewer={fullName || reviewer} />;
  }

  if (route.kind === "ticket") {
    return (
      <ToastProvider>
        <TicketDetailPage
          ticketId={route.ticketId}
          reviewer={fullName || reviewer}
        />
      </ToastProvider>
    );
  }

  // Preboarded candidates (id form ``preboarding:N``) don't have a
  // design / samples / factors yet — they're pre-import metadata
  // shells. Route them to a dedicated read-only landing page instead
  // of mounting Shell, which would try to fetch /design and crash.
  // Per cab handoff HANDOFF_2026-05-24_UI_PREBOARDING_DRILLDOWN.md.
  if (typeof route.id === "string" && route.id.startsWith("preboarding:")) {
    return (
      <ToastProvider>
        <PreboardingDetailPage
          experimentId={route.id}
          groupContext={route.groupContext}
          ticketContext={route.ticketContext}
        />
      </ToastProvider>
    );
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

          DesignDraftProvider sits above FlowProvider in the tree
          (FlowProvider is mounted inside Shell), so it can't read
          chip state directly. The thin ChipBaselineResolver layer
          pre-computes the active baseline source (URL + flow
          defaults) and passes it in — making the whole page render
          against whatever the chip strip selected, per Paul
          2026-06-08 ("yes everywhere").
        */}
        <ChipBaselineResolver
          experimentId={route.id}
          reviewer={reviewer}
          urlBaseline={route.kind === "experiment" ? route.baselineSource : undefined}
          ticketContext={route.ticketContext}
        >
          <Shell
            experimentId={route.id}
            reviewer={reviewer}
            fullName={fullName}
            initialTab={route.tab}
            groupContext={route.groupContext}
            ticketContext={route.ticketContext}
          />
        </ChipBaselineResolver>
      </ProposalReviewProvider>
    </ToastProvider>
  );
}

/** Pre-resolves the chip-strip baseline source and mounts the
 *  DesignDraftProvider with it. DesignDraftProvider lives above
 *  FlowProvider so it can't call useChipState directly; this
 *  resolver does the same READ calculation
 *  (URL ?base= → defaultSlots) at App level. The chip strip itself
 *  (inside Shell, below FlowProvider) handles writes via
 *  useChipState — URL is the single source of truth so both calls
 *  agree by construction. */
function ChipBaselineResolver({
  experimentId,
  reviewer,
  urlBaseline,
  ticketContext,
  children,
}: {
  experimentId: number | string;
  reviewer: string;
  urlBaseline: import("@/features/comparison/sources").Source | undefined;
  ticketContext: string | undefined;
  children: ReactNode;
}) {
  const ticketIdNumeric = ticketContext
    ? Number.parseInt(ticketContext, 10)
    : null;
  const baselineSource = useActiveBaselineSource({
    experimentId,
    urlBaseline,
    ticketIdNumeric: Number.isFinite(ticketIdNumeric) ? ticketIdNumeric : null,
  });
  return (
    <DesignDraftProvider
      key={experimentId}
      experimentId={experimentId}
      reviewer={reviewer}
      baselineSource={baselineSource}
    >
      {children}
    </DesignDraftProvider>
  );
}

function Shell({
  experimentId,
  reviewer,
  fullName,
  initialTab,
  groupContext,
  ticketContext,
}: {
  experimentId: number | string;
  reviewer: string;
  fullName: string;
  initialTab?: string;
  /** Active workflow Group context from the URL ``?group=<id>``.
   *  Threaded into the banner so the inline prev/next cluster knows
   *  which set the curator is walking; preserved on tab-switch
   *  navigations so the context survives. */
  groupContext?: string;
  /** Active Ticket context from the URL ``?ticket=<id>``. Threaded
   *  into the banner so the ticket breadcrumb + per-target prev/next
   *  cluster renders. Mutually exclusive with ``groupContext`` in
   *  practice — a ticket's targets play the role of a group's
   *  member_ids. */
  ticketContext?: string;
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

  const {
    draft,
    isLoading: draftLoading,
    loadError,
    staleCacheDiscarded,
    diff,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useDesignDraft();

  // Global undo / redo bindings — Cmd+Z (Mac) / Ctrl+Z (others) for
  // undo; Cmd+Shift+Z / Ctrl+Y for redo. Skipped when focus is on a
  // text-editable element so the browser's native undo still works
  // inside textareas / inputs / contenteditable. Paul 2026-06-14:
  // "how about binding undo key to last action."
  useEffect(() => {
    function isEditableTarget(el: EventTarget | null): boolean {
      if (!(el instanceof HTMLElement)) return false;
      if (el.isContentEditable) return true;
      const tag = el.tagName;
      if (tag === "TEXTAREA") return true;
      if (tag === "INPUT") {
        const t = (el as HTMLInputElement).type;
        // Allow undo through for non-text inputs (checkbox, radio,
        // button, etc.) — the browser doesn't own undo there.
        return ![
          "checkbox",
          "radio",
          "button",
          "submit",
          "reset",
          "range",
          "color",
        ].includes(t);
      }
      return false;
    }
    function onKey(e: KeyboardEvent) {
      const cmd = e.metaKey || e.ctrlKey;
      if (!cmd) return;
      const key = e.key.toLowerCase();
      const isUndo = key === "z" && !e.shiftKey;
      const isRedo = (key === "z" && e.shiftKey) || key === "y";
      if (!isUndo && !isRedo) return;
      if (isEditableTarget(e.target)) return;
      e.preventDefault();
      if (isUndo) {
        if (canUndo) undo();
      } else if (isRedo) {
        if (canRedo) redo();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, canUndo, canRedo]);

  // ``flow`` drives the review-mode lock. Source of truth: the
  // active Ticket's ``flow`` field — Paul 2026-05-27, "[mode should
  // be] set at the ticket level". Fallback when there's no ticket
  // context: ``review`` (safer default per spec). Computed early
  // so chip state + sidebar override + downstream FlowProvider
  // all see the same value.
  const ticketIdNumeric = ticketContext
    ? Number.parseInt(ticketContext, 10)
    : null;
  const activeTicket = useTicket(
    Number.isFinite(ticketIdNumeric) ? ticketIdNumeric : null,
  );
  const flow: "edit" | "review" =
    activeTicket.data?.flow === "edit" ? "edit" : "review";

  // Chip state lives at the Shell level so within-experiment tab
  // switches (samples, history, …) can thread ``?base=``/``?cmp=``
  // through ``experimentRoute`` calls. Without this, every tab click
  // would silently reset the chips to defaults — losing the curator's
  // explicit comparison setup. Spec Gotcha #6.
  const chipForRoute = useChipState({
    experimentId,
    flow,
    tab: tabIdToRouteTab(mapRouteTab(initialTab).tab),
    groupContext,
    ticketContext,
  });
  const chipsForNav: { base?: typeof chipForRoute.baseline; cmp?: typeof chipForRoute.comparator } = {
    base: chipForRoute.baseline,
    cmp: chipForRoute.comparator,
  };

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
        navigate(
          experimentRoute(
            experimentId,
            "samples",
            groupContext,
            ticketContext,
            chipsForNav,
          ),
        );
        dispatchSamplesScrollRow(parsed.biomaterialShortName);
        return;
      }
      const tab = tabForTargetId(targetId);
      if (!tab) return;
      const localTab = mapRouteTab(tab).tab;
      setActiveTab(localTab);
      navigate(
        experimentRoute(
          experimentId,
          tab,
          groupContext,
          ticketContext,
          chipsForNav,
        ),
      );
      dispatchAuditFocusTarget(targetId);
    });
  }, [experimentId, groupContext, ticketContext, chipsForNav]);

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
      navigate(
        experimentRoute(
          experimentId,
          "samples",
          groupContext,
          ticketContext,
          chipsForNav,
        ),
      );
      dispatchSamplesScrollRow(shortName);
    });
  }, [experimentId, groupContext, ticketContext, chipsForNav]);

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
  // If the experiment id resolves to nothing in storage, the
  // /design GET 404s. Show the import prompt instead of the
  // generic error.
  if (loadError && /\b404\b/.test(loadError)) {
    return <ImportPrompt experimentId={experimentId} />;
  }

  // While the design draft is still loading, mask the experiment
  // shell. Without this, the banner + tabs mount against fallback
  // values (``experiment {id}``, taxon "", n=0, …) — disconcerting
  // empty fields that read like a stuck render rather than an
  // in-flight fetch. TopBar still renders because the persistent
  // session / mode / health chrome is independent of the draft.
  if (draftLoading && !draft) {
    return (
      <div className="min-h-screen flex flex-col">
        <AppHeader reviewer={fullName || reviewer}>
          <span className="text-xs text-slate-400 dark:text-slate-500" aria-hidden>
            /
          </span>
          <a
            href="#/"
            className="text-sm text-slate-700 dark:text-slate-300 hover:underline"
            title="back to dashboard"
          >
            Experiments
          </a>
        </AppHeader>
        <TopBar
          experimentId={experimentId}
          experimentShortName={`experiment ${experimentId}`}
          reviewer={fullName || reviewer}
        />
        <ExperimentShellLoading experimentId={experimentId} />
      </div>
    );
  }

  const externalSource = draft?.external_source ?? null;
  const shortName = draft?.experiment_short_name ?? `experiment ${experimentId}`;

  // "Thin" experiment — imported as a numeric-id shell with NO
  // metadata at all (no preload has run, no factors, no
  // biomaterials, no curator tags). Rendering the full curation
  // chrome against this state looks broken — Overview has nothing
  // to show. Mount PreboardingDetailPage in embedded mode so the
  // curator gets a screening surface that doesn't pretend there's
  // a design.
  //
  // Once preload has populated GEO metadata (title / taxon /
  // external_source / assay), the Overview tab IS the screening
  // surface — title, organism, platform, publications all render
  // there. The dedicated PreboardingDetailPage would be redundant.
  // So we only short-circuit when even the preload bits are empty.
  // Per Paul 2026-05-26 — "once they are loaded, rowclick should
  // take you to the curator view; the preload view is irrelevant".
  const hasPreloadMetadata = !!(
    draft &&
    (draft.title || draft.taxon || draft.external_source || draft.assay)
  );
  const isThin =
    !!draft &&
    !hasPreloadMetadata &&
    (draft.biomaterials?.length ?? 0) === 0 &&
    (draft.factors?.length ?? 0) === 0 &&
    (draft.tags ?? []).filter((t) => !t.inferred).length === 0;
  if (isThin && draft) {
    return (
      <div className="min-h-screen flex flex-col">
        <AppHeader reviewer={fullName || reviewer}>
          <span className="text-xs text-slate-400 dark:text-slate-500" aria-hidden>
            /
          </span>
          <a
            href="#/"
            className="text-sm text-slate-700 dark:text-slate-300 hover:underline"
            title="back to dashboard"
          >
            Experiments
          </a>
        </AppHeader>
        <TopBar
          experimentId={experimentId}
          experimentShortName={shortName}
          reviewer={fullName || reviewer}
        />
        <PreboardingDetailPage
          experimentId={experimentId}
          embedded
          preloaded={{
            id: typeof experimentId === "number" ? experimentId : undefined,
            short_name: draft.experiment_short_name,
            name: draft.title,
            taxon_common_name: draft.taxon,
            technology_type: draft.technology_type,
            number_of_bio_assays: draft.biomaterials?.length ?? 0,
            external_uri: draft.external_source?.uri ?? undefined,
            accession:
              draft.external_source?.accession || draft.experiment_short_name,
            external_database: draft.external_source?.database || "GEO",
            platform_short_name:
              draft.platform_short_name || draft.platform || undefined,
            // ``assay`` carries the gdsType string on preboarded
            // rows; the draft uses the same field name (populated by
            // the python preboarding mapper).
            assay: draft.assay || undefined,
          }}
        />
      </div>
    );
  }

  return (
    <FlowProvider flow={flow}>
    <div className="min-h-screen flex flex-col">
      <AppHeader reviewer={fullName || reviewer} />
      <TopBar
        experimentId={experimentId}
        experimentShortName={shortName}
        reviewer={fullName || reviewer}
      />
      <ChipStrip
        experimentId={experimentId}
        flow={flow}
        tab={tabIdToRouteTab(activeTab)}
        groupContext={groupContext}
        ticketContext={ticketContext}
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
        ticketContext={ticketContext}
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
              ticketContext,
              chipsForNav,
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
              ticketContext,
              chipsForNav,
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
          <div className="mx-auto w-full px-4 py-2 text-xs text-amber-900 flex items-center gap-2 dark:text-amber-200">
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
        groupContext={groupContext}
        ticketContext={ticketContext}
        flow={flow}
      />

      <LeaveJobGuard
        eeId={experimentId}
        accession={shortName || String(experimentId)}
      />

      {/* "connected to /rest (proxied)" footer retired 2026-05-23 —
          sat below the experiment grid, was effectively invisible
          (the grid overflows the viewport). Its info now lives in
          the HealthChip popover in TopBar, which is always on-screen. */}
    </div>
    </FlowProvider>
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
  groupContext,
  ticketContext,
  flow,
}: {
  activeTab: TabId;
  experimentId: number | string;
  reviewer: string;
  groupContext?: string;
  ticketContext?: string;
  flow: "edit" | "review";
}) {
  // SSE-driven hooks for the two agent runs. Both fire from the
  // unified AgentRunDialog opened by the sidebar header strip;
  // their progress panels render below the strip on whichever tab
  // is active. ``useTriggerProposal`` (the legacy synchronous POST)
  // was retired 2026-05-23 along with the inline redo-with-notes
  // affordance.
  const proposeStream = useProposeStream(experimentId);
  const auditStream = useAuditStream(experimentId);
  const servicesHealth = useServicesHealth();
  // Dev-time schema-drift check — fires once per kind when the
  // /propose/schema and /audit/schema responses land. Warns if the
  // dialog is sending a field the agent no longer advertises.
  const proposeSchema = useProposeSchema();
  const auditSchema = useAuditSchema();
  useEffect(() => {
    if (proposeSchema.data) {
      warnOnSchemaDrift("propose", proposeSchema.data, UI_PROPOSAL_FIELDS);
    }
  }, [proposeSchema.data]);
  useEffect(() => {
    if (auditSchema.data) {
      warnOnSchemaDrift("audit", auditSchema.data, UI_AUDIT_FIELDS);
    }
  }, [auditSchema.data]);
  const { draft } = useDesignDraft();
  // Per-experiment data presence: drives sidebar toggle visibility.
  // Hide the Audit toggle when no kind=audit reviews exist on the
  // experiment; hide Proposal review when no kind=proposal reviews
  // exist. Both fetches run unconditionally so the sidebar can
  // refresh as data lands (e.g. a freshly-completed audit stream
  // populates the audit toggle without a page reload).
  const auditsForExp = useAuditsForExperiment(experimentId);
  const proposalReviewsForExp = useProposalReviewsForExperiment(experimentId);
  const hasAudits = (auditsForExp.data?.items?.length ?? 0) > 0;
  const hasProposalReviews =
    (proposalReviewsForExp.data?.items?.length ?? 0) > 0;
  // Unified agent-run dialog state. Replaces the inline "+ propose"
  // sidebar button, the in-panel "+ audit" button, and the
  // proposal-card "redo with notes" affordance. All three routes
  // converge here so the curator always sees a confirmation + the
  // backend health state before a run starts.
  const [agentRunDialog, setAgentRunDialog] = useState<
    | null
    | {
        kind: "proposal" | "audit";
        mode: "fresh" | "redo";
      }
  >(null);
  // Sidebar view toggle: Proposals (existing) or Audit (new — see
  // AUDIT_FEATURE.md §UI integration shape, surface B). Sticky so the
  // curator's last choice survives experiment switches.
  //
  // Two-way sidebar view (2026-05-25, Paul):
  //  - ``audit`` — rich AuditSidebarPanel over kind=audit reviews
  //    (already-curated experiments where the agent flagged deltas).
  //  - ``proposalReview`` — rich AuditSidebarPanel re-used over
  //    kind=proposal reviews (calibration packages on uncurated /
  //    preboarded GSEs; same component, branched on kind). See
  //    AUDIT_TO_REVIEW_RENAME_UI_HANDOFF.md.
  //
  // The legacy ``proposals`` view (thin panel reading
  // ``/curation-proposals``) was hidden in favour of the
  // unified kind=proposal CurationReview surface. Sticky state from
  // before the cutover is normalised to ``proposalReview`` so
  // curators don't land on a now-invalid view.
  const [sidebarViewRaw, setSidebarViewRaw] = useStickyState<
    "audit" | "proposalReview" | "proposals"
  >("sidebar.view", "proposalReview");
  const sidebarViewNormalised: "audit" | "proposalReview" =
    sidebarViewRaw === "audit" ? "audit" : "proposalReview";
  // Auto-flip the view when the curator's sticky preference points
  // at an empty surface but the other one has data. Only fires when
  // both queries have resolved so we don't bounce the view mid-
  // fetch.
  const dataResolved =
    !auditsForExp.isLoading && !proposalReviewsForExp.isLoading;
  const sidebarView: "audit" | "proposalReview" = dataResolved
    ? sidebarViewNormalised === "audit"
      ? hasAudits
        ? "audit"
        : hasProposalReviews
          ? "proposalReview"
          : "audit"
      : hasProposalReviews
        ? "proposalReview"
        : hasAudits
          ? "audit"
          : "proposalReview"
    : sidebarViewNormalised;
  const setSidebarView = setSidebarViewRaw as (
    v: "audit" | "proposalReview",
  ) => void;
  // Open the unified dialog. The strip's single button calls this;
  // the dialog gathers tier / scope / notes / etc and calls back into
  // ``submitAgentRun``.
  function openAgentRunDialog(kind: "proposal" | "audit") {
    // Standing-proposal detection was wired through the legacy
    // pendingProposals count; with that surface hidden, we default
    // every run to ``fresh``. The dialog still allows the curator
    // to attach prior_feedback / refresh_cache manually; the
    // proposer service decides whether to redo internally. A
    // follow-up can re-derive ``redo`` from kind=proposal
    // CurationReview presence.
    setAgentRunDialog({ kind, mode: "fresh" });
  }

  function submitAgentRun(req: AgentRunRequest) {
    const accession = String(experimentId);
    if (req.kind === "proposal") {
      proposeStream.start(accession, {
        fresh_preboarding: true,
        // Redo mode always forces a fresh agent pass so the
        // curator's notes / tier change actually shape the run.
        // Fresh mode trusts the proposer's cache behavior.
        refresh_cache: req.mode === "redo",
        tier: req.tier,
        prior_feedback:
          req.priorFeedback.length > 0 ? req.priorFeedback : null,
      });
    } else {
      auditStream.start(accession, {
        tier: req.tier,
        scope: req.scope,
        with_comparison: req.withComparison,
        refresh_cache: req.mode === "redo",
        prior_feedback:
          req.priorFeedback.length > 0 ? req.priorFeedback : null,
      });
    }
    setAgentRunDialog(null);
  }
  // Default-open. Curators want the proposals panel visible by
  // default so they notice newly-submitted proposals; if they want
  // the editor full-width they can collapse it explicitly.
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Chip strip drives sidebar visibility: ``?cmp=`` empty ⇒ nothing
  // to render in the right panel, so close it. Inverse (auto-reopen
  // on non-empty) is intentionally NOT wired — if the curator
  // explicitly closed the panel during a comparison they want full
  // width, and force-reopening on every chip toggle would be hostile.
  // The collapse button still works as before for the manual close.
  const chipForSidebar = useChipState({
    experimentId,
    flow,
    tab: tabIdToRouteTab(activeTab),
    groupContext,
    ticketContext,
  });
  // Auto-close on the transition non-empty → empty (the user just
  // cleared the comparator, suggesting they're done with the
  // comparison surface). One-shot per transition: re-opening the
  // sidebar manually after that point sticks, even if comparator
  // stays empty (Paul 2026-05-29: "the proposal tab refuses to
  // stay open when the comparator is empty… it's fine to close it
  // by default but don't trap it").
  const prevComparatorRef = useRef(chipForSidebar.comparator);
  useEffect(() => {
    const prev = prevComparatorRef.current;
    if (prev !== "empty" && chipForSidebar.comparator === "empty") {
      setSidebarOpen(false);
    }
    prevComparatorRef.current = chipForSidebar.comparator;
  }, [chipForSidebar.comparator]);
  // Baseline source's Design — fed into the Design tab in review
  // mode so the curator sees the source they chose, not the live
  // editable draft. ``null`` while loading or when baseline=empty;
  // the DesignEditor falls back to the live draft in that case.
  const chipPair = useChipDesignPair(
    experimentId,
    chipForSidebar.baseline,
    chipForSidebar.comparator,
  );
  const chipBaselineDesign = chipPair.baseline;
  // Sidebar width. Default 320 = Tailwind's old ``lg:w-80``. Curators
  // who want more room for the v2 ProposalCard's verify-N or edit
  // affordances drag the left edge wider; persists via localStorage.
  // Max bumped 2026-06-12 from 1200 → 1600 so the proposal-review
  // panel can host the side-by-side ComparisonFactorCard layout on
  // wide displays without horizontal scroll in the comparator
  // columns. Per Paul: "the review panel needs to be as wide as
  // possible (reasonable) to fit the side-by-side."
  const SIDEBAR_MIN = 240;
  const SIDEBAR_MAX = 1600;
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
      {/* Workspace shell — drop the 1800px cap so the proposal-review
          panel can sit close to the viewport edge on wide displays.
          ``px-4`` keeps a small visual gutter on the left + right;
          the right rail's own draggable resizer caps the panel
          width inside that space. Landing / inboxes still use the
          1800px cap (those are text-column surfaces; an ultra-wide
          column of cards reads worse than a contained one). Per
          Paul 2026-06-12: "the portal should fill the horizontal
          width; the proposal tab should be right at the right-side
          of the window, or at least closer." */}
      <main className="mx-auto w-full px-4 py-4 flex-1 flex gap-4 flex-col lg:flex-row">
        {/* Review-mode lock scope, per Paul 2026-05-29: "all we
            need to block is editing of the factors and tags."
            Sample-table sorting, guideline popups, expand/collapse,
            scroll, navigation, and any other read-only affordance
            stays live. The lock now lives INSIDE the relevant
            editing surfaces (``DesignEditor`` for factor edits,
            ``OverviewPanel``'s tag bar for tag edits). The few
            span+role="button" widgets that bypass ``fieldset
            disabled`` (``CategoryPicker``, ``OntologyTermPicker``,
            ``EditableDescription``) self-gate via
            ``useIsReadOnly()``. */}
        <div className="flex-1 min-w-0">
        <section className="space-y-4">
        {activeTab === "overview" ? (
          // displayOverride routes the tab to render against the chip
          // baseline (e.g. polished:cy snapshot) instead of the live
          // editable draft. Fires only when the baseline is something
          // OTHER than ``preboard`` — preboard IS the live draft, so
          // overlaying it would just lock editing for no reason. Per
          // Paul 2026-06-02 ("I would like this holdout 50 to be
          // finalized" — the curator needs the design tab editable
          // when baseline = consensus polished gold = preboard).
          chipForSidebar.baseline !== "empty"
          && chipForSidebar.baseline !== "preboard" ? (
            <OverviewPanel displayOverride={chipBaselineDesign} />
          ) : (
            <OverviewPanel />
          )
        ) : activeTab === "design" ? (
          <DesignEditor
            experimentId={experimentId}
            displayOverride={
              chipForSidebar.baseline !== "empty"
              && chipForSidebar.baseline !== "preboard"
                ? chipBaselineDesign
                : null
            }
          />
        ) : activeTab === "samples" ? (
          <SampleDetailsPanel experimentId={experimentId} />
        ) : activeTab === "qc" ? (
          <QualityControlPanel experimentId={experimentId} />
        ) : activeTab === "diagnostics" ? (
          <DiagnosticsPanel experimentId={experimentId} />
        ) : activeTab === "history" ? (
          <HistoryPanel experimentId={experimentId} />
        ) : activeTab === "pipeline" ? (
          <PipelinePanel experimentId={experimentId} />
        ) : activeTab === "single-cell" ? (
          <SingleCellPanel />
        ) : (
          <QuantitationTypesPanel experimentId={experimentId} />
        )}
      </section>
      </div>

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
            {/* View toggle — Audit vs Proposal review. Both surfaces
                run the same AuditSidebarPanel against different
                CurationReview kinds (audit vs proposal). Sticky
                preference (sidebarView) survives experiment switches.
                The legacy "Proposals" toggle (thin live-proposer
                panel) was hidden on 2026-05-25 in favour of the
                unified kind=proposal CurationReview flow. */}
            <div className="flex items-center gap-1">
              {/* Each toggle hides when its source has no rows for
                  this experiment — keeps the sidebar header focused
                  on actionable work. When the experiment has
                  neither (the import-fresh case), we still render
                  Audit + Proposal review as a stub so the chrome
                  doesn't collapse to "(no work here)". */}
              {hasAudits || (!hasAudits && !hasProposalReviews) ? (
                <ViewToggleButton
                  active={sidebarView === "audit"}
                  onClick={() => setSidebarView("audit")}
                >
                  Audit
                </ViewToggleButton>
              ) : null}
              {hasProposalReviews || (!hasAudits && !hasProposalReviews) ? (
                <ViewToggleButton
                  active={sidebarView === "proposalReview"}
                  onClick={() => setSidebarView("proposalReview")}
                >
                  Proposal review
                </ViewToggleButton>
              ) : null}
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
            {/* Unified request affordance. Replaces the old per-tab
                "+ propose" / "+ audit" buttons + the "use cache" /
                "reset experiment" dev knobs. The button text depends
                on which tab is active AND whether a standing run
                already exists ("Request" vs "Re-run"). Click opens
                AgentRunDialog which carries tier + scope + notes
                inputs and gates on agent health. */}
            <AgentRunButton
              sidebarView={sidebarView}
              proposeRunning={proposeStream.status === "running"}
              auditRunning={auditStream.status === "running"}
              agentDown={servicesHealth.data?.agent === "down"}
              onRequest={openAgentRunDialog}
            />
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
                : "Open proposal review"
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
              {sidebarView === "audit" ? "Audit" : "Proposal"}
            </span>
          </button>
        )}

        {sidebarOpen ? (
          sidebarView === "audit" ? (
            <AuditSidebarPanel experimentId={experimentId} stream={auditStream} />
          ) : (
            // Proposal review. Nested AuditProvider keyed to
            // kind="proposal" so this panel reads from
            // /datasets/{id}/proposals; the outer AuditProvider
            // (kind="audit") keeps feeding inline dots in the
            // design + samples surfaces. The two providers don't
            // share state — only the closest one wins for
            // ``useAudit()`` inside the panel.
            <AuditProvider
              experimentId={experimentId}
              kind="proposal"
              reviewer={reviewer}
              showAuditSidebar={() => {
                setSidebarOpen(true);
                setSidebarView("proposalReview");
              }}
            >
              {/* Chip-strip → AuditProvider bridge. When the
                  comparator chip is a polished source (Cy / Am /
                  preboard), feeds a synthetic AuditReport into
                  this provider so the panel renders diff-as-cards
                  instead of the live agent proposal. Clears the
                  override when comparator = agent_proposal so the
                  live cards return. */}
              <ChipOverrideMount
                experimentId={experimentId}
                flow={flow}
                tab={tabIdToRouteTab(activeTab)}
                groupContext={groupContext}
                ticketContext={ticketContext}
                experimentShortName={draft?.experiment_short_name || String(experimentId)}
              />
              <AuditSidebarPanel
                experimentId={experimentId}
                stream={auditStream}
              />
            </AuditProvider>
          )
        ) : null}
      </aside>
      {/* Reset-experiment affordance retired 2026-05-23 — was a
          dev-only "strip curation + re-import" path used early in
          the prototype; not part of the production curator
          workflow. */}
      {/* Unified agent-run dialog. Opens for proposal AND audit
          requests; the per-tab strip button + (TBD) banner shortcut
          both route here. */}
      <AgentRunDialog
        open={agentRunDialog !== null}
        kind={agentRunDialog?.kind ?? "proposal"}
        mode={agentRunDialog?.mode ?? "fresh"}
        experimentShortName={draft?.experiment_short_name || String(experimentId)}
        agentStatus={servicesHealth.data?.agent ?? "unknown"}
        curationEmpty={
          (draft?.factors?.length ?? 0) === 0 &&
          (draft?.tags ?? []).filter((t) => !t.inferred).length === 0
        }
        busy={
          (agentRunDialog?.kind === "proposal" &&
            proposeStream.status === "running") ||
          (agentRunDialog?.kind === "audit" &&
            auditStream.status === "running")
        }
        onCancel={() => setAgentRunDialog(null)}
        onSubmit={submitAgentRun}
      />
      </main>
    </AuditProvider>
  );
}

/** Single context-aware request button that lives in the sidebar
 *  header strip. Replaces the old per-tab "+ propose" / "+ audit"
 *  buttons + the "use cache" / "reset experiment" knobs. Label flips
 *  between "Request …" (fresh) and "Re-run …" (something already
 *  exists); disabled when the agent service is down or a run of the
 *  matching kind is already in flight.
 *
 *  Audit-side redo detection: needs the AuditProvider's state to
 *  know whether an open audit exists. Today this button stays in
 *  "Run audit" copy regardless — the dialog still works the same
 *  (notes field is hidden when mode=fresh) and the Audit sidebar
 *  panel below the strip surfaces the standing-audit state. A
 *  follow-up wires the redo mode through here too. */
function AgentRunButton({
  sidebarView,
  proposeRunning,
  auditRunning,
  agentDown,
  onRequest,
}: {
  sidebarView: "audit" | "proposalReview";
  proposeRunning: boolean;
  auditRunning: boolean;
  agentDown: boolean;
  onRequest: (kind: "proposal" | "audit") => void;
}) {
  const kind: "proposal" | "audit" =
    sidebarView === "audit" ? "audit" : "proposal";
  const running = kind === "audit" ? auditRunning : proposeRunning;
  // Standing-proposal detection used to gate "Re-run …" vs
  // "Request …" labels via the legacy pendingProposals count;
  // with that surface hidden, this button is always "Request …"
  // until we re-derive the signal off kind=proposal
  // CurationReview presence.
  const label = running
    ? kind === "audit"
      ? "auditing…"
      : "proposing…"
    : kind === "audit"
      ? "Run audit…"
      : "Request proposal…";
  const disabled = running || agentDown;
  const title = agentDown
    ? "Agent service is unreachable — start it to enable runs"
    : running
      ? "A run is already in flight — watch the progress panel below"
      : `Opens the run dialog. Fires a fresh ${kind} request on submit.`;
  return (
    <button
      type="button"
      onClick={() => onRequest(kind)}
      disabled={disabled}
      title={title}
      className={
        "self-start px-2 py-0.5 rounded text-[11px] font-medium inline-flex items-center gap-1 border " +
        (disabled
          ? "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed dark:bg-slate-800 dark:text-slate-500 dark:border-slate-700"
          : "bg-blue-600 text-white border-blue-700 hover:bg-blue-700")
      }
    >
      {running ? <Spinner /> : null}
      <span>{label}</span>
    </button>
  );
}

/** Renders the shared CommitBar at the bottom of the active tab.
 *  The bar reads its diff + commit/discard handlers from the
 *  draft context, so any edit on any tab surfaces here. */
function SharedCommitBar({
  experimentId,
  reviewer,
}: {
  experimentId: number | string;
  reviewer: string;
}) {
  // Review-mode lock — no committing when the curator is just
  // looking at someone else's polished gold. The chip strip's
  // FlowContext is the single source of truth for this.
  const readOnly = useIsReadOnly();
  const { diff, draft, commit, discard, saving, saveError } = useDesignDraft();
  if (readOnly) return null;
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

/** Full-area loading mask shown while the design draft is still
 *  in its initial fetch. Keeps the chrome that matters (TopBar,
 *  HealthChip) while replacing the banner + content with a single
 *  centered "loading…" state so the curator doesn't see the
 *  experiment-shell mount against fallback values for a frame.
 *  Delegates to ``PageMask`` from ``@gemma/ui`` in region mode — the
 *  chrome above is already mounted. */
function ExperimentShellLoading({
  experimentId,
}: {
  experimentId: number | string;
}) {
  return (
    <PageMask mode="region" label="Loading experiment" detail={`${experimentId}…`} />
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
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  badge?: number;
  badgeCls?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
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
    tab === "qc" ||
    tab === "diagnostics" ||
    tab === "history" ||
    tab === "pipeline" ||
    tab === "qt" ||
    tab === "single-cell"
  ) {
    return { tab, notesOpen: false };
  }
  // ``proposals`` and unknown tabs both land on overview; the
  // proposals sidebar is always there.
  return { tab: "overview", notesOpen: false };
}

