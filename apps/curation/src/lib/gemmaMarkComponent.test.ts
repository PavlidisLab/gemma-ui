/**
 * `packages/ui/src/GemmaMark.tsx` is generated from the shared mark, for
 * the same reason the favicons are: an `<img>` can't inherit
 * `currentColor`, so the header's monochrome mark has to be inline SVG —
 * and inline SVG means the path data exists in a second file. This pins
 * that file to the mark it came from. Edit the mark without re-running
 * `npm run emit:mark-component` and the header keeps drawing the old
 * shape, silently.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MARK_PATH } from "../../../../packages/assets/scripts/emit-favicon.mjs";
import { buildMarkComponent } from "../../../../packages/assets/scripts/emit-mark-component.mjs";

const COMPONENT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../packages/ui/src/GemmaMark.tsx",
);

describe("GemmaMark.tsx", () => {
  it("matches what the mark would emit", () => {
    const mark = readFileSync(MARK_PATH, "utf8");
    const committed = readFileSync(COMPONENT_PATH, "utf8");
    expect(committed).toBe(buildMarkComponent(mark));
  });

  it("draws in currentColor and pins no brand fill", () => {
    const committed = readFileSync(COMPONENT_PATH, "utf8");
    expect(committed).toContain('fill="currentColor"');
    // A leftover per-path fill would win over the svg-level one and
    // strand the mark in the light theme's palette.
    expect(committed).not.toMatch(/<path[^>]*fill=/);
  });

  it("carries every path the mark has", () => {
    const mark = readFileSync(MARK_PATH, "utf8");
    const committed = readFileSync(COMPONENT_PATH, "utf8");
    const inMark = mark.match(/<path/g)!.length;
    expect((committed.match(/<path/g) ?? []).length).toBe(inMark);
    // Same box, so the component and the favicon crop the same artwork.
    const box = /viewBox="([\d.\s-]+)"/.exec(mark)![1];
    expect(committed).toContain(
      `viewBox="0 0 ${box.trim().split(/\s+/).slice(2).join(" ")}"`,
    );
  });
});
