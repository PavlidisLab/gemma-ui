import { cn } from "@/lib/cn";

/**
 * Shared 20×20 status-badge primitive used by every "kind /
 * severity / disposition" indicator across the audit + proposal
 * surfaces. Replaces the four parallel copies of the same shell
 * classes that drifted before (the `w-5 h-5` rounded square with
 * a centered glyph). Per design review's 2026-05-21 audit.
 *
 * Callers supply:
 *   - `glyph`   — the single character to render (e.g. "✓", "≈",
 *                  "+", "✎", "⏸", "·").
 *   - `cls`     — palette utilities for the square's bg / text /
 *                  border. Keep the SAME family of utilities
 *                  (bg-* + text-* + border-* + the `border` class
 *                  itself) so the visual reads consistent.
 *   - `label`   — accessible name (used for both `title` hover and
 *                  `aria-label` so screen readers + sighted curators
 *                  see the same thing).
 *
 * The shell layout (size, font, position) is fixed here so every
 * card's status slot lines up at the same left edge.
 */
export function StatusBadge({
  glyph,
  cls,
  label,
}: {
  glyph: string;
  cls: string;
  label: string;
}) {
  return (
    <span
      className={cn(
        // Bumped from w-5 h-5 / text-[12px] to w-6 h-6 / text-[14px]
        // (design review 2026-05-25: "that ttteeeeeny thing in the box ... lets
        // do better"). The minor-severity variant additionally got a
        // filled bg in its caller config so the glyph reads at the new
        // size — see ``SeverityBadge``.
        "inline-flex items-center justify-center font-bold rounded mt-0.5 shrink-0 w-6 h-6 text-[14px] leading-none",
        cls,
      )}
      title={label}
      aria-label={label}
    >
      <span aria-hidden>{glyph}</span>
    </span>
  );
}
