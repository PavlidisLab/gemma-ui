import { useEffect, useMemo, useState } from "react";
import { Pencil as PencilIcon } from "lucide-react";
import { useDesignDraft } from "@/features/design/DesignDraftContext";
import { useProposalsForExperiment } from "@/api/proposals";
import { GuidelineSnippetBody } from "@/components/ui/GuidelinePopup";
import { HelpPopup } from "@/components/ui/HelpPopup";
import type { GuidelineSnippet } from "@/lib/guidelines";
import { Tooltip } from "@/components/ui/Tooltip";
import { useIsReadOnly } from "@/features/comparison/FlowContext";
import { extractPaperMeta, pmidFromPaperSource } from "@/features/proposal/paperEvidence";
import { isPaperDismissed, markPaperDismissed } from "@/features/proposal/paperDismissal";
import { platformPageUrl } from "@/lib/gemmaUrls";
import { descriptionWithoutGeoRecordBlock, overallDesignFromDescription } from "./geoRecordBlock";
import { FindPublicationButton } from "./FindPublicationButton";
import { KV, SummaryCard } from "./SummaryCard";
import { DesignSummary } from "./DesignSummary";
import { TagBar } from "./TagBar";
import { abstractForPublication, AddPublicationForm, anyPublicationGetsAbstract, ProposedAbstract, PublicationRow } from "./publications";
import { addPublication, deletePublication, setDesignDescription } from "@/features/design/mutations";
import { TermValidationPanel } from "@/features/design/TermValidationPanel";
import { ProvenancePanel } from "@/features/provenance/ProvenancePanel";
import { ONTOLOGY_GUIDELINE, FREE_TEXT_GUIDELINE, PREDICATE_GUIDELINE, STATEMENT_TEMPLATE_GUIDELINE, BASELINE_GUIDELINE, TAGS_GUIDELINE, DEV_STAGE_GUIDELINE, DERIVED_MATERIAL_GUIDELINE, GRAFT_GUIDELINE, CHECKLIST_GUIDELINE } from "@/lib/guidelines";
import { focusByAuditTarget, onAuditFocusTarget } from "@/lib/scrollToAuditTarget";



/**
 * Read-only experiment summary — title, abstract / description,
 * taxon + assay + platform, source links, publications, sample
 * counts. The banner is kept compact for space; the prose lives
 * here so the curator has somewhere to read the abstract before
 * digging into the design.
 */

/** GEO per-sample protocol fields that are experiment-wide facts when
 *  they're identical across every sample (e.g. GSE99114's growth_protocol
 *  "immunized with MOG35-55/CFA to induce EAE" — the useful disease
 *  induction). Mirrors preboarding's ``_GEO_COLLAPSIBLE_FIELDS``. Order =
 *  render order. */
const GEO_CONSTANT_PROTOCOLS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "growth_protocol", label: "growth (GEO)" },
  { key: "treatment_protocol", label: "treatment (GEO)" },
  { key: "extract_protocol", label: "extract (GEO)" },
];

/** Collect the protocol fields that carry the SAME non-empty value on
 *  every biomaterial — those are really whole-experiment context that GEO
 *  buried in per-sample free-text. A field that varies across samples is
 *  genuinely per-sample and stays in the sample popover only. */
export function constantGeoProtocols(
  biomaterials: ReadonlyArray<{ geo_fields?: Record<string, string> }> | undefined,
): Array<{ label: string; text: string }> {
  const bms = biomaterials ?? [];
  if (bms.length === 0) return [];
  const out: Array<{ label: string; text: string }> = [];
  for (const { key, label } of GEO_CONSTANT_PROTOCOLS) {
    const values = bms.map((b) => (b.geo_fields ?? {})[key]?.trim() ?? "");
    const first = values[0];
    if (first && values.every((v) => v === first)) {
      out.push({ label, text: first });
    }
  }
  return out;
}

export function OverviewPanel() {
  const live = useDesignDraft();
  const apply = live.apply;
  const isLoading = live.isLoading;
  const loadError = live.loadError;
  // The panel always renders the live editable draft so accepted
  // edits are visible. (A chip baseline is carried as the draft's
  // seed in ``DesignDraftContext``, and diffs surface in amber —
  // there's no separate frozen-snapshot view to swap in.)
  const draft = live.draft;

  // Audit "Apply & focus" handler. Tag chips and the experiment
  // header carry data-audit-target attributes that this listener
  // resolves on demand. Multi-tag groups are collapsed by default;
  // focus into a collapsed group is a known gap (the chip isn't in
  // the DOM yet) — fall through to "no match" silently rather than
  // popping the group open from here.
  useEffect(() => {
    return onAuditFocusTarget(({ targetId }) => {
      requestAnimationFrame(() => {
        focusByAuditTarget(targetId);
      });
    });
  }, []);
  // Editable read-side metadata (title / description / taxon /
  // assay / platform / publications) lives on the draft; edits go
  // through the normal commit flow. The Identity / Cohort summary
  // fields below stay sourced from draft so counts reflect any
  // pending edits the curator made on other tabs.
  const meta = draft;
  // The GEO series overall design, from its own field or (legacy packs)
  // dug back out of the description fold. Rendered as the "design (GEO)"
  // row below, and used to de-duplicate the description read view.
  const overallDesign =
    (meta?.overall_design ?? "").trim() ||
    overallDesignFromDescription(meta?.description);
  // Pull every proposal for this experiment so the Publications
  // card can surface paper excerpts the agent fetched. The most
  // recent submission with a non-empty ``paper_excerpt`` wins —
  // older proposals' excerpts are stale once a fresh proposer
  // run has retrieved a different paper. The query is cheap (cached
  // by TanStack) and the proposer panel uses the same fetch.
  const { data: proposalsList } = useProposalsForExperiment(
    draft?.experiment_id ?? -1,
  );
  const paperEvidence = useMemo(() => {
    // Only surface paper evidence tied to a *pending* proposal.
    // Accepted / rejected proposals carry stale excerpts that the
    // curator already adjudicated — keeping them visible led to a
    // "Proposed paper" card sitting on the page with no matching
    // entry in the proposals sidebar (the proposal was already
    // rejected or accepted), confusing curators about what's
    // actionable. A new pending proposer run brings its own evidence.
    const list = (proposalsList?.items ?? []).filter(
      (p) => p.status === "pending",
    );
    // Newest first by submitted_at, then by proposal_id as tiebreak.
    const sorted = [...list].sort((a, b) =>
      (b.submitted_at || "").localeCompare(a.submitted_at || ""),
    );
    for (const p of sorted) {
      const ex = p.evidence?.paper_excerpt?.trim();
      if (ex) {
        return {
          proposal_id: p.proposal_id ?? "",
          paper_source: p.evidence.paper_source ?? "",
          paper_excerpt: p.evidence.paper_excerpt ?? "",
        };
      }
    }
    return null;
  }, [proposalsList]);

  // Auto-apply the agent-proposed paper as a draft Publication the
  // moment the pending proposal lands, so the curator sees the
  // proposed paper sitting in the PUBLICATIONS section (with the
  // abstract toggle) instead of having to accept blind. Acceptance
  // is then a no-op for the publication (addPublication dedups by
  // PMID / DOI); rejection retracts it via the existing reject-undo
  // path in ProposalCardV2.
  //
  // localStorage gates the auto-apply per ``proposal_id``: once the
  // curator has dismissed the publication (manual × in the row, or
  // a reject of the proposal), we don't re-add on the next render
  // / tab visit / page reload. New proposal => new flag key.
  const draftExperimentId = draft?.experiment_id;
  useEffect(() => {
    if (!paperEvidence || !draft || draftExperimentId == null) return;
    const pid = paperEvidence.proposal_id;
    if (!pid) return;
    if (isPaperDismissed(draftExperimentId, pid)) return;
    const meta = extractPaperMeta(paperEvidence.paper_excerpt);
    const pmid =
      meta.pubmed_id ?? pmidFromPaperSource(paperEvidence.paper_source) ?? "";
    const doi = meta.doi ?? "";
    const title = meta.title ?? "";
    if (!pmid && !doi && !title) return;
    // Already in draft (either previously auto-applied this session
    // and the flag got cleared, or curator manually linked it)? Skip
    // the add but still set the flag so we don't churn.
    const alreadyLinked = (draft.publications ?? []).some(
      (p) =>
        (pmid && p.pubmed_id === pmid) ||
        (doi && p.doi === doi) ||
        (title && p.title && p.title.trim() === title.trim()),
    );
    if (!alreadyLinked) {
      apply((d) =>
        addPublication(d, { pubmed_id: pmid, doi, title, citation: "" }),
      );
    }
    markPaperDismissed(draftExperimentId, pid);
  }, [paperEvidence, draftExperimentId, apply, draft]);

  // Order matters: a transient ``draft === null`` can show up between
  // a "Reset experiment" and the design refetch landing — react-query
  // reports ``isFetching`` (not ``isLoading``) on a refetch, so we'd
  // otherwise fall through to the error card with no real error to
  // report. Treat "no draft yet, no error" as still loading.
  if (loadError) {
    return (
      <div className="card p-4 text-sm text-rose-700">
        couldn't load overview: {loadError}
      </div>
    );
  }
  if (isLoading || !draft) {
    return (
      <div className="card p-4 text-sm text-slate-500">
        loading overview…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ONE row, three controls (Paul, 2026-08-16: "this takes up far
          too much space; make it a popup or something"). This was three
          stacked full-width cards — a wrapping list of eleven guideline
          chips, plus a card each for two buttons — and together they
          pushed the TAGS header to the fold on a laptop, so the first
          annotation was below it.

          What collapses and what doesn't is the whole point. The
          guideline links are reference material a curator opens
          deliberately, so they fold behind one control. The two
          ACTIONS keep their counts on the surface: "23 terms" and "(8)"
          are live signals that say there is work here, and behind a
          menu they'd become two items nobody opens.

          The panels render `bare` — no card of their own — so all three
          share this one border.

          Term validation lives here rather than in the Design tab's
          ValidatorBanner because it spans tags, factor values,
          statement slots and sample characteristics; and rather than in
          the audit sidebar because that toggle is hidden until an audit
          exists, which is precisely when it's most useful. Provenance
          sits beside it as the same shape one question over: validation
          asks whether an annotation is RIGHT, provenance asks where it
          came FROM. */}
      <div className="card px-3 py-1.5 flex items-center gap-x-4 gap-y-1 flex-wrap text-xs text-slate-600">
        <GuidelinesMenu />
        {meta ? (
          <TermValidationPanel bare experimentId={meta.experiment_id} />
        ) : null}
        {meta ? <ProvenancePanel bare experimentId={meta.experiment_id} /> : null}
      </div>

      <article className="card p-3 space-y-2">
        {/* Title + "re-import from Gemma" both moved to the
            ExperimentBanner. The Overview card now leads with tags
            and the editable description. */}
        {meta ? (
          <TagBar
            tags={meta.tags ?? []}
            biomaterials={meta.biomaterials ?? []}
            experimentId={meta.experiment_id}
          />
        ) : null}
        <EditableDescription
          value={meta?.description ?? ""}
          displayValue={descriptionWithoutGeoRecordBlock(meta?.description, {
            overallDesign,
            title: meta?.title,
            taxon: meta?.taxon,
            pubmedIds: (meta?.publications ?? [])
              .map((p) => p.pubmed_id ?? "")
              .filter(Boolean),
            accession: meta?.experiment_short_name,
          })}
          onCommit={(description) =>
            draft && apply(setDesignDescription(draft, description))
          }
        />
      </article>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Identity card removed 2026-04-30 — short_name + source +
            external link already render in the ExperimentBanner at the
            top of the page; experiment_id is internal plumbing
            curators rarely need. The short_name is still curator-
            editable inline on the banner. */}

        <SummaryCard label="Subject + assay">
          <KV k="taxon" v={meta?.taxon || "—"} />
          <KV k="assay" v={meta?.assay || "—"} />
          <KV
            k="platform"
            v={renderPlatform(
              meta?.platform ?? "",
              meta?.platform_short_name ?? "",
              meta?.platform_id ?? null,
            )}
            mono
          />
          {(meta?.original_platform ?? "") ||
          (meta?.original_platform_short_name ?? "") ? (
            <KV
              k="original platform"
              v={renderPlatform(
                meta?.original_platform ?? "",
                meta?.original_platform_short_name ?? "",
                meta?.original_platform_id ?? null,
              )}
              mono
            />
          ) : null}
          <KV k="loaded at" v={formatTimestamp(meta?.loaded_at) || "—"} />
          {(() => {
            const rows: Array<{ label: string; text: string }> = [];
            if (overallDesign) rows.push({ label: "design (GEO)", text: overallDesign });
            rows.push(...constantGeoProtocols(meta?.biomaterials));
            return rows.map(({ label, text }) => {
              const oneLine = text.replace(/\s+/g, " ").trim();
              return (
                <KV
                  key={label}
                  k={label}
                  v={
                    <Tooltip
                      interactive
                      wide
                      label={
                        // GEO protocol prose runs to paragraphs; the
                        // curator has to be able to scroll it, which
                        // needs `interactive` on the Tooltip (the
                        // default bubble ignores the pointer).
                        // `overscroll-contain`: without it, hitting the
                        // bottom of the protocol chains the wheel to the
                        // page, and the page scroll closes the tooltip.
                        <div className="max-h-80 overflow-auto overscroll-contain whitespace-pre-wrap text-left">
                          {text}
                        </div>
                      }
                    >
                      <span className="cursor-help text-slate-700">
                        {oneLine.slice(0, 72)}
                        {oneLine.length > 72 ? "…" : ""}
                        <span className="ml-1 text-[10px] italic text-slate-400">
                          from GEO — hover
                        </span>
                      </span>
                    </Tooltip>
                  }
                />
              );
            });
          })()}
        </SummaryCard>

        {/* Cohort card removed 2026-04-30 — its four counts were
            taking up a full card for stats that compress nicely into
            a single strip. The cohort numbers now ride at the top
            of the DesignSummary card below where they're actually
            used (the curator is reading the design crosstab; "165
            samples · 1 factor / 6 FVs · 3 tags" belongs there). */}

        <SummaryCard label="Publications">
          {(meta?.publications?.length ?? 0) === 0 ? (
            <p className="text-[11px] text-slate-500 italic mb-2">
              No publications linked yet. Add manually below — or
              accept the agent's proposal once it surfaces one.
            </p>
          ) : (
            <ul className="space-y-2 text-xs mb-2">
              {(meta?.publications ?? []).map((p, i) => {
                // Attach the agent-fetched abstract to this row.
                // ``paper_source`` is sometimes a PMID / DOI we can
                // substring-match, sometimes a provenance label
                // ("geo_linked_fulltext", "biolit"). When the label
                // case kicks in AND there's exactly one publication
                // on the experiment, attach the abstract anyway —
                // the proposer fetches one paper per run from the
                // experiment's own publication record, so a 1:1
                // mapping is safe. With multiple publications and
                // an opaque source we can't attribute reliably and
                // fall through to the unlinked Proposed-paper block.
                const abstract = abstractForPublication(
                  p,
                  meta?.publications ?? [],
                  paperEvidence,
                );
                return (
                  <PublicationRow
                    key={i}
                    publication={p}
                    abstract={abstract}
                    onDelete={() => {
                      if (!draft) return;
                      // If this row matches the proposal's auto-
                      // applied paper, set the dismissal flag so the
                      // auto-apply effect doesn't re-add on the next
                      // render. Match by PMID / DOI to be tolerant
                      // of curator edits to the title.
                      if (paperEvidence?.proposal_id) {
                        const meta = extractPaperMeta(
                          paperEvidence.paper_excerpt,
                        );
                        const proposalPmid =
                          meta.pubmed_id ??
                          pmidFromPaperSource(paperEvidence.paper_source);
                        if (
                          (p.pubmed_id && p.pubmed_id === proposalPmid) ||
                          (p.doi && p.doi === meta.doi)
                        ) {
                          markPaperDismissed(
                            draft.experiment_id,
                            paperEvidence.proposal_id,
                          );
                        }
                      }
                      apply(deletePublication(draft, p.pubmed_id, p.doi));
                    }}
                  />
                );
              })}
            </ul>
          )}
          {paperEvidence &&
          !anyPublicationGetsAbstract(
            meta?.publications ?? [],
            paperEvidence,
          ) ? (
            <ProposedAbstract
              source={paperEvidence.paper_source}
              excerpt={paperEvidence.paper_excerpt}
            />
          ) : null}
          <div className="mb-2">
            <FindPublicationButton
              accession={meta?.external_source?.accession ?? ""}
              onLink={(c) =>
                draft &&
                apply(
                  addPublication(draft, {
                    pubmed_id: c.pmid,
                    doi: c.doi ?? "",
                    title: c.title,
                    citation: c.citation,
                  }),
                )
              }
            />
          </div>
          <AddPublicationForm
            onAdd={(pub) => draft && apply(addPublication(draft, pub))}
            accession={meta?.external_source?.accession ?? ""}
            title={meta?.title ?? ""}
          />
        </SummaryCard>
      </div>

      <DesignSummary
        factors={draft.factors}
        biomaterials={draft.biomaterials}
        nTags={draft.tags.length}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Design summary — Gemma-style crosstab
// ---------------------------------------------------------------------------

/**
 * Mirrors Gemma's experiment-overview "Experimental Design overview"
 * table. Columns are categorical factors (one per non-continuous,
 * non-nuisance factor); each row is one unique combination of FV
 * values across those factors, with an "Assays" count showing how
 * many biomaterials fall into it.
 *
 * Two trailing bits Gemma also surfaces:
 *
 *   - Continuous factors note ("not shown in this view") — these
 *     carry per-sample values, not FV labels.
 *   - Batch-confound chip when a batch / block factor partitions
 *     samples identically to another factor (so the batch effect
 *     can't be separated from that factor's effect — every batch
 *     contains exactly one level of the confounded factor).
 */
/**
 * Read mode: paragraphs split on blank lines, scrolling. Pencil
 * icon reveals on hover as the edit affordance — but unlike
 * ShortNameEditor / TitleEditor (single-line, rarely text-selected),
 * the description body is prose curators commonly select-to-copy.
 * So entering edit mode is gated on clicking the pencil itself,
 * not the surrounding text — the text stays plain selectable
 * content. Empty-state placeholder is click-to-edit since there's
 * no real text to select there.
 * Edit mode: textarea, Esc to revert, Cmd/Ctrl-Enter to commit,
 * blur to commit.
 *
 * ``displayValue`` lets the caller show LESS than it stores — the read
 * view drops the legacy GEO-record block the rest of the page already
 * renders. The editor always opens on ``value``, the full stored text,
 * so an edit can't silently drop what the read view hid; a note says so
 * when the two differ.
 */
function EditableDescription({
  value,
  displayValue,
  onCommit,
}: {
  value: string;
  displayValue?: string;
  onCommit: (next: string) => void;
}) {
  const readOnly = useIsReadOnly();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const shown = displayValue ?? value;
  const hidesSome = shown !== value;

  const beginEdit = () => {
    if (readOnly) return;
    setDraft(value);
    setEditing(true);
  };

  if (!editing) {
    const paragraphs = shown
      .split(/\n\s*\n/)
      .filter((p) => p.trim());
    const isEmpty = paragraphs.length === 0;
    return (
      <div
        className="relative text-xs text-slate-700 leading-relaxed space-y-1.5 max-h-[24rem] overflow-y-auto rounded px-1 -mx-1 group"
      >
        {isEmpty ? (
          // Empty state — no prose to select; let the whole row act
          // as the affordance.
          <p
            role="button"
            tabIndex={0}
            onClick={beginEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                beginEdit();
              }
            }}
            className="italic text-slate-400 cursor-pointer hover:bg-blue-50/60 dark:hover:bg-slate-700/30 rounded"
            title="click to add description"
          >
            (no description — click to add)
          </p>
        ) : (
          paragraphs.map((p, i) => (
            <p key={i} className="whitespace-pre-wrap">
              {p}
            </p>
          ))
        )}
        {/* Edit affordance — pencil-on-hover that's the actual click
            target. Keeping the surrounding text as plain content so
            curators can select-to-copy without dropping into edit
            mode. Slightly larger hitbox via padding so the pencil
            isn't a 12px-square target. */}
        {!isEmpty ? (
          <button
            type="button"
            onClick={beginEdit}
            title="edit description"
            aria-label="edit description"
            className="absolute top-0 right-0 p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-blue-50/60 dark:hover:bg-slate-700/40 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <PencilIcon className="h-3 w-3" aria-hidden />
          </button>
        ) : null}
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <textarea
        value={draft}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== value) onCommit(draft);
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            (e.target as HTMLTextAreaElement).blur();
          }
        }}
        rows={Math.min(20, Math.max(6, draft.split("\n").length + 1))}
        className="w-full text-xs border border-blue-300 rounded px-2 py-1.5 bg-white leading-relaxed font-sans"
      />
      <div className="text-[10px] text-slate-500">
        ⌘ / Ctrl+Enter to save · Esc to revert
        {hidesSome ? (
          <>
            {" · "}
            <span className="text-slate-400">
              includes the verbatim GEO record block, hidden while reading
              (it repeats the design (GEO), taxon and source rows)
            </span>
          </>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Build the link to a Gemma platform page. Prefer ``shortName=``
 * when available (more readable URLs); fall back to ``id=`` when
 * only the numeric id is set; render plain text when neither.
 */
function renderPlatform(
  display: string,
  shortName: string,
  id: number | null,
): React.ReactNode {
  if (!display) return "—";
  const href = platformPageUrl(shortName || null, id);
  if (!href) return display;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-700 hover:underline"
      title="open the platform on Gemma"
    >
      {display} ↗
    </a>
  );
}


function formatTimestamp(iso: string | undefined): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString([], {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

const GUIDELINE_TOPICS: { label: string; snippet: GuidelineSnippet }[] = [
  { label: "ontologies", snippet: ONTOLOGY_GUIDELINE },
  { label: "free-text", snippet: FREE_TEXT_GUIDELINE },
  { label: "predicates", snippet: PREDICATE_GUIDELINE },
  { label: "statement shapes", snippet: STATEMENT_TEMPLATE_GUIDELINE },
  { label: "baselines", snippet: BASELINE_GUIDELINE },
  { label: "tags", snippet: TAGS_GUIDELINE },
  { label: "developmental stages", snippet: DEV_STAGE_GUIDELINE },
  { label: "derived material", snippet: DERIVED_MATERIAL_GUIDELINE },
  { label: "grafts", snippet: GRAFT_GUIDELINE },
  { label: "pre-publish checklist", snippet: CHECKLIST_GUIDELINE },
];

/**
 * The curation guidelines, behind one control.
 *
 * They were ten chips laid across a full-width card, wrapping onto a
 * second line. They're reference material a curator opens on purpose,
 * not a status line to scan on every page load, so one control is the
 * right footprint.
 *
 * ONE PANEL, TWO LEVELS. The first pass put a `?` badge on each row
 * that opened its own popover — which portalled over the list it came
 * from, so choosing a second topic meant navigating around a panel
 * covering the menu, with a tooltip over that ("this is difficult to
 * navigate — it appears on top of the section header", Paul,
 * 2026-08-16). Stacked popovers are the wrong shape for a list whose
 * whole job is choosing between siblings.
 *
 * So the panel drills down in place: the list swaps to the topic, and a
 * back row swaps it home. One surface, one position, nothing occluded,
 * and the topic gets the panel's full width instead of a second box
 * elbowing in beside it. Selection resets on close so reopening always
 * starts at the list.
 */
function GuidelinesMenu() {
  const [openTopic, setOpenTopic] = useState<string | null>(null);
  const active = GUIDELINE_TOPICS.find((t) => t.label === openTopic) ?? null;
  return (
    <HelpPopup
      title={active ? active.snippet.title : "Curation guidelines"}
      size="lg"
      source={active?.snippet.source}
      sourceUrl={active?.snippet.sourceUrl}
      onOpenChange={(open) => {
        if (!open) setOpenTopic(null);
      }}
      trigger={
        <>
          Guidelines <span aria-hidden>▾</span>
        </>
      }
      triggerClassName="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900 text-xs cursor-pointer dark:bg-slate-800 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
    >
      {active ? (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setOpenTopic(null)}
            className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 bg-transparent border-none cursor-pointer p-0"
          >
            <span aria-hidden>‹</span> All guidelines
          </button>
          <GuidelineSnippetBody snippet={active.snippet} />
        </div>
      ) : (
        // Whole row is the target, not a 16px badge beside it — the
        // label is what a curator is aiming at.
        <ul className="-mx-1">
          {GUIDELINE_TOPICS.map((t) => (
            <li key={t.label}>
              <button
                type="button"
                onClick={() => setOpenTopic(t.label)}
                className="w-full flex items-baseline justify-between gap-3 px-1 py-1 rounded text-left bg-transparent border-none cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700"
              >
                <span>{t.label}</span>
                <span aria-hidden className="text-slate-400">
                  ›
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </HelpPopup>
  );
}
