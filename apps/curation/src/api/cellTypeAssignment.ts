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
 * 🛑 **An absent assignment is NOT evidence that the authors wrote the
 * labels.** It is the absence of a record, and those are different
 * claims — Gemma has no "submitter-supplied" marker to read. So this
 * reports what the assignment says when there is one and says plainly
 * that there is none when there is not; it must never resolve the
 * second case into an authorship claim, and "no URI, therefore the
 * authors" is exactly the inference to refuse. Asked of gembro
 * 2026-08-31; until it is answered the honest surface is a gap, not a
 * guess.
 *
 * `protocol` is null on every assignment seen so far, so it is carried
 * but not relied on.
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
 *  Grounding is a property of the terms, NOT of who assigned them —
 *  the two are reported separately because conflating them is how "no
 *  URI" turns into "the authors wrote it". */
export function groundedCount(a: CellTypeAssignment): number {
  return (a.cell_types ?? []).filter((c) => !!c.value_uri).length;
}
