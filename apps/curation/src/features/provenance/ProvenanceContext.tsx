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
 */

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
  populate: (experimentId: number | string, refs: ProvenanceRef[]) => void;
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

  const populate = useCallback(
    (experimentId: number | string, refs: ProvenanceRef[]) => {
      setStatus("loading");
      setAsked(refs.length);
      lookup.mutate(
        { experimentId, refs },
        {
          onSuccess: (res) => {
            const next = new Map<string, ProvenanceTrace>();
            for (const [refId, trace] of Object.entries(res.by_ref_id ?? {})) {
              next.set(refId, trace);
            }
            setByRef(next);
            setStatus("ready");
          },
          onError: (e) => {
            setByRef(new Map());
            setStatus(e instanceof ProvenanceUnavailable ? "unavailable" : "error");
          },
        },
      );
    },
    [lookup],
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
