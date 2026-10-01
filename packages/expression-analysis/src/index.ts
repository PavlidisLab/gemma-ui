/**
 * @gemma/expression-analysis — gene-expression browse (gene/GO-term
 * picker + heatmap) and differential-expression browse (analyses,
 * contrasts, p-value distributions, TSV download). Presentation +
 * orchestration only: hosts supply data-fetching via the *Api
 * interfaces below. See GeneExpressionPanel.tsx / deTypes.ts for the
 * design rationale and known scope cuts.
 */

export {
  GeneExpressionPanel,
  type GeneExpressionPanelProps,
  type ProbeTooltipInput,
  splitFragment,
  setFragmentParam,
} from "./GeneExpressionPanel";
export type {
  Gene,
  Taxon,
  GoTermMatch,
  GoTermGenesPage,
  QuantitationTypeLite,
  PlatformLite,
  GeneExpressionHeatmapParams,
  GeneExpressionHeatmapDecoration,
  GeneOrigin,
  GeneExpressionApi,
} from "./types";

export {
  DifferentialExpressionPanel,
  type DifferentialExpressionPanelProps,
  type TermChipInput,
  factorValueLabel,
  factorValueTerm,
} from "./DifferentialExpressionPanel";
export type {
  DiffExAnalysis,
  DiffExNestedResultSet,
  PvalueDistribution,
  ExperimentalDesignForContrasts,
  ExperimentalFactorEntry,
  FactorValueBasic,
  DifferentialExpressionApi,
} from "./deTypes";

export { useDebounced, toGoCurie, shortenGoUri, curieToUrl, middleEllipsis, isBaselineTerm } from "./util";
