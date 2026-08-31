import { useQuery } from "@tanstack/react-query";

import { api, ApiError } from "./client";

/**
 * Who assigned this dataset's cell types —
 * `GET /rest/v2/datasets/{id}/cellTypeAssignment`.
 *
 * A curator looking at eleven cell-type labels needs to know whether
 * they are the submitter's own cluster names or something Gemma
 * computed, because those carry different authority and different
 * curation work. Nothing in the UI said, and the labels look identical
 * either way.
 *
 * 🛑 **The `name` field is the answer, and it is the ONLY positive
 * signal there is.** Measured on gemma2 `0293d82c47`:
 *
 *     44580  name "sc-pipeline-2.0.0-family", preferred, 94,525 cells
 *            8 cell types, all grounded — `astrocyte` -> CL_0000127
 *
 *     38651  404 "No preferred cell type assignment found for
 *            GSE199762 and 10x MEX"
 *            …while 176 subsets carry 11 free-text labels
 *            (`Astrocytes`, `OPCs`, `Dividing Cells`), every
 *            `valueUri` null
 *
 * 🛑 **An absent assignment is still NOT evidence that the authors
 * wrote the labels.** It is the absence of a record, and those are
 * different claims. 51 single-cell experiments are in exactly that
 * state — subsets carrying cell-type characteristics with zero
 * assignment behind them (gembro, from the database, 2026-08-31) — and
 * nobody has established whether the assignment was deleted or never
 * made. "No URI, therefore the authors" is the inference to keep
 * refusing.
 *
 * 🛑 **`protocol` is on the wire and always null — read `name`.** The
 * data is in `ANALYSIS.PROTOCOL_FK`; `AnalysisValueObject` populates
 * the field only for an initialized proxy, and the route builds the VO
 * outside the service transaction, so a LAZY `@ManyToOne` is silently
 * dropped. gembro has flagged it and not fixed it. When it lands,
 * `assignmentOrigin` should read `protocol` and this name-matching
 * should go — the protocol is a controlled vocabulary and the name is a
 * display string nobody promised to keep. The two do not even agree in
 * form (`author-submitted` vs `Author-submitted annotations`), so never
 * match one against the other.
 *
 * Gemma-only in both modes (the store serves no such route), like
 * `subsets.ts` and `sourceMetadata.ts`.
 */

/** One cell type in the assignment, post-`snakeify`. */
export interface AssignedCellType {
  id?: number | null;
  category?: string | null;
  category_uri?: string | null;
  value?: string | null;
  value_uri?: string | null;
}

/** `CellTypeAssignmentValueObject`, post-`snakeify`. */
export interface CellTypeAssignment {
  id?: number | null;
  /** What made the assignment — `sc-pipeline-2.0.0-family` for ours.
   *  The whole point of this fetch. */
  name?: string | null;
  protocol?: unknown;
  cell_types?: AssignedCellType[] | null;
  number_of_assigned_cells?: number | null;
  preferred?: boolean | null;
}

export type CellTypeAssignmentResult =
  | { state: "assignment"; assignment: CellTypeAssignment }
  /** 404 — Gemma records no assignment. Carries the server's own
   *  sentence, which distinguishes "single-cell but nothing assigned"
   *  from "not a single-cell dataset" more reliably than we could
   *  restate it. Rendered verbatim rather than reworded into a claim. */
  | { state: "none"; reason: string };

export function useCellTypeAssignment(
  experimentId: number | string | null | undefined,
) {
  return useQuery<CellTypeAssignmentResult>({
    queryKey: ["cell-type-assignment", String(experimentId ?? "")],
    enabled: experimentId != null && experimentId !== "",
    queryFn: async () => {
      try {
        const a = await api.get<CellTypeAssignment | null>(
          `/rest/v2/datasets/${experimentId}/cellTypeAssignment`,
        );
        return a
          ? { state: "assignment", assignment: a }
          : { state: "none", reason: "" };
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) {
          return { state: "none", reason: e.detail || "" };
        }
        throw e;
      }
    },
    staleTime: 30 * 60_000,
    retry: false,
  });
}

/** How many of the assignment's cell types carry an ontology term.
 *
 *  🛑 **Grounding is a property of the terms, not of who assigned
 *  them**, and the numbers say how wrong conflating them would be.
 *  Provenance is the dominant factor — `author-submitted` subset cell
 *  types are 33% grounded against 86-97% for every pipeline version —
 *  but it is nowhere near the whole story: of 8,606 free-text rows,
 *  4,501 are author-submitted and **3,396 sit on assignments our own
 *  pipeline produced** (gembro, 2026-08-31). So "no URI, therefore the
 *  authors" would be wrong about two rows in five. Reported as two
 *  separate axes for that reason, not out of caution. */
export function groundedCount(a: CellTypeAssignment): number {
  return (a.cell_types ?? []).filter((c) => !!c.value_uri).length;
}

/** Who made the assignment, in the terms a curator asked in — "our
 *  pipeline, or the authors of the study?" (Paul, 2026-08-31).
 *
 *  🛑 **This matches on a DISPLAY NAME and that is a stopgap.** The real
 *  field is the assignment's protocol, a controlled vocabulary of 949
 *  rows on prod — `sc-pipeline-2.0.0` (565), `author-submitted` (223),
 *  `sc-pipeline-1.1.2` (75), `sc-pipeline-2.0.0dev` (42),
 *  `sc-pipeline-1.2.0` (22), `sc-pipeline-1.1.1` (12), none (10) — but
 *  it never reaches the wire (see above). Names measured:
 *
 *      44580  "sc-pipeline-2.0.0-family"     -> pipeline
 *      66278  "Author-submitted annotations"  -> authors
 *
 *  Anything it cannot place returns `unknown` and the caller shows the
 *  raw name. Guessing wrong about provenance is worse than declining
 *  to guess, so the fallback is deliberately not "probably ours". */
export type AssignmentOrigin = "authors" | "pipeline" | "unknown";

export function assignmentOrigin(name: string | null | undefined): AssignmentOrigin {
  const n = (name ?? "").trim().toLowerCase();
  if (!n) return "unknown";
  if (n.includes("author")) return "authors";
  if (n.includes("sc-pipeline") || n.includes("pipeline")) return "pipeline";
  return "unknown";
}
