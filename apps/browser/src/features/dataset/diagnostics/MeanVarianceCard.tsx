/**
 * Mean-variance scatter — browser-side wrapper around the shared
 * MvScatter chart body. Fetches the wire data + adapts the
 * camelCase ``sortedMeans`` / ``fittedVariances`` into the
 * shared MvScatterData shape (which uses the same names — kept
 * camelCase across both apps).
 */

import { useQuery } from "@tanstack/react-query";
import {
  PanelCard,
  PanelEmpty,
  PanelLoading,
  PanelError,
  MvScatter,
} from "@gemma/diagnostics";
import { getDatasetMeanVariance } from "@/api/endpoints";

export function MeanVarianceCard({ datasetId }: { datasetId: number }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["mean-variance", datasetId],
    queryFn: ({ signal }) => getDatasetMeanVariance(datasetId, signal),
    staleTime: 10 * 60_000,
  });

  let body;
  if (isLoading) {
    body = <PanelLoading />;
  } else if (error) {
    body = <PanelError message={(error as Error).message} />;
  } else if (!data || data.means.length === 0) {
    body = (
      <PanelEmpty reason="No mean-variance data available. Either this dataset's MeanVarianceRelation hasn't been computed, or /datasets/{id}/mean-variance isn't deployed on the current Gemma build." />
    );
  } else {
    body = (
      <MvScatter
        data={{
          means: data.means,
          variances: data.variances,
          fit: data.fit ?? null,
        }}
      />
    );
  }

  return (
    <PanelCard
      title="Mean-Variance"
      footer={data?.source ? <span>computed via {data.source}</span> : null}
    >
      {body}
    </PanelCard>
  );
}
