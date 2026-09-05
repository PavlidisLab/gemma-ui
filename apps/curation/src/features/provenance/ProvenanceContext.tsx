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
 * One run, three sources, and downstream nothing can tell them apart —
 * which is the point: a curator asked one question and gets one answer
 * per annotation.
 *
 *   - **local mode** — the store joins findings to dispositions and
 *     answers factors and tags in one POST.
 *   - **remote mode** — Gemma serves no provenance route, so the same
 *     join runs here (`assembleTraces`) over the reviews Gemma does
 *     serve. Both halves are on that wire: the findings and their
 *     evidence in each annotation set's payload, the curator rulings in
 *     the `dispositions` beside it.
 *   - **either mode** — a publication link is in nobody's tables; the
 *     assertion lives on the link itself and is already on the page, so
 *     the caller resolves those and passes them in.
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
import { fetchReviewsForExperiment } from "@/api/annotationSetReviews";

import { assembleTraces } from "./assembleTraces";

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
  // Only the curation store answers the LOOKUP ROUTE; remote does the
  // same join client-side. See `populate`.
  const storeBacked = useGemmaMode().mode === "local";

  const populate = useCallback(
    (
      experimentId: number | string,
      refs: ProvenanceRef[],
      derived?: ReadonlyMap<string, ProvenanceTrace>,
    ) => {
      setStatus("loading");
      setAsked(refs.length);
      // 🛑 Gemma serves no provenance route — re-checked against the
      // live gemma2 OpenAPI 2026-09-04, still zero paths matching
      // `provenance`. `/rest` is a catch-all whose meaning changes with
      // mode, so the store's POST would go at Gemma and 404.
      //
      // It does not have to. The route's whole job is a JOIN over two
      // things Gemma already serves on `/datasets/{id}/annotation-sets`
      // — findings with their evidence and run provenance in the
      // payload, curator rulings in the `dispositions` beside them — so
      // remote reads those and runs the same join here. Remote means
      // all remote (Paul, 2026-09-03); a surface that answers less
      // there is the bug, not the mode.
      //
      // The DERIVED half needs no service at all in either mode: a
      // publication's provenance is the `association` block Gemma ships
      // on `/datasets/{id}/publications`, which `publicationTraces`
      // converts from the page.
      if (!storeBacked) {
        fetchReviewsForExperiment(experimentId).then(
          (reports) => {
            const next = new Map<string, ProvenanceTrace>(derived ?? []);
            for (const [refId, trace] of assembleTraces(refs, reports)) {
              next.set(refId, trace);
            }
            setByRef(next);
            setStatus("ready");
          },
          () => {
            // 🛑 A failed read is not "nothing recorded". The reviews
            // route needs GROUP_CURATOR / GROUP_ADMIN / GROUP_AGENT and
            // answers 403 without one; rendering that as an empty trace
            // would tell a curator this experiment has no history when
            // nobody was allowed to look. The publication traces still
            // stand — they came off a wire this failure never touched.
            setByRef(new Map(derived ?? []));
            setStatus("error");
          },
        );
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
