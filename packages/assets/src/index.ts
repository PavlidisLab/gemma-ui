// Shared brand assets. Each export is the build-time-resolved URL
// of the image (Vite fingerprints and emits the file); import the
// binding, don't hardcode a path. The editable .xcf GIMP sources
// sit next to each .png under ./images/logo/ so the source art
// stays physically beside its export — they are intentionally never
// imported here.

export { default as gemmaLogo } from "./images/logo/gemma-logo.png";
export { default as gemmaLogoText } from "./images/logo/gemma-logo-text.png";
export { default as ubcLogo } from "./images/logo/ubc-logo.png";
