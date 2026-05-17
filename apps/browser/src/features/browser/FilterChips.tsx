// Active-filter chip strip shown above the results table.

import { X } from "lucide-react";
import { titleCase } from "title-case";
import type {
  AnnotationTerm,
  Category,
  Platform,
  SearchSettings,
  Taxon,
} from "@/lib/types";

interface Props {
  settings: SearchSettings;
  onRemoveTaxon: (t: Taxon) => void;
  onRemovePlatform: (p: Platform) => void;
  onRemoveTechnologyType: (t: string) => void;
  onRemoveAnnotation: (t: AnnotationTerm) => void;
  onRemoveNegativeAnnotation: (t: AnnotationTerm) => void;
  onRemoveCategory: (c: Category) => void;
  onRemoveNegativeCategory: (c: Category) => void;
  onClearQuery: () => void;
}

function Chip({
  cls,
  text,
  title,
  onRemove,
}: {
  cls?: string;
  text: string;
  title?: string;
  onRemove: () => void;
}) {
  return (
    <span className={`chip ${cls ?? ""}`} title={title}>
      <span className="max-w-[20ch] truncate">{text}</span>
      <button onClick={onRemove} className="opacity-60 hover:opacity-100">
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

export function FilterChips(props: Props) {
  const { settings } = props;
  const anything =
    settings.query ||
    settings.taxon.length > 0 ||
    settings.platforms.length > 0 ||
    settings.technologyTypes.length > 0 ||
    settings.annotations.length > 0 ||
    settings.negativeAnnotations.length > 0 ||
    settings.categories.length > 0 ||
    settings.negativeCategories.length > 0;

  if (!anything) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-3 py-1.5 border-b border-gemma-grid bg-gray-50/60">
      {settings.query ? (
        <Chip text={`"${settings.query}"`} cls="chip-pos" onRemove={props.onClearQuery} />
      ) : null}
      {settings.taxon.map((t) => (
        <Chip key={`tx-${t.id}`} text={t.commonName} onRemove={() => props.onRemoveTaxon(t)} />
      ))}
      {settings.technologyTypes.map((tt) => (
        <Chip key={`tt-${tt}`} text={tt} onRemove={() => props.onRemoveTechnologyType(tt)} />
      ))}
      {settings.platforms.map((p) => (
        <Chip key={`pl-${p.id}`} text={p.shortName || p.name || `#${p.id}`} onRemove={() => props.onRemovePlatform(p)} />
      ))}
      {settings.categories.map((c) => (
        <Chip
          key={`cat-${c.classUri ?? c.className}`}
          cls="chip-cat"
          text={`${titleCase(c.className ?? c.classUri ?? "Uncategorized")}: ANY`}
          title={c.classUri ?? undefined}
          onRemove={() => props.onRemoveCategory(c)}
        />
      ))}
      {settings.annotations.map((a) => (
        <Chip
          key={`an-${a.termUri ?? a.termName}`}
          cls="chip-pos"
          text={titleCase(a.termName ?? a.termUri ?? "")}
          title={`${a.className ?? ""} → ${a.termName ?? a.termUri}`}
          onRemove={() => props.onRemoveAnnotation(a)}
        />
      ))}
      {settings.negativeAnnotations.map((a) => (
        <Chip
          key={`xan-${a.termUri ?? a.termName}`}
          cls="chip-neg"
          text={"NOT " + titleCase(a.termName ?? a.termUri ?? "")}
          title={`NOT ${a.className ?? ""} → ${a.termName ?? a.termUri}`}
          onRemove={() => props.onRemoveNegativeAnnotation(a)}
        />
      ))}
      {settings.negativeCategories.map((c) => (
        <Chip
          key={`xcat-${c.classUri ?? c.className}`}
          cls="chip-neg"
          text={"NOT " + titleCase(c.className ?? c.classUri ?? "Uncategorized") + ": ANY"}
          onRemove={() => props.onRemoveNegativeCategory(c)}
        />
      ))}
    </div>
  );
}
