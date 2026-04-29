import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useCurationDetails } from "@/api/curation";
import { useQuantitationTypes, type QuantitationType } from "@/api/quantitation";
import { useAuditEvents, type AuditEvent } from "@/api/history";
import { useDesignDraft } from "@/features/design/DesignDraftContext";
import { experimentPageUrl, platformPageUrl } from "@/lib/gemmaUrls";
import { validateDesign, type Design } from "@/features/experiment/types";

/**
 * Pre-publish checklist mirroring the Confluence
 * `Experiment-Checklist` page (with extras drawn from
 * `Check-the-Diagnostics-Tab` for PCA Scree / PCA+Factors). Items
 * split into two kinds:
 *
 *  - **auto**: derivable from the loaded Design / CurationDetails /
 *    QT list / audit trail. Tick-mark + reason are computed.
 *  - **manual**: requires the curator's eye on a plot or an
 *    external page. Click to tick. Each manual item carries an
 *    inline `details` block surfacing whatever local data is
 *    relevant (current value, deep link to the Gemma page that
 *    hosts the artifact, etc.) so the curator doesn't have to
 *    leave the diagnostics tab to make the call.
 *
 * Manual ticks persist in `localStorage` per experiment, keyed by a
 * freshness signal: the date of the most recent
 * `ExperimentalDesignUpdatedEvent`. When that advances we clear
 * ticks — a design change invalidates the curator's prior
 * walk-through. Other audit events (notes, comments,
 * needs-attention flips) do not invalidate ticks.
 */

const STORAGE_PREFIX = "pre-publish-checklist:";

/**
 * Persisted shape: which manual ticks the curator has filled, plus
 * the freshness signal at the time of writing. When the signal
 * doesn't match the current one we clear ticks (the design changed
 * since the walk-through).
 */
interface StoredChecklist {
  ticks: string[];
  signal: string;
}

function readStorage(experimentId: number): StoredChecklist | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + experimentId);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      Array.isArray(parsed.ticks) &&
      typeof parsed.signal === "string"
    ) {
      return parsed as StoredChecklist;
    }
    return null;
  } catch {
    return null;
  }
}

function writeStorage(experimentId: number, value: StoredChecklist): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STORAGE_PREFIX + experimentId,
      JSON.stringify(value),
    );
  } catch {
    // Quota / disabled storage — checklist still works in-memory.
  }
}

function loadStoredTicks(experimentId: number): Set<string> {
  const stored = readStorage(experimentId);
  return new Set(stored?.ticks ?? []);
}

type ChecklistItem =
  | {
      section: string;
      kind: "auto";
      id: string;
      label: string;
      ok: boolean;
      reason: string;
      details?: ReactNode;
    }
  | {
      section: string;
      kind: "manual";
      id: string;
      label: string;
      hint?: string;
      details?: ReactNode;
    }
  | {
      // Not-applicable: derived from data when there's nothing to
      // check (e.g. "checked for batch confounds" when no batch
      // factor exists). Counts as done; the curator can't tick or
      // untick it.
      section: string;
      kind: "na";
      id: string;
      label: string;
      reason: string;
    };

export function PrePublishChecklist({ experimentId }: { experimentId: number }) {
  // Read from the draft (not the committed server state) so an edit
  // on another tab — e.g. linking a publication via the Overview's
  // FindPublicationButton — shows up in the checklist without
  // round-tripping a commit. Other tabs already edit through the
  // draft, so this matches the rest of the editor.
  const { draft: design } = useDesignDraft();
  const { data: curation } = useCurationDetails(experimentId);
  const { data: qts } = useQuantitationTypes(experimentId);
  const { data: events } = useAuditEvents(experimentId);

  // Freshness signal: newest ExperimentalDesignUpdatedEvent date. We
  // intentionally ignore comments / note / attention events — those
  // don't change the structural state the checklist is about.
  const designUpdatedAt = useMemo(
    () =>
      events?.find((e) => e.event_type === "ExperimentalDesignUpdatedEvent")
        ?.date ?? null,
    [events],
  );

  const [manualTicks, setManualTicks] = useState<Set<string>>(() =>
    loadStoredTicks(experimentId),
  );
  const [stored, setStored] = useState<StoredChecklist | null>(() =>
    readStorage(experimentId),
  );

  // Per-section open/closed override. When a section is absent from
  // this map we derive its open state from completion (open until
  // ready, then auto-collapse). Once the curator clicks the header
  // their preference sticks.
  const [sectionOpen, setSectionOpen] = useState<Record<string, boolean>>({});

  // Reset ticks if the experiment changes (component reuse across
  // navigations) or the design-update signal advances past what we
  // have stored.
  useEffect(() => {
    setManualTicks(loadStoredTicks(experimentId));
    setStored(readStorage(experimentId));
    setSectionOpen({});
  }, [experimentId]);

  useEffect(() => {
    if (!designUpdatedAt) return;
    if (stored && stored.signal && stored.signal !== designUpdatedAt) {
      setManualTicks(new Set());
      writeStorage(experimentId, { ticks: [], signal: designUpdatedAt });
      setStored({ ticks: [], signal: designUpdatedAt });
    }
  }, [designUpdatedAt, experimentId, stored]);

  // Persist on tick change, once we know the signal.
  useEffect(() => {
    if (!designUpdatedAt) return;
    writeStorage(experimentId, {
      ticks: [...manualTicks],
      signal: designUpdatedAt,
    });
  }, [manualTicks, designUpdatedAt, experimentId]);

  const items = useMemo<ChecklistItem[] | null>(() => {
    if (!design) return null;
    return buildItems({ design, curation, qts, events });
  }, [design, curation, qts, events]);

  // Prune stale tick ids — an item the curator ticked may no longer
  // be in the rendered list (e.g. mean-variance row hides on
  // non-microarray, or a checklist refactor renamed an id). Without
  // this the stale ticks silently inflate the "done" count.
  useEffect(() => {
    if (!items) return;
    const validManualIds = new Set(
      items.filter((it) => it.kind === "manual").map((it) => it.id),
    );
    setManualTicks((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (validManualIds.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [items]);

  if (!items) {
    return (
      <div className="card p-3 text-sm text-slate-500">loading checklist…</div>
    );
  }

  // Group items by section and compute aggregate progress.
  const bySection = new Map<string, ChecklistItem[]>();
  for (const it of items) {
    if (!bySection.has(it.section)) bySection.set(it.section, []);
    bySection.get(it.section)!.push(it);
  }
  const isDone = (it: ChecklistItem) =>
    it.kind === "auto"
      ? it.ok
      : it.kind === "na"
        ? true
        : manualTicks.has(it.id);
  const totalDone = items.filter(isDone).length;
  const totalCount = items.length;
  const allReady = totalDone === totalCount;

  function toggle(id: string) {
    setManualTicks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function tickAll(ids: string[]) {
    setManualTicks((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
  }

  // Each section is collapsed by default — the curator opens what
  // they're working on. Warning chips on collapsed sections (red)
  // signal "there's something to look at hidden in here". The
  // expand-all / collapse-all toggle below sets every section's
  // override at once.
  const sectionNames = [...new Set(items.map((it) => it.section))];
  const allExpanded = sectionNames.every(
    (name) => (sectionOpen[name] ?? false) === true,
  );
  const anyExpanded = sectionNames.some(
    (name) => (sectionOpen[name] ?? false) === true,
  );
  function setAllSections(open: boolean) {
    setSectionOpen(
      Object.fromEntries(sectionNames.map((name) => [name, open])),
    );
  }
  return (
    <div className="card">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 gap-3 flex-wrap">
        <div className="flex items-baseline gap-2">
          <span className="section-h">Pre-publish checklist</span>
          <span className="text-xs text-slate-500">
            {totalDone} / {totalCount} ready
          </span>
        </div>
        <div className="flex items-baseline gap-2">
          <button
            type="button"
            onClick={() => setAllSections(!anyExpanded)}
            className="text-[11px] text-blue-700 hover:underline"
            title={
              allExpanded
                ? "collapse every section"
                : anyExpanded
                  ? "collapse every section"
                  : "expand every section"
            }
          >
            {anyExpanded ? "collapse all" : "expand all"}
          </button>
          {allReady ? (
            <span className="text-[11px] uppercase tracking-wide font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-0.5">
              ready to publish
            </span>
          ) : (
            <span className="text-[11px] uppercase tracking-wide font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">
              in progress
            </span>
          )}
        </div>
      </div>

      {/*
        Section grid. Sections render side-by-side on wider viewports
        so the checklist uses the horizontal space instead of being a
        25-row vertical scroll. Each section is a lightly-bordered
        sub-card with its own progress count; items inside collapse
        their bullet-list "what to check" guides via <details> while
        keeping the at-a-glance reason / chips visible.
       */}
      <div className="p-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {[...bySection.entries()].map(([section, sectionItems]) => {
          const sectionDone = sectionItems.filter(isDone).length;
          const sectionTotal = sectionItems.length;
          const sectionReady = sectionDone === sectionTotal;
          // "Warning" = an auto item the validator failed. These are
          // concrete data problems the curator needs to look at; the
          // chip turns red so a collapsed section can't hide them.
          const warningCount = sectionItems.filter(
            (it) => it.kind === "auto" && !it.ok,
          ).length;
          const untickedManualIds = sectionItems
            .filter((it) => it.kind === "manual" && !manualTicks.has(it.id))
            .map((it) => it.id);
          // Panel state: untouched (no done) → neutral, in-progress
          // (some done) → light green, complete → darker green. The
          // panel coloring is independent of the warning signal —
          // a section with progress + warnings still reads "you've
          // started here" while the chip says "and there are issues".
          const sectionState =
            sectionReady
              ? "ready"
              : sectionDone > 0
                ? "progress"
                : "idle";
          const sectionCls =
            sectionState === "ready"
              ? "border-emerald-400 bg-emerald-100/70"
              : sectionState === "progress"
                ? "border-emerald-200 bg-emerald-50/60"
                : "border-slate-200";
          // Warning chip wins over progress chip when there are any
          // failing auto items. Otherwise the chip tracks the
          // existing progress palette.
          const sectionCountCls =
            warningCount > 0
              ? "text-rose-800 bg-rose-50 border border-rose-200 px-1 rounded"
              : sectionState === "ready"
                ? "text-emerald-800"
                : sectionState === "progress"
                  ? "text-emerald-700"
                  : "text-slate-500";
          // Default: every section starts collapsed; the curator
          // opens what they want to work on. Override sticks until
          // experiment / design changes.
          const expanded = sectionOpen[section] ?? false;
          return (
            <section
              key={section}
              className={
                "border rounded-md self-start transition-colors " +
                sectionCls
              }
            >
              <header
                className="flex items-baseline justify-between gap-2 px-2 py-1.5 cursor-pointer select-none rounded-md hover:bg-black/[0.02]"
                onClick={() =>
                  setSectionOpen((prev) => ({
                    ...prev,
                    [section]: !expanded,
                  }))
                }
                title={expanded ? "collapse section" : "expand section"}
              >
                <span className="flex items-baseline gap-1.5 min-w-0">
                  <span
                    className={
                      "text-slate-400 text-[10px] inline-block transition-transform " +
                      (expanded ? "rotate-90" : "")
                    }
                  >
                    ▸
                  </span>
                  <span className="text-[11px] uppercase tracking-wide font-semibold text-slate-600 truncate">
                    {section}
                  </span>
                </span>
                <span className="flex items-baseline gap-2 shrink-0">
                  {expanded && untickedManualIds.length > 0 ? (
                    // Discreet bulk-tick. Hidden when collapsed and
                    // when nothing is left to tick — avoids becoming
                    // a habit-button. Stops propagation so it
                    // doesn't also collapse the section.
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        tickAll(untickedManualIds);
                      }}
                      className="text-[10px] text-blue-700 hover:underline"
                      title={`tick the ${untickedManualIds.length} manual item${untickedManualIds.length === 1 ? "" : "s"} in this section`}
                    >
                      tick all
                    </button>
                  ) : null}
                  <span
                    className={
                      "text-[10px] tabular-nums font-semibold " +
                      sectionCountCls
                    }
                    title={
                      warningCount > 0
                        ? `${warningCount} validator warning${warningCount === 1 ? "" : "s"} in this section — expand to see`
                        : undefined
                    }
                  >
                    {sectionDone}/{sectionTotal}
                    {sectionReady
                      ? " ✓"
                      : warningCount > 0
                        ? ` · ${warningCount} ⚠`
                        : ""}
                  </span>
                </span>
              </header>
              {expanded ? (
                <ul className="space-y-1.5 px-2 pb-2">
                  {sectionItems.map((it) => {
                    if (it.kind === "na") {
                      return (
                        <li
                          key={it.id}
                          className="flex items-start gap-2 text-sm opacity-60"
                        >
                          <span className="mt-1 inline-block w-4 text-center text-[11px] text-slate-400">
                            —
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="leading-snug text-slate-600">
                              {it.label}
                              <span className="ml-1 text-[10px] uppercase tracking-wide text-slate-400">
                                n/a
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {it.reason}
                            </div>
                          </div>
                        </li>
                      );
                    }
                    const ticked =
                      it.kind === "auto" ? it.ok : manualTicks.has(it.id);
                    const reason = it.kind === "auto" ? it.reason : null;
                    const hint = it.kind === "manual" ? it.hint : null;
                    const isWarning = it.kind === "auto" && !it.ok;
                    return (
                      <li
                        key={it.id}
                        className={
                          "flex items-start gap-2 text-sm " +
                          (isWarning
                            ? "bg-rose-50/70 border-l-2 border-rose-400 -mx-2 px-2 py-1 rounded-sm"
                            : "")
                        }
                      >
                        <input
                          type="checkbox"
                          checked={ticked}
                          onChange={() => {
                            if (it.kind === "manual") toggle(it.id);
                          }}
                          disabled={it.kind === "auto"}
                          className="mt-1"
                          title={
                            it.kind === "auto"
                              ? "auto-determined"
                              : "click to tick"
                          }
                        />
                        <div className="flex-1 min-w-0">
                          <div
                            className={
                              "leading-snug " +
                              (ticked ? "text-slate-700" : "text-slate-900")
                            }
                          >
                            {it.label}
                            {it.kind === "auto" ? (
                              <span className="ml-1 text-[10px] uppercase tracking-wide text-slate-400">
                                auto
                              </span>
                            ) : null}
                          </div>
                          {reason ? (
                            <div
                              className={
                                "text-[11px] " +
                                (isWarning
                                  ? "text-rose-800"
                                  : "text-slate-500")
                              }
                            >
                              {reason}
                            </div>
                          ) : hint ? (
                            <div className="text-[11px] text-slate-500">
                              {hint}
                            </div>
                          ) : null}
                          {it.details ? (
                            <div className="mt-1">{it.details}</div>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

function buildItems({
  design,
  curation,
  qts,
  events,
}: {
  design: Design;
  curation: ReturnType<typeof useCurationDetails>["data"];
  qts: QuantitationType[] | undefined;
  events: AuditEvent[] | undefined;
}): ChecklistItem[] {
  const validation = validateDesign(design);
  const expUrl = experimentPageUrl(design.experiment_id);
  const platformUrl = platformPageUrl(null, design.platform_id);

  const techType = (design.technology_type ?? "").toUpperCase();
  const isMicroarray = techType === "ONECOLOR" || techType === "TWOCOLOR";
  const isTwoColor = techType === "TWOCOLOR";
  const isPlaceholderTech =
    techType === "OTHER" || techType === "GENELIST" || techType === "";

  const hasPub = (design.publications?.length ?? 0) > 0;
  const hasTags = (design.tags?.length ?? 0) > 0;
  const batchFactor = design.factors.find((f) => {
    const cat = (f.category?.label ?? "").toLowerCase();
    const name = (f.name ?? "").toLowerCase();
    return cat === "block" || cat === "batch" || /batch|block/.test(name);
  });
  const allAssigned = validation.factors.every(
    (s) => s.unassigned_biomaterials.length === 0,
  );
  const baselinesOk = validation.factors.every((s) => s.baseline_count === 1);
  const noUnknownPredicates = validation.factors.every(
    (s) => s.unknown_predicates === 0,
  );

  const prefQts = (qts ?? []).filter((q) => q.is_preferred);
  const maskedPrefQts = (qts ?? []).filter((q) => q.is_masked_preferred);

  const failEvents = (events ?? []).filter((e) => isFailureEvent(e));

  const sampleCount = design.biomaterials.length;
  // Display the descriptive platform name; ``platform_short_name`` is
  // a URL-building token (Gemma-internal, not human-friendly) so it's
  // a poor fallback. ``original_platform_short_name`` is the source-DB
  // accession (e.g. ``GPL570``) — short *and* informative, so it's
  // worth surfacing alongside the name when it exists.
  const platformLabel = design.platform || "(no platform)";
  const showOrigPlatform =
    !!design.original_platform &&
    design.original_platform !== design.platform;
  const origPlatformAlias =
    design.original_platform_short_name || design.original_platform || "";

  return [
    // -- Details / overall ---------------------------------------------
    {
      section: "Details",
      kind: "manual",
      id: "samples-platform-correct",
      label: "Number of samples and platform is correct",
      details: (
        <Inline>
          <Chip>{sampleCount} samples</Chip>
          <Chip title={design.platform || undefined}>{platformLabel}</Chip>
          {showOrigPlatform ? (
            <Chip
              title={
                design.original_platform &&
                design.original_platform !== origPlatformAlias
                  ? `original: ${design.original_platform}`
                  : undefined
              }
            >
              orig: {origPlatformAlias}
            </Chip>
          ) : null}
          {platformUrl ? <ExtLink href={platformUrl}>platform on Gemma</ExtLink> : null}
          {design.external_source ? (
            <ExtLink href={externalSourceLink(design)}>
              {design.external_source.database}:{" "}
              {design.external_source.accession}
            </ExtLink>
          ) : null}
        </Inline>
      ),
    },
    {
      section: "Details",
      kind: "manual",
      id: "taxon-correct",
      label: "Correct taxon is annotated",
      details: (
        <Inline>
          <Chip tone={design.taxon ? "default" : "amber"}>
            {design.taxon || "no taxon set"}
          </Chip>
        </Inline>
      ),
    },
    {
      section: "Details",
      kind: "manual",
      id: "platform-usable",
      label: "Platform not unusable / two-colour / dual mode",
      hint:
        isTwoColor
          ? "two-colour platform — confirm Gemma's processing handles this experiment"
          : isPlaceholderTech
            ? "technology classifier is a placeholder — verify the platform"
            : undefined,
      details: (
        <Inline>
          <Chip
            tone={
              isTwoColor || isPlaceholderTech
                ? "amber"
                : "default"
            }
          >
            {techType || "UNKNOWN"}
          </Chip>
          <Chip>{design.assay || "—"}</Chip>
        </Inline>
      ),
    },
    {
      section: "Details",
      kind: "manual",
      id: "dea-looks-ok",
      label:
        "Differential expression analysis looks ok (p-values, charts, baseline)",
      details: (
        <DetailBlock link={expUrl}>
          <WhatToCheck
            items={[
              "p-value distribution: not uniformly flat (no signal) and no suspicious peaks at non-zero p-values",
              "all DEA charts render without errors",
              "the selected baseline FV is the correct biological reference",
            ]}
          />
        </DetailBlock>
      ),
    },
    {
      section: "Details",
      kind: "manual",
      id: "publication-linked",
      label: "Publication linked or confirmed unpublished",
      hint: hasPub
        ? `${design.publications!.length} publication(s) linked — confirm it's the right one`
        : "no publication linked — confirm you've searched and the dataset is unpublished",
      details: hasPub ? (
        <ul className="text-[11px] text-slate-700 space-y-0.5">
          {design.publications!.slice(0, 3).map((p, i) => (
            <li key={i} className="truncate">
              {p.pubmed_id ? (
                <a
                  href={`https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(p.pubmed_id)}/`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-700 hover:underline"
                >
                  PMID {p.pubmed_id}
                </a>
              ) : null}
              {p.pubmed_id && p.citation ? " — " : null}
              {p.citation || p.title || ""}
            </li>
          ))}
          {design.publications!.length > 3 ? (
            <li className="text-slate-500">
              + {design.publications!.length - 3} more
            </li>
          ) : null}
        </ul>
      ) : (
        <DetailBlock link={expUrl}>
          <WhatToCheck
            items={[
              "Overview tab → Publications card has a 'search GEO for linked publications' button",
              "search PubMed by contributor name (GEO links the contributors directly into a PubMed search)",
              "for the GSE accession or paper title, Google can be faster than PubMed",
              "if published but not on PubMed, link it in the description and add a curator note",
              "if unpublished, write 'missing publication' on the Master Curation List",
            ]}
          />
        </DetailBlock>
      ),
    },
    // -- Experimental Design -------------------------------------------
    {
      section: "Experimental Design",
      kind: "auto",
      id: "design-valid",
      label: "Design validator clean",
      ok: validation.ok,
      reason: validation.ok
        ? "all factors pass: 1 baseline, no unassigned, no duplicates"
        : "see warnings on the Design tab",
    },
    {
      section: "Experimental Design",
      kind: "auto",
      id: "all-fvs-assigned",
      label: "All samples have factor values assigned (unless DE_Exclude)",
      ok: allAssigned,
      reason: allAssigned
        ? "every factor covers every biomaterial"
        : "see Design tab for the unassigned list",
    },
    {
      section: "Experimental Design",
      kind: "auto",
      id: "baseline-ok",
      label: "Each factor has exactly one baseline FV",
      ok: baselinesOk,
      reason: baselinesOk
        ? "all factors mark exactly one baseline"
        : "see Design tab — baseline count is wrong",
    },
    {
      section: "Experimental Design",
      kind: "auto",
      id: "predicates-ok",
      label: "Statement predicates use the curated allow-list",
      ok: noUnknownPredicates,
      reason: noUnknownPredicates
        ? "no unknown predicate URIs"
        : "some statements use predicates outside the Confluence allow-list",
    },
    {
      section: "Experimental Design",
      kind: "auto",
      id: "batch-as-efc",
      label: "Batch information shows up as an EFC",
      ok: !!batchFactor,
      reason: batchFactor
        ? `factor "${batchFactor.name || "(unnamed)"}" detected as batch / block`
        : "no batch / block factor found — confirm if expected",
      details: batchFactor ? (
        <Inline>
          <Chip>{batchFactor.factor_values.length} levels</Chip>
          <Chip>{batchFactor.category.label || "—"}</Chip>
        </Inline>
      ) : undefined,
    },
    {
      section: "Experimental Design",
      kind: "auto",
      id: "tags-set",
      label: "Tags and experiment groups complete",
      ok: hasTags,
      reason: hasTags ? `${design.tags!.length} tag(s)` : "no tags set",
    },
    // -- Visualize Expression ------------------------------------------
    {
      section: "Visualize Expression",
      kind: "manual",
      id: "ve-design-looks-good",
      label: "Experimental design looks good in Visualize Expression",
      details: (
        <DetailBlock link={expUrl}>
          <WhatToCheck
            items={[
              "design heatmap renders without errors",
              "samples cluster sensibly within their factor values — no obvious mislabels",
              <>
                suspect a sex-mislabel? cross-check{" "}
                <span className="font-mono">XIST</span> expression — it's female-specific
              </>,
            ]}
          />
        </DetailBlock>
      ),
    },
    // ve-batch-confounds: if there's no batch / block factor on the
    // design, there's literally nothing to confound with — the
    // PCA+Factors batch row won't exist. Auto-N/A so the curator
    // doesn't have to tick a box that has no question to answer.
    batchFactor
      ? {
          section: "Visualize Expression",
          kind: "manual" as const,
          id: "ve-batch-confounds",
          label: "Checked for batch confounds",
          details: (
            <DetailBlock link={expUrl}>
              <WhatToCheck
                items={[
                  "PCA+Factors: if batch and an EFC both load strongly on the same PC, that's a confound",
                  "batch should line up with date_run; if it doesn't, the batch factor likely needs revisiting",
                  "for confounded designs see the Salvaging-Experiments-with-Batch-Confounds Confluence page",
                ]}
              />
              <Inline>
                <Chip>batch factor: {batchFactor.name || "(unnamed)"}</Chip>
              </Inline>
            </DetailBlock>
          ),
        }
      : {
          section: "Visualize Expression",
          kind: "na" as const,
          id: "ve-batch-confounds",
          label: "Checked for batch confounds",
          reason:
            "no batch / block factor recorded — nothing to evaluate against",
        },
    // -- Diagnostics ---------------------------------------------------
    {
      section: "Diagnostics",
      kind: "manual",
      id: "diag-images-render",
      label: "All diagnostic images render",
      details: (
        <DetailBlock link={expUrl}>
          <WhatToCheck
            items={[
              "Sample Correlation, PCA Scree, PCA+Factors, and Mean-Variance plots all load",
              "Affymetrix: AffyFromCel must have been run, otherwise plots may be missing",
              isTwoColor
                ? "two-colour platform: Mean-Variance may legitimately be missing if only ratio data was provided"
                : null,
            ].filter(Boolean) as ReactNode[]}
          />
        </DetailBlock>
      ),
    },
    {
      section: "Diagnostics",
      kind: "manual",
      id: "diag-sample-corr",
      label: "Sample-correlation matrix looks reasonable",
      details: (
        <DetailBlock link={expUrl}>
          <WhatToCheck
            items={[
              "diagonal grey line present (samples vs themselves) — missing diagonal means something went wrong",
              "no off-diagonal cells equal to ~1.00 — those are duplicate samples (Microarray-Case-1 / GitHub #466 pattern)",
              "overall correlation range isn't extreme; cancer studies legitimately run lower (e.g. 0.5+) but most experiments cluster ≥ 0.9",
              "click the heatmap on Gemma to see the colour-gradient range at the top-left",
            ]}
          />
        </DetailBlock>
      ),
    },
    {
      section: "Diagnostics",
      kind: "manual",
      id: "diag-pca-scree",
      label: "PCA Scree plot looks normal",
      details: (
        <DetailBlock link={expUrl}>
          <WhatToCheck
            items={[
              "fraction of variance is monotonically decreasing across the first 10 PCs",
              "PC1 dominating the others suggests a batch confound or strong tissue contrast — re-check after batch correction",
              "fewer than N−1 PCs shown (N = sample count) means the data matrix isn't full rank — usually duplicated columns (Microarray-Case-1 / GitHub #466)",
              "click the small probe-loading thumbnails for PC1/PC2/PC3 to spot which probes drive each component",
            ]}
          />
        </DetailBlock>
      ),
    },
    {
      section: "Diagnostics",
      kind: "manual",
      id: "diag-pca-factors",
      label: "PCA+Factors associations look sensible",
      details: (
        <DetailBlock link={expUrl}>
          <WhatToCheck
            items={[
              "each EFC's bars show its association with PC1 / PC2 / PC3",
              "batch loading strongly on the same PC as a biological EFC = confound — flag and address",
              "batch should align with date_run (that's how samples are typically grouped into batches)",
              "one EFC associated with multiple PCs is fine; report nothing",
              "if all associations are uniformly low, expect little from DEA",
            ]}
          />
        </DetailBlock>
      ),
    },
    {
      section: "Diagnostics",
      kind: "manual",
      id: "diag-outliers",
      label: "Predicted outliers reviewed (and removed if necessary)",
      details: (
        <DetailBlock link={expUrl}>
          <WhatToCheck
            items={[
              "Gemma's outlier detector is intentionally over-sensitive — manually verify each flag",
              "compare the flagged sample to others in the same condition; n=2 means you can't tell which is the outlier",
              "dark lines that track an experimental group are usually noisy biology, not outliers",
              "if the design changed since the last detection, re-run Diagnostics on the Admin tab first",
              "removed outliers can't be re-added without reloading all data — check the right samples before saving",
            ]}
          />
        </DetailBlock>
      ),
    },
    // Microarray-only — drop entirely on RNA-seq / single-cell so the
    // checklist doesn't ask the curator to sign off on a plot that
    // doesn't exist.
    ...(isMicroarray
      ? [
          {
            section: "Diagnostics",
            kind: "manual" as const,
            id: "diag-mv-flat",
            label: "Microarray: mean-variance plot is relatively flat",
            details: (
              <DetailBlock link={expUrl}>
                <WhatToCheck
                  items={[
                    "x-axis range roughly −5 to 16 (Log2). Way outside that → suspect a wrong quantitation type",
                    "Affymetrix / one-colour: red smoothed-fit line should be fairly flat",
                    "Illumina BeadChip can ramp up or down — that's normal",
                    isTwoColor
                      ? "two-colour: plot may be missing entirely if GEO only provided ratios (it's computed from raw values)"
                      : null,
                  ].filter(Boolean) as ReactNode[]}
                />
                <Inline>
                  <Chip>{techType}</Chip>
                </Inline>
              </DetailBlock>
            ),
          },
        ]
      : []),
    // -- Quantitation Types --------------------------------------------
    // qt-pref / qt-scale: structurally auto-evaluable. Gemma requires
    // exactly one preferred QT for DEA, and a scale that isn't OTHER
    // / UNKNOWN. The checklist auto-passes on those mechanical rules;
    // the inline detail still shows the QT name + scale so the
    // curator can spot-check that the *right* QT was picked. While QT
    // data is still loading we fall back to a manual stub so a
    // momentarily-empty list doesn't show as failing.
    qts == null
      ? {
          section: "Quantitation Types",
          kind: "manual" as const,
          id: "qt-pref",
          label: "Correct rows set as Pref",
          hint: "loading quantitation types…",
        }
      : {
          section: "Quantitation Types",
          kind: "auto" as const,
          id: "qt-pref",
          label: "Correct rows set as Pref",
          ok: prefQts.length === 1,
          reason:
            prefQts.length === 0
              ? "no preferred QT — Gemma needs exactly one for DEA"
              : prefQts.length > 1
                ? `${prefQts.length} preferred QTs — should be exactly one`
                : `1 preferred QT (${prefQts[0].name || `QT ${prefQts[0].id}`}) — visually confirm it's the right one`,
          details: (
            <div className="text-[11px] text-slate-700 space-y-0.5">
              {prefQts.length === 0 ? (
                <div className="text-amber-800">none flagged</div>
              ) : (
                prefQts.map((q) => (
                  <div key={q.id}>
                    <span className="font-medium">
                      {q.name || `QT ${q.id}`}
                    </span>{" "}
                    <span className="text-slate-500">
                      ({q.scale || "—"} · {q.representation || "—"})
                    </span>
                  </div>
                ))
              )}
              {maskedPrefQts.length > 0 ? (
                <div className="text-slate-500">
                  masked-pref:{" "}
                  {maskedPrefQts
                    .map((q) => q.name || `QT ${q.id}`)
                    .join(", ")}
                </div>
              ) : null}
            </div>
          ),
        },
    qts == null
      ? {
          section: "Quantitation Types",
          kind: "manual" as const,
          id: "qt-scale",
          label: "Scale column set correctly",
          hint: "loading quantitation types…",
        }
      : {
          section: "Quantitation Types",
          kind: "auto" as const,
          id: "qt-scale",
          label: "Scale column set correctly",
          ok:
            prefQts.length === 1 && !isSuspectScale(prefQts[0].scale),
          reason:
            prefQts.length === 0
              ? "no preferred QT to read a scale from"
              : prefQts.length > 1
                ? "multiple preferred QTs — pick one before checking scale"
                : isSuspectScale(prefQts[0].scale)
                  ? `scale "${prefQts[0].scale || "(empty)"}" is OTHER / UNKNOWN — confirm the actual scale`
                  : `scale: ${prefQts[0].scale}`,
          details: (
            <Inline>
              {prefQts.map((q) => (
                <Chip
                  key={q.id}
                  tone={isSuspectScale(q.scale) ? "amber" : "default"}
                >
                  {q.name || `QT ${q.id}`}: {q.scale || "—"}
                </Chip>
              ))}
            </Inline>
          ),
        },
    // -- History / Curation status ------------------------------------
    failEvents.length === 0 && events != null
      ? {
          section: "History / Curation status",
          kind: "auto" as const,
          id: "history-failures-fixed",
          label: "Failed events or analyses fixed",
          ok: true,
          reason: "no failure events in the loaded audit window",
        }
      : {
          section: "History / Curation status",
          kind: "manual" as const,
          id: "history-failures-fixed",
          label: "Failed events or analyses fixed",
          hint:
            events == null
              ? "loading audit trail…"
              : `${failEvents.length} failure event${failEvents.length === 1 ? "" : "s"} in the loaded audit window`,
          details:
            failEvents.length > 0 ? (
              <ul className="text-[11px] text-slate-700 space-y-0.5">
                {failEvents.slice(0, 5).map((e) => (
                  <li key={e.id}>
                    <span className="font-mono text-slate-500">
                      {formatShortDate(e.date)}
                    </span>{" "}
                    <span className="font-medium">{e.event_type}</span>
                    {e.note ? (
                      <span className="text-slate-600"> — {e.note}</span>
                    ) : null}
                  </li>
                ))}
                {failEvents.length > 5 ? (
                  <li className="text-slate-500">
                    + {failEvents.length - 5} more — see the History tab
                  </li>
                ) : null}
              </ul>
            ) : null,
        },
    // failures-flagged-troubled: only meaningful when there are
    // failure events. If the audit window is clean, there's nothing
    // to flag with Trouble — auto-N/A.
    events != null && failEvents.length === 0
      ? {
          section: "History / Curation status",
          kind: "na" as const,
          id: "failures-flagged-troubled",
          label: "Unfixable failures flagged with the Trouble flag",
          reason: "no failure events in the loaded audit window",
        }
      : {
          section: "History / Curation status",
          kind: "manual" as const,
          id: "failures-flagged-troubled",
          label: "Unfixable failures flagged with the Trouble flag",
          hint:
            events == null
              ? "loading audit trail…"
              : curation?.troubled
                ? `troubled is set — note: ${(curation.curation_note ?? "").trim() || "(empty)"}`
                : "troubled is not currently set",
          details: (
            <Inline>
              <Chip tone={curation?.troubled ? "amber" : "default"}>
                {curation?.troubled ? "troubled: yes" : "troubled: no"}
              </Chip>
              <span className="text-[11px] text-slate-500">
                if a failure can't be fixed, set Trouble via the Notes drawer with an explanatory note
              </span>
            </Inline>
          ),
        },
    {
      section: "History / Curation status",
      kind: "auto",
      id: "attention-flags-resolved",
      label: "Curator-attention flags resolved (or troubled set with a note)",
      ok:
        curation == null ||
        (!curation.needs_attention &&
          (!curation.troubled || (curation.curation_note ?? "").trim().length > 0)),
      reason:
        curation == null
          ? "curation status not loaded"
          : curation.needs_attention
            ? "needs-attention is set — clear it via Notes drawer with a resolution note"
            : curation.troubled && !(curation.curation_note ?? "").trim()
              ? "troubled is set but the curation note is empty"
              : "no outstanding flags",
    },
    // -- Admin -------------------------------------------------------
    {
      section: "Admin",
      kind: "manual",
      id: "preprocessing-complete",
      label: "All preprocessing events complete",
      details: (
        <DetailBlock link={expUrl}>
          <WhatToCheck
            items={[
              "Admin tab pipeline events: ranks computed, processed-data generated, batch info filled, etc.",
              "batch info may legitimately be missing if the platform's raw files have no dates (microarray edge case)",
              "Affymetrix: AffyFromCel must have run before processed data is meaningful",
            ]}
          />
        </DetailBlock>
      ),
    },
    {
      section: "Admin",
      kind: "manual",
      id: "dea-done",
      label: "DEA computed (unless sample study or unsuitable)",
      details: (
        <DetailBlock link={expUrl}>
          <WhatToCheck
            items={[
              "DEA results visible on the experiment page",
              "skip if the design is a single-condition sample study or otherwise unsuitable for DEA",
              "if DEA failed, fix the underlying issue or flag with Trouble",
            ]}
          />
        </DetailBlock>
      ),
    },
  ];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isFailureEvent(e: AuditEvent): boolean {
  // Gemma's audit-event subclasses for failure are named with a
  // `Fail*` suffix (FailedBatchInformationFetchingEvent,
  // FailedDifferentialExpressionAnalysisEvent, …). Free-text notes
  // sometimes carry "failed" without the typed event, so we cover
  // both.
  return /fail/i.test(e.event_type) || /\bfail(ed|ure)?\b/i.test(e.note);
}

function isSuspectScale(scale: string): boolean {
  const s = (scale ?? "").toUpperCase();
  return s === "" || s === "OTHER" || s === "UNKNOWN";
}

function externalSourceLink(design: Design): string {
  const src = design.external_source;
  if (!src) return "#";
  if (src.uri) return src.uri;
  // Best-effort fallback for the common databases.
  const acc = src.accession;
  switch (src.database.toUpperCase()) {
    case "GEO":
      return `https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${encodeURIComponent(acc)}`;
    case "ARRAYEXPRESS":
      return `https://www.ebi.ac.uk/biostudies/arrayexpress/studies/${encodeURIComponent(acc)}`;
    default:
      return "#";
  }
}

function formatShortDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString([], {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// Tiny inline UI primitives — kept local to this file because they only
// exist to format the per-item detail block.
// ---------------------------------------------------------------------------

function Inline({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
      {children}
    </div>
  );
}

/**
 * Concrete what-to-look-for guidance for visual checks. Bullet
 * points come from the Confluence pages (Check-the-Diagnostics-Tab,
 * Remove-Outliers, Salvaging-Experiments-with-Batch-Confounds) so
 * curators don't have to leave the tab to remember what "reasonable"
 * means for each plot. Renders as a native ``<details>`` so the
 * guide stays out of the way until needed — without it the section
 * grid is dominated by these bullet lists.
 */
function WhatToCheck({ items }: { items: ReactNode[] }) {
  return (
    <details className="text-[11px] mt-0.5 [&[open]>summary>span:first-child]:rotate-90">
      <summary className="cursor-pointer text-blue-700 hover:underline list-none inline-flex items-center gap-1 select-none">
        <span className="inline-block w-2 text-slate-400 transition-transform">
          ▸
        </span>
        what to check
      </summary>
      <ul className="text-slate-600 list-disc pl-5 space-y-0.5 mt-1">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </details>
  );
}

/** Stacks the per-item guidance + an "open on Gemma" link below it. */
function DetailBlock({
  children,
  link,
}: {
  children: ReactNode;
  link: string;
}) {
  return (
    <div className="space-y-1">
      {children}
      <ExtLink href={link}>open on Gemma</ExtLink>
    </div>
  );
}

function Chip({
  children,
  tone = "default",
  title,
}: {
  children: ReactNode;
  tone?: "default" | "amber";
  title?: string;
}) {
  const cls =
    tone === "amber"
      ? "bg-amber-50 border-amber-200 text-amber-900"
      : "bg-slate-50 border-slate-200 text-slate-700";
  return (
    <span
      className={`inline-block border rounded px-1.5 py-0.5 text-[11px] ${cls}`}
      title={title}
    >
      {children}
    </span>
  );
}

function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-[11px] text-blue-700 hover:underline"
    >
      {children} ↗
    </a>
  );
}
