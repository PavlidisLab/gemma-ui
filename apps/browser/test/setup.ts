/**
 * Vitest setup — loaded once per test file. Only the files that opt
 * into jsdom (the `@vitest-environment jsdom` docblock) have a DOM; in
 * the node files the guards below no-op.
 *
 * Mirrors `apps/curation/test/setup.ts` — jest-dom matchers plus a
 * `cleanup` between tests — and adds the browser APIs this app touches
 * that jsdom does not implement. Each one is a hard TypeError when
 * missing, not a degraded render, so a page that draws a chart or
 * measures an element cannot be rendered under test without them.
 */
import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});

if (typeof window !== "undefined") {
  // `matchMedia` — read by the theme and layout code on mount.
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }

  // Observers — jsdom ships neither. Both are used for sticky headers,
  // lazy panels and chart resizing; a missing constructor throws during
  // render rather than degrading.
  class NoopObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  if (!window.ResizeObserver) {
    window.ResizeObserver = NoopObserver as unknown as typeof ResizeObserver;
  }
  if (!window.IntersectionObserver) {
    window.IntersectionObserver =
      NoopObserver as unknown as typeof IntersectionObserver;
  }

  // jsdom DEFINES `scrollTo` and then throws "Not implemented" from
  // it, so this one is replaced rather than filled in — otherwise every
  // page that scrolls on mount prints a stack to the test output.
  window.scrollTo = (() => {}) as unknown as typeof window.scrollTo;
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }

  // jsdom's Blob has no `stream()`. `compressArg` (src/lib/utils.ts)
  // gzips any filter of 150+ characters through it, so without this
  // every request carrying two or three clauses throws before it is
  // sent — the rows never load, and the spec fails looking for text
  // rather than on the missing method.
  if (typeof Blob !== "undefined" && !Blob.prototype.stream) {
    Blob.prototype.stream = function stream(this: Blob) {
      const blob = this;
      return new ReadableStream<Uint8Array>({
        async start(controller) {
          const buf = await new Promise<ArrayBuffer>((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result as ArrayBuffer);
            r.onerror = () => reject(r.error);
            r.readAsArrayBuffer(blob);
          });
          controller.enqueue(new Uint8Array(buf));
          controller.close();
        },
      });
    } as Blob["stream"];
  }

  // The heatmap draws to a canvas. jsdom's `getContext` throws "not
  // implemented"; this returns a context whose calls are no-ops, so the
  // widget mounts and everything AROUND it stays testable. Nothing here
  // asserts on pixels — that is what the e2e screenshots are for.
  if (typeof HTMLCanvasElement !== "undefined") {
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      canvas: document.createElement("canvas"),
      fillRect: () => {},
      clearRect: () => {},
      getImageData: (_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(Math.max(1, w * h * 4)),
        width: w,
        height: h,
      }),
      putImageData: () => {},
      createImageData: () => ({ data: new Uint8ClampedArray(4) }),
      setTransform: () => {},
      drawImage: () => {},
      save: () => {},
      restore: () => {},
      beginPath: () => {},
      closePath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      stroke: () => {},
      fill: () => {},
      arc: () => {},
      rect: () => {},
      translate: () => {},
      scale: () => {},
      rotate: () => {},
      measureText: () => ({ width: 0 }),
      fillText: () => {},
      strokeText: () => {},
      createLinearGradient: () => ({ addColorStop: () => {} }),
    })) as unknown as HTMLCanvasElement["getContext"];
  }
}
