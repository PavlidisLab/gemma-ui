import { useEffect, useRef, useState } from "react";

/** Track a container's CSS pixel size. Returns a ref to attach + the
 *  measured {width,height}. Both start at 0; consumers should pick a
 *  fallback for the first render before ResizeObserver fires. */
export function useContainerSize<T extends Element>(): {
  ref: React.RefObject<T>;
  width: number;
  height: number;
} {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const obs = new ResizeObserver((entries) => {
      for (const e of entries) {
        const { width, height } = e.contentRect;
        if (width > 0 && height > 0) setSize({ width, height });
      }
    });
    obs.observe(node);
    return () => obs.disconnect();
  }, []);

  return { ref, width: size.width, height: size.height };
}