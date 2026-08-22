/**
 * Tailwind config — skin-aware.
 *
 * The `gemma` palette + a small set of `surface` / chrome tokens are
 * now CSS-variable-driven. Each entry resolves to
 * ``rgb(var(--skin-X-rgb) / <alpha-value>)`` so Tailwind opacity
 * modifiers (e.g. ``text-gemma-ink/50``) keep working.
 *
 * Default values live in ``src/index.css`` under ``:root``. Skin
 * variants (`html.skin-extjs { … }`, etc.) override the same vars.
 * See ``src/lib/skin/`` for the picker + provider.
 */

/** @type {import('tailwindcss').Config} */
export default {
  // Class-gated, matching apps/curation. Without this, Tailwind 3
  // defaults to `media`, so every `dark:` utility in this app and in
  // the shared packages (PanelCard's plot background, the annotation
  // checkbox fill) fired off the OS `prefers-color-scheme: dark` —
  // black plot panels and checkboxes on an otherwise light page,
  // since the `--skin-*` chrome tokens in index.css have no dark
  // branch. This app has no theme toggle, so nothing puts `dark` on
  // <html> and the site stays light everywhere.
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        gemma: {
          // Page background. The CSS var has always been there; the
          // token was not, so every `bg-gemma-bg` in the app compiled
          // to nothing — 19 of them, across page backgrounds, zebra
          // rows, hover states and two sticky table headers. The
          // Platforms header was the visible one: transparent, so the
          // rows scrolled underneath and printed on top of it.
          bg: "rgb(var(--skin-bg) / <alpha-value>)",
          ink: "rgb(var(--skin-ink) / <alpha-value>)",
          subtle: "rgb(var(--skin-subtle) / <alpha-value>)",
          grid: "rgb(var(--skin-grid) / <alpha-value>)",
          accent: "rgb(var(--skin-accent) / <alpha-value>)",
          accent2: "rgb(var(--skin-accent2) / <alpha-value>)",
          accent3: "rgb(var(--skin-accent3) / <alpha-value>)",
          accent4: "rgb(var(--skin-accent4) / <alpha-value>)",
        },
        // Chrome tokens — used by panel / surface / table utilities so
        // skins can shift the page background + card colour without
        // touching every component.
        surface: {
          DEFAULT: "rgb(var(--skin-surface) / <alpha-value>)",
          sunk: "rgb(var(--skin-surface-sunk) / <alpha-value>)",
          alt: "rgb(var(--skin-surface-alt) / <alpha-value>)",
        },
      },
      fontFamily: {
        // Skin can override the body font via --skin-font-sans (string).
        sans: [
          "var(--skin-font-sans, Inter)",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
      },
      borderRadius: {
        // Skin can shrink the default radius. Constrained: skins keep
        // sizing close to default so layouts don't reflow drastically.
        skin: "var(--skin-radius, 0.25rem)",
      },
    },
  },
  plugins: [],
};
