import type { ReactNode } from "react";
import { HelpPopup } from "./HelpPopup";
import { InlineMarkdown } from "./MarkdownText";
import { cn } from "@/lib/cn";
import type { GuidelineSnippet } from "@/lib/guidelines";

/**
 * `<HelpPopup/>` filled in from a `GuidelineSnippet`. Renders bullets,
 * examples, and "don't" rules with consistent styling.
 * Use this everywhere a curator might want a quick refresher on the
 * rule for the surface they're looking at.
 */
export function GuidelinePopup({
  snippet,
  size = "md",
  align = "left",
}: {
  snippet: GuidelineSnippet;
  size?: "sm" | "md" | "lg";
  align?: "left" | "right";
}) {
  return (
    <HelpPopup
      title={snippet.title}
      source={snippet.source}
      sourceUrl={snippet.sourceUrl}
      size={size}
      align={align}
    >
      <GuidelineSnippetBody snippet={snippet} />
    </HelpPopup>
  );
}

/** A 🛑 at the head of a bullet marks a rule the rest of the snippet
 *  hangs off. Only at the head — several bullets carry one mid-text to
 *  flag a trap inside a longer explanation, and those stay inline. */
function isRule(bullet: string): boolean {
  return bullet.trimStart().startsWith("🛑");
}

/** Most catalogue bullets open with a short label — "Genotype:",
 *  "DEA subsetting axis:" — and the rest of the line is the shape and
 *  its caveat. Setting the label apart turns the list into something a
 *  curator scans for their own situation instead of reading through.
 *
 *  Conservative on purpose: no label when the line opens with a code
 *  span (the predicate list, where the term itself is the anchor), and
 *  none when the prefix has already run to a sentence. */
function splitLabel(text: string): { label: string | null; rest: string } {
  if (text.startsWith("`")) return { label: null, rest: text };
  const at = text.indexOf(": ");
  if (at < 0 || at > 48) return { label: null, rest: text };
  const head = text.slice(0, at);
  if (/[.!?`]/.test(head)) return { label: null, rest: text };
  return { label: head, rest: text.slice(at + 2) };
}

/** Small uppercase section heading, matching the app's convention. */
function SectionLabel({
  children,
  tone = "normal",
}: {
  children: ReactNode;
  tone?: "normal" | "warn";
}) {
  return (
    <div
      className={cn(
        "text-[10px] uppercase tracking-wide font-semibold",
        tone === "warn"
          ? "text-rose-700 dark:text-rose-300"
          : "text-slate-500 dark:text-slate-400",
      )}
    >
      {children}
    </div>
  );
}

/** A list row with a hanging indent: the marker sits in its own column
 *  so wrapped lines align under the text rather than under the bullet.
 *  `list-inside` put every continuation flush against the left edge,
 *  which is most of what made these snippets read as one block. */
function Row({
  marker,
  markerClass,
  children,
}: {
  marker: string;
  markerClass?: string;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-1.5">
      <span
        aria-hidden
        className={cn("select-none shrink-0", markerClass ?? "text-slate-300 dark:text-slate-600")}
      >
        {marker}
      </span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}

/** One catalogue bullet: its label, then the rest of the line. */
function BulletRow({ text }: { text: string }) {
  const { label, rest } = splitLabel(text);
  return (
    <Row marker="•">
      {label ? (
        <strong className="font-semibold text-slate-800 dark:text-slate-100">
          {label}:{" "}
        </strong>
      ) : null}
      <InlineMarkdown text={rest} />
    </Row>
  );
}

/**
 * Just the BODY of a snippet — rules, bullets, examples, "don't"
 * rules — with no popover around it.
 *
 * Split out so a surface that already owns a panel can render a
 * snippet inside it instead of opening a second one on top. The
 * guidelines menu does exactly that: it drills down in place rather
 * than stacking a popover over its own list.
 *
 * ## Why the parts look different from each other
 *
 * These snippets are reference material a curator opens mid-compose,
 * not prose to read start to finish, and they had grown to seventeen
 * paragraph-length bullets in one undifferentiated disc list. Four
 * things carry the structure that the text already had:
 *
 * - **Inline Markdown.** Every shape, URI and predicate in
 *   `guidelines.ts` is already backticked at the source; it was
 *   rendering as literal backtick characters. Code spans give each
 *   bullet an anchor the eye can find.
 * - **🛑 bullets become callouts**, in place — the order is the
 *   author's and reordering it would be editing the rule.
 * - **Hanging indents**, so a wrapped line stays inside its bullet.
 * - **Named sections** for examples and don'ts, so a curator looking
 *   for one of them is not reading the rules again to get there.
 */
export function GuidelineSnippetBody({
  snippet,
}: {
  snippet: GuidelineSnippet;
}) {
  return (
    <div className="space-y-2.5 leading-relaxed">
      {snippet.bullets.length ? (
        <ul className="space-y-1.5">
          {snippet.bullets.map((b, i) =>
            isRule(b) ? (
              <li
                key={i}
                className="rounded-r border-l-2 border-amber-400 bg-amber-50/70 px-2 py-1 text-slate-800 dark:border-amber-500 dark:bg-amber-900/20 dark:text-slate-100"
              >
                <InlineMarkdown text={b.trimStart().replace(/^🛑\s*/, "")} />
              </li>
            ) : (
              <BulletRow key={i} text={b} />
            ),
          )}
        </ul>
      ) : null}

      {snippet.examples?.length ? (
        <div className="space-y-1">
          <SectionLabel>Examples</SectionLabel>
          <div className="space-y-0.5">
            {snippet.examples.map((e, i) => (
              <code
                key={i}
                className="block font-mono text-[11px] text-slate-700 bg-slate-50 rounded px-1.5 py-0.5 dark:bg-slate-700/50 dark:text-slate-200"
              >
                {e}
              </code>
            ))}
          </div>
        </div>
      ) : null}

      {snippet.donts?.length ? (
        <div className="space-y-1">
          <SectionLabel tone="warn">Don't</SectionLabel>
          <ul className="space-y-1 text-rose-800 dark:text-rose-200">
            {snippet.donts.map((b, i) => (
              <Row
                key={i}
                marker="×"
                markerClass="text-rose-400 dark:text-rose-500"
              >
                <InlineMarkdown text={b} />
              </Row>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
