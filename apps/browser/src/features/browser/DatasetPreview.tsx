// Click-to-expand row preview: dataset description + annotation chips.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import pluralize from "pluralize";
import { titleCase } from "title-case";
import { Plus, Minus, ExternalLink, AlertOctagon, ArrowRight } from "lucide-react";
import { marked } from "marked";
import { getDatasetAnnotations } from "@/api/endpoints";
import { HelpHint } from "@/features/shared/HelpHint";
import type {
  AnnotationTerm,
  Category,
  CategoryWithChildren,
  Dataset,
  DatasetAnnotation,
} from "@/lib/types";
import {
  displayTaxon,
  formatDecimal,
  formatNumber,
  getCategoryId,
  getTermId,
  highlight,
  TERM_ID_SEP,
} from "@/lib/utils";

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

  const [showFullDescription, setShowFullDescription] = useState(false);

  const { description, descriptionTruncated } = useMemo(() => {
    if (
      dataset.searchResult?.highlights &&
      "description" in dataset.searchResult.highlights &&
      dataset.description
    ) {
      return {
        description: marked.parseInline(
          highlight(dataset.description, dataset.searchResult.highlights.description),
        ),
        descriptionTruncated: false,
      };
    }
    const text = dataset.description ?? "";
    const words = text.split(/\s+/);
    const LIMIT = 250;
    if (!showFullDescription && words.length > LIMIT) {
      return {
        description: marked.parseInline(words.slice(0, LIMIT).join(" ") + "…"),
        descriptionTruncated: true,
      };
    }
    return {
      description: marked.parseInline(text),
      descriptionTruncated: false,
    };
  }, [dataset, showFullDescription]);

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

  const quality = dataset.geeq?.publicQualityScore;
  const accession = dataset.accession?.accession;
  const isGeo = !!accession && /^GSE/i.test(accession);
  const geoUrl = isGeo
    ? `https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${encodeURIComponent(accession!)}`
    : null;

  return (
    <div className="py-3 px-2 space-y-3">
      {/* Meta strip: at-a-glance facts + outbound links. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gemma-subtle">
        {dataset.taxon ? (
          <span className="capitalize text-gemma-ink">{displayTaxon(dataset.taxon)}</span>
        ) : null}
        {typeof dataset.numberOfBioAssays === "number" ? (
          <span>
            <span className="tabular-nums text-gemma-ink">
              {formatNumber(dataset.numberOfBioAssays)}
            </span>{" "}
            samples
          </span>
        ) : null}
        {typeof quality === "number" ? (
          <span className="inline-flex items-center gap-1">
            <QualityDot value={quality} />
            <span>
              quality{" "}
              <span className="tabular-nums text-gemma-ink">
                {formatDecimal(quality)}
              </span>
            </span>
            <HelpHint
              label="GEEQ quality score"
              body="Gemma's public quality score (GEEQ) reflects experimental design + data-suitability heuristics. Green ≥ 0.45 · amber > 0.1 · red ≤ 0.1."
            />
          </span>
        ) : null}
        {dataset.lastUpdated ? (
          <span title={new Date(dataset.lastUpdated).toString()}>
            updated{" "}
            <span className="text-gemma-ink">
              {new Date(dataset.lastUpdated).toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
            </span>
          </span>
        ) : null}
        <span className="flex-1" />
        <Link
          to="/dataset/$id"
          params={{ id: String(dataset.id) }}
          className="inline-flex items-center gap-0.5 text-gemma-accent hover:underline"
          title="open the experiment page"
        >
          View experiment
          <ArrowRight className="h-3 w-3" />
        </Link>
        {geoUrl ? (
          <a
            href={geoUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 text-gemma-accent hover:underline"
            title="open on NCBI GEO"
          >
            GEO: {accession}
            <ExternalLink className="h-3 w-3" />
          </a>
        ) : null}
      </div>

      {/* Curator note callout — surfaced when a curator left a flag. */}
      {dataset.curationNote ? (
        <div className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50/60 px-2 py-1.5 text-xs text-amber-900">
          <AlertOctagon className="h-3.5 w-3.5 mt-0.5 shrink-0 text-gemma-accent3" />
          <div className="flex-1 min-w-0">
            <div className="font-medium uppercase tracking-wider text-[10px] text-amber-800/80">
              Curator note
            </div>
            <div className="whitespace-pre-wrap">{dataset.curationNote}</div>
          </div>
        </div>
      ) : null}

      {/* Description. Inline highlight for search hits; expand-to-full
          when the trimmed preview cuts off content. */}
      <div className="space-y-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-gemma-subtle font-medium">
            Description
          </span>
          <HelpHint
            label="Description"
            body="Free-text abstract Gemma stores for this dataset — usually mirrors the GEO study summary. Search-query hits are highlighted."
          />
        </div>
        {dataset.description ? (
          <>
            <div
              className="text-sm text-gemma-ink/90 max-w-none"
              dangerouslySetInnerHTML={{ __html: String(description) }}
            />
            {descriptionTruncated ? (
              <button
                type="button"
                onClick={() => setShowFullDescription(true)}
                className="text-xs text-gemma-accent hover:underline"
              >
                Show full description
              </button>
            ) : null}
          </>
        ) : (
          <div className="text-xs italic text-gemma-subtle">No description.</div>
        )}
      </div>

      {/* Annotations — chips drive the include/exclude filter state. */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-gemma-subtle font-medium">
            Annotations
          </span>
          <HelpHint
            label="Annotations"
            body={
              "Ontology terms tagged on this dataset. Color = source:" +
              "\n· blue = biomaterial (sample-level metadata)" +
              "\n· green = experiment tag (whole-experiment)" +
              "\n· amber = factor value (experimental design)." +
              "\nClick a chip to add it as a filter; click again to remove."
            }
          />
          {ann.isLoading ? (
            <span className="text-[11px] italic text-gemma-subtle">loading…</span>
          ) : null}
        </div>
        {!ann.isLoading && mainTerms.length === 0 && Object.keys(grouped).length === 0 ? (
          <div className="text-xs italic text-gemma-subtle">No annotations.</div>
        ) : (
          <div className="flex flex-wrap gap-1">
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
                  {pluralize(cls)} ({grouped[cls].length}) {groupedOpen[cls] ? "▾" : "▸"}
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
        )}
      </div>
    </div>
  );
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
      aria-hidden
    />
  );
}

