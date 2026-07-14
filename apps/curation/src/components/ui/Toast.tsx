import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * Minimal toast — a brief banner that appears at the bottom of the
 * viewport, auto-dismisses, and can be programmatically shown from
 * anywhere via the ``useToast`` hook. Used today only for the
 * apply-confirmation summary on the v2 ProposalCard ("2 factors
 * created · 4 FVs · 40 samples assigned"). Curator's review card
 * unmounts when the proposal leaves ``pending``, so we need a
 * survivor.
 *
 * Tone variants reuse the existing slate / emerald / amber / rose
 * palette so the visual stays consistent with the rest of the app.
 */
export type ToastTone = "info" | "success" | "warn" | "danger";

interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

export interface ToastContextValue {
  show: (message: string, tone?: ToastTone, durationMs?: number) => void;
}

// Exported for render-time tests so a stub ``show`` can be threaded
// in without booting the full ``ToastProvider``.
export const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const show = useCallback(
    (message: string, tone: ToastTone = "info", durationMs = 4500) => {
      const id = nextId.current++;
      setToasts((prev) => [...prev, { id, message, tone }]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, durationMs);
    },
    [],
  );

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={
        (id) => setToasts((prev) => prev.filter((t) => t.id !== id))
      } />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Fail soft — components that mount outside the provider get a
    // no-op so the call site doesn't have to null-check.
    return { show: () => undefined };
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Internal viewport
// ---------------------------------------------------------------------------

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  // Render to the document directly so we don't get clipped by an
  // ancestor's overflow:hidden. Top-right column so the curator's
  // attention is drawn there for celebratory / failure messages
  // (matches the CommitBar's home now). ``z-50`` puts toasts above
  // the CommitBar (z-30) on the rare case both want the same
  // pixels — overlap is brief because toasts auto-dismiss.
  // ``pointer-events-none`` lets clicks fall through except on the
  // toast pills themselves.
  if (toasts.length === 0) return null;
  return (
    <div
      className="fixed top-2 right-2 flex flex-col items-end gap-2 z-50 pointer-events-none"
      role="status"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <ToastChip key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastChip({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: () => void;
}) {
  // Slide-up entrance for visual continuity with the click that
  // produced it. Tailwind's ``animate-*`` is a one-line affordance
  // we already have, no plugin needed.
  const palette: Record<ToastTone, string> = {
    info: "bg-slate-800 text-slate-50 border-slate-700",
    success: "bg-emerald-700 text-emerald-50 border-emerald-600",
    warn: "bg-amber-700 text-amber-50 border-amber-600",
    danger: "bg-rose-700 text-rose-50 border-rose-600",
  };

  // Auto-fade after a beat, in addition to the timed removal in the
  // provider. Belt-and-braces; means the toast is visible the whole
  // time and just disappears at the end.
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const t = window.setTimeout(() => setVisible(false), 4200);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div
      className={
        "pointer-events-auto px-3 py-1.5 rounded-md shadow-md border text-xs " +
        "flex items-center gap-3 max-w-2xl transition-opacity duration-300 " +
        palette[toast.tone] + (visible ? " opacity-100" : " opacity-0")
      }
    >
      <span className="whitespace-pre-wrap">{toast.message}</span>
      <button
        type="button"
        onClick={onDismiss}
        className="text-current/70 hover:text-current text-[11px] font-semibold opacity-70 hover:opacity-100"
        aria-label="dismiss"
      >
        ×
      </button>
    </div>
  );
}
