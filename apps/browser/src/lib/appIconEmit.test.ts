/**
 * The home-screen icons are generated rasters, so nothing in the build
 * would notice if they went stale, went missing, or came out transparent.
 * This pins the three properties that actually decide whether a phone
 * renders them:
 *
 *  - the SVG they are rasterized from still matches the shared mark;
 *  - each PNG is the size its `<link>` / manifest claims;
 *  - each PNG is OPAQUE. iOS does not honour alpha in a home-screen icon —
 *    a transparent pixel composites to black — so an RGBA cut of this
 *    artwork would put the teal-and-orange mark on a black tile.
 *
 * Sibling of `faviconEmit.test.ts`, which pins the tab-strip cut.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildAppIconSvg,
  APP_ICON,
  MARK_PATH,
} from "../../../../packages/assets/scripts/emit-favicon.mjs";

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "../../public");

/** Width, height and colour type straight out of the PNG IHDR, so the test
 *  needs no image library. IHDR is always the first chunk: an 8-byte
 *  signature, then length+type, then the fields. Colour type 2 is RGB
 *  (no alpha channel at all), 6 is RGBA. */
function readPngHeader(path: string) {
  const b = readFileSync(path);
  expect(b.subarray(0, 8).toString("hex"), `${path} is not a PNG`).toBe(
    "89504e470d0a1a0a",
  );
  return {
    width: b.readUInt32BE(16),
    height: b.readUInt32BE(20),
    colourType: b.readUInt8(25),
  };
}

describe("the app-icon SVG", () => {
  it("is what the shared mark would emit", () => {
    // Regenerated per run rather than committed: the rasters are the
    // artifact, and this is the thing they come from.
    const svg = buildAppIconSvg(readFileSync(MARK_PATH, "utf8"));
    expect(svg).toContain(`viewBox="0 0 ${APP_ICON.SIZE} ${APP_ICON.SIZE}"`);
  });

  it("paints an opaque ground rather than relying on the platform", () => {
    const svg = buildAppIconSvg(readFileSync(MARK_PATH, "utf8"));
    expect(svg).toContain(
      `<rect width="${APP_ICON.SIZE}" height="${APP_ICON.SIZE}" fill="${APP_ICON.BACKGROUND}"/>`,
    );
  });

  it("keeps the mark clear of the corners a squircle mask cuts", () => {
    const svg = buildAppIconSvg(readFileSync(MARK_PATH, "utf8"));
    const t = /translate\(([\d.]+) ([\d.]+)\) scale\(([\d.]+)\)/.exec(svg);
    expect(t).not.toBeNull();
    const [, dy, scale] = t!.slice(1).map(Number);
    const margin = APP_ICON.SIZE * APP_ICON.MARGIN_RATIO;
    expect(dy).toBeCloseTo(margin, 3);

    const mark = readFileSync(MARK_PATH, "utf8");
    const [, , , h] = /viewBox="([\d.\s-]+)"/
      .exec(mark)![1]
      .trim()
      .split(/\s+/)
      .map(Number);
    expect(h * scale).toBeCloseTo(APP_ICON.SIZE - 2 * margin, 3);
  });

  // The favicon's margin is deliberately tighter — a tab strip applies no
  // mask. If these ever match, one of the two cuts has lost its reason.
  it("is more generously margined than the favicon cut", () => {
    expect(APP_ICON.MARGIN_RATIO).toBeGreaterThan(2 / 64);
  });
});

describe("the committed rasters", () => {
  const expected = [
    ["apple-touch-icon.png", 180],
    ["icon-192.png", 192],
    ["icon-512.png", 512],
  ] as const;

  for (const [name, px] of expected) {
    it(`${name} is ${px}x${px} and opaque`, () => {
      const path = join(PUBLIC, name);
      expect(existsSync(path), `${name} missing — run npm run emit:app-icons`).toBe(
        true,
      );
      const h = readPngHeader(path);
      expect(h.width).toBe(px);
      expect(h.height).toBe(px);
      // 2 = RGB, 0 = greyscale; both carry no alpha channel. 6 (RGBA) would
      // mean transparent corners, which iOS fills with black.
      expect([0, 2]).toContain(h.colourType);
    });
  }

  it("is declared to the phone by index.html", () => {
    const html = readFileSync(join(PUBLIC, "../index.html"), "utf8");
    expect(html).toContain('rel="apple-touch-icon"');
    expect(html).toContain("/apple-touch-icon.png");
    expect(html).toContain('rel="manifest"');
  });

  it("has a manifest naming icons that exist", () => {
    const m = JSON.parse(
      readFileSync(join(PUBLIC, "manifest.webmanifest"), "utf8"),
    );
    expect(m.icons.length).toBeGreaterThan(0);
    for (const icon of m.icons) {
      expect(
        existsSync(join(PUBLIC, icon.src.replace(/^\//, ""))),
        `manifest names ${icon.src}, which is not in public/`,
      ).toBe(true);
    }
    // short_name is what a home screen prints under the tile; it truncates
    // around 12 characters, which is why it is not just `name`.
    expect(m.short_name.length).toBeLessThanOrEqual(12);
  });
});
