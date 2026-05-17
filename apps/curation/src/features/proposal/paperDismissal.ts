/**
 * localStorage gating for the OverviewPanel's auto-apply effect.
 *
 * The auto-apply effect adds the proposal's paper as a draft
 * Publication on first sight; it skips when the dismissal flag is
 * already set. The flag survives across page reloads so the
 * curator's "I already dealt with this" decision sticks — set when
 * the curator manually deletes the auto-applied row, when they
 * reject the proposal, or naturally after the first auto-apply
 * succeeds.
 *
 * Keyed by ``experiment_id + proposal_id`` so a "reset experiment"
 * (which wipes the design but doesn't delete proposals) can scope
 * its flag-clear to just this experiment, leaving other
 * experiments' dismissals intact.
 */

const PREFIX = "gca:auto-applied-paper:";

export function paperDismissalKey(
  experimentId: number,
  proposalId: string,
): string {
  return `${PREFIX}${experimentId}:${proposalId}`;
}

export function isPaperDismissed(
  experimentId: number,
  proposalId: string,
): boolean {
  try {
    return (
      window.localStorage.getItem(paperDismissalKey(experimentId, proposalId)) ===
      "1"
    );
  } catch {
    return false;
  }
}

export function markPaperDismissed(
  experimentId: number,
  proposalId: string,
): void {
  try {
    window.localStorage.setItem(
      paperDismissalKey(experimentId, proposalId),
      "1",
    );
  } catch {
    // ignore — best-effort.
  }
}

/** Clear every dismissal flag for an experiment — called by the
 *  reset-experiment flow so a fresh skeleton gets fresh auto-apply
 *  behaviour for any pending proposals. */
export function clearPaperDismissalsForExperiment(experimentId: number): void {
  try {
    const scopedPrefix = `${PREFIX}${experimentId}:`;
    const toRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(scopedPrefix)) toRemove.push(k);
    }
    for (const k of toRemove) window.localStorage.removeItem(k);
  } catch {
    // ignore
  }
}
