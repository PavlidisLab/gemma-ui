// Tells a signed-in viewer who else can see something. "restricted"
// marks anything a regular visitor does not see — a private dataset, a
// curator-only filter row, an admin-only tab.
//
// Two shapes. The default is a small rose eye-off glyph with the
// explanation in its tooltip: it sits beside nav tabs, facet rows and
// footer links, where a worded chip took more room than the thing it
// marked. `variant="chip"` is the worded rose / emerald chip, for where
// the visibility IS the information — the dataset page's Public /
// Private. The label is still in the DOM as screen-reader text either
// way.

import { EyeOff } from "lucide-react";

interface Props {
  tone: "public" | "restricted";
  label: string;
  title: string;
  variant?: "icon" | "chip";
}

export function VisibilityChip({ tone, label, title, variant = "icon" }: Props) {
  if (variant === "icon") {
    return (
      <span
        title={title}
        className={
          "inline-flex items-center self-center shrink-0 " +
          (tone === "public"
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-rose-500 dark:text-rose-400")
        }
      >
        <EyeOff className="h-3 w-3" aria-hidden />
        <span className="sr-only">{label}</span>
      </span>
    );
  }
  return (
    <span
      title={title}
      className={
        "text-[10px] px-1.5 py-0.5 rounded border font-mono self-center shrink-0 " +
        (tone === "public"
          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
          : "bg-rose-50 text-rose-700 border-rose-300")
      }
    >
      {label}
    </span>
  );
}
