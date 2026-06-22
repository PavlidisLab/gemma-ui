/**
 * Inline factor-detail embeds rendered inside finding cards on the
 * audit sidebar. Each component takes one `AuditFinding`, resolves
 * the relevant agent / gold factor(s) from the loaded
 * `comparison_proposal` and `design`, and renders a side-by-side
 * per-FV view that mirrors the bottom-of-panel DesignComparisonPanel
 * shape — so curators don't have to scroll out of the card to see
 * what the agent is actually proposing.
 *
 * Extracted from `AuditSidebarPanel.tsx` (Paul 2026-06-10 sweep —
 * mega-file >5 000 lines was conflating ~50 components in one file).
 * Components here are self-contained — they read live state via
 * `useAudit()` + `useDesign()` and otherwise depend only on the
 * pure helpers in `./factorMatch`, `./rationaleText`, and the
 * shared `@/lib/ontologyTerm` URI-aware identity helper.
 *
 * Cluster:
 *   - `curationTermRenderer` — shared `FvDisplayRow` term renderer
 *     so the audit + proposal-review surfaces look identical.
 *   - `parseRenameLabels` — pulls the agent + Gemma category labels
 *     out of an arbiter rename rationale.
 *   - `FvStatusGlyph` — tiny ✓/≈/+/− indicator for per-FV
 *     correspondence inside `RenameFactorEmbed`.
 *   - `RenameFactorEmbed` — the canonical agent-factor inline view
 *     for rename / near-match / extra findings.
 *   - `GoldFactorMissEmbed` — the gold-side mirror for
 *     `calibration_factor_gold_only_miss`.
 *   - `FactorRenameFvPairs` — fallback FV-pairs table when no
 *     structured `comparison_proposal` is available.
 *   - `FactorDescriptionSubtitle` — italic ≤80-char subtitle pulled
 *     from `FactorProposal.description` per
 *     UIB_HANDOFF_2026_06_10_FACTOR_DESCRIPTION_SURFACE.md.
 *   - `FactorReplacementHint` — "↪ Proposed adding: …" hint on
 *     legacy gold-only-miss findings without a paired extra.
 */

import { cn } from "@/lib/cn";
import { Term } from "@/components/ui/Term";
import { FvDisplayRow, type FvTermRenderer } from "@gemma/ontology";
import { sameOntologyTerm, capitalizeCategory } from "@/lib/ontologyTerm";
import type {
  AuditFinding,
  AuditReport,
  FvPair,
} from "@/api/auditTypes";
import type {
  FactorProposal,
  FactorValueProposal,
} from "@/api/types";
import { useAudit } from "./AuditContext";
import { useDesign } from "@/api/design";
import { useDesignDraft } from "@/features/design/DesignDraftContext";
import { firstBacktick } from "./rationaleText";
import {
  pickGoldFactor,
  resolveAgentFactor,
  resolveGoldFactor,
} from "./factorMatch";

// ---------------------------------------------------------------------------
// Shared term renderer + rename rationale parser
// ---------------------------------------------------------------------------

/** Curation-side `FvDisplayRow` term renderer — same one the
 *  proposal-review surface uses. Pulling it into a shared const keeps
 *  the audit + proposal-review surfaces visually identical when they
 *  consume the shared row. */
export const curationTermRenderer: FvTermRenderer = ({
  label,
  uri,
  variant,
  provenance,
}) => (
  <Term
    uri={uri}
    asLink={false}
    variant={variant === "predicate" ? "predicate" : "default"}
    className="!whitespace-normal break-words"
    provenance={provenance}
  >
    {label}
  </Term>
);

/** Pulls the agent + Gemma category labels out of the rename
 *  rationale. The arbiter emits a stable prose template:
 *
 *    "Category rename: agent proposes `<agent>` where Gemma has
 *     `<gold>` (matched via …). Which label is right? …"
 *
 *  Returns `null` if the rationale doesn't match — the caller falls
 *  back to the standard finding card so we never render a half-built
 *  diff. */
function parseRenameLabels(
  rationale: string,
): { agent: string; gold: string } | null {
  const m = rationale.match(
    /agent proposes `([^`]+)`\s+where Gemma has `([^`]+)`/i,
  );
  if (!m) return null;
  return { agent: m[1], gold: m[2] };
}

// ---------------------------------------------------------------------------
// FV status glyph — 1ch ✓/≈/+/− cell for per-FV correspondence
// ---------------------------------------------------------------------------

/** Tiny inline status glyph for the per-FV correspondence indicators
 *  rendered next to each agent FV inside `RenameFactorEmbed` (near
 *  matches only). Four states:
 *    - ✓ emerald — labels match (or proposer flagged match_type=exact)
 *    - ≈ amber   — paired by URI / synonym, labels drifted
 *    - + amber   — agent FV with no Gemma counterpart
 *    - − amber   — Gemma FV the agent didn't propose
 *  Width fixed at 1ch so the labels left-align across rows. */
export function FvStatusGlyph({
  status,
}: {
  status: "exact" | "near" | "agent_only" | "gold_only";
}) {
  const cfg = {
    exact: {
      glyph: "✓",
      cls: "text-emerald-600 dark:text-emerald-400",
      title: "labels match",
    },
    near: {
      glyph: "≈",
      cls: "text-amber-600 dark:text-amber-400",
      title: "paired by URI / synonym — labels differ",
    },
    agent_only: {
      glyph: "+",
      cls: "text-amber-600 dark:text-amber-400",
      title: "agent FV with no Gemma counterpart",
    },
    gold_only: {
      glyph: "−",
      cls: "text-amber-600 dark:text-amber-400",
      title: "Gemma FV the agent didn't propose",
    },
  }[status];
  return (
    <span
      className={cn(
        "inline-block w-[1ch] text-center text-xs font-bold leading-none shrink-0",
        cfg.cls,
      )}
      title={cfg.title}
      aria-label={cfg.title}
    >
      {cfg.glyph}
    </span>
  );
}

// ---------------------------------------------------------------------------
// RenameFactorEmbed — agent-side factor view for rename / near / extra
// ---------------------------------------------------------------------------

/** Embedded agent-factor detail for an alternate-factor finding.
 *
 *  Looks up the agent's `FactorProposal` from
 *  `report.evidence.comparison_proposal.factors` by matching the
 *  rename payload's `agent.category.label`, and renders the same
 *  per-FV view the bottom-of-panel DesignComparisonPanel shows for
 *  this factor: each FV's label, sample count, statement glyph, and
 *  the structured statement detail with URIs. This puts the "what is
 *  the agent actually proposing" answer inside the audit card so
 *  curators don't have to scroll to the bottom of the panel to see it.
 *
 *  Falls back to the FV-pair table (label-only) when no
 *  comparison_proposal is available — older audits or experiments
 *  where the agent didn't ship a structured proposal alongside the
 *  rename. */
export function RenameFactorEmbed({ finding }: { finding: AuditFinding }) {
  const { report, experimentId } = useAudit();
  // Prefer the draft (curator's uncommitted edits) so a factor
  // they just deleted / renamed doesn't ghost into the embed via a
  // stale server design. Falls through to ``useDesign`` only when
  // no draft is mounted. Per the 2026-06-13 continuity sweep.
  const { draft } = useDesignDraft();
  const { data: savedDesign } = useDesign(experimentId);
  const serverDesign = draft ?? savedDesign;
  // Three label-source paths (most specific first):
  //   1. Structured `finding.rename` payload (calibration package v11+).
  //   2. Parsed rename rationale ("agent proposes `X` where Gemma has
  //      `Y`") for v10 alternate-factor findings.
  //   3. First backticked token in the rationale — works for plain
  //      confirmed-match rationales ("Is factor `treatment` correctly
  //      captured?") so this same embed renders the agent's FV /
  //      statement detail inside MatchFindingRow expansions, not just
  //      inside alternate-factor cards.
  const rename = finding.rename ?? null;
  const parsed = parseRenameLabels(finding.rationale || "");
  const firstBacktickLabel = firstBacktick(finding.rationale) ?? undefined;
  const agentLabel = (
    rename?.agent.category.label ??
    parsed?.agent ??
    firstBacktickLabel ??
    ""
  )
    .toLowerCase()
    .trim();
  // For confirmed matches the agent and gold share a label, so the
  // "Gemma calls this:" footer is suppressed (its only job is showing
  // the divergent gold label on alternate-factor cards).
  const goldLabelRaw = rename?.gold.category.label ?? parsed?.gold ?? "";
  const goldLabel =
    goldLabelRaw && goldLabelRaw.toLowerCase().trim() !== agentLabel
      ? goldLabelRaw
      : "";

  const cp = report?.evidence?.comparison_proposal ?? null;
  // Prefer the builder's committed agent → gold pairing
  // (`agent_target_index`, calibration package v12+, agents-repo
  // `f313770`) so multi-factor-same-category designs don't end up
  // rendering the same agent factor on two cards. Fall back to the
  // label lookup for older audits that pre-date the field — see
  // `resolveAgentFactor`. Also gives up early when there's neither
  // an index nor a label, which preserves the "render nothing" shape
  // the rest of this function expects.
  const agentFactor =
    finding.agent_target_index != null || agentLabel
      ? resolveAgentFactor(finding, cp, agentLabel)
      : null;
  if (!agentFactor && !agentLabel) return null;

  // No structured factor available — fall back to the bare FV-pair
  // table from the rename payload when present (labels only, no
  // statements). When neither factor proposal nor pair table is
  // available there's nothing structured to render.
  if (!agentFactor) {
    return rename && rename.fv_pairs?.length > 0 ? (
      <FactorRenameFvPairs pairs={rename.fv_pairs} />
    ) : null;
  }

  const fvs = agentFactor.factor_values ?? [];

  // Per-FV correspondence — render whenever we have a factor-kind
  // finding with a resolvable agent factor. Originally gated to match
  // findings only, but with the 2026-05-18 stricter near-match gate
  // (concept-mismatch demotes match → extra + gold_only_miss),
  // curators need the same per-FV ✓ / ≈ / + / − visual on extra and
  // calibration-factor-rename findings too so they can see *what's
  // wrong / right / near* without bouncing tabs.
  //
  // The downstream gold-factor lookup tries biomaterial overlap
  // across every gold factor (not just same-slug candidates) so an
  // agent `extra` for a partition-equal-but-URI-divergent factor
  // still surfaces "↔ Gemma <other-label>" if the biomaterials line
  // up.
  const showCorrespondence = finding.target_kind === "factor";
  // Resolve the paired gold factor. Index-first (post-3868a09 wire);
  // slug + biomaterial-overlap fallback for older audits. With
  // `gold_target_index` shipping, multi-factor-same-category gold
  // lookups (GSE93824's two `genotype` factors) are deterministic
  // from the wire — no UI guessing.
  const goldSlug = (
    rename?.gold.category.label ??
    parsed?.gold ??
    firstBacktickLabel ??
    ""
  )
    .toLowerCase()
    .trim();
  let goldFactor: import("@/features/experiment/types").Factor | undefined;
  const indexed = resolveGoldFactor(finding, serverDesign?.factors, goldSlug);
  if (indexed) {
    goldFactor = indexed;
  } else {
    // Prefer URI identity when the agent factor carries one — labels
    // collide on multi-factor-same-category designs (two `genotype`
    // factors with distinct URIs both match the slug). Fall back to
    // the label slug for older audits where agent_target_index +
    // agentFactor are both absent, or where the agent's category is
    // free-text. `pickGoldFactor` still disambiguates across any
    // remaining candidates by biomaterial overlap.
    const agentCategory = agentFactor?.category ?? null;
    const goldCandidates =
      serverDesign?.factors.filter((f) =>
        agentCategory
          ? sameOntologyTerm(f.category, agentCategory)
          : f.category.label.toLowerCase().trim() === goldSlug,
      ) ?? [];
    goldFactor = pickGoldFactor(agentFactor, goldCandidates);
  }
  // Pair each agent FV to a Gemma FV. Three lookup paths, in order:
  //
  //   1. `gemma_ref` on the proposal (proposer pre-computed at
  //      proposal time — most precise when it fires).
  //   2. Biomaterial-overlap against `goldFactor.factor_values`
  //      (partition-equal pairing; works even when the proposer
  //      didn't ship a gemma_ref, e.g. older proposals or cases the
  //      proposer judged "new" but where Gemma actually has a
  //      same-biomaterial FV under a different label).
  //   3. Genuinely unpaired → "agent_only" (rare on factor matches
  //      with a resolved gold factor; common on alternate-factor).
  //
  // The biomaterial-overlap path is the same principle as the
  // NEAR_MATCH_FV_PAIRING handoff for the builder side: if the
  // partition is the same, the pairing is bijective by biomaterial
  // set. Surfacing "total RNA" ↔ "pre-immunoprecipitation input"
  // here (paired by biomaterials despite the label drift) is the
  // canonical case.
  const pairedGoldIds = new Set<number>();
  type FvPairing = {
    status: "exact" | "near" | "agent_only";
    /** Gemma label of the paired FV, when paired. Empty for agent-only. */
    gemmaLabel: string;
  };
  function fvStatus(fv: FactorValueProposal): FvPairing {
    let refLabel = fv.gemma_ref?.label?.trim() || "";
    const refUri = fv.gemma_ref?.uri?.trim() || "";
    let pairedId: number | null = null;
    // Path 1: gemma_ref. Resolve the gold FV id from refLabel/refUri
    // (so pairedGoldIds catches it for the gold-only sweep).
    if ((refLabel || refUri) && goldFactor) {
      const matchByUri = refUri
        ? goldFactor.factor_values.find((gfv) =>
            gfv.statements.some(
              (s) =>
                s.subject?.uri === refUri || s.object?.uri === refUri,
            ),
          )
        : undefined;
      const matchByLabel = !matchByUri && refLabel
        ? goldFactor.factor_values.find(
            (gfv) =>
              (gfv.free_text_label || "").toLowerCase().trim() ===
              refLabel.toLowerCase(),
          )
        : undefined;
      const hit = matchByUri ?? matchByLabel;
      if (hit) pairedId = hit.id;
    }
    // Path 2: biomaterial-overlap fallback when proposal didn't ship
    // a gemma_ref. Pick the gold FV whose biomaterial set overlaps
    // the agent FV's most. Skip gold FVs already claimed by an
    // earlier agent FV (one-to-one pairing).
    if (!refLabel && !refUri && goldFactor) {
      const agentBms = new Set(fv.biomaterial_short_names);
      let bestOverlap = 0;
      let bestGfv: typeof goldFactor.factor_values[number] | null = null;
      for (const gfv of goldFactor.factor_values) {
        if (pairedGoldIds.has(gfv.id)) continue;
        let n = 0;
        for (const bm of gfv.biomaterial_short_names) {
          if (agentBms.has(bm)) n++;
        }
        if (n > bestOverlap) {
          bestOverlap = n;
          bestGfv = gfv;
        }
      }
      if (bestGfv) {
        refLabel = bestGfv.free_text_label || "";
        pairedId = bestGfv.id;
      }
    }
    if (pairedId != null) pairedGoldIds.add(pairedId);
    if (!refLabel && !refUri) {
      return { status: "agent_only", gemmaLabel: "" };
    }
    if (
      fv.match_type === "exact" ||
      (fv.free_text_label || "").toLowerCase().trim() ===
        refLabel.toLowerCase()
    ) {
      return { status: "exact", gemmaLabel: refLabel };
    }
    return { status: "near", gemmaLabel: refLabel };
  }
  // Pre-compute so we can also derive gold-only after the agent loop
  // has populated pairedGoldIds.
  const fvPairings: FvPairing[] = showCorrespondence
    ? fvs.map(fvStatus)
    : [];
  const goldOnly =
    showCorrespondence && goldFactor
      ? goldFactor.factor_values.filter((gfv) => !pairedGoldIds.has(gfv.id))
      : [];

  // Surface the paired gold factor's distinguishing info in the
  // header. `Factor.name` is the curator-given name, which often
  // disambiguates multi-factor-same-category cases (e.g.
  // `wild-type vs KO` vs `genotype background`) where the
  // category label alone is identical. Falls back to FV-count when
  // `name` is empty or equals the category label.
  const goldDistinguisher = goldFactor
    ? goldFactor.name &&
      goldFactor.name.toLowerCase().trim() !==
        goldFactor.category.label.toLowerCase().trim()
      ? goldFactor.name
      : `${goldFactor.factor_values.length} value${
          goldFactor.factor_values.length === 1 ? "" : "s"
        }`
    : null;

  return (
    <div className="px-2 py-1.5 rounded bg-white/60 dark:bg-slate-900/30 border border-slate-200 dark:border-slate-700 space-y-1">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 flex-wrap">
        <span>Agent factor</span>
        <span className="font-mono text-slate-700 dark:text-slate-200 normal-case tracking-normal">
          {capitalizeCategory(agentFactor.category.label)}
        </span>
        {agentFactor.factor_type ? (
          <span className="text-slate-400 dark:text-slate-500 normal-case tracking-normal">
            · {agentFactor.factor_type}
          </span>
        ) : null}
        {/* Matched-against indicator. Critical for multi-factor-same-
            category cases (two `genotype` factors in gold) — without
            it both finding cards read identically. */}
        {goldFactor ? (
          <span
            className="text-slate-400 dark:text-slate-500 normal-case tracking-normal inline-flex items-baseline gap-1"
            title={`paired with Gemma factor (id=${goldFactor.id})${
              finding.gold_target_index != null
                ? " — agent-emitted gold_target_index"
                : " — UI-side disambiguation via biomaterial overlap"
            }`}
          >
            <span>↔</span>
            <span className="text-slate-500 dark:text-slate-400 uppercase tracking-wide text-[9px]">
              Gemma
            </span>
            <span className="font-mono text-slate-700 dark:text-slate-200">
              {capitalizeCategory(goldFactor.category.label)}
            </span>
            {goldDistinguisher ? (
              <span className="text-slate-400 dark:text-slate-500 italic">
                ({goldDistinguisher})
              </span>
            ) : null}
          </span>
        ) : null}
        <span className="text-slate-400 dark:text-slate-500 ml-auto normal-case tracking-normal">
          {fvs.length} {fvs.length === 1 ? "value" : "values"}
        </span>
      </div>
      <div className="space-y-1 pl-1">
        {fvs.map((fv, i) => {
          const pairing = showCorrespondence ? fvPairings[i] : null;
          const status = pairing?.status ?? null;
          const gemmaLabel = pairing?.gemmaLabel ?? "";
          return (
            <FvDisplayRow
              key={i}
              fv={fv}
              termRenderer={curationTermRenderer}
              indexLabel={i + 1}
              leading={
                status ? <FvStatusGlyph status={status} /> : null
              }
              trailing={
                <>
                  {status === "near" && gemmaLabel ? (
                    <span
                      className="text-[10px] text-amber-700 dark:text-amber-300 italic"
                      title="Gemma's label for the paired FV"
                    >
                      ↔ Gemma:{" "}
                      <span className="font-mono not-italic">
                        {gemmaLabel}
                      </span>
                    </span>
                  ) : null}
                  {status === "agent_only" ? (
                    <span
                      className="text-[10px] text-amber-700 dark:text-amber-300 italic"
                      title="no Gemma counterpart — neither by proposer alignment nor biomaterial overlap"
                    >
                      not in Gemma
                    </span>
                  ) : null}
                </>
              }
            />
          );
        })}
        {/* Gemma-only FVs — the agent didn't propose these. Renders
            below the agent rows as muted italic lines so the curator
            sees what's missing without it competing visually with
            agent content. Only fires on near matches. */}
        {goldOnly.map((gfv, i) => (
          <div
            key={`g${i}`}
            className="text-[11px] flex items-center gap-1 flex-wrap opacity-70"
            title="Gemma FV the agent didn't propose"
          >
            <FvStatusGlyph status="gold_only" />
            <span className="font-mono text-slate-500 dark:text-slate-400 italic truncate">
              {gfv.free_text_label || "(unnamed)"}
            </span>
            <span className="text-[10px] text-slate-400 dark:text-slate-500">
              ({gfv.biomaterial_short_names.length})
            </span>
            <span className="text-[10px] text-slate-400 dark:text-slate-500 italic">
              Gemma only
            </span>
          </div>
        ))}
      </div>
      {/* Gold-side reference: small footer line so the curator has
          the comparison without leaving the card. Label comes from
          either the structured rename payload or the parsed rationale,
          whichever is available. */}
      {goldLabel ? (
        <div className="text-[10px] text-slate-500 dark:text-slate-400 border-t border-slate-200/70 dark:border-slate-700/70 pt-1">
          <span className="font-medium text-slate-600 dark:text-slate-300">
            Gemma calls this:
          </span>{" "}
          <span className="font-mono text-slate-700 dark:text-slate-200">
            {goldLabel}
          </span>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// GoldFactorMissEmbed — gold-side mirror for calibration_factor_gold_only_miss
// ---------------------------------------------------------------------------

/** Gold-side factor embed for `calibration_factor_gold_only_miss`
 *  findings — the agent didn't propose this factor, so the gold side
 *  is primary. Mirrors `RenameFactorEmbed`'s shape so the visual
 *  rhythm stays consistent across (match, extra, miss) cards.
 *
 *  Looks up the gold factor via target_id slug (with biomaterial-
 *  overlap disambiguation for multi-factor-same-category) and tries
 *  to surface a paired agent factor pointer when biomaterial overlap
 *  hints at one — same heuristic the extra side uses, so a demoted
 *  near-match pair's two cards can be visually correlated by curators
 *  scanning the column. */
export function GoldFactorMissEmbed({ finding }: { finding: AuditFinding }) {
  const { report, experimentId } = useAudit();
  // Same draft-preference as RenameFactorEmbed above — see comment
  // there. Per the 2026-06-13 continuity sweep.
  const { draft } = useDesignDraft();
  const { data: savedDesign } = useDesign(experimentId);
  const serverDesign = draft ?? savedDesign;
  const cp = report?.evidence?.comparison_proposal ?? null;

  // Pull the gold factor's label from the rationale's first
  // backticked token (same trick the headline uses).
  const goldSlug = (firstBacktick(finding.rationale) ?? "")
    .toLowerCase()
    .trim();
  // Index-first via `gold_target_index` (post-3868a09 wire); slug +
  // biomaterial-overlap fallback for older audits without the index.
  const indexed = resolveGoldFactor(finding, serverDesign?.factors, goldSlug);
  let goldFactor: typeof serverDesign extends infer T
    ? T extends { factors: infer F }
      ? F extends Array<infer Item>
        ? Item
        : never
      : never
    : never;
  let pairedAgentFactor: FactorProposal | null = null;
  if (indexed) {
    goldFactor = indexed;
    // Even with gold side resolved, we still need to pair an agent
    // factor by biomaterial overlap for the "↔ agent <label>" header
    // hint (the cross-card correlation pointer). No wire field for
    // agent ↔ gold-only-miss pairing today.
    if (cp?.factors?.length) {
      const gBms = new Set(
        indexed.factor_values.flatMap((fv) => fv.biomaterial_short_names),
      );
      let bestOverlap = 0;
      for (const a of cp.factors) {
        const aBms = new Set(
          a.factor_values.flatMap((fv) => fv.biomaterial_short_names),
        );
        let overlap = 0;
        for (const bm of aBms) if (gBms.has(bm)) overlap++;
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          pairedAgentFactor = a;
        }
      }
    }
  } else {
    const goldCandidates =
      serverDesign?.factors.filter(
        (f) => f.category.label.toLowerCase().trim() === goldSlug,
      ) ?? [];
    goldFactor = goldCandidates[0];
    if (goldCandidates.length > 0 && cp?.factors?.length) {
      let bestOverlap = -1;
      for (const g of goldCandidates) {
        const gBms = new Set(
          g.factor_values.flatMap((fv) => fv.biomaterial_short_names),
        );
        for (const a of cp.factors) {
          const aBms = new Set(
            a.factor_values.flatMap((fv) => fv.biomaterial_short_names),
          );
          let overlap = 0;
          for (const bm of aBms) if (gBms.has(bm)) overlap++;
          if (overlap > bestOverlap) {
            bestOverlap = overlap;
            goldFactor = g;
            pairedAgentFactor = bestOverlap > 0 ? a : null;
          }
        }
      }
    }
  }
  if (!goldFactor) return null;

  // Agent FV label lookup for the inline "↔ agent: <label>" hint per
  // gold FV. Built from the paired agent factor's biomaterial sets.
  const agentFvByBiomaterial = new Map<string, string>();
  if (pairedAgentFactor) {
    for (const afv of pairedAgentFactor.factor_values) {
      for (const bm of afv.biomaterial_short_names) {
        agentFvByBiomaterial.set(bm, afv.free_text_label || "");
      }
    }
  }
  function agentLabelForGoldFv(
    gfv: typeof goldFactor.factor_values[number],
  ): string {
    if (!pairedAgentFactor) return "";
    // Pick the most-common agent label across this gold FV's
    // biomaterials. If they all agree, we get a clean pairing.
    const counts = new Map<string, number>();
    for (const bm of gfv.biomaterial_short_names) {
      const lab = agentFvByBiomaterial.get(bm);
      if (!lab) continue;
      counts.set(lab, (counts.get(lab) ?? 0) + 1);
    }
    let best = "";
    let bestN = 0;
    for (const [lab, n] of counts) {
      if (n > bestN) {
        best = lab;
        bestN = n;
      }
    }
    return best;
  }

  return (
    <div className="px-2 py-1.5 rounded bg-white/60 dark:bg-slate-900/30 border border-slate-200 dark:border-slate-700 space-y-1">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 flex-wrap">
        <span>Gemma factor</span>
        <span className="font-mono text-slate-700 dark:text-slate-200 normal-case tracking-normal">
          {goldFactor.category.label}
        </span>
        {goldFactor.name &&
        goldFactor.name.toLowerCase().trim() !==
          goldFactor.category.label.toLowerCase().trim() ? (
          <span className="text-slate-400 dark:text-slate-500 italic normal-case tracking-normal">
            ({goldFactor.name})
          </span>
        ) : null}
        {pairedAgentFactor ? (
          <span
            className="text-slate-400 dark:text-slate-500 normal-case tracking-normal inline-flex items-baseline gap-1"
            title="biomaterial overlap suggests the agent proposed this same partition under a different category"
          >
            <span>↔</span>
            <span className="text-slate-500 dark:text-slate-400 uppercase tracking-wide text-[9px]">
              agent
            </span>
            <span className="font-mono text-slate-700 dark:text-slate-200">
              {capitalizeCategory(pairedAgentFactor.category.label)}
            </span>
          </span>
        ) : null}
        <span className="text-slate-400 dark:text-slate-500 ml-auto normal-case tracking-normal">
          {goldFactor.factor_values.length}{" "}
          {goldFactor.factor_values.length === 1 ? "value" : "values"}
        </span>
      </div>
      <div className="space-y-1 pl-1">
        {goldFactor.factor_values.map((gfv) => {
          const agentLab = agentLabelForGoldFv(gfv);
          const sameLabel =
            agentLab &&
            agentLab.toLowerCase().trim() ===
              (gfv.free_text_label || "").toLowerCase().trim();
          const status: "exact" | "near" | "gold_only" = !agentLab
            ? "gold_only"
            : sameLabel
              ? "exact"
              : "near";
          return (
            <div
              key={gfv.id}
              className="text-[11px] flex items-center gap-1 flex-wrap"
            >
              <FvStatusGlyph status={status} />
              <span className="font-mono text-slate-900 dark:text-slate-100 truncate">
                {gfv.free_text_label || "(unnamed)"}
              </span>
              <span className="text-[10px] text-slate-400 dark:text-slate-500">
                ({gfv.biomaterial_short_names.length})
              </span>
              {status === "near" ? (
                <span
                  className="text-[10px] text-amber-700 dark:text-amber-300 italic"
                  title="agent put these biomaterials under a different label"
                >
                  ↔ agent:{" "}
                  <span className="font-mono not-italic">{agentLab}</span>
                </span>
              ) : null}
              {status === "gold_only" ? (
                <span
                  className="text-[10px] text-amber-700 dark:text-amber-300 italic"
                  title="agent didn't claim this partition under any factor"
                >
                  not in agent proposal
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FactorRenameFvPairs — fallback FV-pair table (no comparison_proposal)
// ---------------------------------------------------------------------------

/** Compact FV-pairs table for an alternate-factor finding without a
 *  structured comparison_proposal. Fallback view; the richer
 *  `RenameFactorEmbed` is preferred when the agent's factor proposal
 *  is available. Renders one row per (agent FV, gold FV) pair from
 *  the arbiter's `FactorRenamePayload`. */
export function FactorRenameFvPairs({ pairs }: { pairs: FvPair[] }) {
  if (!pairs || pairs.length === 0) return null;
  return (
    <div className="px-1 py-1.5 rounded bg-white/60 dark:bg-slate-900/30 border border-slate-200 dark:border-slate-700 space-y-0.5">
      <div className="grid grid-cols-[1fr_auto_1fr] gap-x-2 text-[9px] uppercase tracking-wide text-slate-500 dark:text-slate-400 px-1">
        <span>agent FVs</span>
        <span>&nbsp;</span>
        <span>Gemma FVs</span>
      </div>
      {pairs.map((p, i) => {
        const marker =
          p.equivalence === "exact"
            ? { ch: "=", title: "exact: same URI or identical label" }
            : p.equivalence === "synonym"
              ? {
                  ch: "~",
                  title: "synonym: different label, arbiter judged equivalent",
                }
              : {
                  ch: "?",
                  title:
                    "judgment: same partition position only (no semantic match)",
                };
        return (
          <div
            key={i}
            className="grid grid-cols-[1fr_auto_1fr] gap-x-2 items-center text-[11px] px-1"
          >
            <span
              className="font-mono text-slate-900 dark:text-slate-100 truncate"
              title={p.agent.label || p.agent.uri || ""}
            >
              {p.agent.label || <em className="text-slate-400">(none)</em>}
            </span>
            <span
              className="text-slate-400 dark:text-slate-500 text-center select-none"
              title={marker.title}
              aria-label={p.equivalence}
            >
              {marker.ch}
            </span>
            <span
              className="font-mono text-slate-900 dark:text-slate-100 truncate"
              title={p.gold.label || p.gold.uri || ""}
            >
              {p.gold.label || <em className="text-slate-400">(none)</em>}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FactorDescriptionSubtitle + FactorReplacementHint — header annotations
// ---------------------------------------------------------------------------

/** Subtitle line under the outer finding-card header — surfaces the
 *  LLM-emitted ≤80-char `description` from the matching
 *  `FactorProposal` in `report.evidence.comparison_proposal.factors`.
 *  Lookup: `agent_target_index` first (authoritative for findings the
 *  comparison-proposal owns), then `name_in_design` match against the
 *  finding's backticked rationale token. Renders nothing when the
 *  description is empty or absent. Per
 *  UIB_HANDOFF_2026_06_10_FACTOR_DESCRIPTION_SURFACE.md. */
export function FactorDescriptionSubtitle({
  finding,
  report,
}: {
  finding: AuditFinding;
  report: AuditReport | null;
}) {
  if (finding.target_kind !== "factor") return null;
  const cp = report?.evidence?.comparison_proposal;
  const factors = cp?.factors ?? [];
  let description: string | undefined;
  if (
    finding.agent_target_index != null &&
    finding.agent_target_index >= 0 &&
    factors[finding.agent_target_index]
  ) {
    description = factors[finding.agent_target_index]?.description;
  }
  if (!description) {
    const tok = firstBacktick(finding.rationale)?.toLowerCase();
    if (tok) {
      const byName = factors.find(
        (f) => f.name_in_design?.toLowerCase() === tok,
      );
      description = byName?.description;
    }
  }
  if (!description || !description.trim()) return null;
  return (
    <span className="block text-[11px] italic text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
      {description.trim()}
    </span>
  );
}

/** When a `calibration_factor_gold_only_miss` surfaces ("remove
 *  Gemma's factor X"), the curator's real decision is "remove X *and*
 *  take the agent's replacement Y." Today the agent's replacement
 *  lives in the DesignComparisonPanel at the bottom of the sidebar,
 *  far from the finding card. Until the agent emits paired
 *  `calibration_factor_extra` findings (filed in
 *  FACTOR_CALIBRATION_FINDINGS_HANDOFF.md), surface the agent-side
 *  proposal inline as a one-line companion line so the pair reads
 *  together. Removes itself once paired findings ship — those will
 *  sort adjacently in the finding list and this helper renders
 *  nothing when no non-exact proposed factors exist. */
export function FactorReplacementHint({
  finding,
  report,
}: {
  finding: AuditFinding;
  report: AuditReport | null;
}) {
  if (finding.issue_code !== "calibration_factor_gold_only_miss") return null;
  // When my brother's `calibration_factor_extra` findings are in the
  // report, those *are* the canonical "agent proposes adding X" view —
  // the paired finding sits directly adjacent in the list. Adding a
  // hint here just duplicates it. Suppress.
  //
  // Known limitation: this is a report-wide check, not per-pair. An
  // audit with multiple gold_only_miss findings for unrelated factors
  // where only one has a paired _extra would still suppress the hint
  // on every miss in the report. In practice calibration audits are
  // narrowly scoped (one factor change per audit), so this isn't
  // hitting today. Revisit if multi-factor calibration audits become
  // a regular thing.
  const hasExtra = (report?.findings ?? []).some(
    (f) => f.issue_code === "calibration_factor_extra",
  );
  if (hasExtra) return null;
  const proposed = (report?.evidence?.comparison_proposal?.factors ?? []).filter(
    (f) => f.match_type !== "exact",
  );
  if (proposed.length === 0) return null;
  return (
    <span className="block mt-0.5 text-[11px] text-blue-700 dark:text-blue-400">
      ↪ Proposed adding:{" "}
      {proposed.map((f, i) => (
        <span key={i}>
          {i > 0 ? ", " : ""}
          <span className="font-mono">{capitalizeCategory(f.category.label)}</span>
          {f.factor_values?.length
            ? ` (${f.factor_values.length} value${f.factor_values.length === 1 ? "" : "s"})`
            : ""}
        </span>
      ))}
    </span>
  );
}
