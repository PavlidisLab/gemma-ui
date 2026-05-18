// In-context help affordance. Small "?" button that opens a tiny
// popover with explanatory copy; also shown on hover via the native
// title attribute for the impatient. Lightweight by design — no
// external popover library, closes on blur. Used inline beside
// section labels, column headers, and any UI element whose meaning
// isn't self-evident from its label alone.

import { useState } from "react";

interface Props {
  /** Short identifier surfaced to assistive tech (aria-label).
   *  Example: "GEEQ quality score". */
  label: string;
  /** Body copy shown inside the popover. Plain text with newlines
   *  preserved (the popover uses ``whitespace-pre-line``). */
  body: string;
}

export function HelpHint({ label, body }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block">
      <button
        type="button"
        aria-label={`Help: ${label}`}
        aria-expanded={open}
        title={body}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onBlur={() => setOpen(false)}
        className="inline-flex items-center justify-center h-3.5 w-3.5 rounded-full border border-gemma-grid text-[9px] font-semibold text-gemma-subtle hover:text-gemma-ink hover:border-gemma-subtle leading-none align-middle"
      >
        ?
      </button>
      {open ? (
        <span
          role="tooltip"
          className="absolute z-30 left-0 top-full mt-1 w-64 max-w-[80vw] rounded border border-gemma-grid bg-white shadow-md px-2.5 py-1.5 text-xs text-gemma-ink whitespace-pre-line"
          onMouseDown={(e) => e.preventDefault()}
        >
          {body}
        </span>
      ) : null}
    </span>
  );
}
