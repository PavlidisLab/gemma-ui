/**
 * The Design card on the Overview — the factor x factor-value crosstab,
 * the nuisance/standard split, and the batch-confound detector behind
 * it.
 *
 * Extracted from ``OverviewPanel.tsx`` 2026-08-09 (that file was 4260
 * lines / ~512 KB transpiled, re-parsed by the dev server on every
 * navigation). A pure move: the crosstab reads the draft through props
 * exactly as before.
 */
import { useMemo, useState } from "react";
import { Tooltip } from "@/components/ui/Tooltip";
import { tintForIndex, compareValuesNatural } from "@/lib/valueTint";
import { SummaryCard } from "./SummaryCard";
import { FvCellTooltipBody } from "./factorChips";
import type { Biomaterial, Factor, FactorValue } from "@/features/experiment/types";
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
          Hover a factor-value cell to see its full curation — statements,
          which terms are ontology-anchored vs free text, baseline, and
          sample count — without opening the Design tab.
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

export function DesignSummary({
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
    // Numeric-aware so "3 h" precedes "8 h" precedes "24 h" rather
    // than sorting lexically (which would float "24 h" to the top).
    return Array.from(buckets.values()).sort((a, b) =>
      compareValuesNatural(a.values.join(" / "), b.values.join(" / ")),
    );
  }, [standard, biomaterials]);

  // Per-column ``FV label → FactorValue`` lookup so a table cell can
  // surface the FV's full curation in a hover (statements, ontology
  // grounding, baseline, sample count) without a trip to the Design
  // tab. Uses the SAME label derivation as the row builder above so the
  // cell's displayed label keys straight in. Design review 2026-07-20.
  const fvByLabelByColumn = useMemo(
    () =>
      standard.map((f) => {
        const m = new Map<string, FactorValue>();
        for (const fv of f.factor_values) {
          const lab =
            fv.free_text_label ||
            fv.statements?.[0]?.subject?.label ||
            "(unlabelled FV)";
          if (!m.has(lab)) m.set(lab, fv);
        }
        return m;
      }),
    [standard],
  );

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
      return compareValuesNatural(a.values[sort.col], b.values[sort.col]) * sign;
    };
    return [...rows].sort(cmp);
  }, [rows, sort]);

  // Per-column first-seen-value index → shared `tintForIndex` colour,
  // the same scheme the samples table uses. Walk the rows in display
  // order so the tint follows the current sort; "(unassigned)" keeps
  // its rose treatment and is left untinted. Index 0 is the same hue
  // across every column, so two factor columns that partition the
  // design identically show matching colour stripes.
  const valueIdxByColumn = useMemo(() => {
    const out: Array<Map<string, number>> = standard.map(() => new Map());
    for (const row of sortedRows) {
      row.values.forEach((v, j) => {
        if (v === "(unassigned)") return;
        const seen = out[j];
        if (!seen.has(v)) seen.set(v, seen.size);
      });
    }
    return out;
  }, [sortedRows, standard]);
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
                  {row.values.map((v, j) => {
                    const tint =
                      v === "(unassigned)"
                        ? undefined
                        : tintForIndex(valueIdxByColumn[j]?.get(v) ?? -1);
                    const fv =
                      v === "(unassigned)"
                        ? null
                        : fvByLabelByColumn[j]?.get(v) ?? null;
                    return (
                      <td
                        key={j}
                        className={
                          "px-2 py-1 border border-slate-200 " +
                          (v === "(unassigned)"
                            ? "text-rose-700 italic"
                            : "text-slate-700")
                        }
                        style={tint ? { backgroundColor: tint } : undefined}
                      >
                        {fv ? (
                          <Tooltip
                            label={
                              <FvCellTooltipBody factor={standard[j]} fv={fv} />
                            }
                          >
                            <span className="cursor-help underline decoration-dotted decoration-slate-300 underline-offset-2">
                              {v}
                            </span>
                          </Tooltip>
                        ) : (
                          v
                        )}
                      </td>
                    );
                  })}
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
