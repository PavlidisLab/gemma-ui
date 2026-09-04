/**
 * `public/favicon.svg` is a generated copy of the shared Gemma mark —
 * `index.html` needs it at a fixed URL, so it can't be a hashed import of
 * `@gemma/assets` and has to be duplicated. This pins the copy to its
 * source: edit the mark without re-running `npm run emit:favicon` and the
 * two silently disagree, with the tab icon showing the older artwork.
 *
 * This app gets the MONO cut — the same mark in one flat ink — so its tab is
 * tellable from the browser app's at 16px; the two sit side by side in one
 * strip all day. apps/browser has the mirror of this test against the
 * colour cut.
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

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const ch = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Roughly what Chrome paints behind a tab's icon in each theme. Exact
 *  values drift between releases; these are only used to assert that the
 *  ink chosen for a theme is the legible one of the pair, which any
 *  plausible light/dark strip preserves. */
const TAB_STRIP = { light: "#dee1e6", dark: "#292a2d" };

describe("favicon.svg (mono cut)", () => {
  it("matches what the mark would emit", () => {
    const mark = readFileSync(MARK_PATH, "utf8");
    const committed = readFileSync(FAVICON_PATH, "utf8");
    expect(committed).toBe(buildFaviconSvg(mark, "mono"));
  });

  it("differs from the browser app's cut", () => {
    const mark = readFileSync(MARK_PATH, "utf8");
    expect(buildFaviconSvg(mark, "mono")).not.toBe(
      buildFaviconSvg(mark, "colour"),
    );
  });

  it("carries no per-path fill — the ink comes from one rule", () => {
    const committed = readFileSync(FAVICON_PATH, "utf8");
    expect(committed).not.toMatch(/<path[^>]*fill=/);
    // Same geometry as the colour cut, so the two tabs match in weight.
    expect(committed).toContain('viewBox="0 0 64 64"');
    expect((committed.match(/<path/g) ?? []).length).toBe(13);
  });

  // The whole reason the ink is a PAIR and not just black. Black on Chrome's
  // dark tab strip is 1.2:1 — the tab reads as a failed icon load, not as a
  // dark logo. Assert the property, so a later re-tint that keeps the media
  // query but picks an unreadable value still fails.
  it("picks the legible ink for each tab-strip theme", () => {
    const committed = readFileSync(FAVICON_PATH, "utf8");
    const light = /^\s*path\s*\{\s*fill:\s*(#[0-9a-f]{6});/m.exec(
      committed,
    )![1];
    const dark =
      /prefers-color-scheme:\s*dark[^}]*\{\s*fill:\s*(#[0-9a-f]{6});/.exec(
        committed,
      )![1];
    expect(contrast(TAB_STRIP.light, light)).toBeGreaterThan(
      contrast(TAB_STRIP.light, dark),
    );
    expect(contrast(TAB_STRIP.dark, dark)).toBeGreaterThan(
      contrast(TAB_STRIP.dark, light),
    );
    expect(contrast(TAB_STRIP.light, light)).toBeGreaterThanOrEqual(3);
    expect(contrast(TAB_STRIP.dark, dark)).toBeGreaterThanOrEqual(3);
  });
});
