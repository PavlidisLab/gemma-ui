import { useEffect, useRef, useState } from "react";
import { useIsReadOnly } from "@/features/comparison/FlowContext";
import { cn } from "@/lib/cn";

/**
 * Double-click-to-edit text. Renders as a span until double-clicked
 * (or focused + Enter / Space); becomes an `<input>` that commits on
 * blur / Enter and reverts on Escape.
 *
 * Single-click is intentionally a no-op so the wrapping row / chip
 * can keep its single-click semantics (selection, navigation). The
 * hover background and the "double-click to edit" tooltip are the
 * affordance.
 */
export function InlineText({
  value,
  onCommit,
  placeholder,
  className,
  dirty,
}: {
  value: string;
  onCommit: (next: string) => void;
  placeholder?: string;
  className?: string;
  /** When true, the cell shows a subtle blue ring + dot to mark
   *  uncommitted-vs-saved drift. Display-only — the parent decides
   *  what "dirty" means (here: draft.characteristics differs from
   *  the server-saved value). */
  dirty?: boolean;
}) {
  // Review-mode lock: ``<span role="button">`` bypasses ``fieldset
  // disabled`` — gate the double-click affordance directly so the
  // curator can read the value but not open the editor.
  const readOnly = useIsReadOnly();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [editing, value]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== value) onCommit(draft);
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        placeholder={placeholder}
        className={cn(
          "border border-blue-300 rounded px-1 py-0 text-sm bg-white",
          className,
        )}
      />
    );
  }

  return (
    <span
      role={readOnly ? undefined : "button"}
      tabIndex={readOnly ? undefined : 0}
      onDoubleClick={readOnly ? undefined : () => setEditing(true)}
      onKeyDown={
        readOnly
          ? undefined
          : (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setEditing(true);
              }
            }
      }
      className={cn(
        readOnly ? "rounded px-1 -mx-1 select-text" : "cursor-text hover:bg-blue-50 rounded px-1 -mx-1 select-none",
        !value && "text-slate-400 italic",
        dirty && "ring-1 ring-blue-300 bg-blue-50/70",
        className,
      )}
      title={
        readOnly
          ? undefined
          : dirty
            ? "uncommitted edit · double-click to edit"
            : "double-click to edit"
      }
    >
      {value || placeholder || "(empty)"}
      {dirty ? (
        <span
          aria-hidden
          className="ml-1 text-[10px] text-blue-500 align-baseline"
        >
          •
        </span>
      ) : null}
    </span>
  );
}
