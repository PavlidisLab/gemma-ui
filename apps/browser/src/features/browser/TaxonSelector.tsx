import type { Taxon } from "@/lib/types";
import { formatNumber } from "@/lib/utils";

interface Props {
  available: Taxon[];
  selected: Taxon[];
  loading?: boolean;
  disabled?: boolean;
  onChange: (next: Taxon[]) => void;
}

export function TaxonSelector({ available, selected, loading, disabled, onChange }: Props) {
  const ranked = [...available].sort(
    (a, b) => (b.numberOfExpressionExperiments ?? 0) - (a.numberOfExpressionExperiments ?? 0),
  );
  const ids = new Set(selected.map((t) => t.id));

  function toggle(t: Taxon) {
    if (disabled) return;
    const next = ids.has(t.id) ? selected.filter((x) => x.id !== t.id) : [...selected, t];
    onChange(next);
  }

  return (
    <section className="mb-4">
      <div className="flex items-baseline justify-between mb-1">
        <h3 className="side-heading">Taxa</h3>
        {selected.length > 0 ? (
          <button
            type="button"
            onClick={() => onChange([])}
            disabled={disabled}
            className="text-xs text-gemma-accent hover:underline"
          >
            Clear
          </button>
        ) : null}
      </div>

      {loading ? <div className="h-0.5 bg-gemma-accent/30 animate-pulse" /> : null}

      <ul className="text-sm">
        {ranked.length === 0 && !loading ? (
          <li className="text-gemma-subtle italic py-1">No taxa available</li>
        ) : null}
        {ranked.map((t) => (
          <li key={t.id} className="flex items-center gap-2 py-0.5">
            <input
              type="checkbox"
              checked={ids.has(t.id)}
              disabled={disabled}
              onChange={() => toggle(t)}
              className="h-3.5 w-3.5 accent-gemma-accent"
            />
            <span className="flex-1 truncate" title={`${t.scientificName} (${t.commonName})`}>
              <span className="italic">{t.scientificName}</span>{" "}
              <span className="text-gemma-subtle">
                ({t.commonName ? t.commonName[0].toUpperCase() + t.commonName.slice(1) : ""})
              </span>
            </span>
            <span className="text-gemma-subtle text-xs tabular-nums">
              {formatNumber(t.numberOfExpressionExperiments ?? 0)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
