/**
 * One `label … n (pct)` row inside a section card's table.
 *
 * Checked before writing it: the page has `SectionCard`, `BigNumber`,
 * `Sparkline`, `HealthDot` and `ConfirmButton`, and none of them is a
 * table row. Every section that shows a breakdown (Tickets, Indices,
 * Ontologies, Sessions) hand-rolls the same
 * `px-2 py-1 text-right tabular-nums` cell, and three new cards
 * wanting a fourth and fifth copy is where that stops being fine — so
 * this is the shared one, and those sections can adopt it whenever
 * someone is in them next.
 *
 * The share-of-total is the reason it exists rather than a plain
 * `<tr>`: "2,146 not public" means nothing without "of 25,695", and a
 * reader should never have to divide two numbers on a monitoring page.
 */

export type CountTone = "warn";

/** Share of a total, as a percentage string. Returns `null` when there
 *  is no total to divide by — a "0%" and a "we don't know" must not
 *  render the same. */
export function pct(n: number, of: number | undefined): string | null {
  if (!of || of <= 0 || !Number.isFinite(n)) return null;
  const share = (n / of) * 100;
  if (share > 0 && share < 0.1) return "<0.1%";
  return `${share.toFixed(share < 10 ? 1 : 0)}%`;
}

export interface CountRowProps {
  label: string;
  /** `null` renders an em dash — the number could not be obtained,
   *  which must not look like the number being zero. */
  n: number | null;
  /** Denominator for the share column. Omit for a bare count. */
  of?: number;
  /** `warn` tints the number amber — for a count whose being non-zero
   *  is itself the signal (troubled, needs attention). */
  tone?: CountTone;
  /** Hover text. Use it to say what the underlying filter is; the
   *  labels are short by design and the filter is the real answer to
   *  "what am I looking at". */
  title?: string;
}

export function CountRow({ label, n, of, tone, title }: CountRowProps) {
  const share = n === null ? null : pct(n, of);
  return (
    <tr
      className="border-t border-slate-100 dark:border-slate-700"
      title={title}
    >
      <td className="px-2 py-1 text-slate-600 dark:text-slate-300">{label}</td>
      <td
        className={
          "px-2 py-1 text-right tabular-nums font-medium " +
          (n === null
            ? "text-slate-400 dark:text-slate-500"
            : tone === "warn"
              ? "text-amber-700 dark:text-amber-300"
              : "text-slate-900 dark:text-slate-100")
        }
        title={n === null ? "not available on this Gemma build" : undefined}
      >
        {n === null ? "—" : n.toLocaleString()}
      </td>
      <td className="px-2 py-1 text-right tabular-nums text-slate-400 dark:text-slate-500 w-12">
        {share ?? ""}
      </td>
    </tr>
  );
}
