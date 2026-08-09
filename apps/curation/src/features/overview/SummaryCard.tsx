/**
 * The Overview's two layout primitives: a titled card and a
 * label/value row. Extracted from ``OverviewPanel.tsx`` 2026-08-09 so
 * ``DesignSummary`` could leave that file without dragging the panel
 * back in as an import cycle. Behaviour unchanged.
 */
import { HelpPopup } from "@/components/ui/HelpPopup";

export function SummaryCard({
  label,
  children,
  className,
  help,
  helpTitle,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
  /** Optional inline help body rendered behind a `?` popover next to
   *  the card's label. Use for legends (colour meanings, chip
   *  provenance) and short "how to read this card" notes. Each card
   *  is free to skip when there's nothing to explain. */
  help?: React.ReactNode;
  /** Title shown in the popover header + the `?` button tooltip.
   *  Defaults to ``"{label} — legend"``. */
  helpTitle?: string;
}) {
  return (
    <div className={"card p-3" + (className ? " " + className : "")}>
      <div className="text-xs text-slate-500 mb-2 flex items-center gap-1.5">
        <span className="uppercase tracking-wide">{label}</span>
        {help ? (
          <HelpPopup title={helpTitle ?? `${label} — legend`} size="md">
            {help}
          </HelpPopup>
        ) : null}
      </div>
      <dl className="space-y-1">{children}</dl>
    </div>
  );
}

export function KV({
  k,
  v,
  mono,
}: {
  k: string;
  v: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-2 text-xs">
      <dt className="text-slate-500 w-32 shrink-0">{k}</dt>
      <dd
        className={
          mono ? "font-mono text-slate-800 truncate" : "text-slate-800 truncate"
        }
      >
        {v}
      </dd>
    </div>
  );
}

