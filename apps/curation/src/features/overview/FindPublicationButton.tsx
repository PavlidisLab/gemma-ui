import { useState } from "react";
import {
  useFindPublication,
  type PublicationCandidate,
} from "@/api/proposals";
import { ApiError } from "@/api/client";
import { Spinner } from "@/components/ui/Spinner";

/**
 * Triggers the proposer service's pub-finder agent and renders its
 * suggestions. Lives next to the Publications card so it sits in the
 * curator's "manage publications" flow rather than the ``+ propose``
 * pipeline used for design / tag proposals. The "link this" action
 * is delegated up via ``onLink`` so the parent decides how to apply
 * (in OverviewPanel: through the design draft's ``apply`` +
 * ``addPublication``).
 *
 * Phase 1 only — the agent currently checks GEO's own ``Pubmed-ID``
 * field. When GEO has none, the agent reports back empty and we tell
 * the curator to fall back to a manual PubMed search. An LLM-driven
 * contributor / title search is phase 2 (see
 * ``gemma-curation-agents/PUBLICATION-FINDER-HANDOFF.md``).
 */
export function FindPublicationButton({
  accession,
  onLink,
}: {
  accession: string;
  onLink: (c: PublicationCandidate) => void;
}) {
  const find = useFindPublication();
  const [linked, setLinked] = useState<Set<string>>(new Set());
  // Dismissed candidates are hidden from the rendered list. Pure
  // client state — we don't tell the agent the curator rejected
  // anything; for publications there's no model-tuning loop the way
  // there is for design proposals, so a reject is just "don't show
  // me this again in this session".
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  if (!accession) {
    return (
      <div className="text-[11px] text-slate-500 italic">
        no external accession recorded — auto-search needs a GEO accession
      </div>
    );
  }
  const result = find.data;
  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={() => find.mutate({ accession })}
        disabled={find.isPending}
        title={
          find.isPending
            ? "looking up candidates from GEO + PubMed"
            : "asks the publication-finder agent for candidates"
        }
        className={
          "text-[11px] inline-flex items-center gap-1.5 px-2 py-0.5 rounded font-medium " +
          (find.isPending
            ? "bg-slate-200 text-slate-500 cursor-progress"
            : "bg-slate-100 text-slate-700 hover:bg-slate-200")
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
          "+ seek a publication"
        )}
      </button>
      {find.error ? (
        <div className="text-[11px] text-amber-800">
          {find.error instanceof ApiError && find.error.status === 404
            ? "publication-finder endpoint not yet available — see PUBLICATION-FINDER-HANDOFF.md"
            : find.error instanceof ApiError
              ? find.error.detail || find.error.message
              : (find.error as Error).message}
        </div>
      ) : null}
      {result ? (
        (() => {
          const visible = result.candidates.filter(
            (c) => !dismissed.has(c.pmid),
          );
          if (result.candidates.length === 0 || visible.length === 0) {
            return (
              <div className="text-[11px] text-slate-600 italic">
                {result.candidates.length === 0
                  ? result.note ||
                    (result.source === "no_geo_record"
                      ? `Agent couldn't find a GEO record for ${accession}.`
                      : "Agent didn't find a linked publication on the GEO record. Try a manual PubMed search by contributor or title.")
                  : "All candidates dismissed. Use ↻ look again to re-fetch."}
              </div>
            );
          }
          return (
            <div className="space-y-1">
              <div className="text-[11px] text-slate-500 uppercase tracking-wide font-semibold">
                {visible.length === 1
                  ? "Agent suggests"
                  : `Agent suggests (${visible.length})`}
              </div>
              <ul className="space-y-1">
                {visible.map((c) => {
                  const isLinked = linked.has(c.pmid);
                  return (
                    <li
                      key={c.pmid}
                      className="flex items-start gap-2 border border-slate-200 rounded px-2 py-1 bg-white text-[11px]"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-slate-800">
                          <a
                            href={c.pubmed_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-700 hover:underline font-medium"
                          >
                            PMID {c.pmid}
                          </a>
                          {c.citation ? (
                            <span className="text-slate-700"> — {c.citation}</span>
                          ) : null}
                        </div>
                        {c.title ? (
                          <div className="text-slate-500 truncate">{c.title}</div>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          onLink(c);
                          setLinked((prev) => new Set(prev).add(c.pmid));
                        }}
                        disabled={isLinked}
                        className={
                          "shrink-0 px-2 py-0.5 rounded border " +
                          (isLinked
                            ? "border-emerald-300 bg-emerald-50 text-emerald-800 cursor-default"
                            : "border-blue-300 bg-blue-50 text-blue-800 hover:bg-blue-100")
                        }
                      >
                        {isLinked ? "✓ confirmed" : "confirm"}
                      </button>
                      {isLinked ? null : (
                        <button
                          type="button"
                          onClick={() =>
                            setDismissed((prev) =>
                              new Set(prev).add(c.pmid),
                            )
                          }
                          title="dismiss this suggestion"
                          className="shrink-0 px-1.5 py-0.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                        >
                          ✕
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })()
      ) : null}
    </div>
  );
}
