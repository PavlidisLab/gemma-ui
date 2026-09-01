import { useExperimentSetsFor } from "@/api/experimentSets";

/**
 * Chips for the Gemma experiment sets a dataset belongs to.
 *
 * 🛑 Not `ExperimentGroupChips` — those are the curation side's
 * workflow groups. Both render; neither subsumes the other.
 *
 * Split out of `ExperimentBanner.tsx` 2026-09-01 — behaviour unchanged.
 */

/** Chips for the Gemma experiment sets this dataset belongs to.
 *
 *  🛑 **A different thing from `ExperimentGroupChips` below**, which
 *  shows the curation-side workflow groups. These are Gemma's own
 *  `ExpressionExperimentSet`s — what a `/browse` user filters by — and
 *  a curator wants to know an experiment is in one BEFORE editing it,
 *  because someone else's analysis is keyed on that membership (Paul,
 *  2026-08-31). Neither surface subsumes the other.
 *
 *  On the TITLE row, not the meta row. The meta row had just been
 *  emptied of its link-outs for being overloaded; putting a variable
 *  number of chips back on it would undo that in one step.
 *
 *  Renders nothing when the dataset is in no set, which is most of
 *  them — 640 sets over ~23.5k datasets. Not a link: Gemma has no
 *  per-set page this app can honestly deep-link to, and a chip that
 *  looks clickable and is not is worse than a plain one. */
export function ExperimentSetChips({
  experimentId,
}: {
  experimentId: number | string;
}) {
  const { sets } = useExperimentSetsFor(experimentId);
  if (sets.length === 0) return null;
  return (
    <span className="flex items-center gap-1.5 flex-wrap">
      {sets.map((s) => (
        <span
          key={s.id}
          className="text-[11px] px-1.5 py-0.5 rounded border border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-700 dark:bg-sky-900/40 dark:text-sky-200"
          title={
            `Gemma experiment set "${s.name ?? s.id}"` +
            (typeof s.size === "number" ? ` · ${s.size} datasets` : "") +
            (s.description ? ` — ${s.description}` : "")
          }
        >
          {/* Name only. The member count was on the chip and is not
              what the chip is for — the fact worth seeing at a glance is
              WHICH set, and the size is one hover away in the tooltip
              (Paul, 2026-08-31). */}
          {s.name || `set ${s.id}`}
        </span>
      ))}
    </span>
  );
}
