import { useState } from "react";
import { useFindTerm, type TermCandidate } from "@/api/findTerm";
import { ApiError } from "@/api/client";
import { useDesignDraft } from "./DesignDraftContext";
import { Spinner } from "@/components/ui/Spinner";
import { shortenUri } from "@/lib/curie";
import type { OntologyTerm } from "@/features/experiment/types";

/**
 * Mini agent action attached to a free-text Statement subject /
 * object: hands the label + category to the find-term agent and
 * renders ranked candidates the curator confirms with one click.
 *
 * Only renders when the current term has no URI — once a term is
 * resolved, the typeahead picker has done its job and the button
 * disappears. Shape mirrors the publication-finder button.
 *
 * Endpoint contract lives in
 * ``gemma-curation-agents/FIND-TERM-HANDOFF.md``. Until that ships
 * we still render the button; clicks 404 / connection-fail and we
 * surface a "endpoint not yet available" hint so the curator
 * doesn't think the UI is broken.
 */
export function FindTermButton({
  currentLabel,
  category,
  context,
  onPick,
}: {
  currentLabel: string;
  /** Statement / factor category that scopes the search (e.g.
   *  "cell line", "disease"). The agent uses it to pick the right
   *  ontology bucket. */
  category: string;
  /** Whether this button sits next to the subject or object slot —
   *  forwarded as a soft hint so the agent can prefer slot-
   *  appropriate ontology classes. */
  context: "subject" | "object";
  /** Curator confirmed a candidate; apply it as the new term. */
  onPick: (term: OntologyTerm) => void;
}) {
  const find = useFindTerm();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const { draft } = useDesignDraft();

  const trimmed = currentLabel.trim();
  if (!trimmed) return null; // nothing to search for

  function run() {
    find.mutate({
      free_text: trimmed,
      category,
      experiment_id: draft?.experiment_id,
      taxon: draft?.taxon,
      context,
    });
  }

  const result = find.data;
  const visibleCandidates = result
    ? result.candidates.filter((c) => !dismissed.has(c.uri))
    : [];

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={run}
        disabled={find.isPending}
        title={
          find.isPending
            ? "asking the find-term agent"
            : `look up ontology candidates for "${trimmed}"`
        }
        className={
          "text-[10px] inline-flex items-center gap-1 px-1.5 py-0.5 rounded border " +
          (find.isPending
            ? "bg-slate-200 text-slate-500 border-slate-300 cursor-progress"
            : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100")
        }
      >
        {find.isPending ? (
          <>
            <Spinner />
            looking…
          </>
        ) : result ? (
          "↻ look again"
        ) : (
          "↻ find term"
        )}
      </button>
      {find.error ? (
        <div className="text-[10px] text-amber-800">
          {find.error instanceof ApiError && find.error.status === 404
            ? "find-term endpoint not yet available — see FIND-TERM-HANDOFF.md"
            : find.error instanceof ApiError
              ? find.error.detail || find.error.message
              : (find.error as Error).message}
        </div>
      ) : null}
      {result ? (
        visibleCandidates.length === 0 ? (
          <div className="text-[10px] text-slate-500 italic">
            {result.note ||
              (result.candidates.length > 0
                ? "all candidates dismissed."
                : "agent found no candidates — try a different label or look up manually.")}
          </div>
        ) : (
          <div className="space-y-1">
            {/* Header: echoes the searched category so the curator
                sees what scope the agent ran against, plus the
                clear-all link. ``find.reset()`` clears
                ``find.data`` so the button label flips back to
                "↻ find term" — the curator can re-fire later if
                they want. */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-slate-500">
                category:{" "}
                <span className="text-slate-700 font-medium">
                  {result.category}
                </span>
              </span>
              <button
                type="button"
                onClick={() => {
                  setPicked(new Set());
                  setDismissed(new Set());
                  find.reset();
                }}
                className="text-[10px] text-blue-700 hover:underline"
                title="clear all candidates"
              >
                clear
              </button>
            </div>
            <ul className="text-[10px] space-y-0.5">
              {visibleCandidates.map((c) => {
                const isPicked = picked.has(c.uri);
                return (
                  <li
                    key={c.uri}
                    className="flex items-start gap-1.5 border border-slate-200 rounded px-1.5 py-0.5 bg-white"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-slate-800 truncate">
                        <span className="font-medium">{c.label}</span>
                        <span className="ml-1 text-slate-400 font-mono">
                          {shortenUri(c.uri) || c.ontology}
                        </span>
                        <SourceBadge source={c.source} />
                        {/* Per-candidate category chip. Highlighted
                            amber when it differs from the request's
                            category (e.g. agent surfaced a cell-line
                            candidate for a cell-type slot) so the
                            curator can decide whether to use it. */}
                        {c.category ? (
                          <span
                            className={
                              "ml-1 text-[9px] uppercase tracking-wide font-semibold px-1 py-0 rounded border " +
                              (c.category.trim().toLowerCase() !==
                              result.category.trim().toLowerCase()
                                ? "bg-amber-50 text-amber-800 border-amber-200"
                                : "bg-slate-50 text-slate-600 border-slate-200")
                            }
                            title={
                              c.category.trim().toLowerCase() !==
                              result.category.trim().toLowerCase()
                                ? `category mismatch — searched ${result.category}, this candidate is ${c.category}`
                                : `category: ${c.category}`
                            }
                          >
                            {c.category}
                          </span>
                        ) : null}
                      </div>
                      {c.definition ? (
                        <div className="text-slate-600 leading-snug">
                          {c.definition}
                        </div>
                      ) : null}
                      {c.parent_label ? (
                        <div className="text-slate-500">
                          parent: {c.parent_label}
                        </div>
                      ) : null}
                      {c.rationale ? (
                        <div className="text-slate-500 italic truncate">
                          {c.rationale}
                        </div>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        onPick({ label: c.label, uri: c.uri });
                        setPicked((prev) => new Set(prev).add(c.uri));
                      }}
                      disabled={isPicked}
                      className={
                        "shrink-0 px-1.5 py-0.5 rounded border " +
                        (isPicked
                          ? "border-emerald-300 bg-emerald-50 text-emerald-800 cursor-default"
                          : "border-blue-300 bg-blue-50 text-blue-800 hover:bg-blue-100")
                      }
                    >
                      {isPicked ? "✓ used" : "use"}
                    </button>
                    {isPicked ? null : (
                      <button
                        type="button"
                        onClick={() =>
                          setDismissed((prev) => new Set(prev).add(c.uri))
                        }
                        title="dismiss this suggestion"
                        className="shrink-0 px-1 text-slate-400 hover:text-slate-700"
                      >
                        ✕
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )
      ) : null}
    </div>
  );
}

function SourceBadge({ source }: { source: TermCandidate["source"] }) {
  const cls =
    source === "annotation_search"
      ? "bg-emerald-50 text-emerald-800 border-emerald-200"
      : source === "ontology_lookup"
        ? "bg-slate-50 text-slate-600 border-slate-200"
        : "bg-amber-50 text-amber-800 border-amber-200";
  const label =
    source === "annotation_search"
      ? "catalog"
      : source === "ontology_lookup"
        ? "ontology"
        : "llm";
  return (
    <span
      className={
        "ml-1 text-[9px] uppercase tracking-wide font-semibold px-1 py-0 rounded border " +
        cls
      }
      title={`source: ${source}`}
    >
      {label}
    </span>
  );
}
