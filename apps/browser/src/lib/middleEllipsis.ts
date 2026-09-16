/**
 * Shorten a label from the MIDDLE, keeping its head and its tail.
 *
 * 🛑 Tail-truncation — CSS `truncate`, or a plain `slice` + "…" — drops
 * exactly the part that tells two sibling labels apart. The DE tab's
 * treatment factor on GSE239820 shows why: `dextran sulfate sodium
 * delivered for duration 7 days` and `… for duration 5 days` are
 * different levels of the same factor, and capped at 22rem they both
 * render as `dextran sulfate sodium delivered for duratio…`. Two rows
 * claiming to be the same thing is worse than one long row.
 *
 * Returns the string unchanged when it already fits, so short labels
 * cost nothing and never gain an ellipsis.
 */
export function middleEllipsis(s: string, max = 44): string {
  const str = (s ?? "").trim();
  if (max <= 1 || str.length <= max) return str;
  // Favour the head: it carries the subject, and the tail only has to
  // be long enough to separate siblings ("7 days" / "5 days").
  const budget = max - 1;
  const head = Math.ceil(budget * 0.6);
  const tail = budget - head;
  return tail > 0
    ? `${str.slice(0, head).trimEnd()}…${str.slice(str.length - tail).trimStart()}`
    : `${str.slice(0, head).trimEnd()}…`;
}
