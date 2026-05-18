export {
  HeatmapWidget,
  type HeatmapWidgetProps,
  type WidgetPalette,
} from './HeatmapWidget';
export { Heatmap, type HeatmapProps } from './Heatmap';
export { Legend, type LegendProps } from './Legend';
export { renderMatrix, type RenderOptions } from './render';
export { resolveConfig, computeLayout, type Layout, type ColumnMap } from './layout';
export { makeColorScale, dataExtent, rowStandardize } from './color';
export { PALETTES, DEFAULT_PALETTE } from './palettes';
export type {
  CellGeometry,
  CellValue,
  CategoricalAnnotation,
  HeatmapConfig,
  HeatmapData,
  Palette,
  RenderResult,
  ResolvedConfig,
} from './types';
