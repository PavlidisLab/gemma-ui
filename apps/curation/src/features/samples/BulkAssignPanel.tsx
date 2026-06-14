import { useEffect, useMemo, useState } from "react";
import type { Biomaterial, Factor } from "@/features/experiment/types";
import { fvDisplayLabel } from "@/features/samples/fvLabels";

/**
 * Bulk-assign panel — pick a single biomaterial-characteristic key,
 * inspect its distinct values, and route each value to a target
 * factor value in one go. The most common path for "the cohort
 * already has a ``treatment`` characteristic that maps cleanly onto
 * my factor's FVs" — turns N drag-drops into one apply.
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
  const allKeys = useMemo(
    () => collectVaryingCharacteristicKeys(biomaterials),
    [biomaterials],
  );
  const defaultKey =
    pickDistinguishingKey(biomaterials) ?? allKeys[0] ?? null;
  const [key, setKey] = useState<string | null>(defaultKey);

  const buckets = useMemo(
    () => bucketByCharacteristic(biomaterials, key),
    [biomaterials, key],
  );

  const initialPlan = useMemo(
    () => suggestPlan(buckets, factor),
    [buckets, factor],
  );
  const [valueToFv, setValueToFv] =
    useState<Map<string, number | null>>(initialPlan);

  // Reset selections when the chosen characteristic key (and so
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
          characteristic:{" "}
          <select
            value={key ?? ""}
            onChange={(e) => setKey(e.target.value || null)}
            className="text-xs border border-slate-300 rounded px-1 py-0.5 bg-white ml-1"
          >
            {allKeys.length === 0 ? (
              <option value="">(no varying characteristic)</option>
            ) : null}
            {allKeys.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <span className="text-[11px] text-slate-500">
          {key
            ? `${buckets.size} distinct value${buckets.size === 1 ? "" : "s"}`
            : "pick a characteristic with varying values"}
        </span>
      </div>

      {key && buckets.size > 0 ? (
        <table className="w-full text-xs">
          <thead className="text-slate-500">
            <tr>
              <th className="text-left font-medium pr-3 py-1">{key}</th>
              <th className="text-left font-medium pr-3 py-1 w-12">
                samples
              </th>
              <th className="text-left font-medium py-1">→ factor value</th>
            </tr>
          </thead>
          <tbody>
            {Array.from(buckets.entries()).map(([value, sns]) => {
              const target = valueToFv.get(value) ?? null;
              return (
                <tr key={value} className="border-t border-slate-200">
                  <td className="pr-3 py-1 align-top">
                    {value || (
                      <span className="text-slate-400 italic">(blank)</span>
                    )}
                  </td>
                  <td className="pr-3 py-1 align-top text-slate-500">
                    {sns.length}
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

/** Bucket samples by the value of a single characteristic key.
 *  Returns ``Map<value, [biomaterial short_names]>`` preserving
 *  first-seen value order. Missing / empty values are bucketed
 *  under "" so the curator sees them. */
function bucketByCharacteristic(
  biomaterials: Biomaterial[],
  key: string | null,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (!key) return out;
  for (const b of biomaterials) {
    const v = (b.characteristics?.[key] ?? "").trim();
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
