/**
 * Tiny inline spinner for buttons mid-mutation.
 *
 * Border-trick spinner — one rounded element with a transparent top
 * border. Inherits ``currentColor`` from its parent so a button
 * styled in slate / amber / emerald gets a matching ring without
 * configuration. ``size`` defaults to 12px (3 in Tailwind units),
 * which lines up with text-[11px] / text-xs button copy.
 */
export function Spinner({
  size = 12,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span
      role="status"
      aria-label="loading"
      style={{ width: size, height: size, borderWidth: Math.max(1, Math.round(size / 6)) }}
      className={
        "inline-block rounded-full border-current border-t-transparent animate-spin shrink-0 " +
        className
      }
    />
  );
}
