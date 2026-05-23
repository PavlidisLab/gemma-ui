import { useEffect, useRef, useState } from "react";
import { SKINS, useSkin, type SkinId } from "./SkinProvider";

/**
 * Compact skin picker. Drop it anywhere — usually the AppBar.
 *
 * Trigger reads "Skin: <label>". Clicking opens a small popover
 * listing the registered skins with their taglines; selecting one
 * applies the skin, closes the popover, and persists the choice.
 * Outside click + Esc dismiss.
 */
export function SkinSwitcher() {
  const { skin, setSkin } = useSkin();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = SKINS.find((s) => s.id === skin) ?? SKINS[0];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="switch skin"
        className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-gemma-grid bg-surface text-gemma-ink hover:border-gemma-accent"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-gemma-accent" />
        <span className="font-mono">skin: {current.label}</span>
        <span className="text-gemma-subtle">{open ? "▾" : "▸"}</span>
      </button>
      {open ? (
        <div className="absolute right-0 top-full mt-1 z-50 w-56 rounded border border-gemma-grid bg-surface shadow-lg text-sm overflow-hidden">
          <div className="px-2.5 py-1 text-[10px] uppercase tracking-wide text-gemma-subtle border-b border-gemma-grid bg-surface-sunk">
            Skin
          </div>
          {SKINS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                setSkin(s.id as SkinId);
                setOpen(false);
              }}
              className={
                "w-full text-left px-2.5 py-1.5 hover:bg-surface-alt border-b border-gemma-grid last:border-b-0 flex items-baseline gap-2 " +
                (s.id === skin ? "bg-surface-alt" : "")
              }
            >
              <span className="font-medium text-gemma-ink shrink-0">
                {s.label}
              </span>
              <span className="text-[11px] text-gemma-subtle truncate">
                {s.tagline}
              </span>
              {s.id === skin ? (
                <span className="ml-auto text-[10px] text-gemma-accent font-mono shrink-0">
                  active
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
