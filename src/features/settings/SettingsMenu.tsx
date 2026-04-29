import { useEffect, useRef, useState } from "react";
import { Settings } from "lucide-react";
import { useTheme, type ThemePref } from "./useTheme";

/**
 * Gear icon in the top bar. Opens a small popover with the
 * theme toggle. Currently the only setting; structured so more
 * preferences (default-tab, table density, ...) can slot in
 * without rebuilding the popover scaffolding.
 */
export function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const { pref, setPref } = useTheme();
  const ref = useRef<HTMLDivElement>(null);

  // Click-outside / Esc closes the popover. Standard pattern;
  // mousedown rather than click so we don't fight an in-flight
  // click on a child button.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="btn ghost p-1.5"
        onClick={() => setOpen((v) => !v)}
        title="settings"
        aria-label="settings"
        aria-expanded={open}
      >
        <Settings className="w-4 h-4" />
      </button>

      {open ? (
        <div
          className="absolute right-0 top-full mt-1 w-56 z-30 card shadow-lg p-2 text-xs"
          role="menu"
        >
          <div className="section-h px-1 pb-1">Theme</div>
          <div className="flex flex-col gap-0.5">
            <ThemeOption
              label="Light"
              value="light"
              current={pref}
              onPick={setPref}
            />
            <ThemeOption
              label="Dark"
              value="dark"
              current={pref}
              onPick={setPref}
            />
            <ThemeOption
              label="System"
              value="system"
              current={pref}
              hint="follow OS preference"
              onPick={setPref}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ThemeOption({
  label,
  value,
  current,
  hint,
  onPick,
}: {
  label: string;
  value: ThemePref;
  current: ThemePref;
  hint?: string;
  onPick: (v: ThemePref) => void;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      className={
        "flex items-center justify-between text-left px-2 py-1 rounded " +
        (active
          ? "bg-blue-50 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100"
          : "hover:bg-slate-100 dark:hover:bg-slate-800")
      }
      onClick={() => onPick(value)}
      role="menuitemradio"
      aria-checked={active}
    >
      <span className="flex flex-col">
        <span>{label}</span>
        {hint ? (
          <span className="text-[10px] text-slate-500 dark:text-slate-400">
            {hint}
          </span>
        ) : null}
      </span>
      {active ? <span aria-hidden>✓</span> : null}
    </button>
  );
}
