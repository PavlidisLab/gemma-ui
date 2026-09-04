/**
 * `public/favicon.svg` is a generated copy of the shared Gemma mark —
 * `index.html` needs it at a fixed URL, so it can't be a hashed import of
 * `@gemma/assets` and has to be duplicated. This pins the copy to its
 * source: edit the mark without re-running `npm run emit:favicon` and the
 * two silently disagree, with the tab icon showing the older artwork.
 *
 * apps/curation has the mirror of this test against the MONO cut.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildFaviconSvg,
  MARK_PATH,
} from "../../../../packages/assets/scripts/emit-favicon.mjs";

const FAVICON_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../public/favicon.svg",
);

describe("favicon.svg (colour cut)", () => {
  it("matches what the mark would emit", () => {
    const mark = readFileSync(MARK_PATH, "utf8");
    const committed = readFileSync(FAVICON_PATH, "utf8");
    expect(committed).toBe(buildFaviconSvg(mark, "colour"));
  });

  it("carries the mark's five brand fills, set per path", () => {
    const committed = readFileSync(FAVICON_PATH, "utf8");
    const fills = [...committed.matchAll(/fill="(#[0-9a-f]{6})"/g)].map(
      (m) => m[1],
    );
    expect([...new Set(fills)].sort()).toEqual([
      "#167c92",
      "#ca4e2a",
      "#ef7f24",
      "#f6ab37",
      "#f9d560",
    ]);
    // The colour cut takes its fills from the paths themselves. A <style>
    // here would mean the mono cut's theme-swap rule leaked in and would
    // repaint the whole mark one ink.
    expect(committed).not.toContain("<style");
  });

  // The mark's box is portrait; a favicon is square. Fitting by height and
  // centring is what keeps the top and bottom arcs inside the tile.
  it("centres the portrait mark in a square viewBox", () => {
    const committed = readFileSync(FAVICON_PATH, "utf8");
    expect(committed).toContain('viewBox="0 0 64 64"');
    const t = /translate\(([\d.]+) ([\d.]+)\) scale\(([\d.]+)\)/.exec(
      committed,
    );
    expect(t).not.toBeNull();
    const [dx, dy, scale] = t!.slice(1).map(Number);
    const mark = readFileSync(MARK_PATH, "utf8");
    const [, , w, h] = /viewBox="([\d.\s-]+)"/
      .exec(mark)![1]
      .trim()
      .split(/\s+/)
      .map(Number);
    expect(h * scale).toBeCloseTo(60, 3); // 64 less a 2px margin top and bottom
    expect(dx).toBeCloseTo((64 - w * scale) / 2, 3);
    expect(dy).toBe(2);
  });
});
