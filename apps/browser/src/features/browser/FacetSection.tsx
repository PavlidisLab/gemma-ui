// A side-panel section of checkbox rows, each with a dataset count.
// TaxonSelector renders through it.

import type { ReactNode } from "react";
import { formatNumber } from "@/lib/utils";

export interface FacetRow {
  key: string;
  label: ReactNode;
  title?: string;
  /** Datasets matching the row; null while unknown. */
  count: number | null;
  checked: boolean;
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
        {rows.map((r) => (
          <li key={r.key} className="flex items-center gap-2 py-0.5">
            <input
              type="checkbox"
              checked={r.checked}
              disabled={disabled}
              onChange={() => {
                if (!disabled) onToggle(r.key);
              }}
              className="h-3.5 w-3.5 accent-gemma-accent"
            />
            <span className="flex-1 truncate" title={r.title}>
              {r.label}
            </span>
            <span className="text-gemma-subtle text-xs tabular-nums">
              {r.count == null ? "" : formatNumber(r.count)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
