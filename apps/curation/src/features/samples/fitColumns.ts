/**
 * "Fit columns" — a width per column that shows its content whole.
 *
 * The sample table already has per-column widths: `SortableTh` takes a
 * `width` and hard-pins the column (min/width/max), the curator drags
 * the handle to set one, and `samples.colWidths` persists them. What
 * was missing is a way to ask for the width that FITS, rather than
 * dragging each column until the text stops being cut off.
 *
 * 🛑 **Measured from the data, not from the DOM.** The table body is
 * virtualized — only the rows near the viewport exist — so a DOM pass
 * would fit the columns to whatever happened to be on screen, and the
 * answer would change as the curator scrolls. Every value that WILL
 * render is in hand here, so the width is the same wherever they are.
 */

/** One column's content, as text. */
export interface FitColumnInput {
  /** `colKey` — the same key `colWidths` and `SortableTh` use. */
  key: string;
  /** Header label. A column is never narrower than its own header. */
  header: string;
  /** Every value that renders in the column's cells. Duplicates are
   *  fine; only the widest one matters. */
  values: string[];
  /** Furniture the text shares the cell with — a `<select>`'s arrow,
   *  the confidence-warning slot, a badge. Added to the widest value,
   *  not to the header. */
  chrome?: number;
}

/** `px-3` each side, plus the cell's border. */
export const CELL_PADDING = 26;

/** The header carries a sort arrow, a drag handle and sometimes a
 *  badge, all beside the label. */
export const HEADER_CHROME = 30;

/** Narrow enough to be worth fitting, wide enough to read. */
export const FIT_MIN = 64;

/**
 * 🛑 A ceiling, deliberately, even though the point is to show
 * everything. A GEO description runs to several sentences of protocol;
 * fitted honestly it is a 3,000px column and every other column is off
 * screen. At the ceiling the cell still truncates and its `title` still
 * carries the whole string, which is the same deal as before — for one
 * column instead of all of them.
 */
export const FIT_MAX = 640;

/**
 * Width per column key, ready to hand to `setColWidths`.
 *
 * `measure` returns the rendered width of a string in px; the caller
 * supplies it because only the caller knows the table's font (see
 * `canvasTextMeasurer`).
 */
export function fitColumnWidths(
  columns: FitColumnInput[],
  measure: (text: string) => number,
  opts?: { min?: number; max?: number; padding?: number },
): Record<string, number> {
  const min = opts?.min ?? FIT_MIN;
  const max = opts?.max ?? FIT_MAX;
  const padding = opts?.padding ?? CELL_PADDING;
  const out: Record<string, number> = {};
  for (const col of columns) {
    const chrome = col.chrome ?? 0;
    let widest = measure(col.header) + HEADER_CHROME;
    for (const v of col.values) {
      if (!v) continue;
      const w = measure(v) + chrome;
      if (w > widest) widest = w;
    }
    out[col.key] = Math.round(
      Math.min(max, Math.max(min, widest + padding)),
    );
  }
  return out;
}

/**
 * A `measure` backed by a canvas, in the font the cells actually use.
 *
 * Returns `null` where there is no 2D context to measure with — jsdom,
 * a locked-down embed — and the caller leaves the widths alone rather
 * than pinning every column to a guess.
 */
export function canvasTextMeasurer(font: string): ((t: string) => number) | null {
  if (typeof document === "undefined") return null;
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return null;
  ctx.font = font;
  return (text: string) => ctx.measureText(text).width;
}

/** The shorthand `font` of an element, for `canvasTextMeasurer`.
 *  Falls back to the table's 12px default when the element is not
 *  laid out (`getComputedStyle` answers "" off-document). */
export function fontOf(el: Element | null): string {
  const DEFAULT = "12px ui-sans-serif, system-ui, sans-serif";
  if (!el || typeof getComputedStyle !== "function") return DEFAULT;
  const cs = getComputedStyle(el);
  if (cs.font) return cs.font;
  if (!cs.fontSize || !cs.fontFamily) return DEFAULT;
  return `${cs.fontStyle || "normal"} ${cs.fontWeight || "400"} ${cs.fontSize} ${cs.fontFamily}`;
}
