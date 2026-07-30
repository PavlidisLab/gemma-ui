import { useMutation } from "@tanstack/react-query";
import { api } from "./client";

/**
 * Response shape for ``POST /find-term``. Mirrors
 * ``FindTermResult`` in
 * ``gemma-curation-agents/agents/find_term/finder.py``.
 *
 * ``source`` discriminates how the candidate was produced:
 *   - ``annotation_search``: matched in Gemma's annotation
 *     catalog (high confidence, previously used).
 *   - ``ontology_lookup``: direct OBO / OLS lookup based on
 *     the category.
 *   - ``llm_match``: LLM-judged non-exact match against the
 *     experiment context. ``rationale`` carries one short
 *     sentence in this case.
 */
export interface TermCandidate {
  label: string;
  uri: string;
  ontology: string;
  source: "annotation_search" | "ontology_lookup" | "llm_match";
  rationale: string | null;
  /** Optional ontology-supplied definition (textual). Populated by
   *  the agent when it can cheaply resolve one (typically via OLS
   *  on the ontology_lookup or llm_match paths; catalog hits won't
   *  always carry one). UI displays it when present, hides
   *  silently when null. */
  definition?: string | null;
  /** Optional immediate hierarchical parent(s) from OLS4. Multiple
   *  parents are joined with `` / `` server-side. Helps the curator
   *  orient in deep ontology hierarchies without opening the
   *  ontology browser. Populated alongside ``definition`` for small
   *  result sets. */
  parent_label?: string | null;
  /** Curator-facing category label of the matched term — e.g.
   *  ``cell line``, ``disease``, ``organism part``. Distinct from
   *  ``ontology`` (CLO / MONDO / UBERON). Useful when the agent
   *  surfaces a candidate whose category differs from the
   *  requester's slot (e.g. typed a label into a cell-type slot
   *  but the closest match is a cell line); UI flags the mismatch
   *  visually so the curator can decide. Optional — agent
   *  populates when it can identify the term's actual category. */
  category?: string | null;
}

export interface FindTermResult {
  free_text: string;
  category: string;
  candidates: TermCandidate[];
  note: string | null;
}

export interface FindTermRequest {
  free_text: string;
  category: string;
  experiment_id?: number;
  taxon?: string;
  context?: "subject" | "object";
}

/**
 * Look up ontology URI candidates for a free-text label. Phase 1
 * just hits Gemma's annotation catalog server-side; phase 2 adds
 * direct OBO lookup; phase 3 adds LLM rerank against the
 * experiment context. The UI doesn't need to know which phase is
 * active — it renders whatever ``candidates`` come back.
 *
 * The agents-side endpoint is tracked separately. Until the
 * endpoint ships, callers see an ApiError (404 or connection
 * refused) and should render a fallback hint to the curator.
 */
export function useFindTerm() {
  return useMutation({
    mutationFn: (body: FindTermRequest) =>
      api.post<FindTermResult>("/find-term", body),
  });
}
