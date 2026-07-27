/**
 * Helpers for the "edit a stored disposition" flow. Pure functions
 * extracted from AuditSidebarPanel so they're trivially testable —
 * the round-trip between chip-key → wire → chip-key has to keep
 * working under both wire regimes:
 *
 *  - **pre-2026-05-13 agent enum:** calibration-specific chips
 *    (`missed_evidence`, `no_evidence`, `gold_was_wrong`,
 *    `borderline`) were not on the agent's `DismissReason` /
 *    `AcceptReason` enum, so the UI squashed them to canonical
 *    values on send (`weak_evidence` / `other`) and stashed the
 *    specific chip in `notes` as a `[<chip>]` prefix.
 *  - **post-2026-05-13 agent enum:** the agents side extended the
 *    enums to include the calibration chips directly. The
 *    structured `dismiss_reason` / `accept_reason` /
 *    `not_sure_reason` field can carry the chip key as-is, and
 *    the prefix workaround is no longer load-bearing.
 *
 * The UI keeps the squash + prefix as belt-and-braces against
 * older eval packages still running pre-2026-05-13 agent services.
 * Whichever regime the curator's disposition was written under,
 * the edit dialog must read it back and pre-select the chip
 * correctly — this module's job.
 */
import type { AuditFindingDisposition } from "@/api/auditTypes";

export type DispositionMode = "dismiss" | "accept" | "not_sure";

/**
 * Parse the `[chip_key] free-text…` prefix written by the v0.6.4
 * squash workaround out of a disposition's notes field. Returns
 * the chip key (if a prefix is present) and the remainder of the
 * note with the prefix stripped.
 *
 * Idempotent on notes that have no prefix: returns
 * `{ tag: null, plain: notes }`.
 */
export function parsePrefixedNote(notes: string): {
  tag: string | null;
  plain: string;
} {
  const m = notes.match(/^\[([^\]]+)\]\s*(.*)$/s);
  if (!m) return { tag: null, plain: notes };
  return { tag: m[1], plain: m[2] };
}

/**
 * Resolve the initial chip + notes values for the edit dialog from
 * a stored disposition. Prefix wins over the structured field
 * because the prefix encodes the specific calibration chip the
 * curator clicked — the structured field on a pre-2026-05-13
 * wire is the squashed canonical value, which would re-select the
 * wrong chip. Post-2026-05-13 dispositions have no prefix and
 * fall through to the structured field, which IS the chip key.
 */
export function resolveEditInitial(
  disposition: AuditFindingDisposition,
  mode: DispositionMode,
): { tag: string | null; plain: string } {
  const { tag: prefixTag, plain } = parsePrefixedNote(disposition.notes);
  if (prefixTag !== null) return { tag: prefixTag, plain };
  const structured =
    mode === "dismiss"
      ? disposition.dismiss_reason ?? null
      : mode === "accept"
        ? disposition.accept_reason ?? null
        : disposition.not_sure_reason ?? null;
  return { tag: structured, plain };
}
