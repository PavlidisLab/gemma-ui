import { describe, expect, it } from "vitest";
import {
  MARKDOWN_SURFACES,
  markdownToPlainText,
  parseInline,
  parseMarkdown,
  safeHref,
  type Block,
  type InlineNode,
} from "./markdown";

describe("the allow-list is closed", () => {
  it("sanctions exactly two surfaces", () => {
    // *"be careful. I don't want markdown all over the place."*
    // ~40 surfaces in this app render agent- or curator-authored prose;
    // two of them render it as Markdown. Widening this is a decision,
    // not a default — if you are here because a test failed, read the
    // contract at the top of MarkdownText.tsx and say why in it.
    expect([...MARKDOWN_SURFACES]).toEqual(["ticket-body", "review-focus"]);
  });
});

/** Flatten to the text a reader would see, markers gone. */
function textOf(nodes: InlineNode[]): string {
  return nodes
    .map((n) =>
      n.kind === "text" || n.kind === "code"
        ? n.text
        : n.kind === "break"
          ? "\n"
          : textOf(n.children),
    )
    .join("");
}

const kinds = (blocks: Block[]) => blocks.map((b) => b.kind);

describe("supported, never required", () => {
  // The half that matters most. Curators write these notes by hand and
  // always will; a renderer that reflows or eats their text is worse
  // than one that shows `**` to the one author who writes Markdown.
  it("leaves plain prose as a single paragraph", () => {
    const src = "Check the sample assignments before committing.";
    const blocks = parseMarkdown(src);
    expect(kinds(blocks)).toEqual(["paragraph"]);
    expect(markdownToPlainText(src)).toBe(src);
  });

  it("keeps single newlines as line breaks instead of reflowing", () => {
    // CommonMark would join these into one line. A curator who typed
    // three lines gets three lines.
    const blocks = parseMarkdown("one\ntwo\nthree");
    expect(blocks).toHaveLength(1);
    const p = blocks[0] as Extract<Block, { kind: "paragraph" }>;
    expect(p.content.filter((n) => n.kind === "break")).toHaveLength(2);
    expect(textOf(p.content)).toBe("one\ntwo\nthree");
  });

  it("never treats underscores as emphasis", () => {
    // The codebase is snake_case throughout. Italicizing `gold_data_version`
    // would also EAT the underscores, corrupting the token a curator
    // needs to read verbatim.
    for (const src of [
      "gold_data_version was null",
      "check EFO_0000727 and strict_consensus",
      "batch 2026-08-17_panel100_v3",
      "__not bold__",
    ]) {
      expect(textOf(parseInline(src))).toBe(src);
      expect(parseInline(src).every((n) => n.kind === "text")).toBe(true);
    }
  });

  it("leaves arithmetic and stray asterisks alone", () => {
    for (const src of ["2 * 3 * 4", "see the note *", "a * b"]) {
      expect(textOf(parseInline(src))).toBe(src);
    }
  });

  it("blank input renders nothing", () => {
    expect(parseMarkdown("")).toEqual([]);
    expect(markdownToPlainText("")).toBe("");
  });
});

describe("inline", () => {
  it("reads bold, italic and code", () => {
    const nodes = parseInline("**bold** and *slanted* and `code`");
    expect(nodes.map((n) => n.kind)).toEqual([
      "strong",
      "text",
      "em",
      "text",
      "code",
    ]);
  });

  it("does not format inside a code span", () => {
    // `` `a**b` `` has to survive: the agents side puts version stamps
    // and file paths in backticks.
    const nodes = parseInline("`**not bold**`");
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toEqual({ kind: "code", text: "**not bold**" });
  });

  it("lets bold span a hard-wrapped line", () => {
    // The agents side wraps at 80 columns, so a bold run routinely
    // crosses a newline. Parsing per-line would show the markers.
    const nodes = parseInline("**one\ntwo**");
    expect(nodes).toHaveLength(1);
    expect(nodes[0].kind).toBe("strong");
    expect(textOf(nodes)).toBe("one\ntwo");
  });

  it("honours backslash escapes", () => {
    expect(textOf(parseInline("\\*literal\\*"))).toBe("*literal*");
    expect(parseInline("\\*literal\\*").every((n) => n.kind === "text")).toBe(
      true,
    );
  });

  it("leaves an unclosed marker as text", () => {
    expect(textOf(parseInline("**unclosed"))).toBe("**unclosed");
    expect(textOf(parseInline("a `unclosed"))).toBe("a `unclosed");
  });
});

describe("links", () => {
  it("reads a markdown link", () => {
    const [node] = parseInline("[the handoff](https://example.org/a)");
    expect(node).toMatchObject({ kind: "link", href: "https://example.org/a" });
  });

  it("allows in-app hash routes", () => {
    expect(safeHref("#/tickets/177")).toBe("#/tickets/177");
    expect(safeHref("/experiments/42")).toBe("/experiments/42");
  });

  it("refuses dangerous targets but keeps the words", () => {
    // Never silently swallow a sentence over a bad URL.
    for (const bad of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,<script>",
      "//evil.example.com",
    ]) {
      expect(safeHref(bad)).toBeNull();
      const nodes = parseInline(`[click me](${bad})`);
      expect(nodes.some((n) => n.kind === "link")).toBe(false);
      expect(textOf(nodes)).toBe("click me");
    }
  });
});

describe("blocks", () => {
  it("splits paragraphs on a blank line", () => {
    expect(kinds(parseMarkdown("one\n\ntwo"))).toEqual([
      "paragraph",
      "paragraph",
    ]);
  });

  it("reads headings, rules, quotes and fenced code", () => {
    expect(kinds(parseMarkdown("## Findings"))).toEqual(["heading"]);
    expect(kinds(parseMarkdown("---"))).toEqual(["hr"]);
    expect(kinds(parseMarkdown("> quoted"))).toEqual(["quote"]);
    expect(kinds(parseMarkdown("```\nraw **text**\n```"))).toEqual([
      "code_block",
    ]);
  });

  it("does not format inside a fenced block", () => {
    const [block] = parseMarkdown("```\nraw **text**\n```");
    expect(block).toEqual({ kind: "code_block", text: "raw **text**" });
  });

  it("reads bullet and numbered lists", () => {
    const [bullets] = parseMarkdown("- one\n- two");
    expect(bullets).toMatchObject({ kind: "list", ordered: false });
    const [ordered] = parseMarkdown("2. two\n3. three");
    expect(ordered).toMatchObject({ kind: "list", ordered: true, start: 2 });
  });
});

describe("tables", () => {
  // Straight from the agents side's panel-100 note.
  const TABLE = [
    "| | | |",
    "|---|---:|---|",
    "| 🔴 FACTUAL | 5 | a grounded entity disagreeing with gold |",
    "| 🟠 OMISSION | 17 | gold axes this run did not pair with |",
    "| subset/split | 5 | **2 carry BOTH voices** |",
  ].join("\n");

  it("reads a pipe table with its alignments", () => {
    const [block] = parseMarkdown(TABLE);
    const t = block as Extract<Block, { kind: "table" }>;
    expect(t.kind).toBe("table");
    // `---:` asks for right; a bare `---` asks for nothing, and gets
    // nothing — the cell inherits the table's default rather than
    // being pinned left.
    expect(t.align).toEqual([null, "right", null]);
    expect(t.rows).toHaveLength(3);
    expect(textOf(t.rows[0][0])).toBe("🔴 FACTUAL");
    expect(textOf(t.rows[0][1])).toBe("5");
  });

  it("drops an all-blank header row rather than rendering an empty stripe", () => {
    const [block] = parseMarkdown(TABLE);
    expect((block as Extract<Block, { kind: "table" }>).header).toBeNull();
  });

  it("keeps a header row that says something", () => {
    const [block] = parseMarkdown("| class | n |\n|---|---|\n| FACTUAL | 5 |");
    const t = block as Extract<Block, { kind: "table" }>;
    expect(t.header).not.toBeNull();
    expect(textOf(t.header![0])).toBe("class");
  });

  it("formats inside cells", () => {
    const [block] = parseMarkdown(TABLE);
    const t = block as Extract<Block, { kind: "table" }>;
    expect(t.rows[2][2].some((n) => n.kind === "strong")).toBe(true);
  });

  it("does not mistake a lone pipe for a table", () => {
    expect(kinds(parseMarkdown("a | b\nnot a table"))).toEqual(["paragraph"]);
  });
});

describe("markdownToPlainText", () => {
  it("strips markers and keeps the words", () => {
    expect(markdownToPlainText("**bold** and `code`")).toBe("bold and code");
  });

  it("collapses a table to readable rows", () => {
    // A card preview clamped to four lines cannot hold a table, but the
    // counts in it are the point of the note.
    const out = markdownToPlainText(
      "| | |\n|---|---|\n| FACTUAL | 5 |\n| OMISSION | 17 |",
    );
    expect(out).toBe("FACTUAL · 5\nOMISSION · 17");
  });

  it("marks list items so a preview still reads as a list", () => {
    expect(markdownToPlainText("- one\n- two")).toBe("• one\n• two");
  });

  it("is a no-op on plain prose", () => {
    const src = "Check the sample assignments.\nThen commit.";
    expect(markdownToPlainText(src)).toBe(src);
  });
});

describe("the note from the screenshot", () => {
  // End-to-end on the shape that prompted this: bold spanning a code
  // span, hard wraps, an emoji-led table with a blank header.
  const NOTE = [
    "**100 experiments from `2026-08-17_panel100_v3`, reviewed against gold",
    "`pg500-77977665490d`.**",
    "",
    "Open any experiment — **the guidance is at the top of its proposal**",
    "(headline + key findings), ranked by severity.",
    "",
    "| | | |",
    "|---|---:|---|",
    "| 🔴 FACTUAL | 5 | the only class that propagates |",
    "",
    "Full analysis: `~/Dev/Gemma/handoffs/TAG_CONVERGENCE_2026_08_17.md`.",
  ].join("\n");

  it("reads as paragraphs and a table, not as raw syntax", () => {
    expect(kinds(parseMarkdown(NOTE))).toEqual([
      "paragraph",
      "paragraph",
      "table",
      "paragraph",
    ]);
  });

  it("keeps the version stamps verbatim in code spans", () => {
    const blocks = parseMarkdown(NOTE);
    const codes: string[] = [];
    const walk = (nodes: InlineNode[]) => {
      for (const n of nodes) {
        if (n.kind === "code") codes.push(n.text);
        else if (n.kind !== "text" && n.kind !== "break") walk(n.children);
      }
    };
    for (const b of blocks) {
      if (b.kind === "paragraph") walk(b.content);
    }
    expect(codes).toContain("2026-08-17_panel100_v3");
    expect(codes).toContain("pg500-77977665490d");
    expect(codes).toContain("~/Dev/Gemma/handoffs/TAG_CONVERGENCE_2026_08_17.md");
  });

  it("shows no leftover markers anywhere in the plain-text form", () => {
    const out = markdownToPlainText(NOTE);
    expect(out).not.toContain("**");
    expect(out).not.toContain("|---");
    expect(out).toContain("100 experiments from 2026-08-17_panel100_v3");
    expect(out).toContain("🔴 FACTUAL · 5");
  });
});
