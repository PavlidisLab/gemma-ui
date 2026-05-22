import { cn } from "@/lib/cn";

/**
 * Shared 20×20 status-badge primitive used by every "kind /
 * severity / disposition" indicator across the audit + proposal
 * surfaces. Replaces the four parallel copies of the same shell
 * classes that drifted before (the `w-5 h-5` rounded square with
 * a centered glyph). Per Paul's 2026-05-21 audit.
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
        "inline-flex items-center justify-center font-bold rounded mt-0.5 shrink-0 w-5 h-5 text-[12px] leading-none",
        cls,
      )}
      title={label}
      aria-label={label}
    >
      <span aria-hidden>{glyph}</span>
    </span>
  );
}
