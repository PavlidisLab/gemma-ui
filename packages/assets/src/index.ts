// Shared brand assets. Each export is the build-time-resolved URL
// of the image (Vite fingerprints and emits the file); import the
// binding, don't hardcode a path. The editable .xcf GIMP sources
// sit next to each .png under ./images/logo/ so the source art
// stays physically beside its export — they are intentionally never
// imported here.
//
// `gemma-mark.svg` is also read OUTSIDE the bundle, by
// ../scripts/emit-favicon.mjs, which generates each app's
// public/favicon.svg from it. A favicon must live at a fixed URL, so it
// can't be a content-hashed import; generating it is what stops the copy
// drifting from the mark.

// The pre-2026-09 Gemma mark and mark+word raster are NOT exported. They
// sit in ./images/logo/ beside their .xcf sources as archived art, and
// `gemmaMark` / `gemmaLockup` below supersede them. Exporting them was not
// free even with no importer: at 18 kB and 32 kB they are over Vite's 4 kB
// inline limit, so both were emitted into dist/ and referenced by nothing —
// 50 kB of dead payload in the browser build.

export { default as ubcLogo } from "./images/logo/ubc-logo.png";

// Gemma mark, 2026-09. Two cuts of one piece of art: the mark alone, and
// the mark locked up with the "Gemma" wordmark. The wordmark is OUTLINED
// (it ships as paths, not as a font reference), so the lockup is the only
// way to set the word in the real face — a surface that needs mark + word
// uses `gemmaLockup`, not `gemmaMark` beside typed text.
//
// Palette, five flat fills and nothing else:
//   #167c92 teal · #ca4e2a brick · #ef7f24 orange · #f6ab37 amber ·
//   #f9d560 yellow, plus #000000 for the wordmark.
//
// Unlike the .png/.xcf pairs above, these have no separate source file
// beside them: the SVG IS the vector source, editable in Illustrator as it
// stands. The Illustrator originals stay in the design archive.
//
// 🛑 If the lockup is ever re-cut from that archive, note that
// `gemma-logo-w-text.ai` is a WORKING artboard carrying seven objects,
// including earlier versions of the mark whose dots are round and whose
// arcs are straight. The shipped lockup is the one whose mark matches
// `gemma-mark.svg`; check against that file before exporting. Its wordmark
// also uses a CMYK black that converts to #231f20 through some tools and
// #000000 through Illustrator's own export — #000000 is the correct value.
//
// `gemmaMark` has a portrait bounding box (872.5 x 938.26, aspect 0.93);
// `gemmaLockup` is 4.149:1. Both viewBoxes are the tight ink bounds, so a
// surface controls its own padding.
export { default as gemmaMark } from "./images/logo/gemma-mark.svg";
export { default as gemmaLockup } from "./images/logo/gemma-lockup.svg";

// MSL (Michael Smith Laboratories) — the "M" mark, navy #000A3E with an
// orange #F36E34 triangle. These SUPPLEMENT the UBC logo; they do not
// replace it, so `ubcLogo` stays wherever it already is.
//
// Three cuts of one mark plus the triangle alone. Pick by what sits
// behind it: the light-background cut is the default, the dark one
// swaps the navy for PMS 2975 light blue #96D5EC (navy on dark is
// unreadable), and the white-background cut is opaque — only for a
// surface that is already white.
//
// 🛑 The two transparent cuts are 150x91 THUMBNAIL exports and will
// soften if drawn much larger. The only full-size art here is
// `mslLogoOnWhite` (346x210), which carries a baked-in white
// background. If a transparent mark is ever needed at masthead scale,
// it has to be re-exported from the source art — there is no .xcf for
// these four, unlike the logos above.
export { default as mslLogo } from "./images/logo/msl-logo.png";
export { default as mslLogoOnDark } from "./images/logo/msl-logo-on-dark.png";
export { default as mslLogoOnWhite } from "./images/logo/msl-logo-on-white.png";
export { default as mslTriangle } from "./images/logo/msl-triangle.png";
