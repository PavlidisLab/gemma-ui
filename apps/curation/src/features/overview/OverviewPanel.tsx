import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Pencil as PencilIcon } from "lucide-react";
import { useDesignDraft } from "@/features/design/DesignDraftContext";
import { useProposalsForExperiment } from "@/api/proposals";
import { usePubmedMetadata } from "@/api/pubmed";
import { GuidelinePopup } from "@/components/ui/GuidelinePopup";
import { HelpPopup } from "@/components/ui/HelpPopup";
import { Tooltip } from "@/components/ui/Tooltip";
import { CategoryPicker } from "@/features/design/CategoryPicker";
import { OntologyTermPicker } from "@/features/design/OntologyTermPicker";
import { useIsReadOnly } from "@/features/comparison/FlowContext";
import {
  extractPaperMeta,
  pmidFromPaperSource,
} from "@/features/proposal/paperEvidence";
import {
  isPaperDismissed,
  markPaperDismissed,
} from "@/features/proposal/paperDismissal";
import { platformPageUrl } from "@/lib/gemmaUrls";
import { FindPublicationButton } from "./FindPublicationButton";
import { augmentInferredFromBiomaterials } from "./augmentInferred";
import { augmentInferredFromFactors } from "./augmentFactorTags";
import { shortenUri } from "@/lib/curie";
import { cn } from "@/lib/cn";
import { ONTOLOGY_ANCHOR_CLS } from "@/lib/ontologyAnchor";
import {
  addPublication,
  addTag,
  deletePublication,
  deleteTag,
  setDesignDescription,
  setTagCategory,
  setTagValue,
} from "@/features/design/mutations";
import {
  ONTOLOGY_GUIDELINE,
  FREE_TEXT_GUIDELINE,
  PREDICATE_GUIDELINE,
  BASELINE_GUIDELINE,
  TAGS_GUIDELINE,
  CHECKLIST_GUIDELINE,
} from "@/lib/guidelines";
import type {
  Biomaterial,
  Design,
  Factor,
  OntologyTerm,
  Publication,
  Tag,
} from "@/features/experiment/types";
import { isProtectedTagCategory } from "@/features/experiment/types";
import { AuditDot } from "@/features/audit/AuditDot";
import { experimentTarget, factorTarget, tagTarget } from "@/features/audit/targetIds";
import {
  focusByAuditTarget,
  onAuditFocusTarget,
  requestAuditFocus,
} from "@/lib/scrollToAuditTarget";

/**
 * Read-only experiment summary — title, abstract / description,
 * taxon + assay + platform, source links, publications, sample
 * counts. The banner is kept compact for space; the prose lives
 * here so the curator has somewhere to read the abstract before
 * digging into the design.
 */
export function OverviewPanel({
  displayOverride,
}: {
  /** When provided, the panel renders against this Design (a chip
   *  source's snapshot) instead of the live editable draft. Used by
   *  the curation comparison view's chip strip in review mode — the
   *  curator wants to see what cy/am/preboard ACTUALLY has, not the
   *  uncommitted draft. Caller must also be in review mode (the
   *  panel doesn't disable its own edit affordances; the fieldset
   *  wrapper at the call site handles that). */
  displayOverride?: Design | null;
} = {}) {
  const live = useDesignDraft();
  const apply = live.apply;
  const isLoading = live.isLoading;
  const loadError = live.loadError;
  // ``draft`` here is the DISPLAYED design; mutations still target
  // the live draft via ``apply`` (gated by the call-site fieldset in
  // review mode).
  const draft = displayOverride ?? live.draft;

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
      <div className="card px-3 py-1.5 flex items-center gap-3 flex-wrap text-xs text-slate-600">
        <span className="font-semibold text-slate-700">Curation guidelines:</span>
        <span className="inline-flex items-center gap-1">
          ontologies <GuidelinePopup snippet={ONTOLOGY_GUIDELINE} size="md" />
        </span>
        <span className="inline-flex items-center gap-1">
          free-text <GuidelinePopup snippet={FREE_TEXT_GUIDELINE} size="md" />
        </span>
        <span className="inline-flex items-center gap-1">
          predicates <GuidelinePopup snippet={PREDICATE_GUIDELINE} size="md" />
        </span>
        <span className="inline-flex items-center gap-1">
          baselines <GuidelinePopup snippet={BASELINE_GUIDELINE} size="md" />
        </span>
        <span className="inline-flex items-center gap-1">
          tags <GuidelinePopup snippet={TAGS_GUIDELINE} size="md" />
        </span>
        <span className="inline-flex items-center gap-1">
          pre-publish checklist{" "}
          <GuidelinePopup snippet={CHECKLIST_GUIDELINE} size="md" align="right" />
        </span>
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
/** Legend body for the Design card's `?` popover. Covers the
 *  crosstab semantics, batch-confound warning, and sort behaviour. */
function DesignCardLegend() {
  return (
    <div className="space-y-2 text-[11px]">
      <div>
        <div className="font-medium text-slate-700 dark:text-slate-200 mb-1">
          The crosstab
        </div>
        <p className="text-slate-600 dark:text-slate-400">
          Each row is one unique combination of factor values across the
          design's categorical factors. <span className="font-mono">Assays</span>{" "}
          counts biomaterials in that cell. Click any header to sort.
        </p>
      </div>
      <div className="pt-1 border-t border-slate-100 dark:border-slate-800">
        <div className="font-medium text-slate-700 dark:text-slate-200 mb-1">
          Row colour
        </div>
        <ul className="list-disc list-inside space-y-0.5 text-slate-600 dark:text-slate-400">
          <li>
            <span className="text-rose-700 italic">(unassigned)</span> — at
            least one biomaterial isn't covered by any FV in that factor;
            usually a curation gap.
          </li>
        </ul>
      </div>
      <div className="pt-1 border-t border-slate-100 dark:border-slate-800">
        <div className="font-medium text-slate-700 dark:text-slate-200 mb-1">
          Warnings strip
        </div>
        <ul className="list-disc list-inside space-y-0.5 text-slate-600 dark:text-slate-400">
          <li>
            <span className="px-1 rounded bg-amber-100 text-violet-900 border border-amber-300 font-medium">
              ⚠ batch confound
            </span>{" "}
            — a block/batch factor partitions samples identically to
            another factor. The batch effect can't be separated from
            that factor's effect in DEA.
          </li>
          <li>
            <span className="italic">continuous not shown</span> —
            continuous factors (e.g. age in months) carry per-sample
            numerics, so they don't fit a row-per-FV-combination layout.
          </li>
        </ul>
      </div>
      <div className="pt-1 border-t border-slate-100 dark:border-slate-800">
        <div className="font-medium text-slate-700 dark:text-slate-200 mb-1">
          Nuisance factors
        </div>
        <p className="text-slate-600 dark:text-slate-400">
          Factors whose name contains <span className="font-mono">block</span>{" "}
          or <span className="font-mono">batch</span> are treated as
          nuisance: they don't get a column in the crosstab (and don't
          contribute to the row tuples) but do feed the confound check.
        </p>
      </div>
    </div>
  );
}

function DesignSummary({
  factors,
  biomaterials,
  nTags,
}: {
  factors: Factor[];
  biomaterials: Biomaterial[];
  nTags: number;
}) {
  const NUISANCE_KEYWORDS = ["block", "batch"];
  const isNuisance = (f: Factor) => {
    const cat = (f.category?.label || f.name || "").toLowerCase();
    return NUISANCE_KEYWORDS.some((kw) => cat.includes(kw));
  };
  const isContinuous = (f: Factor) => f.type === "continuous";

  const standard = factors.filter((f) => !isNuisance(f) && !isContinuous(f));
  const continuous = factors.filter((f) => isContinuous(f));
  const nuisance = factors.filter((f) => isNuisance(f));

  // Build the crosstab. For each biomaterial we compute a tuple of
  // FV labels across the standard factors; identical tuples
  // collapse into one row with a count. Unassigned samples (no FV
  // claims them in some factor) get an "(unassigned)" label so they
  // surface as a row instead of being silently dropped — that's
  // usually a curation gap worth seeing.
  const rows = useMemo(() => {
    if (standard.length === 0 || biomaterials.length === 0) return [];
    const buckets = new Map<string, { values: string[]; count: number }>();
    for (const bm of biomaterials) {
      const tuple: string[] = [];
      for (const f of standard) {
        const fv = f.factor_values.find((v) =>
          (v.biomaterial_short_names ?? []).includes(bm.short_name),
        );
        tuple.push(
          fv
            ? fv.free_text_label ||
                fv.statements?.[0]?.subject?.label ||
                "(unlabelled FV)"
            : "(unassigned)",
        );
      }
      const key = tuple.join("");
      const existing = buckets.get(key);
      if (existing) existing.count++;
      else buckets.set(key, { values: tuple, count: 1 });
    }
    // Stable order: sort rows by tuple for deterministic display.
    return Array.from(buckets.values()).sort((a, b) =>
      a.values.join(" / ").localeCompare(b.values.join(" / ")),
    );
  }, [standard, biomaterials]);

  // Column sort. ``null`` keeps the deterministic default (tuple
  // lexicographic) so curators see a stable layout until they
  // explicitly sort. ``"assays"`` sorts by the count column;
  // numeric indices sort by that factor column's cell value.
  // Click an active column to flip direction; click again to clear
  // back to default.
  const [sort, setSort] = useState<
    { col: "assays" | number; dir: "asc" | "desc" } | null
  >(null);
  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const sign = sort.dir === "asc" ? 1 : -1;
    const cmp = (
      a: { values: string[]; count: number },
      b: { values: string[]; count: number },
    ) => {
      if (sort.col === "assays") return (a.count - b.count) * sign;
      return a.values[sort.col].localeCompare(b.values[sort.col]) * sign;
    };
    return [...rows].sort(cmp);
  }, [rows, sort]);
  const onSortClick = (col: "assays" | number) => {
    setSort((cur) => {
      if (!cur || cur.col !== col) return { col, dir: "asc" };
      if (cur.dir === "asc") return { col, dir: "desc" };
      return null;
    });
  };
  const sortArrow = (col: "assays" | number): string => {
    if (!sort || sort.col !== col) return "";
    return sort.dir === "asc" ? " ▲" : " ▼";
  };

  // Column header: just the factor's display name. The previous
  // "factor (val1 vs val2 vs +N)" form blew the header to 100+
  // characters — fine on a one-factor design, unworkable on three.
  // The FV labels are visible directly under the header in each
  // row's cells; the full vs-list lives in the column's tooltip
  // for the curator who wants the at-a-glance summary.
  const factorHeader = (f: Factor): string =>
    f.name || f.category?.label || "(factor)";

  const factorHeaderTooltip = (f: Factor): string => {
    const labels = (f.factor_values ?? []).map(
      (fv) =>
        fv.free_text_label ||
        fv.statements?.[0]?.subject?.label ||
        "(unlabelled)",
    );
    const namePart = f.name || f.category?.label || "(factor)";
    const valuesPart =
      labels.length > 0 ? `\nlevels: ${labels.join(" · ")}` : "";
    const descPart = f.description ? `\n${f.description}` : "";
    const uriPart = f.category?.uri ? `\n${f.category.uri}` : "";
    return `${namePart}${valuesPart}${descPart}${uriPart}`;
  };

  // Cohort numbers — moved here from the retired Cohort card. Lives
  // at the top of the Design view because that's where curators are
  // checking "is this design covering all the samples?".
  const fvTotal = factors.reduce((n, f) => n + f.factor_values.length, 0);
  const nBioAssays = biomaterials.reduce(
    (n, b) => n + (b.bio_assays?.length ?? 0),
    0,
  );

  // Batch-confound detection. A batch / block factor is "confounded"
  // with a standard factor when every batch level contains exactly
  // one level of that factor — the batch effect can't be separated
  // from the factor's effect.
  const confound = useMemo(
    () => detectBatchConfound(nuisance, standard, biomaterials),
    [nuisance, standard, biomaterials],
  );

  if (factors.length === 0) {
    return (
      <SummaryCard label="Design" className="md:col-span-2">
        <p className="text-[11px] text-slate-500 italic">
          No factors curated yet. The Design tab is where factors are
          built; agent proposals land there too.
        </p>
      </SummaryCard>
    );
  }

  return (
    <SummaryCard
      label="Design"
      className="md:col-span-2"
      help={<DesignCardLegend />}
    >
      {/* Cohort numbers + design warnings strip. Holds the four
          counts that used to live in a dedicated Cohort card plus
          the existing batch-confound / continuous-not-shown notes
          — all the "by-the-numbers" cues for the design at a
          glance. */}
      <div className="mb-2 flex items-baseline gap-3 flex-wrap text-[11px] text-slate-600">
        <span>
          <span className="font-mono font-medium text-slate-800">
            {biomaterials.length}
          </span>{" "}
          biomaterial{biomaterials.length === 1 ? "" : "s"}
        </span>
        {nBioAssays !== biomaterials.length ? (
          <span>
            <span className="font-mono font-medium text-slate-800">
              {nBioAssays}
            </span>{" "}
            bio_assays
          </span>
        ) : null}
        <span>
          <span className="font-mono font-medium text-slate-800">
            {factors.length}
          </span>{" "}
          factor{factors.length === 1 ? "" : "s"} /{" "}
          <span className="font-mono font-medium text-slate-800">{fvTotal}</span>{" "}
          FV{fvTotal === 1 ? "" : "s"}
        </span>
        <span>
          <span className="font-mono font-medium text-slate-800">{nTags}</span>{" "}
          tag{nTags === 1 ? "" : "s"}
        </span>
        {confound ? (
          <span
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-100 text-violet-900 border border-amber-300 font-medium"
            title={
              `Batch / block factor "${confound.batch.name || confound.batch.category?.label}" ` +
              `partitions samples identically to "${confound.with.name || confound.with.category?.label}". ` +
              "The batch effect can't be separated from the factor's effect in DEA."
            }
          >
            ⚠ batch confound
          </span>
        ) : null}
        {continuous.length > 0 ? (
          <span className="text-slate-500">
            Continuous factor{continuous.length > 1 ? "s" : ""} not shown in
            this view ({continuous
              .map((f) => f.name || f.category?.label)
              .join(", ")}).
          </span>
        ) : null}
      </div>

      {standard.length === 0 ? (
        <p className="text-[11px] text-slate-500 italic">
          No categorical factors of interest. {nuisance.length > 0
            ? `${nuisance.length} nuisance factor${nuisance.length === 1 ? "" : "s"} present (block / batch).`
            : ""}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="text-xs border-collapse w-full">
            <thead>
              <tr className="bg-slate-50 text-slate-700">
                <th
                  className="px-2 py-1.5 text-left border border-slate-200 font-medium w-16 cursor-pointer select-none hover:bg-slate-100"
                  onClick={() => onSortClick("assays")}
                  title="click to sort by assay count"
                  aria-sort={
                    sort?.col === "assays"
                      ? sort.dir === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                >
                  Assays{sortArrow("assays")}
                </th>
                {standard.map((f, colIdx) => (
                  <th
                    key={f.id}
                    className="px-2 py-1.5 text-left border border-slate-200 font-medium cursor-pointer select-none hover:bg-slate-100"
                    onClick={() => onSortClick(colIdx)}
                    title={`${factorHeaderTooltip(f)}\n\n(click to sort)`}
                    aria-sort={
                      sort?.col === colIdx
                        ? sort.dir === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    {factorHeader(f)}
                    {sortArrow(colIdx)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row, i) => (
                <tr key={i}>
                  <td className="px-2 py-1 border border-slate-200 font-mono text-slate-700">
                    {row.count}
                  </td>
                  {row.values.map((v, j) => (
                    <td
                      key={j}
                      className={
                        "px-2 py-1 border border-slate-200 " +
                        (v === "(unassigned)"
                          ? "text-rose-700 italic"
                          : "text-slate-700")
                      }
                    >
                      {v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {nuisance.length > 0 ? (
        <div className="mt-2 text-[11px] text-slate-600">
          Nuisance / covariate factor{nuisance.length > 1 ? "s" : ""}:{" "}
          {nuisance
            .map((f) => {
              const k = (f.factor_values ?? []).length;
              return `${f.name || f.category?.label} (${k} level${k === 1 ? "" : "s"})`;
            })
            .join(", ")}
          .
        </div>
      ) : null}
    </SummaryCard>
  );
}

/**
 * Detect a confounded batch / block factor. A nuisance factor is
 * confounded with a standard factor when every nuisance level
 * contains exactly one level of the standard factor — i.e. the
 * batch perfectly predicts the factor, so the two effects can't be
 * separated in DEA. Returns the first confound found, or null.
 */
function detectBatchConfound(
  nuisance: Factor[],
  standard: Factor[],
  biomaterials: Biomaterial[],
): { batch: Factor; with: Factor } | null {
  if (nuisance.length === 0 || standard.length === 0) return null;
  // Map biomaterial → FV label per factor.
  const fvByFactor = (f: Factor): Map<string, string> => {
    const out = new Map<string, string>();
    for (const fv of f.factor_values ?? []) {
      const label =
        fv.free_text_label ||
        fv.statements?.[0]?.subject?.label ||
        `fv:${fv.id}`;
      for (const sn of fv.biomaterial_short_names ?? []) {
        out.set(sn, label);
      }
    }
    return out;
  };
  for (const batch of nuisance) {
    const batchMap = fvByFactor(batch);
    if (batchMap.size === 0) continue;
    for (const f of standard) {
      const fMap = fvByFactor(f);
      // For each batch level, collect the set of standard-factor
      // levels its samples carry. Confound = every batch level has
      // exactly one standard-factor level (and at least 2 batch
      // levels — otherwise the confound is trivial).
      const levelsByBatch = new Map<string, Set<string>>();
      for (const bm of biomaterials) {
        const b = batchMap.get(bm.short_name);
        const v = fMap.get(bm.short_name);
        if (b === undefined || v === undefined) continue;
        const s = levelsByBatch.get(b) ?? new Set<string>();
        s.add(v);
        levelsByBatch.set(b, s);
      }
      if (levelsByBatch.size < 2) continue;
      const confounded = [...levelsByBatch.values()].every(
        (s) => s.size === 1,
      );
      // Also require that the standard factor itself has ≥2 levels
      // observed across the cohort (otherwise the "confound" is
      // just that the factor doesn't vary).
      const observedFLevels = new Set<string>();
      for (const v of fMap.values()) observedFLevels.add(v);
      if (confounded && observedFLevels.size >= 2) {
        return { batch, with: f };
      }
    }
  }
  return null;
}

/**
 * Compact tag chip strip — mirrors Gemma's experiment header tag
 * row. Direct curator-attached tags render green individually;
 * inferred tags (bubbled up from sample characteristics / FV
 * statements) group by category in yellow chips that expand on
 * click when a category has >1 value (e.g. 20 cell types).
 * Read-only — the Tags tab is where curators edit.
 */
/** Inferred-tag categories that pollute the panel without informing
 *  the curator.
 *
 *  - ``individual`` ships as a sample-id list (e.g. ``101, 102, 103,
 *    …``) that swamps the bar.
 *  - ``labelling`` / ``labeling`` is almost always ``biotin`` on
 *    legacy Affymetrix arrays — universal, uninformative, noise. (If
 *    a curator ever attaches it as a *direct* tag, that's an
 *    explicit choice and stays visible — only the inferred form is
 *    filtered.) */
const INFERRED_HIDE_CATEGORIES = new Set<string>([
  "individual",
  "labelling",
  "labeling",
]);

/** Reproducible-position grouping for tag chips. The TagBar's flat
 *  row was unscannable on heavily-tagged experiments (20+ chips of
 *  mixed semantics in one wrap). Categories now bucket into themed
 *  rows so curators always look in the same spot for the same kind
 *  of annotation:
 *
 *    - assay            → modality / technology / analyte
 *    - condition        → disease / treatment / exposure
 *    - sample source    → where the sample came from (organism part,
 *                         cell type, BioSource)
 *    - subject features → properties of the subject (sex, age,
 *                         strain, genotype, ancestry, …)
 *    - admin            → sample identifiers / replicate structure
 *
 *  Anything not in the explicit lists falls into ``other``, which
 *  renders last. Lookups are lowercase + trimmed; both the singular
 *  and the British / American spellings live in the same set when
 *  Gemma's catalogue carries both.
 *
 *  Order of declaration here is the on-screen row order. */
type TagGroupKey =
  | "assay"
  | "condition"
  | "sample_source"
  | "subject_features"
  | "admin"
  | "other";

const TAG_GROUP_LABEL: Record<TagGroupKey, string> = {
  assay: "assay",
  condition: "condition",
  sample_source: "sample source",
  subject_features: "subject features",
  admin: "admin",
  other: "other",
};

const TAG_GROUP_ORDER: TagGroupKey[] = [
  "assay",
  "condition",
  "sample_source",
  "subject_features",
  "admin",
  "other",
];

const TAG_CATEGORY_TO_GROUP: Record<string, TagGroupKey> = {
  // assay
  assay: "assay",
  modality: "assay",
  technology: "assay",
  "molecular entity": "assay",
  analyte: "assay",
  library: "assay",
  "library strategy": "assay",
  "library selection": "assay",
  // condition
  disease: "condition",
  treatment: "condition",
  exposure: "condition",
  intervention: "condition",
  "culture condition": "condition",
  perturbation: "condition",
  // sample source — where the cells / tissue came from
  "organism part": "sample_source",
  "cell type": "sample_source",
  "cell line": "sample_source",
  biosource: "sample_source",
  source: "sample_source",
  // subject features — properties of the donor / model organism
  "biological sex": "subject_features",
  sex: "subject_features",
  age: "subject_features",
  "developmental stage": "subject_features",
  "life stage": "subject_features",
  population: "subject_features",
  ancestry: "subject_features",
  ethnicity: "subject_features",
  strain: "subject_features",
  "background strain": "subject_features",
  genotype: "subject_features",
  // admin (sample-management identifiers + replicate structure)
  "author sample id": "admin",
  "author reference id": "admin",
  "biological replicate": "admin",
  "technical replicate": "admin",
  "sample group": "admin",
  donor: "admin",
  subject: "admin",
};

function tagGroup(category: string | undefined | null): TagGroupKey {
  const k = (category || "").trim().toLowerCase();
  return TAG_CATEGORY_TO_GROUP[k] ?? "other";
}

/** Legend body for the TagBar's `?` popover. Mirrors the live chip
 *  shape (single-frame, palette = source, weight + italic = resolved
 *  vs free-text) so the legend can't drift from what curators
 *  actually see. */
function TagBarLegend() {
  const Sample = ({
    palette,
    val,
    italic,
  }: {
    palette: keyof typeof TAG_PALETTE;
    val: string;
    italic?: boolean;
  }) => {
    const p = TAG_PALETTE[palette];
    return (
      <span
        className={`inline-flex items-baseline px-1.5 py-0.5 text-[11px] rounded border ${p.outer}`}
      >
        <span
          className={italic ? "italic opacity-80" : "font-medium"}
        >
          {val}
        </span>
      </span>
    );
  };
  return (
    <div className="space-y-2 text-[11px]">
      <div className="font-medium text-slate-700 dark:text-slate-200">
        Border colour = where the tag came from
      </div>
      <div className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1.5 items-center">
        <Sample palette="direct" val="female" />
        <span>
          <span className="font-medium">Direct</span> — curator-attached.
          Click to edit / delete.
        </span>
        <Sample palette="fv" val="LPS" />
        <span>
          <span className="font-medium">FV-synth</span> — derived from a
          Factor Value on the Design tab. Edit on Design.
        </span>
        <Sample palette="bm" val="brain" />
        <span>
          <span className="font-medium">BM-synth</span> — pulled from raw
          biomaterial characteristics (Gemma's GEO import).
        </span>
        <Sample palette="mixed" val="microglial cell" />
        <span>
          <span className="font-medium">Mixed</span> — the category
          surfaces from more than one source.
        </span>
      </div>
      <div className="pt-1 border-t border-slate-100 dark:border-slate-800">
        <div className="font-medium text-slate-700 dark:text-slate-200 mb-1">
          Typography = whether the value is anchored
        </div>
        <div className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1.5 items-center">
          <Sample palette="bm" val="brain" />
          <span>
            <span className="font-medium">Medium weight</span> —
            ontology-resolved. Click to reveal the CURIE inline; click
            the <span className="font-mono">↗</span> to open the term
            page in a new tab.
          </span>
          <Sample palette="bm" val="Laser captured…" italic />
          <span>
            <span className="italic">Italic</span> — free text, no
            ontology URI yet.
          </span>
        </div>
      </div>
      <div className="pt-1 border-t border-slate-100 dark:border-slate-800">
        <div className="font-medium text-slate-700 dark:text-slate-200 mb-1">
          Other details
        </div>
        <ul className="list-disc list-inside space-y-0.5 text-slate-600 dark:text-slate-400">
          <li>
            Category, source name, CURIE, evidence code, and full value
            text all live in the chip's <span className="italic">hover
            tooltip</span> — kept off the chip face to cut visual noise.
          </li>
          <li>
            Bracketed qualifiers like{" "}
            <span className="font-mono">M0 [Cells grown in…]</span> are
            stripped from the chip face; hover for the full text.
          </li>
          <li>
            Multi-value chips collapse as{" "}
            <span className="font-mono">N ▸ val, val +N more</span>.
            Click to expand.
          </li>
        </ul>
      </div>
    </div>
  );
}

/** Compact factor chips for the overview header — one small sky-tinted
 *  card per factor. Mirrors the audit sidebar's factor-card tint so
 *  curator and non-curator views read the same "this is a factor"
 *  signal. Clicking jumps to the Design tab with that factor focused.
 *
 *  Renders one row positioned right after ``sample source`` in the
 *  TagBar so the structural design surface is visible alongside the
 *  tag annotations. Per Paul 2026-05-21: factors used to render
 *  somewhere in the overview area as blue cards; this restores them
 *  as a dedicated row below SAMPLE SOURCE.
 */
function FactorsRow({
  factors,
  experimentId,
}: {
  factors: Factor[];
  experimentId: number | string;
}) {
  if (factors.length === 0) return null;
  return (
    <div className="flex items-baseline gap-2 flex-wrap pl-2 py-0.5">
      <span
        className="text-[10px] uppercase tracking-wide text-slate-500 mr-1 min-w-[5.5rem]"
        title="experimental design factors — categorical axes of the study"
      >
        factors
      </span>
      {factors.map((f) => (
        <FactorChip key={f.id} factor={f} experimentId={experimentId} />
      ))}
    </div>
  );
}

/** Rich tooltip body for a FactorChip hover. Categorical factors
 *  get a bulleted FV list (baselines sorted to the END); continuous
 *  factors get a numeric range or sample-count summary. Rendered
 *  through the styled ``Tooltip`` portal — small enough to scan, big
 *  enough to enumerate a 6-level cohort without overflow. */
function FactorChipTooltipBody({ factor }: { factor: Factor }) {
  const label = factor.category?.label || factor.name || "factor";
  const fvs = factor.factor_values ?? [];
  const isContinuous = factor.type === "continuous";

  let rangeText: string | null = null;
  if (isContinuous && fvs.length > 0) {
    const numericVals = fvs
      .map((fv) => Number((fv.free_text_label || "").trim()))
      .filter((n) => Number.isFinite(n));
    if (numericVals.length > 0) {
      const lo = Math.min(...numericVals);
      const hi = Math.max(...numericVals);
      rangeText =
        lo === hi
          ? `value ${lo} · ${numericVals.length} samples`
          : `range ${lo} – ${hi} · ${fvs.length} samples`;
    } else {
      rangeText = `${fvs.length} sample value${fvs.length === 1 ? "" : "s"}`;
    }
  }

  const sortedFvs = isContinuous
    ? []
    : [...fvs].sort(
        (a, b) => (a.is_baseline ? 1 : 0) - (b.is_baseline ? 1 : 0),
      );

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline gap-1.5">
        <span className="font-semibold text-sky-300">{label}</span>
        <span className="text-[10px] uppercase tracking-wide text-slate-400">
          {isContinuous
            ? "continuous"
            : `${fvs.length} level${fvs.length === 1 ? "" : "s"}`}
        </span>
      </div>
      {rangeText ? (
        <div className="text-[11px] text-slate-200 font-mono">{rangeText}</div>
      ) : null}
      {sortedFvs.length > 0 ? (
        <ul className="space-y-0.5">
          {sortedFvs.map((fv) => {
            const lab = (fv.free_text_label || "").trim() || "(unlabeled)";
            const n = fv.biomaterial_short_names?.length ?? 0;
            return (
              <li
                key={fv.id}
                className="flex items-baseline gap-1.5 text-[11px]"
              >
                <span
                  className={cn(
                    "w-2.5 inline-block text-center shrink-0 leading-none",
                    fv.is_baseline
                      ? "text-amber-400"
                      : "text-sky-300/80 dark:text-sky-400/80",
                  )}
                  title={
                    fv.is_baseline
                      ? "baseline (reference level)"
                      : "factor level"
                  }
                >
                  {fv.is_baseline ? "▂" : "○"}
                </span>
                <span className="flex-1 min-w-0 break-words">{lab}</span>
                {n > 0 ? (
                  <span className="text-[10px] text-slate-400 font-mono shrink-0">
                    {n}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      <div className="text-[10px] text-slate-400 italic pt-0.5">
        Click to focus in the Design tab →
      </div>
    </div>
  );
}

function FactorChip({
  factor,
  experimentId,
}: {
  factor: Factor;
  experimentId: number | string;
}) {
  const label = factor.category?.label || factor.name || "factor";
  const fvCount = factor.factor_values?.length ?? 0;
  const isContinuous = factor.type === "continuous";
  return (
    <Tooltip label={<FactorChipTooltipBody factor={factor} />}>
      <button
        type="button"
        onClick={() =>
          // Jump to the Design tab and focus this factor — reuses
          // the audit-focus event channel so the Shell handles tab
          // switch + scroll-into-view + ring-flash.
          requestAuditFocus(experimentId, `factor:${label.toLowerCase()}`)
        }
        className={cn(
          "inline-flex items-baseline gap-1 px-1.5 py-0.5 rounded border text-[11px]",
          "bg-sky-50 border-sky-300 text-sky-900",
          "dark:bg-sky-900/40 dark:border-sky-700 dark:text-sky-100",
          "hover:bg-sky-100 dark:hover:bg-sky-900/50 transition-colors",
        )}
      >
        <span className="font-medium">{label}</span>
        <span className="text-[10px] text-sky-700/80 dark:text-sky-300/80">
          {isContinuous ? "cont." : `(${fvCount})`}
        </span>
      </button>
    </Tooltip>
  );
}

function TagBar({
  tags,
  biomaterials,
  experimentId,
}: {
  tags: Tag[];
  biomaterials: Biomaterial[];
  /** Experiment id, threaded down to FV-synth chips so their ``ƒ``
   *  glyph can dispatch a Shell focus request to jump to the Design
   *  tab with that factor highlighted. */
  experimentId: number | string;
}) {
  const { draft, apply, diff } = useDesignDraft();
  // Review-mode lock: only the "+ tag" + chip remove + ChipEditor
  // mutate state. Expand/collapse, legend popup, and chip select
  // stay live so the curator can still read.
  const tagReadOnly = useIsReadOnly();
  const [adding, setAdding] = useState(false);
  // Set of tag ids that exist in the draft but not the saved server
  // state — these are uncommitted additions. Threaded down to the
  // chip render so the curator can see at a glance what they've
  // added but not yet committed. ``Tag.id`` is assigned by the
  // mutation helpers (addTag) at insertion time, so it's stable
  // across draft edits.
  const addedTagIds = useMemo(
    () => new Set(diff.tags.added.map((t) => t.id)),
    [diff.tags.added],
  );

  // Build a (category-label, value-label) → URI lookup from
  // ``biomaterial.characteristic_uris``. Used to recover the URI
  // on a tag value that came in as part of a comma-joined synth
  // (Gemma sometimes returns ``biological sex: "female, male"``
  // as one tag with URI null; the underlying per-sample
  // characteristic still has PATO terms attached). When the
  // split value matches a biomaterial characteristic, the URI
  // flows through and the value renders ontology-resolved.
  const charUriLookup = useMemo(() => buildCharUriLookup(biomaterials), [
    biomaterials,
  ]);

  // Build a (category-label, fv-label) → URI lookup from the draft's
  // factor value statements. FV-synth tags have comma-joined value
  // labels whose parts are CL/EFO terms, but charUriLookup only covers
  // biomaterial characteristics. This covers the gap so e.g.
  // "long term hematopoietic stem cell" resolves to its CL URI.
  const fvUriLookup = useMemo(() => {
    const map = new Map<string, string>();
    for (const factor of draft?.factors ?? []) {
      const catKey = (factor.category?.label || factor.name || "").trim().toLowerCase();
      for (const fv of factor.factor_values) {
        const label = (fv.free_text_label || "").trim().toLowerCase();
        if (!label) continue;
        for (const s of fv.statements) {
          const uri = s.subject?.uri;
          if (uri) {
            const k = `${catKey}|${label}`;
            if (!map.has(k)) map.set(k, uri);
            break;
          }
        }
      }
    }
    return map;
  }, [draft?.factors]);

  // (category-label, fv-label) → is_baseline lookup. Used to sort
  // baseline FVs to the END of a multi-value chip's preview — the
  // baseline is the implicit reference (mock / control / vehicle),
  // and the interesting comparison values should land first in
  // limited preview space (per Paul, 2026-05-17).
  const baselineLookup = useMemo(() => {
    const set = new Set<string>();
    for (const factor of draft?.factors ?? []) {
      const catKey = (factor.category?.label || factor.name || "").trim().toLowerCase();
      for (const fv of factor.factor_values) {
        if (!fv.is_baseline) continue;
        const label = (fv.free_text_label || "").trim().toLowerCase();
        if (!label) continue;
        set.add(`${catKey}|${label}`);
      }
    }
    return set;
  }, [draft?.factors]);

  // Augment inferred tags from ``biomaterial.characteristics`` —
  // Gemma's annotation feed ships only one row per dataset for a
  // BM-source category, so a 6-region cohort surfaces only one
  // organism part. The biomaterials carry the full set; we walk
  // them and build a synth chip per category that captures every
  // distinct value across the cohort.
  //
  // Then layer the FV-projected synth chips from ``draft.factors``:
  // one chip per factor with the factor's FV labels comma-joined as
  // the value. Used to come from agents-side
  // ``import_from_gemma.py`` step 4a; that synthesis was retired on
  // 2026-06-10 (handoff
  // ``HANDOFF_2026-06-10_REMOVE_FV_TAG_PROJECTION.md``) because it
  // inflated eval F1 baselines as a factor-as-tag projection
  // artifact. The UI re-synthesises locally so the downstream dedup
  // (FV-synth wins over direct EE tags for the same category) keeps
  // working without any further changes here.
  const augmentedTags = useMemo(
    () =>
      augmentInferredFromFactors(
        augmentInferredFromBiomaterials(tags, biomaterials),
        draft?.factors ?? [],
      ),
    [tags, biomaterials, draft?.factors],
  );

  // Drop block / batch tags here — they're nuisance variables
  // (date_run codes, scan-batch ids, …) and a single batch
  // factor with 11+ levels swamps the bar. The batch factor
  // itself still shows on the Design tab; the curator doesn't
  // need to see every level on the overview header.
  const visibleTags = augmentedTags.filter((t) => {
    const cat = (t.category.label || "").trim().toLowerCase();
    if (cat === "block" || cat === "batch") return false;
    if (t.inferred && INFERRED_HIDE_CATEGORIES.has(cat)) return false;
    return true;
  });

  // FV-source synth tags (one per factor, FV labels comma-joined)
  // are the canonical representation of a factor category. Direct
  // experiment-level tags for the same category duplicate that
  // information — e.g. GSE208707 ships 8 ``cell type: <X>`` direct
  // tags AND a ``cell type: <all 8 joined>`` synth tag from the
  // ``cell type`` factor. Hide the direct tags in those cases; the
  // factor IS the encoding.
  const fvSynthCats = new Set(
    visibleTags
      .filter((t) => t.inferred && t.inferred_source === "FactorValue")
      .map((t) => (t.category.label || t.category.uri || "").toLowerCase()),
  );
  const direct = visibleTags.filter((t) => {
    if (t.inferred) return false;
    const k = (t.category.label || t.category.uri || "").toLowerCase();
    return !fvSynthCats.has(k);
  });
  const inferred = visibleTags.filter((t) => t.inferred);

  // Dedup direct + inferred chips. Two rules, applied together
  // within each tag-group row (so an "organism part: microglial
  // cell" chip and a "cell type: microglial cell" chip both
  // landing in ``sample_source`` collapse to one):
  //
  //   1. Same ontology term (same URI) — redundant; keep the
  //      higher-priority chip. Direct > biomaterial-synth >
  //      FV-synth > anything-else.
  //   2. Free-text duplicate of a resolved ontology term — when
  //      a chip with a URI exists for the same value-label in the
  //      same group, drop the free-text duplicate. Ontology-
  //      resolved chips win because they carry the verifiable
  //      identity. Per Paul 2026-05-21: "ontology terms are the
  //      best, so just hide free text ones, and same-ontology-
  //      term are redundant."
  //
  // The dedup runs across direct + inferred together so a direct
  // free-text "microglial cell" can be hidden by an inferred URI-
  // bearing "microglial cell" within the same row, and vice versa.
  const groupKeyOf = (t: Tag): string => tagGroup(t.category.label) as string;
  const valLabelLc = (t: Tag) => (t.value.label || "").trim().toLowerCase();
  const sourceRank = (t: Tag): number => {
    if (!t.inferred) return 0;
    if (t.inferred_source === "BioMaterial") return 1;
    if (t.inferred_source === "FactorValue") return 2;
    return 3;
  };
  // Effective URI: prefer the tag's own ``value.uri``; fall back to
  // the biomaterial characteristic URI lookup (synth tags built by
  // ``augmentInferredFromBiomaterials`` ship with null URIs because
  // the augmenter doesn't carry them; the URI is recovered at chip-
  // render time via ``splitTagValues``). Without this fallback,
  // dedup-by-URI misses the case where two synth tags built from
  // different BM characteristic columns map to the same ontology
  // term — Paul 2026-06-12: "redundant terms should be hidden; this
  // is coming from two separate biomaterial char columns"
  // (``BioSource: microglial cell CL:0000129`` +
  // ``organism part: microglial cell CL:0000129``).
  const effectiveUri = (t: Tag): string | null => {
    if (t.value.uri) return t.value.uri;
    const catKey = (t.category.label || "").trim().toLowerCase();
    const valKey = (t.value.label || "").trim().toLowerCase();
    return charUriLookup.get(`${catKey}|${valKey}`) ?? null;
  };
  // Canonical-category preference: when two tags in the same row
  // resolve to the same effective URI, prefer the one whose category
  // is a canonical Gemma category over a GEO-imported one. Lower
  // rank wins.
  const CANONICAL_SAMPLE_SOURCE_CATEGORIES = new Set([
    "organism part",
    "cell type",
    "cell line",
  ]);
  const categoryRank = (t: Tag): number => {
    const k = (t.category.label || "").trim().toLowerCase();
    if (CANONICAL_SAMPLE_SOURCE_CATEGORIES.has(k)) return 0;
    return 1;
  };
  // Build "URI exists for (group, label)" lookup so the free-text
  // pass can drop chips that share their label with a URI-bearing
  // sibling in the same row.
  const uriBearingByGroupLabel = new Set<string>();
  for (const t of [...direct, ...inferred]) {
    if (effectiveUri(t) && (t.value.label || "").trim().length > 0) {
      uriBearingByGroupLabel.add(`${groupKeyOf(t)}|${valLabelLc(t)}`);
    }
  }
  // First pass: dedup by effective URI within each row. Sort so the
  // preferred winner lands first: source rank ascending (direct >
  // biomaterial > FV), then canonical category ascending (canonical
  // Gemma > GEO-imported).
  const seenUriKeys = new Set<string>();
  const allSorted = [...direct, ...inferred].sort((a, b) => {
    const s = sourceRank(a) - sourceRank(b);
    if (s !== 0) return s;
    return categoryRank(a) - categoryRank(b);
  });
  const afterUriDedup: Tag[] = [];
  for (const t of allSorted) {
    const uri = effectiveUri(t);
    if (uri) {
      const key = `${groupKeyOf(t)}|${uri}`;
      if (seenUriKeys.has(key)) continue;
      seenUriKeys.add(key);
    }
    afterUriDedup.push(t);
  }
  // Second pass: drop free-text chips whose label is already
  // covered by a URI-bearing chip in the same row.
  const dedupedAll = afterUriDedup.filter((t) => {
    if (effectiveUri(t)) return true; // URI chip — keep
    const k = `${groupKeyOf(t)}|${valLabelLc(t)}`;
    return !uriBearingByGroupLabel.has(k);
  });
  // Split back into direct vs inferred for the bucketing below.
  const dedupedDirect = dedupedAll.filter((t) => !t.inferred);
  const dedupedInferred = dedupedAll.filter((t) => t.inferred);
  const showHeader =
    visibleTags.length > 0 || draft != null;
  if (!showHeader) return null;

  // Bucket direct + inferred tags into the four reproducible group
  // rows + an "other" catch-all. Direct tags render first within a
  // row (editable, green), inferred after (read-only, slate). Empty
  // groups don't render at all, so a sparsely-tagged experiment
  // doesn't get padded with empty rows.
  const directByGroup = new Map<TagGroupKey, Tag[]>();
  const inferredByGroup = new Map<TagGroupKey, Tag[]>();
  for (const t of dedupedDirect) {
    const k = tagGroup(t.category.label);
    const list = directByGroup.get(k) ?? [];
    list.push(t);
    directByGroup.set(k, list);
  }
  for (const t of dedupedInferred) {
    const k = tagGroup(t.category.label);
    const list = inferredByGroup.get(k) ?? [];
    list.push(t);
    inferredByGroup.set(k, list);
  }
  return (
    <div className="pt-1 space-y-0.5">
      <div className="flex items-baseline gap-1.5">
        <span className="text-[11px] uppercase tracking-wide text-slate-500">
          tags
        </span>
        <HelpPopup title="Tag chip legend" size="md">
          <TagBarLegend />
        </HelpPopup>
      </div>
      {/* Render tag-group rows in order, slotting the Factors row
          right after ``sample_source`` per Paul 2026-05-21. Factors
          are the experimental design's structural axis; surfacing
          them in the overview header (with the audit sidebar's sky
          palette so curator + non-curator views agree on entity
          identity) lets non-curators see the design without the
          audit context. */}
      {TAG_GROUP_ORDER.flatMap((g) => {
        const rows: JSX.Element[] = [];
        const hasContent =
          (directByGroup.get(g)?.length ?? 0) +
            (inferredByGroup.get(g)?.length ?? 0) >
          0;
        if (hasContent) {
          // Chip-ordering within a row (Paul 2026-05-23):
          //   1. inferred from factors (FV-synth, ƒ-glyph)
          //   2. EE tags (direct, curator-attached)
          //   3. other ontology terms (non-FV inferred, has URI)
          //   4. free text (no URI)
          // Splits the inferred bucket into FV-synth vs non-FV, then
          // sorts non-FV so URI-bearing categories render before
          // pure-free-text ones. Direct chips slot between #1 and #3.
          const inferredAll = inferredByGroup.get(g) ?? [];
          const fvSynth = inferredAll.filter(
            (t) => t.inferred_source === "FactorValue",
          );
          const nonFvInferred = inferredAll.filter(
            (t) => t.inferred_source !== "FactorValue",
          );
          // Stable sort so categories with any URI-resolved value
          // come before pure-free-text ones. ``Array.sort`` is stable
          // in modern engines; using a 0/1 key preserves intra-rank
          // order (so two URI-resolved categories keep their input
          // order, and same for two free-text categories).
          const categoryHasUri = new Map<string, boolean>();
          for (const t of nonFvInferred) {
            const k = (t.category.label || "").toLowerCase();
            if (categoryHasUri.get(k)) continue;
            categoryHasUri.set(k, !!t.value.uri);
          }
          const nonFvInferredSorted = [...nonFvInferred].sort((a, b) => {
            const ak = (a.category.label || "").toLowerCase();
            const bk = (b.category.label || "").toLowerCase();
            const au = categoryHasUri.get(ak) ? 0 : 1;
            const bu = categoryHasUri.get(bk) ? 0 : 1;
            return au - bu;
          });
          rows.push(
            <div
              key={g}
              className="flex items-baseline gap-2 flex-wrap pl-2 py-0.5"
            >
              <span
                className="text-[10px] uppercase tracking-wide text-slate-500 mr-1 min-w-[5.5rem]"
                title={`${g} category — reproducible spot for this kind of annotation`}
              >
                {TAG_GROUP_LABEL[g]}
              </span>
              <TagGroups
                tags={fvSynth}
                variant="inferred"
                charUriLookup={charUriLookup}
                fvUriLookup={fvUriLookup}
                baselineLookup={baselineLookup}
                experimentId={experimentId}
              />
              <EditableDirectTagGroups
                tags={directByGroup.get(g) ?? []}
                addedTagIds={addedTagIds}
              />
              <TagGroups
                tags={nonFvInferredSorted}
                variant="inferred"
                charUriLookup={charUriLookup}
                fvUriLookup={fvUriLookup}
                baselineLookup={baselineLookup}
                experimentId={experimentId}
              />
            </div>,
          );
        }
        if (g === "sample_source" && (draft?.factors?.length ?? 0) > 0) {
          rows.push(
            <FactorsRow
              key="factors-row"
              factors={draft!.factors}
              experimentId={experimentId}
            />,
          );
        }
        return rows;
      })}
      {draft && !adding ? (
        <div className="flex items-center gap-1 pl-2 pt-0.5">
          <button
            type="button"
            className="text-[11px] text-slate-500 hover:text-emerald-800 hover:bg-emerald-50 border border-dashed border-slate-300 hover:border-emerald-300 rounded px-1.5 py-0.5 disabled:opacity-50 disabled:hover:text-slate-500 disabled:hover:bg-transparent disabled:hover:border-slate-300 disabled:cursor-not-allowed"
            onClick={() => setAdding(true)}
            disabled={tagReadOnly}
          >
            + tag
          </button>
          {/* Surface `missing_tag` audit findings beside the actual
              affordance the curator would use to satisfy them.
              Anchored to the experiment shell's target_id (that's
              what the agent emits for missing_tag — there's no
              concrete tag to attach the dot to since the tag
              doesn't exist yet) and filtered to the issue_code so
              other experiment-kind findings (synth_demo_only,
              missing_factor on the same target_id) don't light up
              the wrong affordance. */}
          <AuditDot
            targetId={experimentTarget(draft.experiment_id)}
            issueCodes={["missing_tag"]}
            // missing_tag ships as severity=minor (slate), which
            // disappears against the dashed-border button. Bump to
            // amber here so curators notice the affordance is
            // flagged. cn() under the hood is tailwind-merge so the
            // override wins over the severity class.
            className="bg-amber-400 border-amber-600 text-amber-950"
          />
        </div>
      ) : null}
      {draft && adding ? (
        <div className="pl-2 pt-0.5">
          <ChipEditor
            category={{ label: "" }}
            value={{ label: "" }}
            onCancel={() => setAdding(false)}
            onCommit={(cat, val) => {
              const { design: next, tagId } = addTag(draft);
              const withCat = setTagCategory(next, tagId, cat);
              const withVal = setTagValue(withCat, tagId, val);
              apply(withVal);
              setAdding(false);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

// `augmentInferredFromBiomaterials` moved to ./augmentInferred.ts —
// kept out of this tsx file so React Fast Refresh doesn't invalidate
// HMR on every component edit.

/** Inline category + value picker, reused for both edit-existing and
 *  add-new flows. Click outside or Escape to cancel; click ✓ (or
 *  blur into outside) to commit when both fields are populated.
 *  Mirrors the editor that lived in the now-retired TagsPanel. */
function ChipEditor({
  category,
  value,
  onCommit,
  onCancel,
  onDelete,
}: {
  category: OntologyTerm;
  value: OntologyTerm;
  onCommit: (category: OntologyTerm, value: OntologyTerm) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [cat, setCat] = useState<OntologyTerm | null>(category);
  const [val, setVal] = useState<OntologyTerm | null>(value);
  // Two-stage local delete: first trash-click arms (visual change +
  // "click again to confirm"); second click commits. Auto-disarms
  // after 3s so the curator can't get stuck in an armed state.
  // The global commit-bar "undo" rolls back EVERY pending edit at
  // once, so per-chip deletion needs its own confirm step otherwise
  // a curator who deletes one tag then hits global undo loses every
  // other unsaved edit too.
  const [deleteArmed, setDeleteArmed] = useState(false);
  useEffect(() => {
    if (!deleteArmed) return;
    const t = window.setTimeout(() => setDeleteArmed(false), 3000);
    return () => window.clearTimeout(t);
  }, [deleteArmed]);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) {
        if (cat && cat.label && val && val.label) {
          onCommit(cat, val);
        } else {
          onCancel();
        }
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [cat, val, onCommit, onCancel]);

  const canSave = !!(cat && cat.label && val && val.label);
  // ``isDirty`` gates the save / cancel buttons — they only matter
  // when the curator has actually changed something. For chips the
  // curator opened-but-didn't-edit (or protected chips that
  // shouldn't really be editable), the editor stays clean. Click-
  // outside still commits the (unchanged) state and Esc still
  // exits, so no behaviour is lost — just the redundant chrome.
  const termsEqual = (a: OntologyTerm | null, b: OntologyTerm | null) => {
    const al = (a?.label ?? "").trim();
    const bl = (b?.label ?? "").trim();
    const au = a?.uri ?? null;
    const bu = b?.uri ?? null;
    return al === bl && au === bu;
  };
  const isDirty = !termsEqual(cat, category) || !termsEqual(val, value);

  return (
    <span
      ref={ref}
      className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border bg-emerald-50 border-emerald-300 text-emerald-900"
      onClick={(e) => e.stopPropagation()}
    >
      <CategoryPicker
        value={cat}
        placeholder="category"
        onCommit={(next) => setCat(next ?? null)}
      />
      <span className="text-emerald-700/70">:</span>
      <OntologyTermPicker
        value={val}
        category={cat?.label || null}
        searchCategory={cat?.label || null}
        placeholder="value"
        onCommit={(next) => setVal(next ?? null)}
      />
      {isDirty ? (
        <>
          <button
            type="button"
            className="ml-1 px-1.5 text-[10px] font-medium uppercase tracking-wide text-emerald-800 hover:text-emerald-950 disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={() => canSave && onCommit(cat!, val!)}
            disabled={!canSave}
            title={
              canSave
                ? "save edit"
                : `fill ${!cat?.label ? "category" : "value"} first`
            }
          >
            save
          </button>
          <button
            type="button"
            className="px-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-500 hover:text-slate-800"
            onClick={onCancel}
            title="discard changes"
          >
            cancel
          </button>
        </>
      ) : null}
      {onDelete ? (
        <button
          type="button"
          className={cn(
            "ml-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide transition-colors",
            deleteArmed
              ? "bg-rose-600 text-white hover:bg-rose-700"
              : "text-rose-700 hover:bg-rose-100 hover:text-rose-900 dark:text-rose-300 dark:hover:bg-rose-900/30",
          )}
          onClick={() => {
            if (deleteArmed) {
              onDelete();
            } else {
              setDeleteArmed(true);
            }
          }}
          title={
            deleteArmed
              ? "click again to confirm delete (auto-cancels in 3s)"
              : "delete tag (requires a second click)"
          }
        >
          {deleteArmed ? "✗ confirm" : "🗑 delete"}
        </button>
      ) : null}
    </span>
  );
}

/** One renderable value inside a tag group. Splits comma-joined
 *  single-tag values (Gemma sometimes returns a single tag with
 *  ``value.label = "A, B, C"``) so they collapse the same way as
 *  proper multi-tag groups. */
interface TagValue {
  label: string;
  /** URI for the value when Gemma resolved it. Comma-split values
   *  inherit from their source tag (the URI applies to the joined
   *  string, not the parts) so they're treated as free-text here.
   */
  uri: string | null;
  /** Stable key for React. */
  key: string;
}

/** Build a ``(category-label, value-label)`` → URI lookup from
 *  every biomaterial's ``characteristic_uris`` map. Both keys are
 *  lower-cased + trimmed so the lookup tolerates Gemma's
 *  capitalisation drift. Used by ``splitTagValues`` to recover the
 *  URI on a tag value that came in as part of a comma-joined
 *  synth.
 */
function buildCharUriLookup(biomaterials: Biomaterial[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const bm of biomaterials) {
    const chars = bm.characteristics ?? {};
    const uris = bm.characteristic_uris ?? {};
    for (const [cat, value] of Object.entries(chars)) {
      const valUri = uris[cat]?.value_uri;
      if (!valUri) continue;
      const k = `${cat.trim().toLowerCase()}|${(value || "").trim().toLowerCase()}`;
      if (!map.has(k)) map.set(k, valUri);
    }
  }
  return map;
}

function splitTagValues(
  tags: Tag[],
  category: Tag["category"],
  charUriLookup: Map<string, string>,
  fvUriLookup: Map<string, string>,
  baselineLookup: Set<string>,
): TagValue[] {
  const catKey = (category.label || "").trim().toLowerCase();
  const out: TagValue[] = [];
  for (const t of tags) {
    const label = (t.value.label || "").trim();
    if (!label) continue;
    const parts = label.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length <= 1) {
      // Single value — prefer the tag's own URI; fall back to the
      // biomaterial characteristic_uris lookup when the synth-tag
      // builder didn't carry a URI through but the underlying BM
      // characteristic does have one (caught 2026-05-10:
      // ``organism part: hypothalamus`` rendered as free-text in
      // the Tags row while the samples table showed UBERON_0001898
      // for the same value). Final fallback: FV statement subject
      // URIs (catches FV-synth tags whose values are CL/EFO terms).
      const uri =
        t.value.uri ??
        charUriLookup.get(`${catKey}|${label.toLowerCase()}`) ??
        fvUriLookup.get(`${catKey}|${label.toLowerCase()}`) ??
        null;
      out.push({ label, uri, key: `${t.id}:${label}` });
    } else {
      // Comma-joined synth value — the tag's own URI doesn't
      // carry to the parts. Look each part up against
      // biomaterial.characteristic_uris first, then FV statement
      // subject URIs; "female" → PATO_0000383 etc. when Gemma's
      // preprocessor mapped it. Falls back to null (free-text
      // styling) when no match in either lookup.
      parts.forEach((p, i) => {
        const uri =
          charUriLookup.get(`${catKey}|${p.toLowerCase()}`) ??
          fvUriLookup.get(`${catKey}|${p.toLowerCase()}`) ??
          null;
        out.push({ label: p, uri, key: `${t.id}:${i}:${p}` });
      });
    }
  }
  // Drop baseline-placeholder rows entirely — Gemma encodes a
  // baseline FV by giving it an OBI "reference substance role" /
  // "reagent role" label, which leaks into FV-synth tags as a
  // curator-meaningless value alongside the real treatment. Same
  // spirit as Paul's earlier "baselines can be omitted or implied"
  // — these are pure implementation chrome.
  const filtered = out.filter(
    (v) =>
      !BASELINE_PLACEHOLDER_LABELS.has(v.label.toLowerCase()) &&
      !(v.uri && BASELINE_PLACEHOLDER_URIS.has(v.uri)),
  );
  // Two-key sort:
  //   1. Baselines bubble to the END (they're the implicit reference;
  //      preview space goes to the interesting comparisons).
  //   2. Within non-baselines, URI-resolved (ontology) values come
  //      FIRST — they're more curator-trustworthy and visually
  //      prominent. Free-text values follow, demoted in the renderer.
  filtered.sort((a, b) => {
    const aB = baselineLookup.has(`${catKey}|${a.label.toLowerCase()}`) ? 1 : 0;
    const bB = baselineLookup.has(`${catKey}|${b.label.toLowerCase()}`) ? 1 : 0;
    if (aB !== bB) return aB - bB;
    const aU = a.uri ? 0 : 1;
    const bU = b.uri ? 0 : 1;
    return aU - bU;
  });
  return filtered;
}

/** OBI / Gemma placeholders that mark a factor value as "this is the
 *  baseline" rather than carrying a real curator-meaningful value.
 *  Filtered out of FV-synth chip values — they're implementation
 *  chrome that confuses curators ("why is TNF tagged alongside
 *  reference substance role?"). */
const BASELINE_PLACEHOLDER_LABELS = new Set([
  "reference substance role",
  "control",
  "vehicle",
  "mock",
  "untreated",
  "baseline",
]);
const BASELINE_PLACEHOLDER_URIS = new Set([
  "http://purl.obolibrary.org/obo/OBI_0000220",
  "http://purl.obolibrary.org/obo/OBI_0000025",
]);

/** Per-value chip styled by URI presence: emerald + medium-weight
 *  for ontology-resolved, slate + italic for free-text. House
 *  standard — green is reserved for "ontology-backed".
 *
 *  Resolved chips render as ``<a>`` so a click opens the ontology
 *  term page (matches the ``Term`` component's resolved-variant
 *  behaviour elsewhere in the UI). The parent group-chip click
 *  handler is for expand/collapse / edit, so we ``stopPropagation``
 *  on the link click — otherwise clicking the term ID would also
 *  toggle the multi-value collapse. */
/** Strip the bracketed qualifier tail from a tag value label —
 *  ``"M0 [Cells grown in basal media for 7 days. ...]"`` becomes
 *  ``"M0"``. The tail is usually a curator/methods comment that
 *  describes the baseline or sample-prep condition; the headline
 *  short label is what the curator wants to scan. Full text is
 *  preserved via the chip's ``title`` for hover-detail. */
function abbreviateValueLabel(label: string): string {
  return label.replace(/\s*\[[^\]]*\]?\s*$/, "").trim() || label;
}

function TagValueChip({
  value,
  categoryLabel,
  demoted = false,
}: {
  value: TagValue;
  /** Category label for this value. Surfaced when the chip is
   *  click-expanded so the curator can see "what kind of annotation
   *  is this" without hovering for the tooltip. Free-text variant
   *  prefixes ``${categoryLabel}: ``; URI variant shows it before
   *  the CURIE. */
  categoryLabel?: string;
  /** When the parent group has at least one ontology-resolved value,
   *  free-text siblings render demoted (lower opacity, lighter
   *  weight) so the eye lands on the anchored terms first. URI
   *  values ignore this prop — they're always the prominent ones. */
  demoted?: boolean;
}) {
  const display = abbreviateValueLabel(value.label);
  const [expanded, setExpanded] = useState(false);
  if (value.uri) {
    // Ontology-resolved: medium weight. Click the label to reveal
    // the CURIE inline + a small ↗ link to OLS + an explicit ×
    // close button. The ↗ is the actual OLS link; the × is the
    // collapse affordance. The chip-itself-toggles behaviour stays
    // (clicking the label re-closes) but the × makes it
    // discoverable.
    const curie = shortenUri(value.uri);
    return (
      <span className="inline-flex items-baseline gap-1 align-bottom">
        {expanded && categoryLabel ? (
          <span className="text-[10px] opacity-70 whitespace-nowrap">
            {categoryLabel}:
          </span>
        ) : null}
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              setExpanded((v) => !v);
            }
          }}
          title={
            expanded
              ? `${value.label} — click to hide ${curie}`
              : `${value.label} — click to reveal ${curie}`
          }
          className="inline-block font-medium text-emerald-700 dark:text-emerald-400 cursor-pointer hover:underline truncate max-w-[22ch]"
        >
          {display}
        </span>
        {expanded ? (
          <>
            <a
              href={value.uri}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              title={`${value.uri} (opens in new tab)`}
              className="font-mono text-[10px] opacity-70 hover:opacity-100 hover:underline whitespace-nowrap"
            >
              {curie}
            </a>
            <a
              href={value.uri}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              title="open the term page in a new tab"
              className="text-[10px] opacity-70 hover:opacity-100"
              aria-label="open in OLS"
            >
              ↗
            </a>
          </>
        ) : null}
      </span>
    );
  }
  // Free-text: italic, no link. Click to reveal the full label
  // (no truncate); click again to collapse. Symmetric with the
  // URI-variant click-to-expand above so the curator's mental
  // model is consistent: clicking any chip reveals more.
  return (
    <span className="inline-flex items-baseline gap-1 align-bottom">
      {expanded && categoryLabel ? (
        <span className="text-[10px] opacity-70 whitespace-nowrap not-italic">
          {categoryLabel}:
        </span>
      ) : null}
      <span
        role="button"
        tabIndex={0}
        onClick={(e) => {
          e.stopPropagation();
          setExpanded((v) => !v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            setExpanded((v) => !v);
          }
        }}
        title={
          expanded
            ? `${value.label} (free text — click to collapse)`
            : `${value.label} (free text — click to reveal full text)`
        }
        className={cn(
          "inline-block italic cursor-pointer hover:opacity-100",
          // Demoted = the group has ontology-resolved siblings; free
          // text plays a supporting role here. Solo / all-free-text
          // groups render at normal weight so they're still readable.
          demoted ? "opacity-50 text-[10px]" : "opacity-80",
          expanded ? "" : "truncate max-w-[22ch]",
        )}
      >
        {expanded ? value.label : display}
      </span>
    </span>
  );
}

/**
 * Group tags by category and render a chip per group.
 *
 * - Single-value groups: flat ``category : value`` chip; the value
 *   carries its own ontology / free-text styling.
 * - Multi-value groups (including a single tag whose value is a
 *   comma-joined synth from Gemma — e.g.
 *   ``disease: "X, Y, Z"`` — get split apart): collapsed by
 *   default to ``category N values ▸ preview…``; click to expand
 *   into a row of value chips.
 *
 * Variant only changes a small bookkeeping cue on the chip
 * (a quiet "auto" tag for inferred groups). All chips share the
 * same neutral background so the curator's eye lands on the
 * **value-level** ontology-vs-free-text styling, which is the
 * actually-actionable signal.
 */
type TagGroupVariant = "direct" | "inferred";

function TagGroups({
  tags,
  variant,
  charUriLookup,
  fvUriLookup,
  baselineLookup,
  experimentId,
}: {
  tags: Tag[];
  variant: TagGroupVariant;
  charUriLookup: Map<string, string>;
  fvUriLookup: Map<string, string>;
  baselineLookup: Set<string>;
  experimentId: number | string;
}) {
  if (tags.length === 0) return null;
  const groups = groupTagsByCategoryLabel(tags);
  return (
    <>
      {[...groups.values()].map((g) => (
        <TagGroupChip
          key={(g.category.label || g.category.uri) + ":" + variant}
          category={g.category}
          tags={g.tags}
          variant={variant}
          charUriLookup={charUriLookup}
          fvUriLookup={fvUriLookup}
          baselineLookup={baselineLookup}
          experimentId={experimentId}
        />
      ))}
    </>
  );
}

/** Direct-tag analogue of ``TagGroups`` with click-to-edit + delete
 *  affordances. Renders one chip per tag (curators add direct tags
 *  one annotation at a time, so comma-split synth doesn't apply
 *  here). Multi-tag categories collapse the same way as ``TagGroups``
 *  does for inferred. */
function EditableDirectTagGroups({
  tags,
  addedTagIds,
}: {
  tags: Tag[];
  /** Tag ids present in the draft but not the saved server state.
   *  Chips in this set render with an amber "new" ring so the
   *  curator can see uncommitted additions at a glance. */
  addedTagIds?: Set<number>;
}) {
  if (tags.length === 0) return null;
  const groups = groupTagsByCategoryLabel(tags);
  return (
    <>
      {[...groups.values()].map((g) => (
        <EditableDirectGroupChip
          key={(g.category.label || g.category.uri) + ":direct"}
          category={g.category}
          tags={g.tags}
          addedTagIds={addedTagIds}
        />
      ))}
    </>
  );
}

/** Group tags by lowercased category label (URI fallback when the
 *  label is empty). Used by both the inferred ``TagGroups`` path and
 *  the editable direct path so a future change to the grouping key
 *  (e.g. include ``inferred_source`` in the key) only has to land
 *  in one place. */
function groupTagsByCategoryLabel(
  tags: Tag[],
): Map<string, { category: Tag["category"]; tags: Tag[] }> {
  const groups = new Map<string, { category: Tag["category"]; tags: Tag[] }>();
  for (const t of tags) {
    const k = (t.category.label || t.category.uri || "").toLowerCase();
    if (!groups.has(k)) {
      groups.set(k, { category: t.category, tags: [] });
    }
    groups.get(k)!.tags.push(t);
  }
  return groups;
}

function EditableDirectGroupChip({
  category,
  tags,
  addedTagIds,
}: {
  category: Tag["category"];
  tags: Tag[];
  /** Tag ids present in the draft but not the saved server state.
   *  Single-tag chips matching one of these get the amber "new"
   *  ring; multi-tag chips get the ring when *any* of their tags is
   *  new (and the inner editable chip per-value mirrors the per-tag
   *  status when expanded). */
  addedTagIds?: Set<number>;
}) {
  const { draft, apply } = useDesignDraft();
  const readOnly = useIsReadOnly();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  function beginEdit(tagId: number) {
    if (readOnly) return;
    setEditingId(tagId);
  }

  function commitEdit(tag: Tag, cat: OntologyTerm, val: OntologyTerm) {
    if (!draft) return;
    const next = setTagCategory(draft, tag.id, cat);
    apply(setTagValue(next, tag.id, val));
    setEditingId(null);
  }
  function deleteOne(tagId: number) {
    if (!draft) return;
    apply(deleteTag(draft, tagId));
    setEditingId(null);
  }

  // Tags whose category names the experiment's assay shape are
  // load-time invariants (Gemma's import attaches them); the curator
  // shouldn't be able to delete them from the UI. Drop the × button
  // and the ChipEditor onDelete prop when the group is protected.
  const protectedCategory = isProtectedTagCategory(category.label);

  // Single tag — render as just the value chip wrapped in an
  // emerald-bordered shell, click to edit, × on hover.
  // C+B chip pass (2026-05-17): category section dropped — the row
  // group header carries it. Category + URI move to hover title.
  if (tags.length === 1) {
    const tag = tags[0];
    if (editingId === tag.id) {
      return (
        <ChipEditor
          category={tag.category}
          value={tag.value}
          onCancel={() => setEditingId(null)}
          onCommit={(c, v) => commitEdit(tag, c, v)}
          onDelete={
            protectedCategory ? undefined : () => deleteOne(tag.id)
          }
        />
      );
    }
    const isNew = addedTagIds?.has(tag.id) ?? false;
    const valueDisplay = abbreviateValueLabel(tag.value.label || "");
    return (
      <span
        // Audit focus hook — Apply & focus on a tag finding scrolls
        // this chip into view + ring-flashes it.
        data-audit-target={tagTarget(tag.category.label, tag.value.label)}
        className={cn(
          "group/chip inline-flex items-baseline gap-1 px-1.5 py-0.5 text-[11px] rounded border bg-emerald-50 border-emerald-300 text-emerald-900 dark:bg-emerald-900/30 dark:border-emerald-700 dark:text-emerald-100",
          // Bookmark on the left when the value is ontology-anchored.
          // Free-text tags share the chip frame but get no bookmark.
          tag.value.uri && ONTOLOGY_ANCHOR_CLS,
          protectedCategory
            ? "cursor-default opacity-90"
            : "cursor-pointer hover:bg-emerald-100 dark:hover:bg-emerald-900/50",
          // Uncommitted addition — amber ring + soft glow so the
          // curator can see at a glance which chips are pending.
          isNew &&
            "ring-2 ring-amber-400 ring-offset-1 ring-offset-white shadow-[0_0_8px_-2px_rgba(251,191,36,0.7)] dark:ring-offset-slate-900",
        )}
        onClick={
          protectedCategory || readOnly
            ? undefined
            : () => beginEdit(tag.id)
        }
        title={
          (protectedCategory
            ? `${category.label}: ${tag.value.label} — load-time tag, can't be edited or removed`
            : readOnly
              ? `${category.label}: ${tag.value.label} — read-only in review mode`
              : `${category.label}: ${tag.value.label} — click to edit`) +
          (tag.value.uri ? ` — ${shortenUri(tag.value.uri)}` : "")
        }
      >
        {/* Padlock for load-time tags — explicit "this can't be
         *  changed" signal. Replaces the silent-no-affordance state
         *  where curators used to click and get the editor with no
         *  meaningful change possible. */}
        {protectedCategory ? (
          <span
            className="text-[10px] opacity-60"
            aria-label="locked"
            title="load-time tag, can't be edited"
          >
            🔒
          </span>
        ) : null}
        <span
          className={cn(
            "font-medium truncate max-w-[22ch]",
            // Anchored term → emerald text; free-text → italic slate.
            // Same convention as TagValueChip (inferred chip variant)
            // so ontology vs free-text reads identically across both.
            tag.value.uri
              ? "text-emerald-700 dark:text-emerald-400"
              : "italic text-slate-700 dark:text-slate-300",
          )}
        >
          {valueDisplay || <em className="not-italic">no value</em>}
        </span>
        <AuditDot
          targetId={tagTarget(tag.category.label, tag.value.label)}
        />
        {protectedCategory || readOnly ? null : (
          <button
            type="button"
            className="ml-0.5 inline-flex items-center justify-center w-3.5 h-3.5 rounded-sm text-emerald-700/70 hover:bg-emerald-200 hover:text-emerald-900 dark:text-emerald-300/70 dark:hover:bg-emerald-800 dark:hover:text-emerald-100"
            onClick={(e) => {
              e.stopPropagation();
              beginEdit(tag.id);
            }}
            title="edit this tag (delete from the editor)"
            aria-label="edit tag"
          >
            <PencilIcon size={11} strokeWidth={2.5} />
          </button>
        )}
      </span>
    );
  }

  // Multi-tag — collapse like the read-only inferred groups, but each
  // value chip in the expanded view is independently editable. C+B
  // chip pass: category section dropped; hover title carries it.
  return (
    <span
      className={cn(
        "inline-flex items-baseline text-[11px] rounded border bg-emerald-50 border-emerald-300 text-emerald-900 dark:bg-emerald-900/30 dark:border-emerald-700 dark:text-emerald-100",
        // Bookmark on the left when any wrapped value is ontology-
        // anchored. Mixed free-text + anchored groups still get the
        // bookmark — the group as a whole is anchored.
        tags.some((t) => !!t.value.uri) && ONTOLOGY_ANCHOR_CLS,
        // Highlight the whole multi-tag group when any member is new
        // (curator just added one of N values in this category).
        tags.some((t) => addedTagIds?.has(t.id)) &&
          "ring-2 ring-amber-400 ring-offset-1 ring-offset-white shadow-[0_0_8px_-2px_rgba(251,191,36,0.7)] dark:ring-offset-slate-900",
      )}
      title={`${category.label} — ${tags.length} tags`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-baseline gap-1 px-1.5 py-0.5 hover:underline underline-offset-2"
        title={
          open
            ? "click to collapse"
            : `click to expand ${tags.length} ${category.label} tags`
        }
      >
        <span className="font-medium tabular-nums">{tags.length}</span>
        <span className="text-emerald-900/75 dark:text-emerald-200/75">{open ? "▾" : "▸"}</span>
        {open ? null : (
          <span className="italic ml-1 truncate max-w-[24ch] text-emerald-900/60 dark:text-emerald-200/70">
            {tags
              .slice(0, 2)
              .map((t) => abbreviateValueLabel(t.value.label || "(blank)"))
              .join(", ")}
            {tags.length > 2 ? "…" : ""}
          </span>
        )}
      </button>
      {open ? (
        <span className="inline-flex items-baseline gap-1 flex-wrap px-1.5 py-0.5">
          {tags.map((tag) =>
            editingId === tag.id ? (
              <ChipEditor
                key={tag.id}
                category={tag.category}
                value={tag.value}
                onCancel={() => setEditingId(null)}
                onCommit={(c, v) => commitEdit(tag, c, v)}
                onDelete={
                  protectedCategory ? undefined : () => deleteOne(tag.id)
                }
              />
            ) : (
              <span
                key={tag.id}
                data-audit-target={tagTarget(tag.category.label, tag.value.label)}
                className={cn(
                  "group inline-flex items-baseline gap-1 px-1 rounded bg-emerald-50 border border-emerald-200/70 hover:bg-emerald-100 dark:bg-emerald-900/40 dark:border-emerald-700/60 dark:hover:bg-emerald-800/50",
                  readOnly ? "cursor-default" : "cursor-pointer",
                  tag.value.uri && ONTOLOGY_ANCHOR_CLS,
                  addedTagIds?.has(tag.id) &&
                    "ring-2 ring-amber-400 ring-offset-1 ring-offset-white dark:ring-offset-slate-900",
                )}
                onClick={readOnly ? undefined : () => beginEdit(tag.id)}
                title={
                  protectedCategory
                    ? "load-time tag, can't be removed"
                    : "click to edit"
                }
              >
                <span>{tag.value.label || "(blank)"}</span>
                {tag.value.uri ? (
                  <a
                    href={tag.value.uri}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    title={`${tag.value.uri} (opens in new tab)`}
                    className="font-mono text-[10px] text-emerald-900/60 hover:text-emerald-900 hover:underline whitespace-nowrap"
                  >
                    {shortenUri(tag.value.uri)}
                  </a>
                ) : null}
                <AuditDot
                  targetId={tagTarget(tag.category.label, tag.value.label)}
                />
                {protectedCategory ? null : (
                  <button
                    type="button"
                    className="ml-1 inline-flex items-center justify-center w-3.5 h-3.5 rounded-sm text-emerald-700/70 hover:bg-emerald-200 hover:text-emerald-900 dark:text-emerald-300/70 dark:hover:bg-emerald-800 dark:hover:text-emerald-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingId(tag.id);
                    }}
                    title="edit this tag (delete from the editor)"
                    aria-label="edit tag"
                  >
                    <PencilIcon size={11} strokeWidth={2.5} />
                  </button>
                )}
              </span>
            ),
          )}
        </span>
      ) : null}
    </span>
  );
}

/** Short tag for inferred-source provenance: BioMaterial → BM,
 *  FactorValue → FV. Anything else falls through verbatim. Surfaced
 *  on every inferred chip so a curator scanning the panel can
 *  answer "where did this come from?" without hovering for the
 *  tooltip. Empty string for tags without a source recorded. */
function inferredSourceTag(source: string | undefined): string {
  if (!source) return "";
  if (source === "BioMaterial") return "BM";
  if (source === "FactorValue") return "FV";
  return source;
}

/** Long-form name for an evidence code, for the chip's hover title.
 *  Limited to the two Gemma actually uses; others render verbatim. */
function evidenceCodeName(code: string | undefined): string {
  const c = (code || "").trim().toUpperCase();
  if (!c) return "";
  if (c === "IC") return "Inferred by Curator";
  if (c === "IIA") return "Inferred from Imported Annotation (GEO)";
  return c;
}

/** Three-way palette for the two-tone tag chip. The provenance signal
 *  (curator-direct vs factor-derived vs biomaterial-inferred) is the
 *  load-bearing distinction a curator is trying to read at a glance:
 *  EE tags they own, FV-synth tags that mirror a factor (so editing
 *  the factor is the way to change them), and BM-inferred tags that
 *  ride along from the biomaterials. Three palettes so the eye can
 *  triage without parsing the tiny "FV" / "BM" badge.
 *
 *  Within each palette the chip splits into two sections — category
 *  on the left in the deeper -100 tier, value on the right in the
 *  -50 tier — so the seam between "what kind of annotation" and
 *  "what value" is visible at chip-scan distance. */
type TagPaletteKey = "direct" | "fv" | "bm" | "mixed";

const TAG_PALETTE: Record<
  TagPaletteKey,
  {
    /** Outer chip border + value-section bg (the right half). */
    outer: string;
    /** Category-section bg + text (the left half). Deeper than outer
     *  so the seam reads clearly. */
    cat: string;
    /** Smaller-weight sibling labels (badges, "N values" preview)
     *  living inside the value section. */
    label: string;
    /** Hover state override on the value section — slight bump so
     *  the chip indicates interactivity (edit / expand) without
     *  blowing out the two-tone differential. */
    valHover: string;
    /** Hover state override on the category section. */
    catHover: string;
  }
> = {
  direct: {
    outer:
      "bg-emerald-50 border-emerald-300 dark:bg-emerald-900/30 dark:border-emerald-700",
    cat:
      "bg-emerald-100 text-emerald-900 dark:bg-emerald-800/50 dark:text-emerald-100",
    label: "text-emerald-900/70 dark:text-emerald-200/70",
    valHover: "group-hover/chip:bg-emerald-100 dark:group-hover/chip:bg-emerald-900/50",
    catHover: "group-hover/chip:bg-emerald-200 dark:group-hover/chip:bg-emerald-700/60",
  },
  fv: {
    outer:
      "bg-sky-50 border-sky-300 dark:bg-sky-900/40 dark:border-sky-700",
    cat:
      "bg-sky-100 text-sky-900 dark:bg-sky-800/50 dark:text-sky-100",
    label: "text-sky-900/70 dark:text-sky-200/70",
    valHover: "group-hover/chip:bg-sky-100 dark:group-hover/chip:bg-sky-900/50",
    catHover: "group-hover/chip:bg-sky-200 dark:group-hover/chip:bg-sky-700/60",
  },
  bm: {
    outer:
      "bg-violet-50 border-violet-300 dark:bg-violet-900/30 dark:border-violet-700",
    cat:
      "bg-violet-100 text-violet-900 dark:bg-violet-800/50 dark:text-violet-100",
    label: "text-violet-900/70 dark:text-violet-200/70",
    valHover: "group-hover/chip:bg-violet-100 dark:group-hover/chip:bg-violet-900/50",
    catHover: "group-hover/chip:bg-violet-200 dark:group-hover/chip:bg-violet-700/60",
  },
  mixed: {
    outer:
      "bg-slate-50 border-slate-300 dark:bg-slate-800/60 dark:border-slate-600",
    cat:
      "bg-slate-100 text-slate-900 dark:bg-slate-700/70 dark:text-slate-100",
    label: "text-slate-900/70 dark:text-slate-200/70",
    valHover: "group-hover/chip:bg-slate-100 dark:group-hover/chip:bg-slate-700/70",
    catHover: "group-hover/chip:bg-slate-200 dark:group-hover/chip:bg-slate-600/70",
  },
};

function pickTagPalette(
  variant: TagGroupVariant,
  sources: string[],
): TagPaletteKey {
  if (variant === "direct") return "direct";
  if (sources.length === 1) {
    if (sources[0] === "FV") return "fv";
    if (sources[0] === "BM") return "bm";
  }
  return "mixed";
}

function TagGroupChip({
  category,
  tags,
  variant,
  charUriLookup,
  fvUriLookup,
  baselineLookup,
  experimentId,
}: {
  category: Tag["category"];
  tags: Tag[];
  variant: TagGroupVariant;
  charUriLookup: Map<string, string>;
  fvUriLookup: Map<string, string>;
  baselineLookup: Set<string>;
  experimentId: number | string;
}) {
  const values = splitTagValues(tags, category, charUriLookup, fvUriLookup, baselineLookup);

  // Single value (after comma-split) renders flat — no collapse to
  // worry about.
  // Outer chip palette signals provenance (direct EE tag vs FV-synth
  // vs BM-inferred); the chip splits into two tonal sections so the
  // category↔value seam is readable at scan distance. Per-value
  // ontology vs free-text styling lives on top inside the value
  // section.
  // House rule: amber means **warning** only — inferred chips are
  // informational, so they get the violet/sky palettes instead.

  // Inferred-source provenance shorthand. Most groups share one
  // source (all BM, all FV); a mixed group renders both joined with
  // "/". For the placeholder/empty case we fall back to "auto" so the
  // chip still signals inferred-ness. Sort the codes so the rendered
  // order is stable (e.g. always "BM/FV", never "FV/BM" depending on
  // which tag was first in the list).
  const sources =
    variant === "inferred"
      ? Array.from(
          new Set(
            tags.map((t) => inferredSourceTag(t.inferred_source)).filter(Boolean),
          ),
        ).sort()
      : [];
  // Source label dropped from inline render (C+B chip pass) — the
  // palette colour on the outer border already encodes BM vs FV vs
  // mixed. Surfaced in the hover title via `sources` directly.

  // Evidence-code mix across the group's tags. When all tags share
  // one code (the common case), use it for both the border style and
  // the badge. Mixed groups fall back to dashed (lower-trust wins
  // for the visual cue) and render the codes joined. Sorted for
  // stable rendering — same input, same output.
  const evCodes =
    variant === "inferred"
      ? Array.from(
          new Set(
            tags
              .map((t) => (t.evidence_code || "").trim().toUpperCase())
              .filter(Boolean),
          ),
        ).sort()
      : [];
  // Dashed-vs-solid evidence-border distinction dropped in the C+B
  // chip pass (2026-05-17) — too much competing styling per chip.
  // Evidence code now lives in the hover title only. Palette colour
  // (direct/FV/BM/mixed) is the at-a-glance signal.
  const evBorder = "border-solid";
  const evTitle =
    evCodes.length === 1
      ? ` · ${evCodes[0]} (${evidenceCodeName(evCodes[0])})`
      : evCodes.length > 1
        ? ` · evidence: ${evCodes.join(", ")}`
        : "";

  const palette = TAG_PALETTE[pickTagPalette(variant, sources)];

  // FV-synth chips get a clickable `ƒ` glyph that jumps to the Design
  // tab with the originating factor focused. Per Paul, 2026-05-17 —
  // colour alone is not enough to signal source on dim screens; the
  // glyph + jump-affordance does double duty (distinguishable
  // typography signal + a real "edit me elsewhere" action).
  const isFvDerived = variant === "inferred" && sources.includes("FV");
  const factorGlyph = isFvDerived ? (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        requestAuditFocus(experimentId, factorTarget(category.label));
      }}
      className={`text-[10px] italic font-serif ${palette.label} hover:underline cursor-pointer leading-none align-baseline`}
      title={`${category.label} — edit on Design tab`}
      aria-label={`go to ${category.label} on Design tab`}
    >
      ƒ
    </button>
  ) : null;

  // C+B chip pass (2026-05-17): drop the in-chip category section
  // (the group row already says it) and the inline source badge
  // (palette colour already encodes it). Category + source + evidence
  // code all live in the hover title now. Result: chip = just value,
  // bordered by the source palette.
  const hoverTitle = (() => {
    const base = `${category.label}${variant === "inferred" ? ` (inferred from ${sources.join(", ") || "auto"})${evTitle}` : ""}`;
    return base;
  })();
  // Demote free-text values when the group also carries at least one
  // URI-resolved value (per Paul, 2026-05-17 — free text plays a
  // supporting role in mixed groups; pure-free-text groups stay at
  // normal weight so they remain readable).
  const hasUriValue = values.some((v) => !!v.uri);

  if (values.length === 1) {
    const v = values[0];
    return (
      <span
        title={`${category.label}: ${v.label}${variant === "inferred" ? ` (inferred from ${sources.join(", ") || "auto"})${evTitle}` : ""}`}
        className={`inline-flex items-baseline gap-1 px-1.5 py-0.5 text-[11px] rounded border ${evBorder} ${palette.outer}`}
      >
        {factorGlyph}
        <TagValueChip
          value={v}
          categoryLabel={category.label}
          demoted={hasUriValue && !v.uri}
        />
      </span>
    );
  }

  // Multi-value: chip always renders the preview + "+N more" /
  // chevron compact form. The full list reveals into a **popover**
  // (portal-mounted, click-outside / Esc to close) rather than
  // expanding inline — high-cardinality groups (30+ cell types
  // on single-cell EEs) would otherwise blow out the row. Per
  // Paul 2026-05-23: "we can't show all the cell types, so they
  // need to be collapsed/grouped; a popup would be needed rather
  // than an expand-in-place for that, and any other 'collapsed'
  // one that has a high cardinality inside."
  const PREVIEW_N = 2;
  const shown = values.slice(0, PREVIEW_N);
  const hidden = values.length - shown.length;
  const titleAttr = evTitle
    ? `${hoverTitle}${evTitle ? ` ·${evTitle.replace(/^\s·\s/, " ")}` : ""}`
    : hoverTitle;
  return (
    <TagValuesPopover
      anchorClassName={`inline-flex items-baseline gap-1 px-1.5 py-0.5 text-[11px] rounded border ${evBorder} ${palette.outer}`}
      anchorTitle={titleAttr}
      category={category}
      values={values}
      hasUriValue={hasUriValue}
      sources={sources}
      evTitle={evTitle}
      paletteLabel={palette.label}
    >
      {factorGlyph}
      <span className="inline-flex items-baseline gap-0.5 flex-wrap">
        {shown.map((v, i) => (
          <span key={v.key} className="inline-flex items-baseline gap-0.5">
            {i > 0 ? <span className={palette.label}>,</span> : null}
            <TagValueChip
              value={v}
              categoryLabel={category.label}
              demoted={hasUriValue && !v.uri}
            />
          </span>
        ))}
        {hidden > 0 ? (
          <span
            className={`text-[10px] ${palette.label}`}
            title={`${hidden} more ${category.label} value${hidden === 1 ? "" : "s"}`}
          >
            +{hidden} more
          </span>
        ) : null}
      </span>
    </TagValuesPopover>
  );
}

/**
 * Click-target wrapper that opens a portal popover showing the full
 * list of values when the curator wants to see them all. Used for
 * multi-value tag-group chips (especially high-cardinality ones
 * like ``cell type`` on single-cell EEs — can be 30+). The popover
 * also serves the low-N cases (3-4 values) because the affordance
 * is consistent and the popover scales down cleanly to short
 * lists.
 *
 * Anchored to the trigger element; click-outside / Escape / scroll
 * close. Portal-mounted so it escapes ``overflow-hidden`` parents.
 */
function TagValuesPopover({
  anchorClassName,
  anchorTitle,
  category,
  values,
  hasUriValue,
  sources,
  evTitle,
  paletteLabel,
  children,
}: {
  anchorClassName: string;
  anchorTitle: string;
  category: Tag["category"];
  values: ReturnType<typeof splitTagValues>;
  hasUriValue: boolean;
  sources: string[];
  evTitle: string;
  paletteLabel: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const WIDTH = 360;
  const MAX_HEIGHT = 360;
  const MARGIN = 8;

  // Measure on open + re-measure on resize / scroll so the popover
  // tracks the trigger position. Standard popover plumbing.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const measure = () => {
      const t = triggerRef.current;
      if (!t) return;
      const rect = t.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left = rect.left;
      if (left + WIDTH + MARGIN > vw) left = vw - WIDTH - MARGIN;
      if (left < MARGIN) left = MARGIN;
      let top = rect.bottom + 4;
      if (top + MAX_HEIGHT + MARGIN > vh && rect.top > MAX_HEIGHT) {
        top = rect.top - MAX_HEIGHT - 4;
      }
      if (top < MARGIN) top = MARGIN;
      setPos({ top, left });
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open]);

  // Click-outside / Escape close.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <span
        ref={triggerRef}
        className={anchorClassName + " cursor-pointer"}
        title={anchorTitle}
        role="button"
        tabIndex={0}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            setOpen((v) => !v);
          }
        }}
      >
        {children}
        <span
          className={`text-[10px] ${paletteLabel} ml-auto`}
          aria-hidden
        >
          {open ? "▾" : "▸"}
        </span>
      </span>
      {open && pos
        ? createPortal(
            <div
              ref={popoverRef}
              className="fixed z-[1000] bg-white border border-slate-300 ring-1 ring-black/10 rounded shadow-xl text-xs text-slate-700 dark:bg-slate-800 dark:border-slate-500 dark:ring-black/40 dark:text-slate-200"
              style={{ top: pos.top, left: pos.left, width: WIDTH }}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="px-2 py-1.5 border-b border-slate-200 dark:border-slate-600 flex items-baseline justify-between gap-2">
                <span className="font-semibold text-slate-800 dark:text-slate-100 truncate">
                  {category.label}
                </span>
                <span className="text-[10px] text-slate-500 dark:text-slate-400">
                  {values.length} value{values.length === 1 ? "" : "s"}
                  {sources.length > 0
                    ? ` · inferred from ${sources.join(", ")}`
                    : ""}
                </span>
              </div>
              <div
                className="p-2 flex flex-wrap gap-1.5 overflow-y-auto"
                style={{ maxHeight: MAX_HEIGHT - 40 }}
              >
                {values.map((v) => (
                  <TagValueChip
                    key={v.key}
                    value={v}
                    categoryLabel={category.label}
                    demoted={hasUriValue && !v.uri}
                  />
                ))}
              </div>
              {evTitle ? (
                <div className="px-2 py-1 border-t border-slate-200 dark:border-slate-600 text-[10px] text-slate-500 dark:text-slate-400">
                  {evTitle.replace(/^\s·\s/, "")}
                </div>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

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
 */
function EditableDescription({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (next: string) => void;
}) {
  const readOnly = useIsReadOnly();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const beginEdit = () => {
    if (readOnly) return;
    setDraft(value);
    setEditing(true);
  };

  if (!editing) {
    const paragraphs = value
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
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  children,
  className,
  help,
  helpTitle,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
  /** Optional inline help body rendered behind a `?` popover next to
   *  the card's label. Use for legends (colour meanings, chip
   *  provenance) and short "how to read this card" notes. Each card
   *  is free to skip when there's nothing to explain. */
  help?: React.ReactNode;
  /** Title shown in the popover header + the `?` button tooltip.
   *  Defaults to ``"{label} — legend"``. */
  helpTitle?: string;
}) {
  return (
    <div className={"card p-3" + (className ? " " + className : "")}>
      <div className="text-xs text-slate-500 mb-2 flex items-center gap-1.5">
        <span className="uppercase tracking-wide">{label}</span>
        {help ? (
          <HelpPopup title={helpTitle ?? `${label} — legend`} size="md">
            {help}
          </HelpPopup>
        ) : null}
      </div>
      <dl className="space-y-1">{children}</dl>
    </div>
  );
}

function KV({
  k,
  v,
  mono,
}: {
  k: string;
  v: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-2 text-xs">
      <dt className="text-slate-500 w-32 shrink-0">{k}</dt>
      <dd
        className={
          mono ? "font-mono text-slate-800 truncate" : "text-slate-800 truncate"
        }
      >
        {v}
      </dd>
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

/** Parse the actual abstract out of the agent's ``paper_excerpt``.
 *  Biolit hands back a kitchen-sink dump — GEO metadata header
 *  (Title / Type / Organism / Platform / Sample count / linked
 *  PMIDs), the GEO ``Summary``, ``Overall design``, then under a
 *  ``--- Linked Publication ---`` divider an ``=== ABSTRACT ===``
 *  block followed by ``=== INTRODUCTION ===``. We want the abstract
 *  body for the curator, not the metadata they already see on the
 *  page. Prefer the explicit ``=== ABSTRACT ===`` marker; fall back
 *  to the GEO ``Summary:`` block (close-enough alternative for
 *  experiments where biolit didn't reach the linked publication).
 *  Returns ``null`` when neither marker matches — the caller shows
 *  the verbatim excerpt as a last-resort fallback. */
function extractAbstract(excerpt: string): string | null {
  if (!excerpt) return null;
  const ab = excerpt.match(
    /===\s*ABSTRACT\s*===\s*\n([\s\S]*?)(?=\n===\s|\n---\s|$)/i,
  );
  if (ab && ab[1].trim()) return ab[1].trim();
  const summary = excerpt.match(
    /(?:^|\n)Summary:\s*([\s\S]*?)(?=\n\n|\nOverall design:|\nExperiment type:|\n---|\n===|$)/i,
  );
  if (summary && summary[1].trim()) return summary[1].trim();
  return null;
}

/** Modal overlay holding the abstract. Centered, capped width,
 *  scrolls internally. Inline expansion was crowding the
 *  Publications card with a wall of text — kicking the abstract
 *  into a modal keeps the card compact and gives the text room to
 *  breathe at a comfortable reading width. Closes on overlay
 *  click, on the close button, and on Escape. */
function AbstractModal({
  title,
  excerpt,
  tone,
  onClose,
}: {
  title: string;
  excerpt: string;
  tone: "annotated" | "proposed";
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const body = extractAbstract(excerpt) ?? excerpt;
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const accentCls =
    tone === "annotated"
      ? "border-l-4 border-emerald-400"
      : "border-l-4 border-violet-400";
  const labelCls =
    tone === "annotated" ? "text-emerald-700" : "text-violet-700";
  const labelText = tone === "annotated" ? "Abstract" : "Proposed paper · abstract";
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className={
          "card max-w-2xl w-full max-h-[80vh] flex flex-col shadow-xl " +
          accentCls
        }
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-baseline justify-between gap-2 px-4 py-2 border-b border-slate-200 shrink-0">
          <div className="min-w-0 flex-1">
            <div
              className={
                "text-[10px] uppercase tracking-wider font-semibold " + labelCls
              }
            >
              {labelText}
            </div>
            {title ? (
              <div className="text-[13px] font-medium text-slate-800 leading-snug truncate">
                {title}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="text-slate-400 hover:text-slate-700 text-lg leading-none px-1"
            onClick={onClose}
            aria-label="close"
            title="close (Esc)"
          >
            ×
          </button>
        </header>
        {/* ``flex-1 min-h-0`` lets the body claim the remaining
            modal height and lets ``overflow-auto`` actually kick in
            — without ``min-h-0``, flex children default to
            ``min-height: auto`` and the body grows past max-h-[80vh]
            without scrolling. Caught when a long abstract truncated
            mid-sentence with no scrollbar. */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 text-xs leading-relaxed text-slate-700 space-y-2">
          {paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Decide which publication, if any, the agent's paper_excerpt
 *  belongs to. Three cases:
 *
 *    1. ``paper_source`` substring-mentions this publication's
 *       PMID or DOI — definitive match.
 *    2. ``paper_source`` is opaque (a provenance label like
 *       "geo_linked_fulltext" / "biolit") AND there's exactly one
 *       publication on the experiment — attach the abstract here.
 *       The proposer fetches one paper per run from the experiment's
 *       linked publication, so the 1:1 inference is safe.
 *    3. Otherwise — return null, and the abstract surfaces in the
 *       Proposed-paper block instead of a publication row.
 */
function abstractForPublication(
  publication: Publication,
  allPublications: Publication[],
  ev: { paper_source: string; paper_excerpt: string } | null,
): string | null {
  if (!ev || !ev.paper_excerpt) return null;
  const src = (ev.paper_source || "").toLowerCase();
  if (
    publication.pubmed_id &&
    src.includes(publication.pubmed_id.toLowerCase())
  ) {
    return ev.paper_excerpt;
  }
  if (publication.doi && src.includes(publication.doi.toLowerCase())) {
    return ev.paper_excerpt;
  }
  // Opaque-source fallback — attach to the lone publication if
  // there's only one. Avoids leaving the abstract orphaned in the
  // common single-paper case.
  if (allPublications.length === 1) {
    return ev.paper_excerpt;
  }
  return null;
}

function anyPublicationGetsAbstract(
  publications: Publication[],
  ev: { paper_source: string; paper_excerpt: string } | null,
): boolean {
  if (!ev) return false;
  return publications.some(
    (p) => abstractForPublication(p, publications, ev) !== null,
  );
}

/** Block for an agent-fetched paper that *isn't* linked to any
 *  confirmed publication on this experiment. Surfaces the abstract
 *  the agent used so the curator can decide whether to link the
 *  paper or reject it. Click "Show abstract" to expand. */
function ProposedAbstract({
  source,
  excerpt,
}: {
  source: string;
  excerpt: string;
}) {
  const [open, setOpen] = useState(false);
  if (!excerpt) return null;
  const sourceIsUrl = /^https?:\/\//i.test(source);
  return (
    <div className="mb-2 border border-violet-200 bg-violet-50/60 rounded p-2 text-xs">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-[10px] uppercase tracking-wider font-semibold text-violet-800">
          Proposed paper
        </span>
        <span className="text-[11px] text-slate-600">
          Agent fetched a paper but it's not linked to this
          experiment yet.
        </span>
      </div>
      {source ? (
        <div className="mt-1 text-[11px] text-slate-700 break-all">
          <span className="font-medium">source: </span>
          {sourceIsUrl ? (
            <a
              href={source}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-700 hover:underline"
            >
              {source}
            </a>
          ) : (
            source
          )}
        </div>
      ) : null}
      <button
        type="button"
        className="mt-1 text-[11px] text-violet-800 hover:text-violet-950 underline underline-offset-2"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "▾ Hide abstract" : "▸ Show abstract"}
      </button>
      {open ? (
        <AbstractModal
          title=""
          excerpt={excerpt}
          tone="proposed"
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}

function PublicationRow({
  publication,
  abstract,
  onDelete,
}: {
  publication: Publication;
  /** When non-null, the agent-fetched paper excerpt for this
   *  publication. Renders behind a "Show abstract" toggle so the
   *  curator can read it inline. Null when no agent has fetched
   *  the paper yet — the row stays compact. */
  abstract?: string | null;
  onDelete?: () => void;
}) {
  const [abstractOpen, setAbstractOpen] = useState(false);
  // Fetch live PubMed metadata when the local row lacks a title.
  // The local API only persists what was on the GEO MINiML
  // ``<Pubmed-ID>`` tag (just the PMID); title / citation /
  // authors are pulled from NCBI esummary on-demand. usePubmedMetadata
  // is a no-op when pubmed_id is empty.
  const needsFetch =
    !publication.title?.trim() && !publication.citation?.trim();
  const { data: pubmedMeta, isLoading: pubmedLoading } = usePubmedMetadata(
    needsFetch ? publication.pubmed_id : undefined,
  );
  const displayTitle =
    publication.title?.trim() ||
    pubmedMeta?.title ||
    publication.citation?.trim() ||
    "";
  const displayCitation =
    publication.citation?.trim() || pubmedMeta?.citation || "";
  const effectiveDoi = publication.doi?.trim() || pubmedMeta?.doi || "";
  const pmidUrl = publication.pubmed_id
    ? `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(publication.pubmed_id)}/`
    : null;
  const doiUrl = effectiveDoi
    ? `https://doi.org/${encodeURIComponent(effectiveDoi)}`
    : null;
  return (
    <li className="flex items-start gap-2">
      <div className="flex-1 min-w-0">
        <div className="font-medium text-slate-800 leading-snug">
          {displayTitle ? (
            displayTitle
          ) : pubmedLoading ? (
            <span className="italic text-slate-400">fetching from PubMed…</span>
          ) : (
            <span className="italic text-slate-400">(metadata not fetched yet)</span>
          )}
        </div>
        {displayCitation && displayTitle && displayCitation !== displayTitle ? (
          <div className="text-slate-500 italic">{displayCitation}</div>
        ) : null}
        <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
          {pmidUrl ? (
            <a
              href={pmidUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-700 hover:underline"
            >
              PMID {publication.pubmed_id} ↗
            </a>
          ) : null}
          {doiUrl ? (
            <a
              href={doiUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-700 hover:underline font-mono"
            >
              {shortenUri(`https://doi.org/${effectiveDoi}`)} ↗
            </a>
          ) : null}
          {abstract ? (
            <button
              type="button"
              className="text-emerald-800 hover:text-emerald-950 underline underline-offset-2"
              onClick={() => setAbstractOpen((v) => !v)}
              title="abstract fetched by the curation agent"
            >
              {abstractOpen ? "▾ Hide abstract" : "▸ Show abstract"}
            </button>
          ) : null}
        </div>
        {abstract && abstractOpen ? (
          <AbstractModal
            title={displayTitle || ""}
            excerpt={abstract}
            tone="annotated"
            onClose={() => setAbstractOpen(false)}
          />
        ) : null}
      </div>
      {onDelete ? (
        <button
          type="button"
          onClick={() => {
            // Confirm before removing — publications are intentionally
            // surfaced by the curator (via the agent or by hand) and
            // an accidental click on the × shouldn't drop the link
            // silently. The next mutation re-renders the row so the
            // curator sees the result immediately. Paul 2026-06-11.
            const what =
              displayTitle ||
              (publication.pubmed_id ? `PMID ${publication.pubmed_id}` : "this publication");
            if (window.confirm(`Remove “${what}” from this experiment?`)) {
              onDelete();
            }
          }}
          className="text-rose-700 hover:text-rose-900 text-xs"
          title="remove this publication"
        >
          ×
        </button>
      ) : null}
    </li>
  );
}

/** Classify a single curator-typed string as either a PubMed ID or
 *  a DOI. PMIDs are bare integers; DOIs match Crossref's
 *  ``10.NNNN/...`` pattern, optionally with a ``doi:`` prefix or a
 *  ``https://doi.org/`` URL wrapper.
 *
 *  Returns ``null`` for empty / ambiguous input so the caller can
 *  disable submit and show a "unrecognised" hint.
 */
export function parsePmidOrDoi(
  raw: string,
): { kind: "pmid"; value: string } | { kind: "doi"; value: string } | null {
  const v = raw.trim();
  if (!v) return null;
  // PMID: bare digits, length 1+ (PubMed PMIDs are <= 9 digits today
  // but no point hard-coding a length cap — Pub gradually growth.)
  if (/^\d+$/.test(v)) {
    return { kind: "pmid", value: v };
  }
  // DOI: strip optional URL / prefix, then match ``10.NNNN/anything``.
  const stripped = v
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .trim();
  if (/^10\.\d{4,9}\/[^\s]+$/.test(stripped)) {
    return { kind: "doi", value: stripped };
  }
  return null;
}

function AddPublicationForm({
  onAdd,
  accession,
  title,
}: {
  onAdd: (pub: { pubmed_id?: string; doi?: string }) => void;
  accession: string;
  title: string;
}) {
  // One input, auto-classified. PMIDs are integers; DOIs match the
  // ``10.NNNN/...`` Crossref pattern, optionally wrapped in a
  // ``https://doi.org/`` URL or a ``doi:`` prefix. Anything else
  // shows a hint and the submit stays disabled. Two-field UX (one
  // for PMID, one for DOI) was an avoidable hoop — the format
  // disambiguates without curator help.
  const [value, setValue] = useState("");
  const parsed = parsePmidOrDoi(value);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!parsed) return;
    onAdd(
      parsed.kind === "pmid"
        ? { pubmed_id: parsed.value }
        : { doi: parsed.value },
    );
    setValue("");
  }

  // PubMed-search stubs. Two cases when the GEO submitter forgot to
  // link a publication: (1) a paper that mentions the GSE
  // accession in its text, (2) a paper by the dataset's submitter
  // whose title matches. Both open the relevant PubMed query in a
  // new tab — curator picks the right hit, copies the PMID, pastes
  // into the form below. Future: a gemma-mcp skill does this match
  // server-side and pre-fills.
  const accessionQuery = accession ? buildAccessionPubmedUrl(accession) : null;
  const titleQuery = title ? buildTitlePubmedUrl(title) : null;

  return (
    <div className="border-t border-slate-100 pt-2 space-y-2">
      {(accessionQuery || titleQuery) ? (
        <div className="flex items-center gap-2 flex-wrap text-[11px]">
          <span className="text-slate-500">find on PubMed:</span>
          {accessionQuery ? (
            <a
              href={accessionQuery}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sky-700 hover:underline"
              title={`Search PubMed for papers that mention "${accession}"`}
            >
              by accession ({accession}) ↗
            </a>
          ) : null}
          {titleQuery ? (
            <a
              href={titleQuery}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sky-700 hover:underline"
              title="Search PubMed using the experiment title as the query"
            >
              by title ↗
            </a>
          ) : null}
        </div>
      ) : null}
      <form
        onSubmit={submit}
        className="flex items-center gap-1.5 flex-wrap text-[11px]"
      >
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="PubMed ID or DOI"
          className="border border-slate-300 rounded px-1.5 py-0.5 flex-1 min-w-[14rem] font-mono"
          title="Paste a PMID (digits) or a DOI (10.xxxx/yyyy or https://doi.org/...). The form picks the right field for you."
        />
        {/* Tiny inline classifier hint — confirms the input parsed
            and tells the curator which field will be set on submit. */}
        {value.trim() ? (
          <span
            className={
              "text-[10px] uppercase tracking-wide " +
              (parsed ? "text-emerald-700" : "text-rose-700")
            }
          >
            {parsed ? parsed.kind : "unrecognised"}
          </span>
        ) : null}
        <button
          type="submit"
          className="btn primary !px-2 !py-0.5 text-[11px]"
          disabled={!parsed}
        >
          + add
        </button>
      </form>
    </div>
  );
}

/**
 * Find papers that mention the GSE / E-MTAB / etc accession.
 * The accession-as-text query catches papers that cite the dataset
 * in their methods or supplement, which is the most reliable signal
 * when the GEO record itself is missing the publication link.
 */
function buildAccessionPubmedUrl(accession: string): string {
  const q = encodeURIComponent(`"${accession}"`);
  return `https://pubmed.ncbi.nlm.nih.gov/?term=${q}`;
}

/**
 * Title-based search. Less reliable than accession (titles get
 * reworded between the GEO submission and the manuscript) but
 * useful when the accession search returns nothing — often happens
 * with older datasets and brand-new submissions.
 */
function buildTitlePubmedUrl(title: string): string {
  // Strip common GEO boilerplate that hurts title match recall:
  // "[bulk RNA-seq]", "(GSE…)", trailing date stamps, etc.
  const cleaned = title
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\(GSE\d+\)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Quoted full-string match in PubMed's [Title] field. PubMed will
  // fall back to its own term-mapping if the exact match fails.
  const q = encodeURIComponent(`${cleaned}[Title]`);
  return `https://pubmed.ncbi.nlm.nih.gov/?term=${q}`;
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
