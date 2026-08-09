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
  experimentId: number | string,
  proposalId: string,
): string {
  return `${PREFIX}${experimentId}:${proposalId}`;
}

export function isPaperDismissed(
  experimentId: number | string,
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
  experimentId: number | string,
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

/** Clear every dismissal flag for one experiment, across all of its
 *  proposals.
 *
 *  Wired into the "Reset experiment" path. A reset wipes the design but
 *  NOT the proposals, so without this the flag outlives the publication
 *  row it was gating: auto-apply stays suppressed forever and the paper
 *  never comes back, with nothing on screen explaining why. The
 *  experiment id is embedded in the key precisely so this clear can be
 *  scoped — other experiments' dismissals must survive.
 *
 *  The trailing ``:`` in the prefix keeps experiment 1 from matching
 *  experiment 12. */
export function clearPaperDismissals(experimentId: number | string): void {
  try {
    const prefix = `${PREFIX}${experimentId}:`;
    const doomed: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(prefix)) doomed.push(key);
    }
    // Collect first, then remove — removing during the scan reindexes
    // the store and skips entries.
    for (const key of doomed) window.localStorage.removeItem(key);
  } catch {
    // ignore — best-effort.
  }
}

