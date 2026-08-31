/**
 * Session store for one "populate provenance" run.
 *
 * Deliberately NOT persisted and NOT fetched on render — the same
 * posture as the term-validation run, and for the same two reasons: a
 * trace is a claim about the annotation as it stood when the curator
 * asked, and the lookup is expensive enough that nobody should pay for
 * it on a page they only meant to read.
 *
 * A context rather than local state because the dots render in
 * subtrees the button will never own — a tag chip on Overview, a
 * factor row in the design editor — and they must all read one run.
 * Same shape as `AuditContext`: an index keyed by a handle, consumers
 * look themselves up and render nothing when absent.
 *
 * One run, two sources. Factors and tags are answered by the store,
 * which joins findings to dispositions. A publication link is not in
 * those tables at all — the assertion lives on the link itself, and it
 * is already on the page — so the caller resolves those and passes them
 * in. Downstream nothing can tell the difference, which is the point:
 * a curator asked one question and gets one answer per annotation.
 */

import { useGemmaMode } from "@/lib/gemmaMode";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  ProvenanceUnavailable,
  useProvenanceLookup,
  type ProvenanceRef,
  type ProvenanceTrace,
} from "@/api/provenance";

export type ProvenanceRunStatus =
  | "idle"
  | "loading"
  /** Ran, results in hand — including the very common "all empty". */
  | "ready"
  /** The endpoint isn't deployed. A different sentence from "nothing
   *  recorded", and the panel must not present it as a finding about
   *  the data. */
  | "unavailable"
  | "error";

export interface ProvenanceRunValue {
  status: ProvenanceRunStatus;
  /** ref_id → trace. Only entries the server answered for; a ref with
   *  no trace is simply absent. */
  byRef: Map<string, ProvenanceTrace>;
  /** How many refs were asked about on the last run. */
  asked: number;
  /** How many came back carrying at least one event. */
  traced: number;
  populate: (
    experimentId: number | string,
    refs: ProvenanceRef[],
    /** Traces the caller resolved itself, keyed by `ref_id` — today the
     *  publication links, whose provenance rides on the publication
     *  wire rather than in the store's tables. Merged UNDER the
     *  server's answer: the store can see rows a browser cannot, so
     *  where both speak, it wins. */
    derived?: ReadonlyMap<string, ProvenanceTrace>,
  ) => void;
  clear: () => void;
}

const EMPTY: ProvenanceRunValue = {
  status: "idle",
  byRef: new Map(),
  asked: 0,
  traced: 0,
  populate: () => {},
  clear: () => {},
};

/** Exported so render tests can supply a run directly instead of
 *  booting the provider and its mutation. Production always goes
 *  through {@link ProvenanceProvider}. Mirrors the affordance
 *  `DesignDraftContext` exposes for the same reason. */
export const ProvenanceRunContext = createContext<ProvenanceRunValue>(EMPTY);
const Ctx = ProvenanceRunContext;

export function ProvenanceProvider({ children }: { children: ReactNode }) {
  const [byRef, setByRef] = useState<Map<string, ProvenanceTrace>>(new Map());
  const [asked, setAsked] = useState(0);
  const [status, setStatus] = useState<ProvenanceRunStatus>("idle");
  const lookup = useProvenanceLookup();
  // Only the curation store answers the lookup; see `populate`.
  const storeBacked = useGemmaMode().mode === "local";

  const populate = useCallback(
    (
      experimentId: number | string,
      refs: ProvenanceRef[],
      derived?: ReadonlyMap<string, ProvenanceTrace>,
    ) => {
      setStatus("loading");
      setAsked(refs.length);
      // 🛑 Gemma serves no provenance route — verified against the live
      // OpenAPI on gemma2 2026-08-31, zero paths matching
      // `provenance`. `/rest` is a catch-all whose meaning changes with
      // mode, so in remote mode this POST would go at Gemma and 404.
      //
      // The DERIVED half needs no service at all: a publication's
      // provenance is the `association` block Gemma ships on
      // `/datasets/{id}/publications` — status / role / source /
      // evidence / evidenceCode / assertedBy / assertedAt, populated on
      // 27103 — which `publicationTraces` converts from the page. So
      // remote skips the request and reports exactly what it has,
      // rather than the panel hiding the whole feature because half of
      // it is unavailable.
      if (!storeBacked) {
        setByRef(new Map(derived ?? []));
        setStatus("unavailable");
        return;
      }
      lookup.mutate(
        { experimentId, refs },
        {
          onSuccess: (res) => {
            const next = new Map<string, ProvenanceTrace>(derived ?? []);
            for (const [refId, trace] of Object.entries(res.by_ref_id ?? {})) {
              next.set(refId, trace);
            }
            setByRef(next);
            setStatus("ready");
          },
          onError: (e) => {
            // 🛑 A backend with no provenance route still cannot
            // un-know what the publication wire already said. Keeping
            // the derived traces here is why the panel reports
            // "unavailable" and the paper still shows its source —
            // two different silences, and only one of them applies.
            setByRef(new Map(derived ?? []));
            setStatus(e instanceof ProvenanceUnavailable ? "unavailable" : "error");
          },
        },
      );
    },
    [lookup, storeBacked],
  );

  const clear = useCallback(() => {
    setByRef(new Map());
    setAsked(0);
    setStatus("idle");
  }, []);

  // An entry with no events is a real answer ("known, nothing
  // recorded") and stays in the map so a caller can tell it from
  // "never asked" — but it doesn't count as traced, and it doesn't
  // earn a dot.
  const traced = useMemo(
    () => [...byRef.values()].filter((t) => (t.events ?? []).length > 0).length,
    [byRef],
  );

  const value = useMemo<ProvenanceRunValue>(
    () => ({ status, byRef, asked, traced, populate, clear }),
    [status, byRef, asked, traced, populate, clear],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Always safe to call — outside a provider it reports an idle run, so
 *  a dot rendered on a surface nobody wrapped simply never appears. */
export function useProvenanceRun(): ProvenanceRunValue {
  return useContext(Ctx);
}

/** The trace for one annotation, or null when the run didn't cover it
 *  or covered it and found nothing. */
export function useTrace(refId: string | null | undefined): ProvenanceTrace | null {
  const run = useProvenanceRun();
  if (!refId) return null;
  const t = run.byRef.get(refId);
  if (!t || (t.events ?? []).length === 0) return null;
  return t;
}
