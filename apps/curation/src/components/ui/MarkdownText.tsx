/**
 * Render prose that might be Markdown.
 *
 * Pairs with `lib/markdown.ts`, which holds the parsing and the reasons
 * for the two places this deliberately departs from CommonMark (single
 * newlines are breaks; `_underscores_` are never emphasis).
 *
 * ## Where Markdown is allowed — a closed list, on purpose
 *
 * *"this contract of where markdown is allowed … be careful. I don't
 * want markdown all over the place."* — the reviewer, 2026-08-17.
 *
 * The app has ~40 surfaces rendering agent- or curator-authored prose.
 * Markdown is sanctioned on **two** of them. `MARKDOWN_SURFACES` in
 * `lib/markdown.ts` is that list, and it arrives here as a REQUIRED
 * prop — so a new surface cannot be added by copying a JSX line. It has
 * to edit the union, which shows up in a diff and in
 * `markdown.test.ts`.
 *
 * The two, and why each earned it:
 *
 * - **`ticket-body`** — the agents side authors these as documents:
 *   headings, severity tables, cited paths. The syntax was rendering
 *   raw on the detail page.
 * - **`review-focus`** — the per-experiment guidance panel
 *   (`summary.headline` + `summary.key_findings`, produced by the
 *   agents side's `annotate_review_summaries.py`). Same author, same
 *   habits: `**bold**`, `` `factor names` ``, and `* ` sub-bullets
 *   carrying the gold-vs-agent correspondence.
 *
 * Everything else stays plain: finding rationale, boss-critic verdicts,
 * proposal reasoning, dismiss reasons, GEO description. Two reasons,
 * and the first is the one that matters — **short agent prose is read
 * as a claim, not as a document**, and formatting it invites the author
 * to decorate an assertion the curator has to weigh. The second is
 * mechanical: `rationaleText.ts::firstBacktick()` already treats the
 * first `` `token` `` in a rationale as that finding's LABEL, so a
 * Markdown pass over rationale would have to run after it, not before.
 *
 * Adding a third is a decision. Take it deliberately, and say why here.
 *
 * ## Why this exists rather than a library
 *
 * There is no Markdown dependency in either app, and `node_modules` is
 * a named Docker volume — adding one is a rebuild for every dev, for a
 * feature whose whole job is "make `**bold**` bold". Against that: the
 * subset the agents side actually writes is small and closed, and this
 * emits React elements rather than HTML, so it never touches
 * `dangerouslySetInnerHTML`. The one occurrence of that in the codebase
 * (`CuriePopover.sanitizeDefinitionHtml`) exists because CHEBI serves
 * HTML; nothing here does. Revisit if Markdown spreads to surfaces
 * needing footnotes, nested lists, or embedded HTML.
 *
 * ## Sizing
 *
 * Inherits its type scale from the caller — a ticket detail page and a
 * card preview want different sizes, and a component that fixed one
 * would be wrong in the other. Only structure and weight are set here.
 */
import type { JSX } from "react";
import { cn } from "@/lib/cn";
import {
  parseInline,
  parseMarkdown,
  type Align,
  type Block,
  type InlineNode,
  type MarkdownSurface,
} from "@/lib/markdown";

function renderInline(nodes: InlineNode[], keyPrefix: string): JSX.Element[] {
  return nodes.map((n, i) => {
    const key = `${keyPrefix}-${i}`;
    switch (n.kind) {
      case "text":
        return <span key={key}>{n.text}</span>;
      case "break":
        return <br key={key} />;
      case "code":
        return (
          // Padding in `em`, and small: these notes are dense with
          // code spans (paths, version stamps, category names) and they
          // are usually followed by a comma or a full stop. At `px-1`
          // the background pushes the punctuation visibly off the
          // token — "`…panel100_v3` , reviewed" — which reads as a typo
          // in the note rather than as styling.
          <code
            key={key}
            className="rounded bg-slate-100 px-[0.25em] font-mono text-[0.9em] text-slate-800 dark:bg-slate-700/70 dark:text-slate-100"
          >
            {n.text}
          </code>
        );
      case "strong":
        return (
          <strong key={key} className="font-semibold">
            {renderInline(n.children, key)}
          </strong>
        );
      case "em":
        return (
          <em key={key} className="italic">
            {renderInline(n.children, key)}
          </em>
        );
      case "link":
        return (
          <a
            key={key}
            href={n.href}
            // Ticket notes cite handoffs and external trackers. Open
            // off-app targets in a new tab so a curator mid-review does
            // not lose an uncommitted draft to a navigation.
            {...(n.href.startsWith("#") || n.href.startsWith("/")
              ? {}
              : { target: "_blank", rel: "noopener noreferrer" })}
            className="text-blue-600 underline underline-offset-2 hover:text-blue-700 dark:text-blue-300 dark:hover:text-blue-200"
          >
            {renderInline(n.children, key)}
          </a>
        );
    }
  });
}

/**
 * Inline-only Markdown — code spans, emphasis, links, no block
 * structure at all.
 *
 * NOT a new `MARKDOWN_SURFACE`, deliberately. That union gates the
 * BLOCK renderer over prose someone ELSE authored, where offering
 * headings and tables invites the author to decorate a claim. This
 * renders one string of our own in-repo copy — `lib/guidelines.ts`,
 * whose backticked shapes and URIs were reaching the popover as
 * literal backtick characters.
 *
 * A caller that wants headings or lists wants `<MarkdownText/>` and a
 * decision about the union, not this.
 */
export function InlineMarkdown({
  text,
  className,
}: {
  text: string;
  className?: string;
}): JSX.Element {
  return <span className={className}>{renderInline(parseInline(text), "il")}</span>;
}

const ALIGN_CLASS: Record<Exclude<Align, null>, string> = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

function alignClass(align: Align): string {
  return align ? ALIGN_CLASS[align] : "";
}

function renderBlock(b: Block, key: string): JSX.Element {
  switch (b.kind) {
    case "paragraph":
      return <p key={key}>{renderInline(b.content, key)}</p>;

    case "heading": {
      // One step of scale per level, capped — a note is not a document,
      // and an `#` in a ticket body should not out-shout the page's own
      // heading.
      const size =
        b.level <= 1
          ? "text-[1.15em]"
          : b.level === 2
            ? "text-[1.08em]"
            : "text-[1em]";
      return (
        <p key={key} className={cn("font-semibold text-slate-900 dark:text-slate-100", size)}>
          {renderInline(b.content, key)}
        </p>
      );
    }

    case "list":
      return b.ordered ? (
        <ol key={key} start={b.start} className="list-decimal pl-5 space-y-0.5">
          {b.items.map((it, i) => (
            <li key={`${key}-${i}`}>{renderInline(it.content, `${key}-${i}`)}</li>
          ))}
        </ol>
      ) : (
        <ul key={key} className="list-disc pl-5 space-y-0.5">
          {b.items.map((it, i) => (
            <li key={`${key}-${i}`}>{renderInline(it.content, `${key}-${i}`)}</li>
          ))}
        </ul>
      );

    case "quote":
      return (
        <blockquote
          key={key}
          className="border-l-2 border-slate-300 pl-3 text-slate-600 dark:border-slate-600 dark:text-slate-400"
        >
          {renderInline(b.content, key)}
        </blockquote>
      );

    case "code_block":
      return (
        <pre
          key={key}
          className="overflow-x-auto rounded bg-slate-100 p-2 font-mono text-[0.9em] text-slate-800 dark:bg-slate-800 dark:text-slate-100"
        >
          {b.text}
        </pre>
      );

    case "hr":
      return <hr key={key} className="border-slate-200 dark:border-slate-700" />;

    case "table":
      return (
        // Its own scroll container: a note's table is wider than the
        // column it sits in more often than not, and the page body must
        // never scroll sideways because of one.
        <div key={key} className="overflow-x-auto">
          <table className="w-full border-collapse">
            {b.header ? (
              <thead>
                <tr className="border-b border-slate-300 dark:border-slate-600">
                  {b.header.map((cell, i) => (
                    <th
                      key={`${key}-h-${i}`}
                      className={cn(
                        "px-2 py-1 font-semibold align-top",
                        alignClass(b.align[i] ?? null),
                      )}
                    >
                      {renderInline(cell, `${key}-h-${i}`)}
                    </th>
                  ))}
                </tr>
              </thead>
            ) : null}
            <tbody>
              {b.rows.map((row, r) => (
                <tr
                  key={`${key}-r-${r}`}
                  className="border-b border-slate-200 last:border-0 dark:border-slate-700"
                >
                  {row.map((cell, c) => (
                    <td
                      key={`${key}-r-${r}-${c}`}
                      className={cn("px-2 py-1 align-top", alignClass(b.align[c] ?? null))}
                    >
                      {renderInline(cell, `${key}-r-${r}-${c}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

export function MarkdownText({
  text,
  className,
}: {
  text: string | null | undefined;
  className?: string;
  /** Which sanctioned surface this is. Required so that turning on
   *  Markdown somewhere new is a typed change, not a copied line. */
  surface: MarkdownSurface;
}): JSX.Element | null {
  const src = (text ?? "").trim();
  if (!src) return null;
  const blocks = parseMarkdown(src);
  return (
    // `space-y-2` is the only thing standing in for blank lines between
    // blocks; the source's own newlines are consumed by the parser.
    <div className={cn("space-y-2", className)}>
      {blocks.map((b, i) => renderBlock(b, `b${i}`))}
    </div>
  );
}
