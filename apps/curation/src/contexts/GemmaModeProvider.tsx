import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  GemmaModeContext,
  fetchRuntimeConfig,
  resolveGemmaMode,
  setRuntimeConfig,
  type GemmaMode,
  type GemmaModeInfo,
  type RuntimeConfig,
} from "@/lib/gemmaMode";

/**
 * Boot-time fetch of local-api's runtime host config so the mode chip
 * + term-picker footer show the *actual* ontology routing host, not
 * whatever was baked into the SPA bundle at docker-build time.
 *
 * 🛑 **Children wait for it.** The first paint used to run on the
 * build-time defaults, and the mode is not just a label — it decides
 * which backend every query talks to, and no query key carries it.
 * `useMe` is the sharp edge: it resolves the mode at render, keys on a
 * bare `["me"]`, and holds its answer with `staleTime: 5min`,
 * `refetchOnMount: false`, `refetchOnWindowFocus: false`. In the
 * build-local / runtime-remote combination the Dockerfile and compose
 * file support (`ARG VITE_GEMMA_MODE=local`, "runtime config takes
 * precedence… without a restart"), a first render under the build-time
 * answer cached the synthetic `local-curator` with `GROUP_ADMIN`: no
 * login page, and every Gemma call anonymous, with nothing left to
 * refetch it. Rendering nothing for one config round-trip (a single
 * in-memory env read on the server) is the version that cannot cache a
 * wrong answer.
 *
 * A failed fetch — legacy local-api without the endpoint, offline —
 * settles immediately on the build-time values, so nothing regresses.
 */

/** How long the first paint waits for `/curation/v1/__config__` before
 *  falling back to the build-time answer. A bound, not a budget: the
 *  fetch normally lands in well under 100 ms, and this only exists so
 *  an upstream that never answers leaves a usable app rather than a
 *  blank one. A config arriving after it is still applied, and drops
 *  the query cache if it changed the mode. */
const CONFIG_WAIT_MS = 3000;

export function GemmaModeProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [info, setInfo] = useState<GemmaModeInfo | null>(null);
  /** The mode children have already rendered under, or null before the
   *  first paint. A ref, because the comparison has to survive the
   *  double-invoked effect under StrictMode. */
  const rendered = useRef<GemmaMode | null>(null);

  useEffect(() => {
    let alive = true;
    const publish = (rc: RuntimeConfig | null) => {
      // Publish BEFORE the state update: code outside React resolves
      // the mode through the same cache, and a queryFn that fires on
      // this render must not still see the build-time answer.
      setRuntimeConfig(rc);
      const next = resolveGemmaMode(rc);
      if (rendered.current !== null && rendered.current !== next.mode) {
        // Only reachable past CONFIG_WAIT_MS. Anything cached by then
        // was answered by the other backend under a key that does not
        // name the mode, so it has to go rather than be trusted.
        qc.clear();
      }
      rendered.current = next.mode;
      setInfo(next);
    };
    const timer = setTimeout(() => {
      if (alive && rendered.current === null) publish(null);
    }, CONFIG_WAIT_MS);
    void fetchRuntimeConfig().then((rc) => {
      if (!alive) return;
      clearTimeout(timer);
      publish(rc);
    });
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [qc]);

  if (!info) return null;

  return (
    <GemmaModeContext.Provider value={info}>
      {children}
    </GemmaModeContext.Provider>
  );
}
