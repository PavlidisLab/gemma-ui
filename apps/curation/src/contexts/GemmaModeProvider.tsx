import { useEffect, useState, type ReactNode } from "react";
import {
  GemmaModeContext,
  fetchRuntimeConfig,
  resolveGemmaMode,
  setRuntimeConfig,
  type GemmaModeInfo,
} from "@/lib/gemmaMode";

/**
 * Boot-time fetch of local-api's runtime host config so the mode chip
 * + term-picker footer show the *actual* ontology routing host, not
 * whatever was baked into the SPA bundle at docker-build time.
 *
 * Optimistic loading (UIB's call): first paint uses the
 * build-time defaults so there's no blank "host = ?" flash; the runtime
 * value swaps in once ``/curation/v1/__config__`` responds (a single
 * in-memory env read on the server, typically <100 ms). If the fetch
 * fails — legacy local-api without the endpoint, offline — we keep the
 * build-time values, so nothing regresses.
 */
export function GemmaModeProvider({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<GemmaModeInfo>(() => resolveGemmaMode());

  useEffect(() => {
    let alive = true;
    fetchRuntimeConfig().then((rc) => {
      if (!alive || !rc) return;
      // Publish BEFORE the state update: code outside React resolves
      // the mode through the same cache, and a queryFn that fires on
      // this render must not still see the build-time answer.
      setRuntimeConfig(rc);
      setInfo(resolveGemmaMode(rc));
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <GemmaModeContext.Provider value={info}>
      {children}
    </GemmaModeContext.Provider>
  );
}
