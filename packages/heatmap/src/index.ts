export {
  HeatmapWidget,
  serializeHeatmapDataAsTsv,
  type HeatmapWidgetProps,
  type WidgetPalette,
} from './HeatmapWidget';
export { Heatmap, type HeatmapProps } from './Heatmap';
export { Legend, type LegendProps } from './Legend';
export { renderMatrix, type RenderOptions } from './render';
export {
  resolveConfig,
  computeLayout,
  type Layout,
  type ColumnMap,
} from './layout';
export { makeColorScale, dataExtent, rowStandardize } from './color';
export { PALETTES, DEFAULT_PALETTE } from './palettes';
export type {
  AnnotationStrip,
  CellGeometry,
  CellValue,
  CategoricalAnnotation,
  ContinuousAnnotation,
  ContinuousScale,
  HeatmapConfig,
  HeatmapData,
  Palette,
  RenderResult,
  ResolvedConfig,
  StripHit,
} from './types';

// v2 — wire-payload-aware surfaces.
export type {
  Factor,
  FactorType,
  FactorValue,
  HeatmapPayload,
  HeatmapPayloadColumn,
  HeatmapPayloadRow,
  HeatmapQuantitationType,
  HeatmapRowGene,
  ProbeRowLabel,
  ProbeRowLabelSource,
  OntologyTerm,
  Statement,
} from './payload';
export {
  buildGeneRowLabel,
  probeRowLabel,
  continuousValueOf,
  parseFactorUnit,
  NONSPECIFIC_MARK,
} from './payload';
export { computeColumnOrder, type ColumnOrderResult } from './columnOrder';
export { isTechnicalFactor, orderFactorsForDisplay } from './factorOrder';
export {
  buildHeatmapDataFromPayload,
  type BuiltHeatmap,
  type BuildOptions,
} from './buildHeatmapData';
export { buildCategoricalStrip } from './strips/categorical';
export {
  buildContinuousStrip,
  pickContinuousScale,
  paletteFor,
  projectContinuous,
  projectedDomain,
} from './strips/continuous';
export { SidePanel, type SidePanelProps, type SidePanelClick } from './SidePanel';
export { HeatmapTooltip, type HeatmapTooltipProps, type TooltipState } from './Tooltip';
