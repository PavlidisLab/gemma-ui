/**
 * GEEQ feature gate.
 *
 * GEEQ is being reworked and the score on the wire no longer means what
 * the UI was saying about it, so every GEEQ surface is suppressed
 * rather than removed: the dot in the results table, the quality figure
 * in the expanded dataset preview, and the score chip + breakdown
 * popover on the dataset page. Flip this to `true` when the new score
 * ships.
 *
 * Owned here so restoring it is a one-line flip rather than four files
 * that have quietly drifted apart.
 *
 * Suitability is a separate matter and is gone for good: it was taken
 * out of the score itself, so its sub-scores and aggregate are no
 * longer rendered anywhere. gemma-rest still emits
 * `publicSuitabilityScore` and the `sScore*` fields — they're simply
 * not ours to show. `GeeqScores` keeps its index signature, so nothing
 * breaks by their still arriving.
 */
export const SHOW_GEEQ = false;
