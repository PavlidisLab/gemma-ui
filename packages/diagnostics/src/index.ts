/**
 * @gemma/diagnostics — presentational primitives for the four-up
 * diagnostics row that lives on both the public dataset page (browser)
 * and the curator Diagnostics tab (curation).
 *
 * Everything here is **pure presentation + math**: no data fetching,
 * no app-config coupling. Apps wrap each chart with their own data
 * hooks and pass results in via props. Curator-only affordances
 * (outlier marking, "exclude probe", etc.) belong in the wrapper —
 * use the PanelCard footer slot or stack a tool strip alongside the
 * chart body.
 */

export {
  PanelCard,
  PanelEmpty,
  PanelLoading,
  PanelError,
  DIAGNOSTICS_PANEL_BODY_PX,
  HEATMAP_LEGEND_ZONE_PX,
} from "./PanelCard";

export { ScreeChart, MAX_SCREE_BARS, MAX_LOADED_PC } from "./ScreeChart";

export { MvScatter, type MvScatterData } from "./MvScatter";

export {
  PcFactorBars,
  type PcFactorBarRow,
} from "./PcFactorBars";

export {
  computePcFactorAssociations,
  type AssocFactor,
  type CategoricalLevel,
  type ContinuousLevel,
  type PcFactorAssoc,
} from "./associations";

export {
  GeneRowsTable,
  type GeneRow,
  type GeneRowsTableProps,
} from "./GeneRowsTable";

export {
  buildSampleCorrelationHeatmapData,
  computeSampleCorrelationDomain,
  summariseOutliers,
  sampleCorrelationCellPx,
  type SampleCorrelationInput,
} from "./sampleCorrelation";

export {
  niceTicks,
  quantileRange,
  scaler,
  mean,
  pearson,
  fmtPct,
  fmtNum,
  truncate,
} from "./math";
