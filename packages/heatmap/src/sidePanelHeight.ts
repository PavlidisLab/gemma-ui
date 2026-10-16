/**
 * How tall the pinned cell/strip detail panel may be, wherever the
 * widget is rendered.
 *
 * A fixed `80vh` was wrong in both directions: the widget's own card is
 * `overflow: hidden`, so on a short heatmap (a 20-gene expression
 * matrix is ~300px) the panel ran past the card's bottom and was cut
 * off with no way to scroll to it.
 *
 * Two kinds of bound, treated differently:
 *   - HARD — an ancestor that clips (`overflow: hidden | clip`).
 *     Anything past its bottom is gone, so the panel never crosses it.
 *   - SOFT — the viewport, and any ancestor that scrolls
 *     (`overflow: auto | scroll`). Past it the panel is still
 *     reachable by scrolling, so it may cross it rather than shrink
 *     below a usable height.
 */

/** Gap kept between the panel and the bound it stops at. */
export const SIDE_PANEL_MARGIN = 8;
/** Smallest height the panel shrinks to for a SOFT bound. */
export const SIDE_PANEL_MIN_H = 240;
/** Never taller than this share of the viewport, however much room. */
export const SIDE_PANEL_MAX_VH = 0.8;

export interface SidePanelBounds {
  /** Panel's top edge, viewport coordinates. */
  top: number;
  /** Bottom of the nearest clipping ancestor, or `Infinity` if none. */
  hardBottom: number;
  /** Bottom of the viewport or the nearest scrolling ancestor, whichever is higher up. */
  softBottom: number;
  viewportH: number;
}

export function sidePanelMaxHeight({
  top,
  hardBottom,
  softBottom,
  viewportH,
}: SidePanelBounds): number {
  const soft = Math.max(SIDE_PANEL_MIN_H, softBottom - top - SIDE_PANEL_MARGIN);
  const hard = hardBottom - top - SIDE_PANEL_MARGIN;
  // The hard bound wins even below the minimum: a panel that is too
  // short scrolls inside itself, one that crosses a clip is cut off.
  return Math.max(0, Math.round(Math.min(soft, hard, viewportH * SIDE_PANEL_MAX_VH)));
}

/** Read the bounds for `el` off the live DOM. Also returns the nearest
 *  clipping ancestor so the caller can watch it for resizes. */
export function measureSidePanelBounds(el: HTMLElement): {
  bounds: SidePanelBounds;
  clipper: HTMLElement | null;
} {
  const viewportH = window.innerHeight;
  let hardBottom = Infinity;
  let softBottom = viewportH;
  let clipper: HTMLElement | null = null;
  for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
    const oy = getComputedStyle(a).overflowY;
    if (oy === 'visible') continue;
    const r = a.getBoundingClientRect();
    // The padding box's bottom: content past it is what gets hidden.
    const bottom = r.top + a.clientTop + a.clientHeight;
    if (oy === 'hidden' || oy === 'clip') {
      if (bottom < hardBottom) {
        hardBottom = bottom;
        clipper = a;
      }
    } else {
      // The first scroller ends the walk: whatever clips further out
      // (an app shell that is `overflow: hidden` at screen height)
      // bounds the scroller, not the panel, which scrolls into view.
      if (a !== document.body) softBottom = Math.min(softBottom, bottom);
      break;
    }
  }
  return {
    bounds: { top: el.getBoundingClientRect().top, hardBottom, softBottom, viewportH },
    clipper,
  };
}
