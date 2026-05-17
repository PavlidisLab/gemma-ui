import { Fragment } from "react";
import { marked } from "marked";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import type {
  AnnotationTerm,
  Category,
  CategoryWithChildren,
  Dataset,
} from "@/lib/types";
import { formatNumber, highlight } from "@/lib/utils";
import { gemmaUrl } from "@/lib/gemmaConfig";
import { DatasetPreview } from "./DatasetPreview";

interface Props {
  datasets: Dataset[];
  loading?: boolean;
  sort?: string;
  onSortChange: (sort: string | undefined) => void;
  expanded: Set<number>;
  onToggleExpanded: (id: number) => void;
  selectedAnnotations: AnnotationTerm[];
  selectedCategories: Category[];
  availableAnnotations: CategoryWithChildren[];
  onSelectTerm: (t: AnnotationTerm) => void;
  onUnselectTerm: (t: AnnotationTerm) => void;
}

const SORT_COLUMNS: Array<{ key: string; label: string; align?: "right" | "center" }> = [
  { key: "shortName", label: "Short name" },
  { key: "taxon", label: "Taxon" },
  { key: "name", label: "Title" },
  { key: "bioAssays.size", label: "Samples", align: "right" },
  { key: "lastUpdated", label: "Updated", align: "right" },
];

function renderName(d: Dataset): string {
  if (d.searchResult?.highlights && "name" in d.searchResult.highlights) {
    return String(marked.parseInline(highlight(d.name, d.searchResult.highlights.name)));
  }
  return String(marked.parseInline(d.name ?? ""));
}

export function ResultsTable(props: Props) {
  const {
    datasets, loading, sort, onSortChange,
    expanded, onToggleExpanded,
    selectedAnnotations, selectedCategories, availableAnnotations,
    onSelectTerm, onUnselectTerm,
  } = props;

  function cycleSort(key: string) {
    if (sort === `-${key}`) onSortChange(`+${key}`);
    else if (sort === `+${key}`) onSortChange(undefined);
    else onSortChange(`-${key}`);
  }

  return (
    <div className="flex-1 min-h-0 overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-white border-b border-gemma-grid z-10">
          <tr>
            <th className="w-6" />
            {SORT_COLUMNS.map((c) => {
              const dir = sort === `-${c.key}` ? "↓" : sort === `+${c.key}` ? "↑" : "";
              return (
                <th
                  key={c.key}
                  onClick={() => cycleSort(c.key)}
                  className={`px-2 py-2 text-xs font-medium text-gemma-subtle uppercase tracking-wider cursor-pointer hover:text-gemma-ink select-none ${
                    c.align === "right" ? "text-right" : "text-left"
                  }`}
                >
                  {c.label} {dir}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {loading && datasets.length === 0 ? (
            <tr><td colSpan={6} className="text-center py-8 text-gemma-subtle">Loading…</td></tr>
          ) : null}
          {!loading && datasets.length === 0 ? (
            <tr><td colSpan={6} className="text-center py-8 text-gemma-subtle">No datasets match the query and filters.</td></tr>
          ) : null}
          {datasets.map((d) => {
            const isOpen = expanded.has(d.id);
            return (
              <Fragment key={d.id}>
                <tr
                  className={`border-b border-gemma-grid hover:bg-gray-50 ${isOpen ? "bg-blue-50/30" : ""} cursor-pointer`}
                  onClick={() => onToggleExpanded(d.id)}
                >
                  <td className="px-2 align-top pt-2">
                    {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-gemma-subtle" /> : <ChevronRight className="h-3.5 w-3.5 text-gemma-subtle" />}
                  </td>
                  <td className="px-2 py-2 align-top whitespace-nowrap">
                    <a
                      href={gemmaUrl(`/expressionExperiment/showExpressionExperiment.html?id=${d.id}`)}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="font-medium inline-flex items-center gap-0.5"
                    >
                      {d.shortName}
                      <ExternalLink className="h-3 w-3 opacity-50" />
                    </a>
                  </td>
                  <td className="px-2 py-2 align-top whitespace-nowrap text-gemma-subtle capitalize">
                    {d.taxon?.commonName}
                  </td>
                  <td
                    className="px-2 py-2 align-top"
                    dangerouslySetInnerHTML={{ __html: renderName(d) }}
                  />
                  <td className="px-2 py-2 align-top text-right tabular-nums">
                    {formatNumber(d.numberOfBioAssays ?? 0)}
                  </td>
                  <td className="px-2 py-2 align-top text-right text-gemma-subtle whitespace-nowrap">
                    {d.lastUpdated ? new Date(d.lastUpdated).toLocaleDateString() : ""}
                  </td>
                </tr>
                {isOpen ? (
                  <tr className="bg-blue-50/30 border-b border-gemma-grid">
                    <td />
                    <td colSpan={5} className="px-2">
                      <DatasetPreview
                        dataset={d}
                        selectedAnnotations={selectedAnnotations}
                        selectedCategories={selectedCategories}
                        availableAnnotations={availableAnnotations}
                        onSelectTerm={onSelectTerm}
                        onUnselectTerm={onUnselectTerm}
                      />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
