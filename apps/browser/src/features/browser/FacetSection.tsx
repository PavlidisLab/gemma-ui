// A side-panel section of checkbox rows, each with a dataset count.
// Taxa and Type render through it. A row with children draws them under
// a chevron, the way TechnologyTypeSelector draws its groups.

import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { formatNumber } from "@/lib/utils";

export interface FacetRow {
  key: string;
  label: ReactNode;
  title?: string;
  /** Datasets matching the row; null while unknown. */
  count: number | null;
  /** "partial" for a parent with only some children checked. */
  checked: boolean | "partial";
  children?: FacetRow[];
}

interface Props {
  title: string;
  rows: FacetRow[];
  /** Whether to offer Clear. Passed rather than derived from `rows`: a
   *  selection can be absent from the rows (a taxon the facet no longer
   *  lists) and still be applied. */
  showClear: boolean;
  loading?: boolean;
  disabled?: boolean;
  emptyText: string;
  onToggle: (key: string) => void;
  onClear: () => void;
}

export function FacetSection({
  title,
  rows,
  showClear,
  loading,
  disabled,
  emptyText,
  onToggle,
  onClear,
}: Props) {
  // Explicit open/closed per parent. Unset follows the selection: a
  // parent opens when a child is checked, so a selection that arrived by
  // link is never hidden under a collapsed row.
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const nested = rows.some((r) => r.children);

  const checkbox = (r: FacetRow) => (
    <input
      type="checkbox"
      checked={r.checked === true}
      ref={(el) => {
        if (el) el.indeterminate = r.checked === "partial";
      }}
      disabled={disabled}
      onChange={() => {
        if (!disabled) onToggle(r.key);
      }}
      className="h-3.5 w-3.5 accent-gemma-accent"
    />
  );
  const count = (r: FacetRow) => (
    <span className="text-gemma-subtle text-xs tabular-nums">
      {r.count == null ? "" : formatNumber(r.count)}
    </span>
  );

  return (
    <section className="mb-4">
      <div className="flex items-baseline justify-between mb-1">
        <h3 className="side-heading">{title}</h3>
        {showClear ? (
          <button
            type="button"
            onClick={onClear}
            disabled={disabled}
            className="text-xs text-gemma-accent hover:underline"
          >
            Clear
          </button>
        ) : null}
      </div>

      {loading ? <div className="h-0.5 bg-gemma-accent/30 animate-pulse" /> : null}

      <ul className="text-sm">
        {rows.length === 0 && !loading ? (
          <li className="text-gemma-subtle italic py-1">{emptyText}</li>
        ) : null}
        {rows.map((r) => {
          if (!r.children) {
            return (
              <li key={r.key} className="flex items-center gap-2 py-0.5">
                {checkbox(r)}
                <span className="flex-1 truncate flex items-center gap-1" title={r.title}>
                  {/* Lines leaf labels up with the parents' after the chevron. */}
                  {nested ? <span className="w-3 shrink-0" aria-hidden /> : null}
                  <span className="truncate">{r.label}</span>
                </span>
                {count(r)}
              </li>
            );
          }
          const isOpen = open[r.key] ?? r.children.some((c) => c.checked !== false);
          return (
            <li key={r.key} className="py-0.5">
              <div className="flex items-center gap-2">
                {checkbox(r)}
                <button
                  type="button"
                  onClick={() => setOpen({ ...open, [r.key]: !isOpen })}
                  className="flex-1 text-left truncate hover:text-gemma-accent flex items-center gap-1"
                  title={r.title}
                >
                  <ChevronRight
                    className={`h-3 w-3 shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`}
                  />
                  <span className="truncate">{r.label}</span>
                </button>
                {count(r)}
              </div>
              {isOpen ? (
                <ul className="pl-6 border-l border-gemma-grid ml-1.5">
                  {r.children.map((c) => (
                    <li key={c.key} className="flex items-center gap-2 py-0.5">
                      {checkbox(c)}
                      <span className="flex-1 truncate text-xs" title={c.title}>
                        {c.label}
                      </span>
                      {count(c)}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
