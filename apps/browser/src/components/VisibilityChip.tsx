// Tells a signed-in viewer who else can see something. "restricted" is
// the rose chip the dataset page first used for Private; it marks
// anything a regular visitor does not see — a private dataset, a
// curator-only filter row, an admin-only tab.

interface Props {
  tone: "public" | "restricted";
  label: string;
  title: string;
}

export function VisibilityChip({ tone, label, title }: Props) {
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
