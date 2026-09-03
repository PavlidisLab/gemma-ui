/**
 * PC × factor association — curator-side wrapper. Math + bars live in
 * @gemma/diagnostics; this wrapper joins the SVD result against the
 * curator's in-memory design draft (biomaterial short_name keyed) and
 * passes the neutral inputs into the shared computePcFactorAssociations.
 *
 * The choice of short_name as the sample key is curation-specific —
 * the draft tracks biomaterials by short_name across edits — and is
 * why the wrapper, not the shared helper, owns the join. The browser
 * wrapper uses bioMaterialId for the same reason.
 */

import { useMemo } from "react";
import {
  PanelCard,
  PanelEmpty,
  PanelLoading,
  PanelError,
  PcFactorBars,
  computePcFactorAssociations,
  type AssocFactor,
  type CategoricalLevel,
  type ContinuousLevel,
} from "@gemma/diagnostics";
import { useDatasetSvd, bioAssayScoresFromSvd, useScanDates } from "@/api/diagnostics";
import { useDesignDraft } from "@/features/design/DesignDraftContext";
import { continuousFvValue } from "./heatmapPayload";
import type { Design } from "@/features/experiment/types";

const N_PCS = 3;

export function PcFactorCard({
  experimentId,
}: {
  experimentId: number | string;
}) {
  const { data: svd, isLoading, error } = useDatasetSvd(experimentId);
  const { draft } = useDesignDraft();
  const { data: scanDates } = useScanDates(experimentId);

  const rows = useMemo(() => {
    const scores = bioAssayScoresFromSvd(svd);
    if (!scores || !draft) return null;
    const { samples, factors } = normaliseCurationDraft(scores, draft);
    const dateRun = scanDateFactor(draft, scanDates);
    return computePcFactorAssociations(
      samples,
      dateRun ? [...factors, dateRun] : factors,
      N_PCS,
    );
  }, [svd, draft, scanDates]);

  let body;
  if (isLoading) {
    body = <PanelLoading />;
  } else if (error) {
    body = <PanelError message={(error as Error).message} />;
  } else if (!svd?.vmatrix || !svd?.bio_assay_ids) {
    body = (
      <PanelEmpty reason="No PCA available — PC↔factor associations need /svd to return bioAssayScores. Check the scree panel for the root cause." />
    );
  } else if (!draft || draft.factors.length === 0) {
    body = (
      <PanelEmpty reason="No factors defined yet. Accept the agent's proposal or add factors on the Design tab." />
    );
  } else if (!rows || rows.length === 0) {
    body = (
      <PanelEmpty reason="No factor assignments overlap with bio-assays in the SVD." />
    );
  } else {
    body = <PcFactorBars rows={rows} nPcs={N_PCS} />;
  }

  return (
    <PanelCard
      title="PC × factor"
      footer={
        <span>top {N_PCS} PCs · rank correlation, as Gemma computes it</span>
      }
    >
      {body}
    </PanelCard>
  );
}

/** Adapt the curator's in-memory design draft into the neutral input
 *  shape `computePcFactorAssociations` accepts. Sample-keys are
 *  biomaterial short_names — the draft's stable identifier across
 *  edits. The bio_assay_id → short_name resolution walks
 *  design.biomaterials[].bio_assays[]. */
function normaliseCurationDraft(
  bioAssayScores: Record<string, number[]>,
  design: Design,
): { samples: Map<string, number[]>; factors: AssocFactor[] } {
  // short_name → PC scores (averaged across multiple bioAssays
  // sharing a biomaterial, as in multi-array studies).
  const samples = new Map<string, number[]>();
  for (const bm of design.biomaterials) {
    for (const ba of bm.bio_assays ?? []) {
      // No cast: `bio_assay_id` is on the BioAssay type now. It used to
      // be read through one, which is part of why nobody noticed the
      // field was never populated in remote mode — a cast makes an
      // absent field look like a present one the compiler cannot see.
      const baId = ba.bio_assay_id;
      if (baId == null) continue;
      const scores = bioAssayScores[String(baId)];
      if (scores) {
        samples.set(bm.short_name, scores);
        break;
      }
    }
  }

  const factors: AssocFactor[] = design.factors.map((factor) => {
    const label = factor.name || factor.category.label || "(factor)";
    if (factor.type === "continuous") {
      const levels: ContinuousLevel[] = factor.factor_values.map((fv) => ({
        // Shared with the heatmap's strips — see `continuousFvValue`.
        // NaN for an unfilled value, which `computePcFactorAssociations`
        // drops, so an empty continuous factor contributes nothing
        // rather than a column of zeros.
        x: continuousFvValue(fv) ?? NaN,
        sampleKeys: fv.biomaterial_short_names,
      }));
      return { label, type: "continuous", levels };
    }
    // Gemma codes a level by its factor-value id; a draft value does
    // not reliably carry one, so its position in the factor stands in.
    // Both are arbitrary orderings of an unordered factor, and the
    // Kruskal–Wallis branch inside the statistic is what catches the
    // case where the ordering carries no signal.
    const levels: CategoricalLevel[] = factor.factor_values.map((fv, i) => ({
      sampleKeys: fv.biomaterial_short_names,
      code: i,
    }));
    return { label, type: "categorical", levels };
  });

  return { samples, factors };
}

/**
 * "Date run" as a continuous factor: one level per sample, its `x` the
 * scan timestamp. Gemma 1.0 carried this row and it is often the
 * strongest thing on the chart — on GSE143419 it reads 0.72 against
 * PC3 — because a component that tracks the order samples went through
 * the scanner is a processing artefact, not biology.
 *
 * Returns null when no assay reports a date, so the row is absent
 * rather than flat.
 */
function scanDateFactor(
  design: Design,
  scanDates: Map<number, number> | undefined,
): AssocFactor | null {
  if (!scanDates || scanDates.size === 0) return null;
  const levels: ContinuousLevel[] = [];
  for (const bm of design.biomaterials) {
    for (const ba of bm.bio_assays ?? []) {
      const t = ba.bio_assay_id == null ? undefined : scanDates.get(ba.bio_assay_id);
      if (t == null) continue;
      levels.push({ x: t, sampleKeys: [bm.short_name] });
      break;
    }
  }
  if (levels.length < 2) return null;
  return { label: "Date run", type: "continuous", levels };
}
