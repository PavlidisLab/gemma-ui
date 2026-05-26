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
import { useDatasetSvd, bioAssayScoresFromSvd } from "@/api/diagnostics";
import { useDesignDraft } from "@/features/design/DesignDraftContext";
import type { Design } from "@/features/experiment/types";

const N_PCS = 3;

export function PcFactorCard({
  experimentId,
}: {
  experimentId: number | string;
}) {
  const { data: svd, isLoading, error } = useDatasetSvd(experimentId);
  const { draft } = useDesignDraft();

  const rows = useMemo(() => {
    const scores = bioAssayScoresFromSvd(svd);
    if (!scores || !draft) return null;
    const { samples, factors } = normaliseCurationDraft(scores, draft);
    return computePcFactorAssociations(samples, factors, N_PCS);
  }, [svd, draft]);

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
        <span>top {N_PCS} PCs · η² for categorical, |r| for continuous</span>
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
      const baId =
        (ba as { id?: number | string }).id ??
        (ba as { bio_assay_id?: number | string }).bio_assay_id;
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
      const levels: ContinuousLevel[] = factor.factor_values.map((fv) => {
        const raw =
          fv.free_text_label || fv.statements?.[0]?.subject?.label || "";
        return {
          x: Number(raw),
          sampleKeys: fv.biomaterial_short_names,
        };
      });
      return { label, type: "continuous", levels };
    }
    const levels: CategoricalLevel[] = factor.factor_values.map((fv) => ({
      sampleKeys: fv.biomaterial_short_names,
    }));
    return { label, type: "categorical", levels };
  });

  return { samples, factors };
}
