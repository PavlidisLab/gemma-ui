/**
 * Helpers for rendering ``calibration_factor_match_*`` findings.
 *
 * Two responsibilities:
 *
 *   1. Classify the three issue codes a builder may emit for a
 *      gold ↔ agent factor pairing:
 *        - ``calibration_factor_match_exact``  (severity ok)
 *        - ``calibration_factor_match_close``  (severity minor)
 *        - ``calibration_factor_match``        (legacy, pre-2026-05-18
 *          builds — treat conservatively as ``_close``)
 *      ``calibration_factor_rename`` is its own code and handled by
 *      the rename-specific path in ``AuditSidebarPanel``; this module
 *      only covers the match codes.
 *
 *   2. Look up the agent ``FactorProposal`` the builder committed to
 *      for a given gold-side match finding. Uses ``agent_target_index``
 *      (calibration package v12+) when present, with a label-based
 *      fallback for older audits that pre-date the field.
 *
 * Sibling code in ``AuditSidebarPanel.tsx`` and ``AuditReportView.tsx``
 * imports from here so the classification stays in one place — adding
 * a new code, or changing the fallback policy, is a one-file edit.
 *
 * Wire contract: agents-repo commit ``f313770``,
 * eval-repo ``docs/HANDOFF_2026-05-18_UI_FACTOR_MATCH_PAIRING.md``.
 */
import type { AuditFinding } from "@/api/auditTypes";
import type {
  FactorProposal,
  FactorValueProposal,
  Proposal,
} from "@/api/types";
import type { Factor, FactorValue } from "@/features/experiment/types";

/** Match-code variant. ``legacy`` is the pre-split
 *  ``calibration_factor_match`` code that older builds still emit.
 *  ``near`` covers both ``_near`` (post-stricter-gate, 2026-05-18)
 *  and ``_close`` (the earlier name) — same render path. */
export type FactorMatchVariant = "exact" | "near" | "legacy";

/** Classify a finding's ``issue_code`` against the factor-match codes.
 *  Returns ``null`` for anything else (including the rename code,
 *  which has its own rendering path). */
export function factorMatchVariant(
  issue_code: string | null | undefined,
): FactorMatchVariant | null {
  if (!issue_code) return null;
  if (issue_code === "calibration_factor_match_exact") return "exact";
  // Two wire spellings for the same concept: brother renamed _close
  // → _near alongside the stricter near-match gate (2026-05-18).
  // Keep both so audit.json files from either era render the same.
  if (
    issue_code === "calibration_factor_match_near" ||
    issue_code === "calibration_factor_match_close"
  )
    return "near";
  if (issue_code === "calibration_factor_match") return "legacy";
  return null;
}

/** Any factor-match issue code (exact / close / legacy). Convenience
 *  predicate used by call sites that need to differentiate
 *  factor-match findings from extras / misses / renames. */
export function isFactorMatchCode(
  issue_code: string | null | undefined,
): boolean {
  return factorMatchVariant(issue_code) !== null;
}

/** Whether the finding should render with the green-check "exact"
 *  affordance (no curator action needed; severity ok). The split
 *  landed 2026-05-18: only ``_exact`` is truly skippable; ``_close``
 *  and the legacy code carry minor severity ("peek to confirm"). */
export function isExactFactorMatch(f: AuditFinding): boolean {
  return f.issue_code === "calibration_factor_match_exact";
}

/** Whether the finding is a "near — peek to confirm" match. Covers
 *  three wire spellings:
 *    - ``calibration_factor_match_near``   (post-2026-05-18 stricter gate)
 *    - ``calibration_factor_match_close``  (earlier name for the same idea)
 *    - ``calibration_factor_match`` at ok severity (legacy pre-split;
 *      conservative default: older builds didn't distinguish exact
 *      from close, so treating the legacy code as near errs on the
 *      side of curator attention)
 *
 *  Excludes the rename case (legacy code with non-ok severity is a
 *  rename, not a near match — see ``isRenameMatch`` in
 *  ``AuditSidebarPanel.tsx``). */
export function isCloseFactorMatch(f: AuditFinding): boolean {
  if (f.issue_code === "calibration_factor_match_near") return true;
  if (f.issue_code === "calibration_factor_match_close") return true;
  if (f.issue_code === "calibration_factor_match" && f.severity === "ok") {
    return true;
  }
  return false;
}

/** Broader "near-match" predicate that drives the two-header-chip card
 *  treatment (Paul 2026-05-21 redesign — GSE93824 genotype reference
 *  case). True when:
 *
 *   - the finding is a ``calibration_factor_match_near`` (or any
 *     ``isCloseFactorMatch`` variant) — the agent's factor-level
 *     proposal matches gold at the partition / category level but
 *     differs on something subtle (gene URI species, missing facet,
 *     URI variant), OR
 *   - the finding carries a ``rename`` payload — a rename / inner-
 *     concept-diff finding always means "factor-level proposal is a
 *     good call, but a lower-level concept differs."
 *
 *  Used by:
 *
 *   - ``AgentSuggestionPanel`` — suppress the single-axis strength
 *     label (``leanSuggestionLabel``) and move the Judge rationale
 *     text out of the factor-card level. The two header chips
 *     (green disc + yellow N badge) carry the same signal more
 *     cleanly; the label collapsed two axes into one and read as
 *     "the whole factor proposal is bad" on findings where it was
 *     actually right.
 *   - ``DisagreementBlock`` — render the Judge rationale INSIDE the
 *     first concept-diff FV block so the WHY binds to the exact FV
 *     being corrected, not to the entire card.
 *
 *  Extra / gold-only-miss / partition-mismatch findings KEEP the
 *  strength label — those are about full-factor decisions where the
 *  "should we adopt this whole proposal" framing is the right one. */
export function isNearMatchFinding(f: AuditFinding): boolean {
  if (isCloseFactorMatch(f)) return true;
  if (f.rename != null) return true;
  return false;
}

/** Resolve the agent ``FactorProposal`` the builder paired with this
 *  gold match finding.
 *
 *  Priority order:
 *
 *   1. ``finding.agent_target_index`` — direct index into
 *      ``comparison_proposal.factors``. Calibration package v12+
 *      (agents-repo ``f313770``). The builder guarantees a one-to-one
 *      agent → gold pairing here so the same agent factor never
 *      surfaces on two cards.
 *
 *   2. Label-based lookup — older audits pre-date
 *      ``agent_target_index``. Falls back to finding the agent factor
 *      whose ``category.label`` matches ``labelFallback`` (typically
 *      pulled from the rename payload, the parsed rationale, or the
 *      first backticked token in the rationale). Multi-factor-same-
 *      category designs can collide here (the bug
 *      ``agent_target_index`` was introduced to fix) but the fallback
 *      keeps behaviour stable for pre-v12 audit.json files.
 *
 *  Returns ``null`` when neither path produces a hit (no comparison
 *  proposal, out-of-range index, or no label match). */
export function resolveAgentFactor(
  finding: Pick<AuditFinding, "agent_target_index">,
  comparisonProposal: Proposal | null | undefined,
  labelFallback: string | null | undefined,
): FactorProposal | null {
  const factors = comparisonProposal?.factors ?? null;
  if (!factors || factors.length === 0) return null;

  const idx = finding.agent_target_index;
  if (typeof idx === "number" && Number.isInteger(idx)) {
    if (idx >= 0 && idx < factors.length) {
      return factors[idx] ?? null;
    }
    // Out-of-range index — the wire is malformed. Don't fall back
    // silently to a different factor; surface as "no embed" so the
    // mismatch is visible rather than displaying the wrong factor.
    return null;
  }

  // Pre-v12 audit: use the caller's label hint.
  const label = (labelFallback || "").toLowerCase().trim();
  if (!label) return null;
  return (
    factors.find(
      (f) => (f.category.label || "").toLowerCase().trim() === label,
    ) ?? null
  );
}

/** Resolve the gold ``Factor`` the builder paired with this finding.
 *
 *  Priority order:
 *
 *    1. ``finding.gold_target_index`` — direct index into
 *       ``design.factors``. Set by the builder on factor match /
 *       rename / gold_only_miss findings (agents-repo ``3868a09``,
 *       2026-05-18). Disambiguates multi-factor-same-category designs
 *       on the gold side, mirroring ``agent_target_index`` on the
 *       agent side.
 *
 *    2. Slug-based lookup — older audits pre-date
 *       ``gold_target_index``. Falls back to finding the gold factor
 *       whose ``category.label`` slug-matches ``labelFallback``.
 *       Caller is responsible for further disambiguation when the
 *       slug-match returns multiple candidates (e.g. via
 *       ``pickGoldFactor`` + biomaterial overlap).
 *
 *  Returns ``null`` when neither path resolves. */
export function resolveGoldFactor(
  finding: Pick<AuditFinding, "gold_target_index">,
  designFactors: Factor[] | undefined,
  labelFallback: string | null | undefined,
): Factor | null {
  if (!designFactors || designFactors.length === 0) return null;

  const idx = finding.gold_target_index;
  if (typeof idx === "number" && Number.isInteger(idx)) {
    if (idx >= 0 && idx < designFactors.length) {
      return designFactors[idx] ?? null;
    }
    // Out-of-range — surface as miss rather than silently re-deriving
    // from a different factor.
    return null;
  }

  // Pre-3868a09 audit: fall back to label-slug lookup. Caller
  // handles multi-candidate disambiguation.
  const label = (labelFallback || "").toLowerCase().trim();
  if (!label) return null;
  return (
    designFactors.find(
      (f) => (f.category.label || "").toLowerCase().trim() === label,
    ) ?? null
  );
}

/** Per-FV pairing between an agent factor and its paired gold
 *  factor. ``status`` mirrors the audit-side FvStatusGlyph:
 *    - ``"exact"``      — labels match (or ``match_type === "exact"``)
 *    - ``"near"``       — paired (via gemma_ref or biomaterial overlap)
 *                          but labels differ
 *    - ``"agent_only"`` — no Gemma counterpart even after biomaterial
 *                          fallback
 *  ``gemmaLabel`` carries the paired Gemma FV's label, empty when
 *  agent-only. */
export type FvPairingStatus = "exact" | "near" | "agent_only";
export interface FvPairing {
  status: FvPairingStatus;
  gemmaLabel: string;
  pairedGoldId: number | null;
}

/** Compute the per-FV correspondence between an agent factor and the
 *  Gemma factor the audit paired it with. Three lookup paths per
 *  agent FV, mirroring ``RenameFactorEmbed``:
 *
 *    1. ``gemma_ref`` on the proposal (proposer's pre-computed
 *       alignment).
 *    2. Biomaterial-overlap against unconsumed gold FVs (partition-
 *       equal pairing — works even when the proposer didn't emit a
 *       gemma_ref).
 *    3. Genuinely unpaired → ``agent_only``.
 *
 *  Returns the per-FV pairings, the gold FVs the agent didn't claim
 *  (``goldOnly``), and a derived ``hasDrift`` flag that is true iff
 *  any FV pair isn't an exact label/URI match. Use ``hasDrift`` to
 *  decide whether a factor-level "exact" classification should be
 *  visually downgraded — a calibration_factor_match_exact whose FVs
 *  don't all line up is still drifted from the curator's POV. */
export function computeFvCorrespondence(
  agentFactor: FactorProposal,
  goldFactor: Factor | undefined,
): { pairings: FvPairing[]; goldOnly: FactorValue[]; hasDrift: boolean } {
  if (!goldFactor) {
    const pairings: FvPairing[] = (agentFactor.factor_values ?? []).map(
      (fv) => {
        const refLabel = fv.gemma_ref?.label?.trim() || "";
        const refUri = fv.gemma_ref?.uri?.trim() || "";
        if (!refLabel && !refUri) {
          return { status: "agent_only", gemmaLabel: "", pairedGoldId: null };
        }
        const isExact =
          fv.match_type === "exact" ||
          (fv.free_text_label || "").toLowerCase().trim() ===
            refLabel.toLowerCase();
        return {
          status: isExact ? "exact" : "near",
          gemmaLabel: refLabel,
          pairedGoldId: null,
        };
      },
    );
    return {
      pairings,
      goldOnly: [],
      hasDrift: pairings.some((p) => p.status !== "exact"),
    };
  }

  const consumed = new Set<number>();
  const pairings: FvPairing[] = (agentFactor.factor_values ?? []).map(
    (fv: FactorValueProposal) => {
      let refLabel = fv.gemma_ref?.label?.trim() || "";
      const refUri = fv.gemma_ref?.uri?.trim() || "";
      let pairedId: number | null = null;
      // Path 1: gemma_ref → resolve to a gold FV id.
      if ((refLabel || refUri)) {
        const byUri = refUri
          ? goldFactor.factor_values.find((gfv) =>
              gfv.statements.some(
                (s) =>
                  s.subject?.uri === refUri || s.object?.uri === refUri,
              ),
            )
          : undefined;
        const byLabel = !byUri && refLabel
          ? goldFactor.factor_values.find(
              (gfv) =>
                (gfv.free_text_label || "").toLowerCase().trim() ===
                refLabel.toLowerCase(),
            )
          : undefined;
        const hit = byUri ?? byLabel;
        if (hit) pairedId = hit.id;
      }
      // Path 2: biomaterial-overlap fallback.
      if (!refLabel && !refUri) {
        const agentBms = new Set(fv.biomaterial_short_names);
        let best = 0;
        let bestGfv: FactorValue | null = null;
        for (const gfv of goldFactor.factor_values) {
          if (consumed.has(gfv.id)) continue;
          let n = 0;
          for (const bm of gfv.biomaterial_short_names) {
            if (agentBms.has(bm)) n++;
          }
          if (n > best) {
            best = n;
            bestGfv = gfv;
          }
        }
        if (bestGfv) {
          refLabel = bestGfv.free_text_label || "";
          pairedId = bestGfv.id;
        }
      }
      if (pairedId != null) consumed.add(pairedId);
      if (!refLabel && !refUri) {
        return { status: "agent_only", gemmaLabel: "", pairedGoldId: null };
      }
      const isExact =
        fv.match_type === "exact" ||
        (fv.free_text_label || "").toLowerCase().trim() ===
          refLabel.toLowerCase();
      return {
        status: isExact ? "exact" : "near",
        gemmaLabel: refLabel,
        pairedGoldId: pairedId,
      };
    },
  );
  const goldOnly = goldFactor.factor_values.filter(
    (gfv) => !consumed.has(gfv.id),
  );
  const hasDrift =
    pairings.some((p) => p.status !== "exact") || goldOnly.length > 0;
  return { pairings, goldOnly, hasDrift };
}

/** Pair an agent factor to a *specific* gold factor when multiple
 *  Gemma factors share the same category slug (multi-factor-same-
 *  category designs, e.g. GSE93824's two ``genotype`` factors).
 *  Picks the gold candidate whose biomaterial assignments overlap
 *  the agent's most. Returns the single candidate when there's no
 *  ambiguity, ``undefined`` when none match. */
export function pickGoldFactor(
  agentFactor: FactorProposal | null,
  goldCandidates: Factor[],
): Factor | undefined {
  if (goldCandidates.length === 0) return undefined;
  if (goldCandidates.length === 1) return goldCandidates[0];
  if (!agentFactor) return goldCandidates[0];
  const agentBms = new Set(
    agentFactor.factor_values.flatMap((fv) => fv.biomaterial_short_names),
  );
  let best = -1;
  let pick: Factor | undefined;
  for (const g of goldCandidates) {
    let overlap = 0;
    for (const gfv of g.factor_values) {
      for (const bm of gfv.biomaterial_short_names) {
        if (agentBms.has(bm)) overlap++;
      }
    }
    if (overlap > best) {
      best = overlap;
      pick = g;
    }
  }
  return pick;
}
