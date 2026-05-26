/**
 * PC × factor association — browser-side wrapper. The math + bars
 * live in @gemma/diagnostics; this wrapper does the data fetch +
 * the join between the SVD result, /design, and /samples needed to
 * surface the neutral inputs the shared `computePcFactorAssociations`
 * helper consumes.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
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
import {
  getDatasetSvd,
  getDatasetDesign,
  getDatasetSamples,
} from "@/api/endpoints";
import { bioAssayScoresFromSvd, type BioAssay, type ExperimentalDesign } from "@/lib/types";

const N_PCS = 3;

export function PcFactorCard({ datasetId }: { datasetId: number }) {
  const svdQ = useQuery({
    queryKey: ["datasetSvd", datasetId],
    queryFn: ({ signal }) => getDatasetSvd(datasetId, signal),
    staleTime: 10 * 60_000,
  });
  const designQ = useQuery({
    queryKey: ["datasetDesign", datasetId],
    queryFn: ({ signal }) => getDatasetDesign(datasetId, signal),
    staleTime: 10 * 60_000,
  });
  const samplesQ = useQuery({
    queryKey: ["datasetSamples", datasetId],
    queryFn: ({ signal }) => getDatasetSamples(datasetId, signal),
    staleTime: 10 * 60_000,
  });

  const rows = useMemo(() => {
    const scores = bioAssayScoresFromSvd(svdQ.data ?? null);
    if (!scores || !designQ.data || !samplesQ.data) return null;
    const { samples, factors } = normaliseBrowserDesign(
      scores,
      designQ.data,
      samplesQ.data,
    );
    return computePcFactorAssociations(samples, factors, N_PCS);
  }, [svdQ.data, designQ.data, samplesQ.data]);

  const loading = svdQ.isLoading || designQ.isLoading || samplesQ.isLoading;
  const error = svdQ.error ?? designQ.error ?? samplesQ.error;

  let body;
  if (loading) {
    body = <PanelLoading />;
  } else if (error) {
    body = <PanelError message={(error as Error).message} />;
  } else if (!svdQ.data?.vmatrix || !svdQ.data?.bioAssayIds) {
    body = (
      <PanelEmpty reason="No PCA available — PC↔factor associations need /svd to return bioAssayIds + vmatrix. See the scree panel for the root cause." />
    );
  } else if (
    !designQ.data ||
    designQ.data.experimentalFactors.length === 0
  ) {
    body = <PanelEmpty reason="No experimental factors defined for this dataset." />;
  } else if (!rows || rows.length === 0) {
    body = (
      <PanelEmpty reason="No factor assignments overlap with the bio-assays in the SVD." />
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

/** Adapt the browser app's REST shapes (camelCase, /samples + /design)
 *  into the neutral input shape `computePcFactorAssociations` accepts.
 *  Sample-keys are biomaterial ids (averaged when multiple bioAssays
 *  share a biomaterial, as in multi-array studies). */
function normaliseBrowserDesign(
  bioAssayScores: Record<string, number[]>,
  design: ExperimentalDesign,
  samples: BioAssay[],
): { samples: Map<string, number[]>; factors: AssocFactor[] } {
  // bioMaterialId → averaged PC scores across this biomaterial's
  // bioAssays.
  const bmToScores = new Map<string, number[]>();
  const bmCounts = new Map<string, number>();
  for (const ba of samples) {
    const bmId = ba.sample?.id;
    if (bmId == null) continue;
    const sc = bioAssayScores[String(ba.id)];
    if (!sc) continue;
    const key = String(bmId);
    const cur = bmToScores.get(key);
    if (!cur) {
      bmToScores.set(key, sc.slice());
      bmCounts.set(key, 1);
    } else {
      for (let i = 0; i < cur.length; i++) cur[i] += sc[i] ?? 0;
      bmCounts.set(key, (bmCounts.get(key) ?? 0) + 1);
    }
  }
  for (const [k, sc] of bmToScores) {
    const n = bmCounts.get(k) ?? 1;
    if (n > 1) for (let i = 0; i < sc.length; i++) sc[i] /= n;
  }

  // factorValueId → list of biomaterial id strings carrying that level.
  const fvToBms = new Map<number, string[]>();
  for (const a of design.bioMaterialAssignments) {
    for (const fvId of a.factorValueIds) {
      const arr = fvToBms.get(fvId) ?? [];
      arr.push(String(a.bioMaterialId));
      fvToBms.set(fvId, arr);
    }
  }

  const factors: AssocFactor[] = design.experimentalFactors.map((f) => {
    const label = f.name?.trim() || f.category?.category?.trim() || "(factor)";
    if (f.type === "continuous") {
      const levels: ContinuousLevel[] = f.values.map((fv) => ({
        x: Number(fv.value ?? fv.summary ?? ""),
        sampleKeys: fvToBms.get(fv.id) ?? [],
      }));
      return { label, type: "continuous", levels };
    }
    const levels: CategoricalLevel[] = f.values.map((fv) => ({
      sampleKeys: fvToBms.get(fv.id) ?? [],
    }));
    return { label, type: "categorical", levels };
  });

  return { samples: bmToScores, factors };
}
