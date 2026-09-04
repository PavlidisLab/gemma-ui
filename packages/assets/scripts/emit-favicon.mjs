#!/usr/bin/env node
/**
 * Emit an app's `public/favicon.svg` from the shared Gemma mark.
 *
 * Each app's `index.html` points the browser at the fixed URL
 * `/favicon.svg`, so the file has to sit in that app's `public/` as a
 * static copy — it cannot be a bundled, content-hashed import of
 * `@gemma/assets`. That leaves copies of the same artwork in the repo,
 * which is the drift this script exists to stop: the copies are generated,
 * and each app's `faviconEmit.test.ts` fails if the committed one no longer
 * matches what the mark would produce.
 *
 * Two cuts, because the two apps' tabs sit side by side in one strip and a
 * curator has to tell them apart at 16px:
 *
 *   colour  the mark in the five brand fills — apps/browser
 *   mono    the same mark, one flat ink      — apps/curation
 *
 * The mono cut is not a second piece of artwork: same paths, same box, every
 * fill collapsed to one value. Black is the intent, and black is what a
 * light tab strip gets.
 *
 * It cannot be black UNCONDITIONALLY. Chrome's dark theme paints the tab
 * strip near #292a2d, where black-on-dark is 1.2:1 and the mark is simply
 * not there — the tab looks like it failed to load an icon. So the emitted
 * SVG carries a `prefers-color-scheme: dark` rule that swaps the ink for
 * white; an SVG favicon is styled by the browser like any other SVG
 * document, so the rule resolves against the VIEWER's theme, which is the
 * only thing that knows what colour the strip behind it is. The colour cut
 * needs no such rule: its warm dots hold up on both grounds.
 *
 * Run: `npm run emit:favicon` from either app.
 *
 * A `public/favicon.ico` — the legacy fallback for clients that can't
 * render an SVG icon — is a RASTER, and this script can't produce one
 * because Node has no SVG renderer. apps/browser ships one; regenerate it
 * from the emitted SVG with:
 *
 *   rsvg-convert -w 48 -h 48 public/favicon.svg -o /tmp/fav48.png
 *   python3 -c "from PIL import Image; \
 *     Image.open('/tmp/fav48.png').convert('RGBA').save( \
 *       'public/favicon.ico', format='ICO', sizes=[(16,16),(32,32),(48,48)])"
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export const MARK_PATH = join(here, "../src/images/logo/gemma-mark.svg");

/** Square canvas, and the breathing room inside it. A favicon is drawn at
 *  16px in a tab strip; without the margin the arcs touch the edge and read
 *  as clipped. Both cuts use the same box, so the two tabs sit at the same
 *  visual weight beside each other. */
const SIZE = 64;
const MARGIN = 2;

/** The mono cut's ink, per tab-strip theme. See the header for why this is
 *  a pair rather than a single black. */
const MONO_INK = "#000000";
const MONO_INK_ON_DARK = "#ffffff";

export const VARIANTS = ["colour", "mono"];

/** Pull the mark apart into the two things every derived artifact needs.
 *  Shared with emit-mark-component.mjs so a change to the mark's file
 *  shape — paths wrapped in a `<g>`, say — breaks one place rather than
 *  going unnoticed in whichever script wasn't looked at. */
export function readMark(markSvg) {
  const viewBox = /viewBox="([\d.\s-]+)"/.exec(markSvg);
  if (!viewBox) throw new Error("no viewBox in the mark SVG");
  const [, , w, h] = viewBox[1].trim().split(/\s+/).map(Number);
  const paths = markSvg.match(/<path[^>]*\/>/g);
  if (!paths?.length) throw new Error("no <path> elements in the mark SVG");
  return { w, h, paths };
}

/** Build a favicon SVG from the mark's own source text. Pure — the tests
 *  call this and compare, rather than running the script and diffing the
 *  working tree. */
export function buildFaviconSvg(markSvg, variant = "colour") {
  if (!VARIANTS.includes(variant)) {
    throw new Error(`unknown favicon variant "${variant}"`);
  }
  const mark = readMark(markSvg);
  const { w, h } = mark;
  let paths = mark.paths;

  // The mono cut drops every per-path fill and takes the ink from one CSS
  // rule instead, so the theme swap is a single declaration rather than 13
  // of them.
  const style = [];
  if (variant === "mono") {
    paths = paths.map((p) => p.replace(/\s*fill="#[0-9a-f]{6}"/, ""));
    style.push(
      `<style>`,
      `  path { fill: ${MONO_INK}; }`,
      `  @media (prefers-color-scheme: dark) { path { fill: ${MONO_INK_ON_DARK}; } }`,
      `</style>`,
    );
  }

  // Fit by height: the mark is taller than it is wide, so height is the
  // binding dimension and the leftover width becomes the horizontal centring.
  const scale = (SIZE - 2 * MARGIN) / h;
  const dx = (SIZE - w * scale) / 2;

  return [
    `<!-- GENERATED (${variant} cut) by packages/assets/scripts/emit-favicon.mjs`,
    `     from packages/assets/src/images/logo/gemma-mark.svg — do not edit by hand.`,
    `     Run \`npm run emit:favicon\` after the mark changes. -->`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}" role="img" aria-label="Gemma">`,
    ...style,
    `<g transform="translate(${dx.toFixed(3)} ${MARGIN.toFixed(3)}) scale(${scale.toFixed(6)})">`,
    ...paths.map((p) => `  ${p}`),
    `</g>`,
    `</svg>`,
    ``,
  ].join("\n");
}

// Only write when run as a script — importing this module (the tests do)
// must not touch the working tree.
if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  const args = process.argv.slice(2);
  const arg = (name) => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? undefined : args[i + 1];
  };
  const variant = arg("variant") ?? "colour";
  const out = arg("out");
  if (!out) {
    process.stderr.write(
      "usage: emit-favicon.mjs --out <path> [--variant colour|mono]\n",
    );
    process.exit(2);
  }
  const svg = buildFaviconSvg(readFileSync(MARK_PATH, "utf8"), variant);
  writeFileSync(resolve(out), svg);
  process.stdout.write(`emit-favicon: wrote ${resolve(out)} (${variant})\n`);
}
