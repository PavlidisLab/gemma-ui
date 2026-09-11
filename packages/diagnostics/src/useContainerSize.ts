import { useCallback, useEffect, useState } from "react";

/** Track a container's CSS pixel size. Returns a ref to attach + the
 *  measured {width,height}. Both start at 0; consumers should pick a
 *  fallback for the first render before ResizeObserver fires.
 *
 *  🛑 A CALLBACK ref, not a `useRef` object. The measured element is
 *  routinely absent from the first render — a card whose box sits in
 *  the final branch of a loading/error/empty chain mounts its spinner
 *  first — and a `[]`-deps effect reading `ref.current` finds null
 *  there, returns early and never runs again, so the size stays 0 for
 *  the component's life. It comes out right when a warm cache puts the
 *  element in the first render, which makes the symptom read as
 *  intermittent. A callback ref fires when the element actually
 *  arrives, and again when it goes.
 *
 *  The returned ref keeps a stable identity across renders: React
 *  detaches and reattaches an inline callback ref on every render,
 *  which would tear down and rebuild the observer each time. */
export function useContainerSize<T extends Element>(): {
  ref: React.RefCallback<T>;
  width: number;
  height: number;
} {
  const [node, setNode] = useState<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  const ref = useCallback((el: T | null) => setNode(el), []);

  useEffect(() => {
    if (!node) return;
    const obs = new ResizeObserver((entries) => {
      for (const e of entries) {
        const { width, height } = e.contentRect;
        if (width > 0 && height > 0) setSize({ width, height });
      }
    });
    obs.observe(node);
    return () => obs.disconnect();
  }, [node]);

  return { ref, width: size.width, height: size.height };
}
