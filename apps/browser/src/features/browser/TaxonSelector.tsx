import type { Taxon } from "@/lib/types";
import { FacetSection } from "./FacetSection";

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

  function toggle(key: string) {
    const t = ranked.find((x) => String(x.id) === key);
    if (!t) return;
    onChange(ids.has(t.id) ? selected.filter((x) => x.id !== t.id) : [...selected, t]);
  }

  return (
    <FacetSection
      title="Taxa"
      rows={ranked.map((t) => ({
        key: String(t.id),
        label: (
          <>
            <span className="italic">{t.scientificName}</span>{" "}
            <span className="text-gemma-subtle">
              ({t.commonName ? t.commonName[0].toUpperCase() + t.commonName.slice(1) : ""})
            </span>
          </>
        ),
        title: `${t.scientificName} (${t.commonName})`,
        count: t.numberOfExpressionExperiments ?? 0,
        checked: ids.has(t.id),
      }))}
      showClear={selected.length > 0}
      loading={loading}
      disabled={disabled}
      emptyText="No taxa available"
      onToggle={toggle}
      onClear={() => onChange([])}
    />
  );
}
