import { useEffect, useMemo, useState } from "react";
import type { Biomaterial, Factor } from "@/features/experiment/types";
import { fvDisplayLabel } from "@/features/samples/fvLabels";

/**
 * Bulk-assign panel — pick any sample-details column (sample name,
 * assay, or a biomaterial characteristic), inspect its distinct
 * values, and route each value to a target factor value in one go.
 * The most common path for "the cohort already has a ``treatment``
 * characteristic that maps cleanly onto my factor's FVs" — turns N
 * drag-drops into one apply.
 *
 * Lives on the **Samples** tab (per Paul, 2026-04-29) — that's where
 * the per-sample data the curator needs to make assignment decisions
 * actually lives. Originally rendered inline on the Design tab's
 * SampleAssignmentPreview; the Samples tab opens it in a modal,
 * scoped to the column the curator clicked.
 *
 * Emits a single ``plan`` map (biomaterial short_name → target FV
 * id) so the parent can fire reassignments in bulk. The panel
 * doesn't touch the design directly.
 */
export function BulkAssignPanel({
  factor,
  biomaterials,
  onApply,
  onCancel,
}: {
  factor: Factor;
  biomaterials: Biomaterial[];
  onApply: (plan: Map<string, number>) => void;
  onCancel: () => void;
}) {
  // Any column of the sample-details table is a valid thing to match
  // on — not just biomaterial characteristics. Sample name / assay
  // are first-class options alongside the characteristics (per Paul,
  // 2026-06-17).
  const columns = useMemo(
    () => collectMatchColumns(biomaterials),
    [biomaterials],
  );
  const defaultColId =
    (pickDistinguishingKey(biomaterials)
      ? `char:${pickDistinguishingKey(biomaterials)}`
      : null) ??
    columns[0]?.id ??
    null;
  const [colId, setColId] = useState<string | null>(defaultColId);
  const column = columns.find((c) => c.id === colId) ?? null;

  const buckets = useMemo(
    () => bucketByColumn(biomaterials, column),
    [biomaterials, column],
  );

  const initialPlan = useMemo(
    () => suggestPlan(buckets, factor),
    [buckets, factor],
  );
  const [valueToFv, setValueToFv] =
    useState<Map<string, number | null>>(initialPlan);

  // Reset selections when the chosen match column (and so
  // ``buckets``) changes. Use ``factor.id`` rather than ``factor``
  // in deps — the parent often passes a fresh ``factor`` reference
  // each render via ``factors.find(...)``, which would re-fire
  // this effect on every render and clobber in-progress edits. The
  // ``factor.id`` fingerprint is stable across renders for the same
  // logical factor; if the factor genuinely changes, the modal
  // remounts via ``key={factor.id}`` so this effect runs anyway.
  useEffect(() => {
    setValueToFv(suggestPlan(buckets, factor));
    // factor is intentionally not in deps; see comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buckets, factor.id]);

  // Sample → currently-assigned FV id. Used to net out no-op
  // reassignments from the panel count and the apply plan.
  const currentFvBySample = useMemo(() => {
    const m = new Map<string, number>();
    for (const fv of factor.factor_values) {
      for (const sn of fv.biomaterial_short_names ?? []) m.set(sn, fv.id);
    }
    return m;
  }, [factor]);

  function applyPlan() {
    const plan = new Map<string, number>();
    for (const [v, fvId] of valueToFv) {
      if (fvId == null) continue;
      const sns = buckets.get(v);
      if (!sns) continue;
      for (const sn of sns) {
        // Skip samples already in the target FV — assigning them
        // again would be a no-op that still dirties the draft.
        if (currentFvBySample.get(sn) === fvId) continue;
        plan.set(sn, fvId);
      }
    }
    onApply(plan);
  }

  // Net-reassignment count for the apply button label — only samples
  // whose current FV differs from the proposed target count as a
  // reassignment.
  const totalAssigned = Array.from(valueToFv.entries()).reduce(
    (n, [v, fvId]) => {
      if (fvId == null) return n;
      const sns = buckets.get(v) ?? [];
      let netChanges = 0;
      for (const sn of sns) {
        if (currentFvBySample.get(sn) !== fvId) netChanges++;
      }
      return n + netChanges;
    },
    0,
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <label className="text-xs text-slate-700">
          match on:{" "}
          <select
            value={colId ?? ""}
            onChange={(e) => setColId(e.target.value || null)}
            className="text-xs border border-slate-300 rounded px-1 py-0.5 bg-white ml-1"
          >
            {columns.length === 0 ? (
              <option value="">(no columns)</option>
            ) : null}
            {columns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <span className="text-[11px] text-slate-500">
          {column
            ? `${buckets.size} distinct value${buckets.size === 1 ? "" : "s"}`
            : "pick a column to match on"}
        </span>
      </div>

      {column && buckets.size > 0 ? (
        <table className="w-full text-xs">
          <thead className="text-slate-500">
            <tr>
              {/* Samples count leads, so the two things the curator is
                  matching up — the column value and its target factor
                  value — sit adjacent rather than split by the count. */}
              <th className="text-left font-medium pr-3 py-1 w-12">
                samples
              </th>
              <th className="text-left font-medium pr-3 py-1">{column.label}</th>
              <th className="text-left font-medium py-1">→ factor value</th>
            </tr>
          </thead>
          <tbody>
            {Array.from(buckets.entries()).map(([value, sns]) => {
              const target = valueToFv.get(value) ?? null;
              return (
                <tr key={value} className="border-t border-slate-200">
                  <td className="pr-3 py-1 align-top text-slate-500">
                    {sns.length}
                  </td>
                  <td className="pr-3 py-1 align-top">
                    {value || (
                      <span className="text-slate-400 italic">(blank)</span>
                    )}
                  </td>
                  <td className="py-1">
                    <select
                      value={target ?? ""}
                      onChange={(e) =>
                        setValueToFv((m) => {
                          const next = new Map(m);
                          next.set(
                            value,
                            e.target.value === ""
                              ? null
                              : Number(e.target.value),
                          );
                          return next;
                        })
                      }
                      className="text-xs border border-slate-300 rounded px-1 py-0.5 bg-white"
                    >
                      <option value="">(skip)</option>
                      {factor.factor_values.map((fv) => {
                        const r = fvDisplayLabel(fv, factor.factor_values, {
                          compact: fv.id === target,
                        });
                        return (
                          <option
                            key={fv.id}
                            value={fv.id}
                            title={r.title || undefined}
                          >
                            {r.text}
                          </option>
                        );
                      })}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="button"
          className="btn primary text-xs"
          disabled={totalAssigned === 0}
          onClick={applyPlan}
        >
          apply ({totalAssigned} reassignment
          {totalAssigned === 1 ? "" : "s"})
        </button>
        <button
          type="button"
          className="btn ghost text-xs"
          onClick={onCancel}
        >
          cancel
        </button>
        <span className="text-[11px] text-slate-500">
          rows set to "(skip)" leave their samples where they are
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A selectable column of the sample-details table the curator can
 *  bucket on. ``get`` pulls the cell value for a biomaterial. */
export interface MatchColumn {
  id: string;
  label: string;
  get: (b: Biomaterial) => string;
}

/** Max distinct values a column may have to be worth bulk-assigning.
 *  Beyond this a column is effectively continuous / an identifier
 *  (sample ids, measurements) — there's no sane mapping to a handful
 *  of factor values, so we drop it from the picker. */
const MAX_DISTINCT_FOR_MATCH = 25;

/** Columns the curator may match on — any column of the sample-details
 *  table, not just characteristics. Kept only when the column has
 *  between 2 and ``MAX_DISTINCT_FOR_MATCH`` distinct non-blank values:
 *  fewer than 2 maps nothing, more is continuous / id-like and not
 *  mappable to factor values. Characteristics lead (most-distinct
 *  first, the usual match target), then sample name / assay. */
function collectMatchColumns(biomaterials: Biomaterial[]): MatchColumn[] {
  const candidates: MatchColumn[] = [];
  for (const k of collectVaryingCharacteristicKeys(biomaterials)) {
    candidates.push({
      id: `char:${k}`,
      label: k,
      get: (b) => (b.characteristics?.[k] ?? "").trim(),
    });
  }
  candidates.push({
    id: "short_name",
    label: "sample name",
    get: (b) => b.short_name.trim(),
  });
  if (biomaterials.some((b) => (b.name ?? "").trim() && b.name !== b.short_name)) {
    candidates.push({ id: "name", label: "name", get: (b) => (b.name ?? "").trim() });
  }
  if (biomaterials.some((b) => (b.bio_assays?.length ?? 0) > 0)) {
    candidates.push({
      id: "assay",
      label: "assay",
      get: (b) => {
        const a = b.bio_assays?.[0];
        return (a?.name || a?.short_name || "").trim();
      },
    });
  }
  return candidates.filter((c) => {
    const distinct = new Set<string>();
    for (const b of biomaterials) {
      const v = c.get(b);
      if (v) distinct.add(v);
    }
    return distinct.size >= 2 && distinct.size <= MAX_DISTINCT_FOR_MATCH;
  });
}

/** Bucket samples by the value of a single column.
 *  Returns ``Map<value, [biomaterial short_names]>`` preserving
 *  first-seen value order. Missing / empty values are bucketed
 *  under "" so the curator sees them. */
function bucketByColumn(
  biomaterials: Biomaterial[],
  column: MatchColumn | null,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (!column) return out;
  for (const b of biomaterials) {
    const v = column.get(b);
    if (!out.has(v)) out.set(v, []);
    out.get(v)!.push(b.short_name);
  }
  return out;
}

/** Auto-suggest a target FV for each distinct characteristic value.
 *  Picks in order: unanimous current assignment across the bucket's
 *  samples → case-insensitive substring match on FV label /
 *  statement subjects / objects → ``null`` (curator must pick). */
function suggestPlan(
  buckets: Map<string, string[]>,
  factor: Factor,
): Map<string, number | null> {
  // Sample → current FV lookup.
  const currentFvBySample = new Map<string, number>();
  for (const fv of factor.factor_values) {
    for (const sn of fv.biomaterial_short_names ?? []) {
      currentFvBySample.set(sn, fv.id);
    }
  }
  const out = new Map<string, number | null>();
  for (const [v, sns] of buckets) {
    const fromCurrent = unanimousFvAcrossSamples(sns, currentFvBySample);
    if (fromCurrent != null) {
      out.set(v, fromCurrent);
      continue;
    }
    out.set(v, suggestFvForValue(v, factor));
  }
  return out;
}

/** Return the single FV id every sample in ``sns`` is currently
 *  assigned to. ``null`` when the bucket spans multiple FVs OR
 *  any sample is unassigned — those cases need curator picking. */
function unanimousFvAcrossSamples(
  sns: string[],
  currentFvBySample: Map<string, number>,
): number | null {
  if (sns.length === 0) return null;
  const first = currentFvBySample.get(sns[0]);
  if (first == null) return null;
  for (let i = 1; i < sns.length; i++) {
    if (currentFvBySample.get(sns[i]) !== first) return null;
  }
  return first;
}

function suggestFvForValue(value: string, factor: Factor): number | null {
  const v = value.trim().toLowerCase();
  if (!v) return null;
  let bestId: number | null = null;
  let bestScore = -1;
  const haystacks: { id: number; text: string }[] = [];
  for (const fv of factor.factor_values) {
    haystacks.push({ id: fv.id, text: fv.free_text_label });
    for (const s of fv.statements) {
      haystacks.push({ id: fv.id, text: s.subject?.label ?? "" });
      if (s.object?.label) {
        haystacks.push({ id: fv.id, text: s.object.label });
      }
    }
  }
  for (const { id, text } of haystacks) {
    const h = text.trim().toLowerCase();
    if (!h) continue;
    if (!h.includes(v) && !v.includes(h)) continue;
    const score = Math.min(h.length, v.length);
    if (score > bestScore) {
      bestScore = score;
      bestId = id;
    }
  }
  return bestId;
}

/** Characteristic keys with ≥ 2 distinct non-blank values across the
 *  cohort. Sorted by descending value-count so the most informative
 *  key is offered first. */
function collectVaryingCharacteristicKeys(
  biomaterials: Biomaterial[],
): string[] {
  const seen: string[] = [];
  const distinctByKey = new Map<string, Set<string>>();
  for (const b of biomaterials) {
    for (const [k, v] of Object.entries(b.characteristics ?? {})) {
      if (!distinctByKey.has(k)) {
        distinctByKey.set(k, new Set());
        seen.push(k);
      }
      if (v) distinctByKey.get(k)!.add(v);
    }
  }
  return seen
    .filter((k) => (distinctByKey.get(k)?.size ?? 0) >= 2)
    .sort(
      (a, b) =>
        distinctByKey.get(b)!.size - distinctByKey.get(a)!.size ||
        a.localeCompare(b),
    );
}

/** Return the characteristic key whose values vary most across the
 *  cohort — useful as a default when picking which characteristic to
 *  bulk-assign on. Exported so SampleAssignmentPreview's tile
 *  rendering (which falls back to a varying-characteristic display
 *  when no other label is available) can share the heuristic. */
export function pickDistinguishingKey(
  biomaterials: Biomaterial[],
): string | null {
  const seenKeys: string[] = [];
  const distinctValuesByKey = new Map<string, Set<string>>();
  for (const b of biomaterials) {
    for (const [k, v] of Object.entries(b.characteristics ?? {})) {
      if (!distinctValuesByKey.has(k)) {
        distinctValuesByKey.set(k, new Set());
        seenKeys.push(k);
      }
      if (v) distinctValuesByKey.get(k)!.add(v);
    }
  }
  let best: string | null = null;
  let bestN = 1;
  for (const k of seenKeys) {
    const n = distinctValuesByKey.get(k)!.size;
    if (n > bestN) {
      best = k;
      bestN = n;
    }
  }
  return best;
}
