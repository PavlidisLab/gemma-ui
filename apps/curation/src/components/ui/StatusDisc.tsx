/**
 * Compact status disc used in member-row lists (set navigator popover,
 * sets sidebar, ticket queues, …) and beside an annotation that can
 * account for itself.
 *
 * Generic by design — the disc only knows about the visual **tones**;
 * mapping a domain's state machine onto those tones is the caller's
 * job. That keeps the same glyph usable for curation reviews
 * (untouched / draft / uncommitted / done), ticket queues (todo /
 * in-progress / blocked / done), or any other small lifecycle without
 * each call site rolling its own SVG.
 *
 * Visual encoding (per design review 2026-05-25 — color carries the urgency
 * axis, fill carries the progress axis):
 *
 *   ○ slate-400   "untouched"   — outlined ring, no fill
 *   ● slate-500   "neutral"      — full disc, no colour claim
 *   ◐ sky-500     "draft"        — half-filled (left), in-motion calm
 *   ● amber-500   "uncommitted"  — full disc, warns of pending save
 *   ● emerald-500 "done"         — full disc, settled
 *
 * The filled tones differentiate by colour alone, not by fill
 * orientation — color contrast is sharper than a 9px fill
 * difference, and there's no half-disc to draw twice.
 *
 * `neutral` exists because a hollow slate ring is the faintest thing
 * this file can draw, and two unrelated states were sharing it: "no
 * colour applies here" and "nothing has happened yet". A settled fact
 * that simply doesn't sit on the colour axis — the provenance disc on
 * an imported annotation — is not "untouched", and at 9px the ring was
 * missed entirely on a dense page.
 */
import type { CSSProperties } from "react";
import { cn } from "@/lib/cn";

export type StatusDiscTone =
  | "untouched"
  | "neutral"
  | "draft"
  | "uncommitted"
  | "done";

interface ToneConfig {
  /** Tailwind text-color class — drives both stroke + fill via
   *  ``currentColor`` so dark mode and theming flow through one
   *  variable. */
  tone: string;
  /** ``"open"`` = outlined ring, no fill;
   *  ``"half"`` = left semicircle filled, outline ring intact;
   *  ``"full"`` = filled disc. */
  shape: "open" | "half" | "full";
  defaultTitle: string;
}

const TONE_CONFIG: Record<StatusDiscTone, ToneConfig> = {
  untouched: {
    tone: "text-slate-400 dark:text-slate-500",
    shape: "open",
    defaultTitle: "untouched",
  },
  neutral: {
    tone: "text-slate-500 dark:text-slate-300",
    shape: "full",
    defaultTitle: "recorded",
  },
  draft: {
    tone: "text-sky-500 dark:text-sky-400",
    shape: "half",
    defaultTitle: "in progress",
  },
  uncommitted: {
    tone: "text-amber-500 dark:text-amber-400",
    shape: "full",
    defaultTitle: "uncommitted changes",
  },
  done: {
    tone: "text-emerald-600 dark:text-emerald-400",
    shape: "full",
    defaultTitle: "done",
  },
};

export function StatusDisc({
  tone,
  title,
  size = 9,
  className,
  style,
}: {
  tone: StatusDiscTone;
  /** Override the default hover tooltip. Recommended — domains have
   *  more specific copy ("review closed" vs "ticket done") than the
   *  primitive can guess. */
  title?: string;
  /** Pixel size of the SVG. Default matches the audit-status glyph
   *  it replaced (9px). */
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const config = TONE_CONFIG[tone];
  const label = title ?? config.defaultTitle;
  // Use ``r=4`` inside a ``viewBox 10 10`` so the 1px stroke stays
  // visible without the disc filling the box edges.
  return (
    <span
      title={label}
      aria-label={label}
      className={cn("inline-flex shrink-0", config.tone, className)}
      style={style}
    >
      <svg width={size} height={size} viewBox="0 0 10 10" role="img">
        <circle
          cx="5"
          cy="5"
          r="4"
          fill={config.shape === "full" ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="1"
        />
        {config.shape === "half" ? (
          // Left semicircle fill. The outline ring above keeps the
          // right half visible against light + dark backgrounds.
          <path d="M 5 1 A 4 4 0 0 0 5 9 Z" fill="currentColor" />
        ) : null}
      </svg>
    </span>
  );
}
