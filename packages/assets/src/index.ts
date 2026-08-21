// Shared brand assets. Each export is the build-time-resolved URL
// of the image (Vite fingerprints and emits the file); import the
// binding, don't hardcode a path. The editable .xcf GIMP sources
// sit next to each .png under ./images/logo/ so the source art
// stays physically beside its export — they are intentionally never
// imported here.

export { default as gemmaLogo } from "./images/logo/gemma-logo.png";
export { default as gemmaLogoText } from "./images/logo/gemma-logo-text.png";
export { default as ubcLogo } from "./images/logo/ubc-logo.png";

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
