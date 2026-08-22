import { Fragment } from "react";
import { Link } from "@tanstack/react-router";
import { marked } from "marked";
import { ChevronDown, ChevronRight, AlertOctagon } from "lucide-react";
import { SHOW_GEEQ } from "@/lib/geeq";
import type {
  AnnotationTerm,
  Category,
  CategoryWithChildren,
  Dataset,
} from "@/lib/types";
import { displayTaxon, formatDecimal, formatNumber, highlight } from "@/lib/utils";
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

function QualityDot({ value }: { value: number }) {
  const cls =
    value > 0.45
      ? "bg-gemma-accent2"
      : value > 0.1
        ? "bg-gemma-accent3"
        : "bg-gemma-accent4";
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${cls}`}
      title={`Quality (GEEQ): ${formatDecimal(value)}`}
      aria-label={`Quality ${formatDecimal(value)}`}
    />
  );
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "2-digit",
  });
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
      <table className="w-full text-sm table-fixed">
        <colgroup>
          <col className="w-5" />
          <col className="w-[9.5rem]" />
          <col className="w-20" />
          <col />
          <col className="w-16" />
          <col className="w-20" />
        </colgroup>
        <thead className="sticky top-0 bg-white border-b border-gemma-grid z-10">
          <tr>
            <th />
            {SORT_COLUMNS.map((c) => {
              const dir = sort === `-${c.key}` ? "↓" : sort === `+${c.key}` ? "↑" : "";
              return (
                <th
                  key={c.key}
                  onClick={() => cycleSort(c.key)}
                  className={`px-2 py-1.5 text-[11px] font-medium text-gemma-subtle uppercase tracking-wider cursor-pointer hover:text-gemma-ink select-none ${
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
            const q = SHOW_GEEQ ? d.geeq?.publicQualityScore : undefined;
            return (
              <Fragment key={d.id}>
                <tr
                  className={`border-b border-gemma-grid hover:bg-gray-50 ${isOpen ? "bg-blue-50/30" : ""} cursor-pointer`}
                  onClick={() => onToggleExpanded(d.id)}
                >
                  <td className="pl-2 align-middle">
                    {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-gemma-subtle" /> : <ChevronRight className="h-3.5 w-3.5 text-gemma-subtle" />}
                  </td>
                  <td className="px-2 py-1 align-middle whitespace-nowrap">
                    <Link
                      to="/dataset/$id"
                      params={{ id: String(d.id) }}
                      onClick={(e) => e.stopPropagation()}
                      className="font-medium hover:underline"
                    >
                      {d.shortName}
                    </Link>
                  </td>
                  <td className="px-2 py-1 align-middle whitespace-nowrap text-gemma-subtle capitalize text-xs italic">
                    {displayTaxon(d.taxon)}
                  </td>
                  <td className="px-2 py-1 align-middle">
                    <div className="flex items-center gap-2 min-w-0">
                      {typeof q === "number" ? <QualityDot value={q} /> : null}
                      {d.curationNote ? (
                        <span
                          className="shrink-0 inline-flex items-center"
                          title={d.curationNote}
                          aria-label="curation note"
                        >
                          <AlertOctagon className="h-3.5 w-3.5 text-gemma-accent3" />
                        </span>
                      ) : null}
                      <div
                        className="truncate min-w-0 flex-1"
                        title={d.name}
                        dangerouslySetInnerHTML={{ __html: renderName(d) }}
                      />
                    </div>
                  </td>
                  <td className="px-2 py-1 align-middle text-right tabular-nums">
                    {formatNumber(d.numberOfBioAssays ?? 0)}
                  </td>
                  <td className="px-2 py-1 align-middle text-right text-gemma-subtle whitespace-nowrap text-xs tabular-nums">
                    {d.lastUpdated ? shortDate(d.lastUpdated) : ""}
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
