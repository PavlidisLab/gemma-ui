/**
 * Mean-variance scatter — curator-side wrapper. Math + SVG body live
 * in @gemma/diagnostics's MvScatter. Wrapper adapts curation's
 * snake_case wire shape (sorted_means / fitted_variances) to the
 * shared camelCase shape (sortedMeans / fittedVariances).
 */

import {
  PanelCard,
  PanelEmpty,
  PanelLoading,
  PanelError,
  MvScatter,
} from "@gemma/diagnostics";
import { useMeanVariance } from "@/api/diagnostics";

export function MeanVarianceCard({
  experimentId,
}: {
  experimentId: number | string;
}) {
  const { data, isLoading, error } = useMeanVariance(experimentId);

  let body;
  if (isLoading) {
    body = <PanelLoading />;
  } else if (error) {
    body = <PanelError message={(error as Error).message} />;
  } else if (!data || data.means.length === 0) {
    body = (
      <PanelEmpty reason="No mean-variance data returned (HTTP 404). Either this dataset's MeanVarianceRelation hasn't been computed, or /datasets/{id}/mean-variance isn't deployed on the current Gemma build." />
    );
  } else {
    body = (
      <MvScatter
        data={{
          means: data.means,
          variances: data.variances,
          fit: data.fit
            ? {
                sortedMeans: data.fit.sorted_means,
                fittedVariances: data.fit.fitted_variances,
              }
            : null,
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
