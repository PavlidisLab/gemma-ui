import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

/**
 * Like ``InlineText`` but the editor is a picker over a fixed set of
 * factor-value labels — used for characteristic cells whose key
 * matches a categorical Factor, so the curator can't mistype the
 * canonical FV label. The "(custom…)" option flips the editor into
 * free-text input for the rare case where the curator wants to
 * record a value that isn't already an FV.
 *
 * Display behaviour mirrors InlineText (double-click / Enter / Space
 * to start editing, blur / Enter to commit, Escape to revert) so the
 * cell-edit UX stays consistent across char keys.
 */
export function InlineFvPicker({
  value,
  options,
  onCommit,
  placeholder,
  className,
  dirty,
}: {
  value: string;
  /** FV labels for the matching factor — these are the picker's
   *  options. The current value is always shown; if it isn't in
   *  this list it gets prepended as "(current) <value>" so we
   *  don't silently lose data. */
  options: string[];
  onCommit: (next: string) => void;
  placeholder?: string;
  className?: string;
  /** Subtle blue ring + dot when the cell's value differs from the
   *  saved baseline. Display-only. */
  dirty?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  // When the curator picks "(custom…)" we flip the same edit
  // session into free-text input — no need to close + re-open.
  const [freeText, setFreeText] = useState(false);
  const [draft, setDraft] = useState(value);
  const selectRef = useRef<HTMLSelectElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) {
      setDraft(value);
      setFreeText(false);
    }
  }, [editing, value]);

  useEffect(() => {
    if (editing && !freeText && selectRef.current) {
      selectRef.current.focus();
    }
    if (editing && freeText && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing, freeText]);

  const inOptions = options.includes(value);
  const optionList = inOptions || !value ? options : [value, ...options];

  if (editing && freeText) {
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

  if (editing) {
    return (
      <select
        ref={selectRef}
        value={inOptions ? value : value || ""}
        onChange={(e) => {
          const next = e.target.value;
          if (next === "__custom__") {
            setFreeText(true);
            return;
          }
          if (next !== value) onCommit(next);
          setEditing(false);
        }}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setEditing(false);
        }}
        className={cn(
          "border border-blue-300 rounded px-1 py-0 text-sm bg-white max-w-[16rem]",
          className,
        )}
      >
        {!value ? <option value="">(empty)</option> : null}
        {optionList.map((label) => (
          <option key={label} value={label}>
            {!inOptions && label === value ? `(current) ${label}` : label}
          </option>
        ))}
        <option value="__custom__">(custom…)</option>
      </select>
    );
  }

  return (
    <span
      role="button"
      tabIndex={0}
      onDoubleClick={() => setEditing(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setEditing(true);
        }
      }}
      className={cn(
        "cursor-pointer hover:bg-blue-50 rounded px-1 -mx-1 select-none",
        !value && "text-slate-400 italic",
        dirty && "ring-1 ring-blue-300 bg-blue-50/70",
        className,
      )}
      title={
        dirty
          ? "uncommitted edit · double-click to pick a factor value"
          : "double-click to pick a factor value"
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
