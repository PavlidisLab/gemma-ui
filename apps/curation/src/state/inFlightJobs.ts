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
 * React surfaces subscribe via ``useInFlightJobsFor(eeId)`` — a
 * useSyncExternalStore wrapper that re-renders when the registry
 * mutates.
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
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function registerJob(job: Omit<InFlightJob, "startedAt">): () => void {
  jobs.set(job.id, { ...job, startedAt: Date.now() });
  emit();
  // Return an idempotent unregister so callers can wire it to the
  // mutation lifecycle without juggling two refs.
  return () => {
    if (jobs.delete(job.id)) emit();
  };
}

export function unregisterJob(id: string): void {
  if (jobs.delete(id)) emit();
}

export function getJobsForEE(eeId: number | string): InFlightJob[] {
  const key = String(eeId);
  return Array.from(jobs.values()).filter((j) => String(j.eeId) === key);
}

export function getAllJobs(): InFlightJob[] {
  return Array.from(jobs.values());
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
