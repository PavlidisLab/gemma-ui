/**
 * A small Markdown reader for prose that MIGHT be Markdown.
 *
 * The agents side writes ticket notes in Markdown — bold, code spans,
 * and pipe tables — and they were rendering as raw syntax. Curators
 * also write these notes by hand, in plain text, and always will.
 *
 * So the contract is: **support Markdown, never require it.** Text with
 * no markers must come out looking exactly as it does today. Every rule
 * below is chosen to make that true, and two of them differ from
 * CommonMark deliberately:
 *
 * 1. **A single newline is a line break, not a space.** CommonMark joins
 *    the lines of a paragraph and reflows them. That would silently
 *    re-wrap every hand-written note in the app — a curator who typed
 *    three lines would get one. GitHub comments make the same choice for
 *    the same reason. It also costs nothing for real Markdown: the
 *    agents side hard-wraps at 80 columns, which is where its breaks
 *    already are.
 *
 * 2. **`_underscores_` are never emphasis.** This codebase is made of
 *    snake_case: `gold_data_version`, `EFO_0000727`, `strict_consensus`,
 *    `2026-08-17_panel100_v3`. Treating `_` as an emphasis marker would
 *    quietly italicize identifiers and eat the underscores — corrupting
 *    the exact tokens a curator needs to read verbatim. `*` alone marks
 *    emphasis here. `__bold__` is likewise ignored.
 *
 * Everything is parsed to plain data; {@link MarkdownText} turns it into
 * React elements. Nothing here produces HTML, so there is no
 * `dangerouslySetInnerHTML` and no sanitizer to keep correct — the only
 * injection surface left is link targets, handled by {@link safeHref}.
 *
 * Unsupported syntax degrades to its own source text rather than
 * vanishing. A note is a curator's instructions; losing a line because
 * the parser did not recognise it is worse than showing the markers.
 */

export type Align = "left" | "right" | "center" | null;

export type InlineNode =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "break" }
  | { kind: "strong"; children: InlineNode[] }
  | { kind: "em"; children: InlineNode[] }
  | { kind: "link"; href: string; children: InlineNode[] };

export interface ListItem {
  content: InlineNode[];
}

export type Block =
  | { kind: "paragraph"; content: InlineNode[] }
  | { kind: "heading"; level: number; content: InlineNode[] }
  | { kind: "list"; ordered: boolean; start: number; items: ListItem[] }
  | { kind: "quote"; content: InlineNode[] }
  | { kind: "code_block"; text: string }
  | { kind: "hr" }
  | {
      kind: "table";
      /** Null when every header cell is blank — the agents side emits
       *  `| | | |` as a header when the columns need no names, and an
       *  empty header row renders as a stripe of nothing. */
      header: InlineNode[][] | null;
      align: Align[];
      rows: InlineNode[][][];
    };

/* ------------------------------------------------------------------ */
/* links                                                               */
/* ------------------------------------------------------------------ */

/**
 * The one place untrusted text becomes something clickable.
 *
 * Allows http(s), mailto, and in-app targets (`#/tickets/177`, `/foo`).
 * Everything else — `javascript:`, `data:`, and protocol-relative
 * `//host` — returns null, and the caller renders the link's text as
 * plain text rather than dropping it.
 */
export function safeHref(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  if (t.startsWith("//")) return null;
  if (t.startsWith("#") || t.startsWith("/")) return t;
  return /^(https?:\/\/|mailto:)/i.test(t) ? t : null;
}

/* ------------------------------------------------------------------ */
/* inline                                                              */
/* ------------------------------------------------------------------ */

const ESCAPABLE = "\\`*[]()#-|";

function pushText(out: InlineNode[], text: string): void {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && last.kind === "text") last.text += text;
  else out.push({ kind: "text", text });
}

/**
 * Parse one run of prose. `src` may contain newlines: they become
 * `break` nodes, so a `**span**` can cross a hard-wrapped line the way
 * it does in the source.
 */
export function parseInline(src: string): InlineNode[] {
  const out: InlineNode[] = [];
  let buf = "";
  let i = 0;
  const flush = () => {
    pushText(out, buf);
    buf = "";
  };

  while (i < src.length) {
    const c = src[i];

    if (c === "\\" && i + 1 < src.length && ESCAPABLE.includes(src[i + 1])) {
      buf += src[i + 1];
      i += 2;
      continue;
    }

    if (c === "\n") {
      flush();
      out.push({ kind: "break" });
      i += 1;
      continue;
    }

    // Code spans bind tightest: `**` inside one is literal, which is
    // what makes `` `a**b` `` readable.
    if (c === "`") {
      const close = src.indexOf("`", i + 1);
      if (close > i + 1) {
        flush();
        out.push({ kind: "code", text: src.slice(i + 1, close) });
        i = close + 1;
        continue;
      }
    }

    if (c === "*") {
      const strong = src.startsWith("**", i);
      const marker = strong ? "**" : "*";
      const end = findCloser(src, i + marker.length, marker);
      if (end !== -1) {
        flush();
        const children = parseInline(src.slice(i + marker.length, end));
        out.push(
          strong ? { kind: "strong", children } : { kind: "em", children },
        );
        i = end + marker.length;
        continue;
      }
    }

    if (c === "[") {
      const link = matchLink(src, i);
      if (link) {
        flush();
        const href = safeHref(link.href);
        if (href) {
          out.push({ kind: "link", href, children: parseInline(link.text) });
        } else {
          // Refused target: keep the words, drop the linking. Never
          // silently swallow a curator's sentence over a bad URL.
          for (const n of parseInline(link.text)) out.push(n);
        }
        i = link.end;
        continue;
      }
    }

    buf += c;
    i += 1;
  }
  flush();
  return out;
}

/** Closing emphasis marker, or -1. Requires non-space just inside each
 *  end so `2 * 3 * 4` and a lone `*` stay literal. */
function findCloser(src: string, from: number, marker: string): number {
  if (from >= src.length || /\s/.test(src[from])) return -1;
  let i = from;
  while (i < src.length) {
    if (src[i] === "\\") {
      i += 2;
      continue;
    }
    // A code span inside the emphasis is skipped whole, so its
    // backticked contents can hold anything.
    if (src[i] === "`") {
      const close = src.indexOf("`", i + 1);
      if (close === -1) break;
      i = close + 1;
      continue;
    }
    if (src.startsWith(marker, i)) {
      // For `*`, don't mistake the opening of a `**` for a closer.
      if (marker === "*" && src.startsWith("**", i)) {
        i += 2;
        continue;
      }
      if (i > from && !/\s/.test(src[i - 1])) return i;
    }
    i += 1;
  }
  return -1;
}

/** `[text](href)` at `at`, tolerating balanced parens in the target. */
function matchLink(
  src: string,
  at: number,
): { text: string; href: string; end: number } | null {
  let depth = 0;
  let close = -1;
  for (let i = at; i < src.length; i++) {
    if (src[i] === "\\") {
      i += 1;
      continue;
    }
    if (src[i] === "[") depth += 1;
    else if (src[i] === "]") {
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    } else if (src[i] === "\n") return null;
  }
  if (close === -1 || src[close + 1] !== "(") return null;
  let paren = 0;
  for (let i = close + 1; i < src.length; i++) {
    if (src[i] === "(") paren += 1;
    else if (src[i] === ")") {
      paren -= 1;
      if (paren === 0) {
        return {
          text: src.slice(at + 1, close),
          href: src.slice(close + 2, i),
          end: i + 1,
        };
      }
    } else if (src[i] === "\n") return null;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* blocks                                                              */
/* ------------------------------------------------------------------ */

const HR_RE = /^ {0,3}(-{3,}|\*{3,}|_{3,})\s*$/;
const HEADING_RE = /^ {0,3}(#{1,6})\s+(.*)$/;
const BULLET_RE = /^ {0,3}[-*+]\s+(.*)$/;
const ORDERED_RE = /^ {0,3}(\d{1,9})[.)]\s+(.*)$/;
const QUOTE_RE = /^ {0,3}>\s?(.*)$/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})\s*(\S*)\s*$/;
const DELIMITER_RE = /^ {0,3}\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

/** Split a table row on unescaped pipes, dropping the outer pair. */
function splitRow(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\" && line[i + 1] === "|") {
      cur += "|";
      i += 1;
      continue;
    }
    if (line[i] === "|") {
      cells.push(cur);
      cur = "";
      continue;
    }
    cur += line[i];
  }
  cells.push(cur);
  if (cells.length && cells[0].trim() === "") cells.shift();
  if (cells.length && cells[cells.length - 1].trim() === "") cells.pop();
  return cells.map((c) => c.trim());
}

function alignmentsOf(delimiter: string): Align[] {
  return splitRow(delimiter).map((c) => {
    const left = c.startsWith(":");
    const right = c.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    if (left) return "left";
    return null;
  });
}

function isTableStart(lines: string[], i: number): boolean {
  return (
    lines[i].includes("|") &&
    i + 1 < lines.length &&
    DELIMITER_RE.test(lines[i + 1]) &&
    lines[i + 1].includes("-")
  );
}

/**
 * Read a note into blocks.
 *
 * Returns a single paragraph for text with no Markdown in it — that is
 * the common case and the one that must not change.
 */
export function parseMarkdown(src: string): Block[] {
  const blocks: Block[] = [];
  const lines = (src ?? "").replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  let paragraph: string[] = [];

  const closeParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: "paragraph", content: parseInline(paragraph.join("\n")) });
    paragraph = [];
  };

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      closeParagraph();
      i += 1;
      continue;
    }

    const fence = FENCE_RE.exec(line);
    if (fence) {
      closeParagraph();
      const marker = fence[1][0];
      const body: string[] = [];
      i += 1;
      while (i < lines.length) {
        const f = FENCE_RE.exec(lines[i]);
        if (f && f[1][0] === marker) {
          i += 1;
          break;
        }
        body.push(lines[i]);
        i += 1;
      }
      blocks.push({ kind: "code_block", text: body.join("\n") });
      continue;
    }

    if (isTableStart(lines, i)) {
      closeParagraph();
      const headerCells = splitRow(line);
      const align = alignmentsOf(lines[i + 1]);
      i += 2;
      const rows: InlineNode[][][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        rows.push(splitRow(lines[i]).map(parseInline));
        i += 1;
      }
      const headerIsBlank = headerCells.every((c) => c === "");
      blocks.push({
        kind: "table",
        header: headerIsBlank ? null : headerCells.map(parseInline),
        align,
        rows,
      });
      continue;
    }

    if (HR_RE.test(line)) {
      closeParagraph();
      blocks.push({ kind: "hr" });
      i += 1;
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      closeParagraph();
      blocks.push({
        kind: "heading",
        level: heading[1].length,
        content: parseInline(heading[2].trim()),
      });
      i += 1;
      continue;
    }

    if (QUOTE_RE.test(line)) {
      closeParagraph();
      const body: string[] = [];
      while (i < lines.length) {
        const q = QUOTE_RE.exec(lines[i]);
        if (!q) break;
        body.push(q[1]);
        i += 1;
      }
      blocks.push({ kind: "quote", content: parseInline(body.join("\n")) });
      continue;
    }

    const bullet = BULLET_RE.exec(line);
    const ordered = ORDERED_RE.exec(line);
    if (bullet || ordered) {
      closeParagraph();
      const isOrdered = !!ordered;
      const start = ordered ? Number(ordered[1]) : 1;
      const items: ListItem[] = [];
      while (i < lines.length) {
        const b = BULLET_RE.exec(lines[i]);
        const o = ORDERED_RE.exec(lines[i]);
        if (isOrdered ? !o : !b) break;
        const text = isOrdered ? o![2] : b![1];
        const continuation: string[] = [text];
        i += 1;
        // Indented follow-on lines belong to the item they sit under.
        while (
          i < lines.length &&
          /^\s{2,}\S/.test(lines[i]) &&
          !BULLET_RE.test(lines[i]) &&
          !ORDERED_RE.test(lines[i])
        ) {
          continuation.push(lines[i].trim());
          i += 1;
        }
        items.push({ content: parseInline(continuation.join("\n")) });
      }
      blocks.push({ kind: "list", ordered: isOrdered, start, items });
      continue;
    }

    paragraph.push(line);
    i += 1;
  }
  closeParagraph();
  return blocks;
}

/* ------------------------------------------------------------------ */
/* plain text                                                          */
/* ------------------------------------------------------------------ */

function inlineToText(nodes: InlineNode[]): string {
  return nodes
    .map((n) => {
      switch (n.kind) {
        case "text":
          return n.text;
        case "code":
          return n.text;
        case "break":
          return "\n";
        case "strong":
        case "em":
        case "link":
          return inlineToText(n.children);
      }
    })
    .join("");
}

/**
 * The same note with its markers removed.
 *
 * For places that cannot render blocks — a line-clamped card preview, a
 * native `title` tooltip — where showing `**bold**` and a row of pipes
 * is strictly worse than showing the words. Table rows collapse to
 * ` · `-separated cells so a table still reads as something in a
 * two-line preview.
 */
export function markdownToPlainText(src: string): string {
  const parts: string[] = [];
  for (const b of parseMarkdown(src)) {
    switch (b.kind) {
      case "paragraph":
      case "quote":
        parts.push(inlineToText(b.content));
        break;
      case "heading":
        parts.push(inlineToText(b.content));
        break;
      case "code_block":
        parts.push(b.text);
        break;
      case "hr":
        break;
      case "list":
        parts.push(
          b.items
            .map((it, n) =>
              b.ordered
                ? `${b.start + n}. ${inlineToText(it.content)}`
                : `• ${inlineToText(it.content)}`,
            )
            .join("\n"),
        );
        break;
      case "table": {
        const rows = b.header ? [b.header, ...b.rows] : b.rows;
        parts.push(
          rows
            .map((r) =>
              r
                .map(inlineToText)
                .filter((c) => c !== "")
                .join(" · "),
            )
            .filter((r) => r !== "")
            .join("\n"),
        );
        break;
      }
    }
  }
  return parts.join("\n\n").trim();
}

/* ------------------------------------------------------------------ */
/* the allow-list                                                      */
/* ------------------------------------------------------------------ */

/**
 * The surfaces cleared to render Markdown.
 *
 * *"this contract of where markdown is allowed … be careful. I don't
 * want markdown all over the place."* — the reviewer, 2026-08-17.
 *
 * ~40 surfaces in this app render agent- or curator-authored prose. Two
 * of them render it as Markdown, and `MarkdownText` takes the surface
 * as a REQUIRED prop, so switching a third one on cannot happen by
 * copying a JSX line — it has to widen this union, which shows up in a
 * diff and fails `markdown.test.ts`.
 *
 * The reasoning for each, and for the exclusions, lives in the header
 * of `components/ui/MarkdownText.tsx`. Adding a third is a decision;
 * take it deliberately and record why there.
 */
export const MARKDOWN_SURFACES = ["ticket-body", "review-focus"] as const;

export type MarkdownSurface = (typeof MARKDOWN_SURFACES)[number];
