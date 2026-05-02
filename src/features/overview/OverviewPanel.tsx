import { useEffect, useMemo, useRef, useState } from "react";
import { useDesignDraft } from "@/features/design/DesignDraftContext";
import { useProposalsForExperiment } from "@/api/proposals";
import { useImportFromGemma } from "@/api/datasets";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { GuidelinePopup } from "@/components/ui/GuidelinePopup";
import { InlineText } from "@/components/ui/InlineText";
import { CategoryPicker } from "@/features/design/CategoryPicker";
import { OntologyTermPicker } from "@/features/design/OntologyTermPicker";
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
import { shortenUri } from "@/lib/curie";
import {
  addPublication,
  addTag,
  deletePublication,
  deleteTag,
  setDesignDescription,
  setDesignTitle,
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
  Factor,
  OntologyTerm,
  Publication,
  Tag,
} from "@/features/experiment/types";
import { AuditDot } from "@/features/audit/AuditDot";
import { tagTarget } from "@/features/audit/targetIds";
import {
  focusByAuditTarget,
  onAuditFocusTarget,
} from "@/lib/scrollToAuditTarget";

/**
 * Read-only experiment summary — title, abstract / description,
 * taxon + assay + platform, source links, publications, sample
 * counts. The banner is kept compact for space; the prose lives
 * here so the curator has somewhere to read the abstract before
 * digging into the design.
 */
export function OverviewPanel() {
  const { draft, apply, isLoading, loadError } = useDesignDraft();

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
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <InlineText
              value={meta?.title ?? ""}
              placeholder="(no title — double-click to add)"
              onCommit={(title) =>
                draft && apply(setDesignTitle(draft, title))
              }
              className="text-sm font-semibold text-slate-900 leading-snug"
            />
          </div>
          <ResyncButton />
        </div>
        {meta ? (
          <TagBar
            tags={meta.tags ?? []}
            biomaterials={meta.biomaterials ?? []}
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
    <SummaryCard label="Design" className="md:col-span-2">
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
                <th className="px-2 py-1.5 text-left border border-slate-200 font-medium w-16">
                  Assays
                </th>
                {standard.map((f) => (
                  <th
                    key={f.id}
                    className="px-2 py-1.5 text-left border border-slate-200 font-medium"
                    title={factorHeaderTooltip(f)}
                  >
                    {factorHeader(f)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={i}
                  className={i % 2 ? "bg-slate-50/40" : "bg-white"}
                >
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
 * Re-pull this experiment's design from real Gemma. Confirms
 * first because the import is destructive on uncommitted edits —
 * the imported Design replaces whatever's in the mock.
 */
function ResyncButton() {
  const { draft, diff } = useDesignDraft();
  const importer = useImportFromGemma();
  const [confirming, setConfirming] = useState(false);

  if (!draft) return null;

  const isDirty = diff.isDirty;
  const ref =
    draft.external_source?.accession ||
    draft.experiment_short_name ||
    String(draft.experiment_id);

  return (
    <div className="flex items-center gap-2 shrink-0">
      {importer.isError ? (
        <span
          className="text-xs text-rose-700 max-w-md truncate"
          title={(importer.error as Error).message}
        >
          import failed: {(importer.error as Error).message}
        </span>
      ) : null}
      <button
        type="button"
        className="btn ghost text-xs"
        onClick={() => setConfirming(true)}
        disabled={importer.isPending}
        title="re-pull this experiment's design from Gemma"
      >
        {importer.isPending ? "re-importing…" : "re-import from Gemma"}
      </button>
      <ConfirmModal
        open={confirming}
        title="Re-import from Gemma?"
        body={
          (isDirty
            ? "You have uncommitted changes to this design. Re-importing replaces the saved Design with whatever Gemma has now; your draft is preserved client-side until you discard it.\n\n"
            : "Replaces the saved Design with whatever Gemma has now. Curator-edited fields stamped on the mock will be overwritten.\n\n") +
          `Will resolve "${ref}" against Gemma.`
        }
        confirmLabel="re-import"
        destructive
        onConfirm={() => {
          setConfirming(false);
          importer.mutate(ref);
        }}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
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

function TagBar({
  tags,
  biomaterials,
}: {
  tags: Tag[];
  biomaterials: Biomaterial[];
}) {
  const { draft, apply } = useDesignDraft();
  const [adding, setAdding] = useState(false);

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

  // Augment inferred tags from ``biomaterial.characteristics`` —
  // Gemma's annotation feed ships only one row per dataset for a
  // BM-source category, so a 6-region cohort surfaces only one
  // organism part. The biomaterials carry the full set; we walk
  // them and build a synth chip per category that captures every
  // distinct value across the cohort.
  const augmentedTags = useMemo(
    () => augmentInferredFromBiomaterials(tags, biomaterials),
    [tags, biomaterials],
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
  const showHeader =
    visibleTags.length > 0 || draft != null;
  if (!showHeader) return null;
  return (
    <div className="flex items-baseline gap-1 flex-wrap pt-1">
      <span className="text-[11px] uppercase tracking-wide text-slate-500 mr-1">
        tags
      </span>
      <EditableDirectTagGroups tags={direct} />
      <TagGroups
        tags={inferred}
        variant="inferred"
        charUriLookup={charUriLookup}
      />
      {draft && !adding ? (
        <button
          type="button"
          className="text-[11px] text-slate-500 hover:text-emerald-800 hover:bg-emerald-50 border border-dashed border-slate-300 hover:border-emerald-300 rounded px-1.5 py-0.5 ml-1"
          onClick={() => setAdding(true)}
        >
          + tag
        </button>
      ) : null}
      {draft && adding ? (
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
      ) : null}
    </div>
  );
}

/** Inferred-tag augmenter: synthesises one chip per category from
 *  the biomaterial characteristics, capturing every distinct value
 *  across the cohort. Gemma's annotation feed only returns one row
 *  per (dataset, category) pair for BioMaterial-source annotations,
 *  so a 165-sample cohort with 6 organism_part values surfaces just
 *  one chip without this. Direct (curator-attached) tags are passed
 *  through untouched. Inferred tags whose category is also covered
 *  by biomaterial characteristics are dropped — the synth supersedes
 *  them with the comprehensive value set.
 *
 *  The synth chip uses ``inferred_source: "BioMaterial"`` and
 *  ``evidence_code: "IIA"`` because biomaterial characteristics on
 *  imported datasets came in via Gemma's GEO load. URIs flow
 *  through ``charUriLookup`` at split-time, so per-value chips
 *  render ontology-resolved when the underlying characteristic_uris
 *  carry term URIs. */
export function augmentInferredFromBiomaterials(
  tags: Tag[],
  biomaterials: Biomaterial[],
): Tag[] {
  // Walk every biomaterial's characteristics; collect distinct
  // values per category (label-cased original) and remember the
  // category's display capitalisation.
  const valuesByCat = new Map<string, Set<string>>();
  const catLabels = new Map<string, string>();
  for (const bm of biomaterials) {
    const chars = bm.characteristics ?? {};
    for (const [catLabel, valLabel] of Object.entries(chars)) {
      const cat = (catLabel || "").trim();
      const val = (valLabel || "").trim();
      if (!cat || !val) continue;
      const key = cat.toLowerCase();
      if (!catLabels.has(key)) catLabels.set(key, cat);
      const set = valuesByCat.get(key) ?? new Set<string>();
      set.add(val);
      valuesByCat.set(key, set);
    }
  }
  if (valuesByCat.size === 0) return tags;

  // Categories that already have a direct (curator-attached) tag.
  // The synth shouldn't steal a category the curator has explicitly
  // claimed — surfacing both the direct tag AND a BM-derived synth
  // for the same category gives the curator two competing signals.
  // Skip the synth for those categories.
  const directCats = new Set<string>();
  for (const t of tags) {
    if (t.inferred) continue;
    const k = (t.category.label || "").toLowerCase();
    if (k) directCats.add(k);
  }

  // Drop existing inferred tags whose category is covered by
  // biomaterial characteristics AND not already claimed by a direct
  // tag — the synth will supersede those.
  const augmented: Tag[] = [];
  for (const t of tags) {
    if (!t.inferred) {
      augmented.push(t);
      continue;
    }
    const k = (t.category.label || "").toLowerCase();
    if (valuesByCat.has(k) && !directCats.has(k)) continue;
    augmented.push(t);
  }

  // Negative ids keep the synth tags out of the way of any real
  // (server-assigned) tag id space. They're ephemeral display
  // entries; never round-tripped to the server.
  let nextSynthId = -1;
  for (const [catKey, valSet] of valuesByCat.entries()) {
    if (directCats.has(catKey)) continue;
    const sortedValues = Array.from(valSet).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
    augmented.push({
      id: nextSynthId--,
      category: { label: catLabels.get(catKey) || catKey, uri: null },
      value: { label: sortedValues.join(", "), uri: null },
      inferred: true,
      inferred_source: "BioMaterial",
      evidence_code: "IIA",
    });
  }
  return augmented;
}

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
        placeholder="value"
        onCommit={(next) => setVal(next ?? null)}
      />
      <button
        type="button"
        className="ml-1 px-1 text-emerald-800 hover:text-emerald-950 disabled:opacity-40"
        onClick={() => canSave && onCommit(cat!, val!)}
        disabled={!canSave}
        title={canSave ? "save" : "fill category and value first"}
      >
        ✓
      </button>
      <button
        type="button"
        className="px-1 text-slate-500 hover:text-slate-800"
        onClick={onCancel}
        title="cancel"
      >
        ✕
      </button>
      {onDelete ? (
        <button
          type="button"
          className="px-1 text-rose-700 hover:text-rose-900"
          onClick={onDelete}
          title="delete tag"
        >
          🗑
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
): TagValue[] {
  const catKey = (category.label || "").trim().toLowerCase();
  const out: TagValue[] = [];
  for (const t of tags) {
    const label = (t.value.label || "").trim();
    if (!label) continue;
    const parts = label.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length <= 1) {
      out.push({ label, uri: t.value.uri ?? null, key: `${t.id}:${label}` });
    } else {
      // Comma-joined synth value — the tag's own URI doesn't
      // carry to the parts. Look each part up against
      // biomaterial.characteristic_uris; "female" → PATO_0000383
      // etc. when Gemma's preprocessor mapped it. Falls back to
      // null (free-text styling) when no match.
      parts.forEach((p, i) => {
        const uri =
          charUriLookup.get(`${catKey}|${p.toLowerCase()}`) ?? null;
        out.push({ label: p, uri, key: `${t.id}:${i}:${p}` });
      });
    }
  }
  return out;
}

/** Per-value chip styled by URI presence: emerald + medium-weight
 *  for ontology-resolved, slate + italic for free-text. House
 *  standard — green is reserved for "ontology-backed". */
function TagValueChip({ value }: { value: TagValue }) {
  if (value.uri) {
    return (
      <span
        title={`${value.label} — ${value.uri}`}
        className="inline-block px-1 rounded bg-emerald-50 border border-emerald-200 text-emerald-900 font-medium"
      >
        {value.label}
      </span>
    );
  }
  return (
    <span
      title={`${value.label} (free text — no ontology URI)`}
      className="inline-block px-1 rounded bg-slate-50 border border-slate-200 text-slate-700 italic"
    >
      {value.label}
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
}: {
  tags: Tag[];
  variant: TagGroupVariant;
  charUriLookup: Map<string, string>;
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
function EditableDirectTagGroups({ tags }: { tags: Tag[] }) {
  if (tags.length === 0) return null;
  const groups = groupTagsByCategoryLabel(tags);
  return (
    <>
      {[...groups.values()].map((g) => (
        <EditableDirectGroupChip
          key={(g.category.label || g.category.uri) + ":direct"}
          category={g.category}
          tags={g.tags}
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
}: {
  category: Tag["category"];
  tags: Tag[];
}) {
  const { draft, apply } = useDesignDraft();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

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

  // Single tag — render flat, click to edit, × on hover.
  if (tags.length === 1) {
    const tag = tags[0];
    if (editingId === tag.id) {
      return (
        <ChipEditor
          category={tag.category}
          value={tag.value}
          onCancel={() => setEditingId(null)}
          onCommit={(c, v) => commitEdit(tag, c, v)}
          onDelete={() => deleteOne(tag.id)}
        />
      );
    }
    return (
      <span
        // Audit focus hook — Apply & focus on a tag finding scrolls
        // this chip into view + ring-flashes it.
        data-audit-target={tagTarget(tag.category.label, tag.value.label)}
        className="group inline-flex items-baseline gap-1 text-[11px] px-1.5 py-0.5 rounded border bg-emerald-50 border-emerald-200 text-emerald-900 cursor-pointer hover:bg-emerald-100"
        onClick={() => setEditingId(tag.id)}
        title={`${category.label}: ${tag.value.label} — click to edit`}
      >
        <span className="text-emerald-900/75">{category.label}</span>
        <span className="font-medium">
          {tag.value.label || <em className="not-italic">no value</em>}
        </span>
        <AuditDot
          targetId={tagTarget(tag.category.label, tag.value.label)}
        />
        <button
          type="button"
          className="ml-1 text-emerald-700/60 hover:text-rose-700 opacity-0 group-hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            deleteOne(tag.id);
          }}
          title="delete tag"
          aria-label="delete tag"
        >
          ×
        </button>
      </span>
    );
  }

  // Multi-tag — collapse like the read-only inferred groups, but each
  // value chip in the expanded view is independently editable.
  return (
    <span className="inline-flex items-baseline gap-1 text-[11px] rounded border px-1.5 py-0.5 bg-emerald-50 border-emerald-200 text-emerald-900">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-baseline gap-1 hover:underline underline-offset-2"
        title={
          open
            ? "click to collapse"
            : `click to expand ${tags.length} ${category.label} tags`
        }
      >
        <span className="text-emerald-900/75">{category.label}</span>
        <span className="font-medium">{tags.length} values</span>
        <span className="text-emerald-900/75">{open ? "▾" : "▸"}</span>
      </button>
      {open ? (
        <span className="inline-flex items-baseline gap-1 flex-wrap ml-1 pl-1 border-l border-emerald-200">
          {tags.map((tag) =>
            editingId === tag.id ? (
              <ChipEditor
                key={tag.id}
                category={tag.category}
                value={tag.value}
                onCancel={() => setEditingId(null)}
                onCommit={(c, v) => commitEdit(tag, c, v)}
                onDelete={() => deleteOne(tag.id)}
              />
            ) : (
              <span
                key={tag.id}
                data-audit-target={tagTarget(tag.category.label, tag.value.label)}
                className="group inline-flex items-baseline gap-1 px-1 rounded bg-emerald-50 border border-emerald-200/70 cursor-pointer hover:bg-emerald-100"
                onClick={() => setEditingId(tag.id)}
                title="click to edit"
              >
                <span>{tag.value.label || "(blank)"}</span>
                <AuditDot
                  targetId={tagTarget(tag.category.label, tag.value.label)}
                />
                <button
                  type="button"
                  className="ml-1 text-emerald-700/60 hover:text-rose-700 opacity-0 group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteOne(tag.id);
                  }}
                  title="delete tag"
                  aria-label="delete tag"
                >
                  ×
                </button>
              </span>
            ),
          )}
        </span>
      ) : (
        <span className="italic ml-1 truncate max-w-[24ch] text-emerald-900/60">
          {tags
            .slice(0, 2)
            .map((t) => t.value.label || "(blank)")
            .join(", ")}
          {tags.length > 2 ? "…" : ""}
        </span>
      )}
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

function TagGroupChip({
  category,
  tags,
  variant,
  charUriLookup,
}: {
  category: Tag["category"];
  tags: Tag[];
  variant: TagGroupVariant;
  charUriLookup: Map<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const values = splitTagValues(tags, category, charUriLookup);

  // Single value (after comma-split) renders flat — no collapse to
  // worry about.
  // Outer chip color signals direct (curator-attached) vs
  // inferred (auto). Per-value URI styling lives on top so the
  // curator can still see ontology vs free-text inside.
  // House rule: amber means **warning** only — inferred is
  // informational, so it gets a violet palette instead.
  const outerCls =
    variant === "inferred"
      ? "bg-violet-50 border-violet-200"
      : "bg-emerald-50 border-emerald-200";
  const labelCls =
    variant === "inferred" ? "text-violet-900/75" : "text-emerald-900/75";
  const dividerCls =
    variant === "inferred" ? "border-violet-200" : "border-emerald-200";

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
  const sourceLabel =
    variant === "inferred" ? (sources.length > 0 ? sources.join("/") : "auto") : "";

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
  // Mixed-code groups: the lower-trust code wins for the visual
  // cue. Only solid when *every* tag in the group is curator-
  // asserted. Inferred chips with no evidence code (legacy data,
  // BM-synth tags) still render dashed — solid is reserved for
  // explicit IC. Direct (curator-attached) chips are always solid.
  const evBorder =
    variant === "inferred"
      ? evCodes.length > 0 && evCodes.every((c) => c === "IC")
        ? "border-solid"
        : "border-dashed"
      : "border-solid";
  const evBadge = evCodes.length > 0 ? evCodes.join("/") : "";
  const evTitle =
    evCodes.length === 1
      ? ` · ${evCodes[0]} (${evidenceCodeName(evCodes[0])})`
      : evCodes.length > 1
        ? ` · evidence: ${evCodes.join(", ")}`
        : "";

  if (values.length === 1) {
    const v = values[0];
    return (
      <span
        title={`${category.label}: ${v.label}${variant === "inferred" ? ` (inferred from ${sources.join(", ") || "auto"})${evTitle}` : ""}`}
        className={`inline-flex items-baseline gap-1 text-[11px] px-1.5 py-0.5 rounded border ${evBorder} ${outerCls}`}
      >
        <span className={labelCls}>{category.label}</span>
        <TagValueChip value={v} />
        {variant === "inferred" ? (
          <span className="text-[9px] uppercase tracking-wide text-violet-700/70 ml-0.5">
            {sourceLabel}
          </span>
        ) : null}
        {evBadge ? (
          <span className="text-[9px] uppercase tracking-wide text-violet-700/70 ml-0.5">
            {evBadge}
          </span>
        ) : null}
      </span>
    );
  }

  // Multi-value: collapse, with a preview of the first 2 in the
  // closed state.
  return (
    <span
      className={`inline-flex items-baseline gap-1 text-[11px] rounded border ${evBorder} px-1.5 py-0.5 ${outerCls}`}
      title={evTitle ? evTitle.replace(/^\s·\s/, "") : undefined}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-baseline gap-1 hover:underline underline-offset-2"
        title={
          open
            ? "click to collapse"
            : `click to expand ${values.length} ${category.label} values`
        }
      >
        <span className={labelCls}>{category.label}</span>
        <span className={`font-medium ${variant === "inferred" ? "text-violet-900" : "text-emerald-900"}`}>
          {values.length} values
        </span>
        <span className={labelCls}>{open ? "▾" : "▸"}</span>
      </button>
      {variant === "inferred" ? (
        <span className="text-[9px] uppercase tracking-wide text-violet-700/70 ml-0.5">
          {sourceLabel}
        </span>
      ) : null}
      {evBadge ? (
        <span className="text-[9px] uppercase tracking-wide text-violet-700/70 ml-0.5">
          {evBadge}
        </span>
      ) : null}
      {open ? (
        <span
          className={`inline-flex items-baseline gap-1 flex-wrap ml-1 pl-1 border-l ${dividerCls}`}
        >
          {values.map((v) => (
            <TagValueChip key={v.key} value={v} />
          ))}
        </span>
      ) : (
        <span className={`italic ml-1 truncate max-w-[24ch] ${labelCls}`}>
          {values
            .slice(0, 2)
            .map((v) => v.label)
            .join(", ")}
          {values.length > 2 ? "…" : ""}
        </span>
      )}
    </span>
  );
}

/**
 * Read mode: paragraphs split on blank lines, scrolling.
 * Edit mode (double-click to enter): textarea, Esc to revert,
 * Cmd/Ctrl-Enter to commit, blur to commit. Same pattern as
 * InlineText but multiline.
 */
function EditableDescription({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (!editing) {
    const paragraphs = value
      .split(/\n\s*\n/)
      .filter((p) => p.trim());
    return (
      <div
        role="button"
        tabIndex={0}
        onDoubleClick={() => {
          setDraft(value);
          setEditing(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setDraft(value);
            setEditing(true);
          }
        }}
        className="text-xs text-slate-700 leading-relaxed space-y-1.5 max-h-[24rem] overflow-y-auto cursor-text hover:bg-blue-50/60 dark:hover:bg-slate-700/30 rounded px-1 -mx-1"
        title="double-click to edit"
      >
        {paragraphs.length === 0 ? (
          <p className="italic text-slate-400">
            (no description — double-click to add)
          </p>
        ) : (
          paragraphs.map((p, i) => (
            <p key={i} className="whitespace-pre-wrap">
              {p}
            </p>
          ))
        )}
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
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={"card p-3" + (className ? " " + className : "")}>
      <div className="text-xs text-slate-500 uppercase tracking-wide mb-2">
        {label}
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
  const pmidUrl = publication.pubmed_id
    ? `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(publication.pubmed_id)}/`
    : null;
  const doiUrl = publication.doi
    ? `https://doi.org/${encodeURIComponent(publication.doi)}`
    : null;
  return (
    <li className="flex items-start gap-2">
      <div className="flex-1 min-w-0">
        <div className="font-medium text-slate-800 leading-snug">
          {publication.title || publication.citation || (
            <span className="italic text-slate-400">(metadata not fetched yet)</span>
          )}
        </div>
        {publication.citation && publication.title ? (
          <div className="text-slate-500 italic">{publication.citation}</div>
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
              {shortenUri(`https://doi.org/${publication.doi}`)} ↗
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
            title={publication.title || publication.citation || ""}
            excerpt={abstract}
            tone="annotated"
            onClose={() => setAbstractOpen(false)}
          />
        ) : null}
      </div>
      {onDelete ? (
        <button
          type="button"
          onClick={onDelete}
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
        <button type="submit" className="btn primary" disabled={!parsed}>
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
