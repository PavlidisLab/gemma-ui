// Click-to-expand row preview: dataset description + annotation chips.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import pluralize from "pluralize";
import { titleCase } from "title-case";
import { Plus, Minus } from "lucide-react";
import { marked } from "marked";
import { getDatasetAnnotations } from "@/api/endpoints";
import { gemmaUrl } from "@/lib/gemmaConfig";
import type {
  AnnotationTerm,
  Category,
  CategoryWithChildren,
  Dataset,
  DatasetAnnotation,
} from "@/lib/types";
import { getCategoryId, getTermId, highlight, TERM_ID_SEP } from "@/lib/utils";

interface Props {
  dataset: Dataset;
  selectedCategories: Category[];
  selectedAnnotations: AnnotationTerm[];
  availableAnnotations: CategoryWithChildren[];
  onSelectTerm: (term: AnnotationTerm) => void;
  onUnselectTerm: (term: AnnotationTerm) => void;
}

const OBJECT_CLASS_PRIORITY: Record<string, number> = {
  BioMaterial: 0,
  ExperimentTag: 1,
  FactorValue: 2,
};

function getId(t: AnnotationTerm | DatasetAnnotation): string {
  return `${getCategoryId(t as AnnotationTerm)}${TERM_ID_SEP}${getTermId(t as AnnotationTerm)}`;
}

export function DatasetPreview({
  dataset,
  selectedCategories,
  selectedAnnotations,
  availableAnnotations,
  onSelectTerm,
  onUnselectTerm,
}: Props) {
  const [groupedOpen, setGroupedOpen] = useState<Record<string, boolean>>({});

  const ann = useQuery({
    queryKey: ["datasetAnnotations", dataset.id],
    queryFn: ({ signal }) => getDatasetAnnotations(dataset.id, signal),
  });

  const description = useMemo(() => {
    if (
      dataset.searchResult?.highlights &&
      "description" in dataset.searchResult.highlights &&
      dataset.description
    ) {
      return marked.parseInline(
        highlight(dataset.description, dataset.searchResult.highlights.description),
      );
    }
    const text = dataset.description ?? "";
    const words = text.split(" ");
    if (words.length > 150) return marked.parseInline(words.slice(0, 150).join(" ") + "…");
    return marked.parseInline(text);
  }, [dataset]);

  const selectedCategoryIds = useMemo(
    () => new Set(selectedCategories.map((c) => getCategoryId(c))),
    [selectedCategories],
  );
  const selectedAnnotationIds = useMemo(
    () => new Set(selectedAnnotations.map(getId)),
    [selectedAnnotations],
  );
  const availableAnnotationIds = useMemo(
    () => new Set(availableAnnotations.flatMap((c) => c.children).map(getId)),
    [availableAnnotations],
  );

  function isSelectable(term: DatasetAnnotation): boolean {
    const id = getId(term);
    return (
      availableAnnotationIds.has(id) &&
      !selectedCategoryIds.has(getCategoryId(term as unknown as AnnotationTerm)) &&
      !selectedAnnotationIds.has(id)
    );
  }
  function isUnselectable(term: DatasetAnnotation): boolean {
    return selectedAnnotationIds.has(getId(term));
  }

  function chipColor(objectClass: string) {
    switch (objectClass) {
      case "FactorValue": return "bg-amber-50 text-amber-800 border-amber-200";
      case "ExperimentTag": return "bg-emerald-50 text-emerald-800 border-emerald-200";
      case "BioMaterial": return "bg-sky-50 text-sky-800 border-sky-200";
      default: return "bg-orange-50 text-orange-800 border-orange-200";
    }
  }

  function handleClick(term: DatasetAnnotation) {
    const t: AnnotationTerm = {
      classUri: term.classUri,
      className: term.className,
      termUri: term.termUri,
      termName: term.termName,
    };
    if (isSelectable(term)) onSelectTerm(t);
    else if (isUnselectable(term)) onUnselectTerm(t);
  }

  const terms = ann.data?.data ?? [];

  // Bucket into groups when a className has >5 entries; else "main"
  const { mainTerms, grouped } = useMemo(() => {
    const countsByClass = new Map<string, number>();
    for (const t of terms) countsByClass.set(t.className, (countsByClass.get(t.className) ?? 0) + 1);
    const bigClasses = new Set<string>();
    for (const [k, v] of countsByClass) if (v > 5) bigClasses.add(k);

    function uniqueSorted(list: DatasetAnnotation[]): DatasetAnnotation[] {
      const sorted = [...list].sort(
        (a, b) =>
          (OBJECT_CLASS_PRIORITY[a.objectClass] ?? 9) -
          (OBJECT_CLASS_PRIORITY[b.objectClass] ?? 9),
      );
      const seen = new Map<string, DatasetAnnotation>();
      for (const t of sorted) {
        const id = getId(t);
        if (!seen.has(id)) seen.set(id, t);
      }
      return [...seen.values()];
    }

    const groupedObj: Record<string, DatasetAnnotation[]> = {};
    for (const c of bigClasses) groupedObj[c] = uniqueSorted(terms.filter((t) => t.className === c));
    const main = uniqueSorted(terms.filter((t) => !bigClasses.has(t.className)));
    return { mainTerms: main, grouped: groupedObj };
  }, [terms]);

  return (
    <div className="py-3 px-2">
      <h3 className="mb-2">
        <a
          href={gemmaUrl(`/expressionExperiment/showExpressionExperiment.html?id=${dataset.id}`)}
          target="_blank"
          rel="noreferrer"
          className="font-medium"
        >
          {dataset.shortName}
        </a>
        : <span className="text-gemma-ink">{dataset.name}</span>
      </h3>

      <div className="flex flex-wrap gap-1 mb-2">
        {mainTerms.map((t) => {
          const sel = isSelectable(t);
          const unsel = isUnselectable(t);
          const interactive = sel || unsel;
          return (
            <button
              key={getId(t)}
              onClick={() => interactive && handleClick(t)}
              disabled={!interactive}
              className={`chip ${chipColor(t.objectClass)} ${interactive ? "cursor-pointer hover:shadow-sm" : "cursor-default opacity-80"}`}
              title={`${(t.className ?? "").charAt(0).toUpperCase() + (t.className ?? "").slice(1)}: ${t.termUri ?? "free text"} via ${t.objectClass}`}
            >
              {titleCase(t.termName ?? "")}
              {sel ? <Plus className="h-3 w-3" /> : unsel ? <Minus className="h-3 w-3" /> : null}
            </button>
          );
        })}
        {Object.keys(grouped).map((cls) => (
          <span key={cls} className="contents">
            <button
              onClick={() => setGroupedOpen({ ...groupedOpen, [cls]: !groupedOpen[cls] })}
              className="chip border-gemma-grid bg-white text-gemma-subtle hover:bg-gray-50"
            >
              {pluralize(cls)} {groupedOpen[cls] ? "▾" : "▸"}
            </button>
            {groupedOpen[cls]
              ? grouped[cls].map((t) => {
                  const sel = isSelectable(t);
                  const unsel = isUnselectable(t);
                  const interactive = sel || unsel;
                  return (
                    <button
                      key={getId(t)}
                      onClick={() => interactive && handleClick(t)}
                      disabled={!interactive}
                      className={`chip ${chipColor(t.objectClass)} ${interactive ? "cursor-pointer hover:shadow-sm" : "cursor-default opacity-80"}`}
                      title={`${(t.className ?? "").charAt(0).toUpperCase() + (t.className ?? "").slice(1)}: ${t.termUri ?? "free text"} via ${t.objectClass}`}
                    >
                      {titleCase(t.termName ?? "")}
                      {sel ? <Plus className="h-3 w-3" /> : unsel ? <Minus className="h-3 w-3" /> : null}
                    </button>
                  );
                })
              : null}
          </span>
        ))}
      </div>

      <div
        className="text-sm text-gemma-ink/90 prose-sm max-w-none"
        dangerouslySetInnerHTML={{ __html: String(description) }}
      />
    </div>
  );
}
