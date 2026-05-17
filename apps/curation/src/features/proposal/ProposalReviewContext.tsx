import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Proposal } from "@/api/types";

/**
 * Shared state for "reviewing a proposal" — the curator wants to
 * verify and edit a pending proposal's per-sample assignments from
 * the Samples tab rather than from the sidebar card.
 *
 * Lifecycle:
 *
 *   1. Curator clicks "review on Samples tab" on a v2 ProposalCard.
 *      The card calls ``setActiveProposal(proposal)`` and navigates
 *      to the Samples tab.
 *   2. The Samples tab reads ``activeProposal`` and switches to
 *      proposal-overlay mode: factor columns reflect the proposal's
 *      factor structure rather than the saved design's; cells are
 *      clickable to reassign.
 *   3. Each click flows through ``setReassignment``; the v2 card
 *      reads the same reassignments from context when the curator
 *      eventually accepts.
 *   4. Accept on the card applies the (possibly reassigned)
 *      proposal to the design draft and clears the review state.
 *      Reject / clear also clears.
 *
 * Why not local state on the card? Two surfaces need it (card's
 * accept flow + sample table's editing UI), and they live in
 * different parts of the React tree (sidebar vs. main pane).
 *
 * Reassignment key format: ``${biomaterial_short_name}@${factorIdx}``
 * where ``factorIdx`` is the index into ``proposal.factors``. Value
 * is the FV index within ``proposal.factors[factorIdx].factor_values``.
 * Same shape ProposalCardV2 used for its earlier local state.
 */

export interface ProposalReviewValue {
  /** The proposal currently being reviewed, or null when no review
   *  is active. Multiple pending proposals can exist for one
   *  experiment; only one is "active" at a time. */
  activeProposal: Proposal | null;
  setActiveProposal: (p: Proposal | null) => void;

  /** Per-sample reassignments. Curator-driven overrides of the
   *  agent's per-sample FV picks. Keyed by
   *  ``${shortName}@${factorIdx}``. */
  reassignments: Map<string, number>;
  setReassignment: (
    shortName: string,
    factorIdx: number,
    fvIdx: number,
  ) => void;
  /** Look up an active reassignment for a given (sample, factor). */
  getReassignment: (
    shortName: string,
    factorIdx: number,
  ) => number | undefined;
  /** All reassignments for one factor index, parsed back into
   *  ``{shortName, fvIdx}``. Avoids ``key.endsWith('@${fi}')``
   *  which over-matches at ≥10 factors (``@1`` matches ``@10``). */
  listReassignmentsForFactor: (
    factorIdx: number,
  ) => Array<{ shortName: string; fvIdx: number }>;
  /** Clear all reassignments for the current review. Called on
   *  accept / reject / setActiveProposal(null). */
  clearReassignments: () => void;
}

const ProposalReviewContext = createContext<ProposalReviewValue | null>(null);

export function ProposalReviewProvider({ children }: { children: ReactNode }) {
  const [activeProposal, setActiveProposalState] = useState<Proposal | null>(
    null,
  );
  const [reassignments, setReassignments] = useState<Map<string, number>>(
    new Map(),
  );

  // Setting / clearing the active proposal also clears any leftover
  // reassignments — they belong to the previous review.
  const setActiveProposal = useCallback((p: Proposal | null) => {
    setActiveProposalState(p);
    setReassignments(new Map());
  }, []);

  const setReassignment = useCallback(
    (shortName: string, factorIdx: number, fvIdx: number) => {
      const key = `${shortName}@${factorIdx}`;
      setReassignments((prev) => {
        const next = new Map(prev);
        next.set(key, fvIdx);
        return next;
      });
    },
    [],
  );

  const getReassignment = useCallback(
    (shortName: string, factorIdx: number): number | undefined => {
      return reassignments.get(`${shortName}@${factorIdx}`);
    },
    [reassignments],
  );

  const listReassignmentsForFactor = useCallback(
    (factorIdx: number) => {
      const out: Array<{ shortName: string; fvIdx: number }> = [];
      const target = String(factorIdx);
      for (const [key, fvIdx] of reassignments.entries()) {
        // Keys look like "GSM12345@2" — split on the LAST ``@`` so
        // sample names containing ``@`` (rare but possible) don't
        // throw off the parse. Exact factorIdx match — never
        // ``endsWith``, which would match ``@1`` against ``@10``.
        const lastAt = key.lastIndexOf("@");
        if (lastAt < 0) continue;
        if (key.slice(lastAt + 1) !== target) continue;
        out.push({ shortName: key.slice(0, lastAt), fvIdx });
      }
      return out;
    },
    [reassignments],
  );

  const clearReassignments = useCallback(() => {
    setReassignments(new Map());
  }, []);

  const value = useMemo<ProposalReviewValue>(
    () => ({
      activeProposal,
      setActiveProposal,
      reassignments,
      setReassignment,
      getReassignment,
      listReassignmentsForFactor,
      clearReassignments,
    }),
    [
      activeProposal,
      setActiveProposal,
      reassignments,
      setReassignment,
      getReassignment,
      listReassignmentsForFactor,
      clearReassignments,
    ],
  );

  return (
    <ProposalReviewContext.Provider value={value}>
      {children}
    </ProposalReviewContext.Provider>
  );
}

export function useProposalReview(): ProposalReviewValue {
  const ctx = useContext(ProposalReviewContext);
  if (!ctx) {
    // Hard error rather than a no-op fallback. Both current
    // consumers (ProposalCardV2 + SampleDetailsPanel) render only
    // inside the Shell, which is wrapped by ProposalReviewProvider
    // in App.tsx. A missing provider used to silently return no-ops
    // — the v2 card's "review on Samples tab" button just did
    // nothing, no stack trace. Throw so the next consumer who
    // forgets the wrap gets a useful failure.
    throw new Error(
      "useProposalReview called outside <ProposalReviewProvider>. " +
        "Wrap the consumer in the provider (App.tsx Shell does this " +
        "for the experiment view).",
    );
  }
  return ctx;
}
