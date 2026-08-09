/**
 * In-flight jobs registry — tracks long-running launches (proposal,
 * audit, …) that the curator started from an EE page. Used by the
 * navigation leave-guard to decide whether to prompt for a ticket
 * before the curator wanders off.
 *
 * Module-level state, NOT React state. Two reasons:
 *  1. The leave-guard runs inside ``routes.ts``'s ``navigate`` —
 *     plain TS, no React tree. It needs a synchronously-readable
 *     snapshot of the registry.
 *  2. The registry survives route changes; tying it to a context
 *     provider would unmount it the moment the curator navigates
 *     away (the whole point of the guard).
 *
 * Read synchronously via ``getJobsForEE`` — the guard re-reads on each
 * navigate, so there is no subscription surface. (An earlier
 * ``useInFlightJobsFor`` useSyncExternalStore wrapper was planned and
 * never built; its listener plumbing is gone with it.)
 *
 * Forward-compat: when tickets move to gemma-rest (Java), the
 * registry surface stays UI-side; only the helper that resolves
 * "is this EE on a ticket I own?" changes its endpoint.
 */

export type JobKind = "proposal" | "audit";

export interface InFlightJob {
  /** Stable per-launch ID — caller provides via crypto.randomUUID
   *  (or any unique string). Used as the unregister key. */
  id: string;
  eeId: number | string;
  kind: JobKind;
  /** Short human label for the leave-prompt modal. e.g.
   *  ``"Proposal for GSE315959"``. Defaults to the kind name. */
  label?: string;
  startedAt: number;
}

const jobs = new Map<string, InFlightJob>();

export function registerJob(job: Omit<InFlightJob, "startedAt">): () => void {
  jobs.set(job.id, { ...job, startedAt: Date.now() });
  // Return an idempotent unregister so callers can wire it to the
  // mutation lifecycle without juggling two refs. This closure is the
  // ONLY way to deregister — there is deliberately no free-standing
  // ``unregisterJob(id)``, so a caller can't drop a job it didn't
  // start.
  return () => {
    jobs.delete(job.id);
  };
}

export function getJobsForEE(eeId: number | string): InFlightJob[] {
  const key = String(eeId);
  return Array.from(jobs.values()).filter((j) => String(j.eeId) === key);
}
