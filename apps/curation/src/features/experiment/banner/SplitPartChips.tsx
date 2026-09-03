import { useDesignDraft } from "@/features/design/DesignDraftContext";
import { navigate, siblingExperimentRoute } from "@/routes";

/**
 * The other parts of a split experiment.
 *
 * 🛑 **Gemma splits single-cell studies, and over half of them are a
 * part.** 52 of 100 sampled single-cell datasets are named "Split part
 * N of: …" over 32 parent studies (measured 2026-09-03). The title
 * announces that siblings exist and, until `otherParts` landed on
 * `GET /datasets/{id}` the same day, nothing could reach them — a
 * curator on `Rexach-2024.3` read "Split part 3 of: …" and had to go
 * searching for parts 1 and 2 by hand.
 *
 * 🛑 **The distinguishing text is in the TITLE, not the short name.**
 * `Rexach-2024.1` and `.2` differ only by the `[organism part = …]`
 * clause inside their names, so a chip showing the short name alone
 * says nothing about which sibling it is. The short name is the label
 * (it is what a curator types and cites) and the distinguishing clause
 * rides in the tooltip.
 *
 * Renders nothing when the list is empty — which is every unsplit
 * dataset, and every dataset in local mode, where the store serves no
 * such field. Gemma sends `[]` rather than null, so absence and
 * emptiness need no separate handling.
 */

/** Pull the part that distinguishes one sibling from another out of its
 *  title — the trailing `[factor = value]` clause Gemma appends when it
 *  splits. Returns the whole title when there is no such clause, since
 *  a title we cannot parse is still more informative than nothing. */
export function splitPartDistinguisher(name: string | null | undefined): string {
  const n = (name ?? "").trim();
  if (!n) return "";
  const m = n.match(/\[([^\]]+)\]\s*$/);
  return m ? m[1].trim() : n;
}

export function SplitPartChips() {
  const { draft } = useDesignDraft();
  const parts = draft?.other_parts ?? [];
  if (parts.length === 0) return null;

  return (
    <span className="inline-flex flex-wrap items-baseline gap-1">
      <span className="text-[11px] text-slate-500 dark:text-slate-400">
        Other part{parts.length === 1 ? "" : "s"}:
      </span>
      {parts.map((p) => {
        const label = (p.short_name ?? "").trim() || `#${p.id ?? "?"}`;
        const hint = splitPartDistinguisher(p.name);
        return (
          <button
            key={p.id ?? label}
            type="button"
            // Same navigation as every other in-app experiment hop, so
            // the tab and the comparator chips survive the jump —
            // see `siblingExperimentRoute`.
            onClick={() =>
              p.id != null && navigate(siblingExperimentRoute(p.id, {}))
            }
            disabled={p.id == null}
            title={hint || undefined}
            className="text-[11px] rounded border border-slate-300 px-1.5 py-0.5 text-slate-700 hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {label}
          </button>
        );
      })}
    </span>
  );
}
