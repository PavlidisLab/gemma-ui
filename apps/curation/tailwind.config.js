/** @type {import('tailwindcss').Config} */
export default {
  // The shared packages are scanned too: a class used only there is
  // otherwise never generated (GeneExpressionPanel's `lg:flex-1
  // lg:min-w-0` was, which let its heatmap creep wider render by
  // render — see apps/browser/tailwind.config.js).
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
    "../../packages/*/src/**/*.{ts,tsx}",
  ],
  // Class-based dark mode: a `useTheme` hook toggles `dark` on the
  // <html> element. We don't auto-respond to `prefers-color-scheme`
  // at the CSS level — the hook honours it via the "system" theme
  // setting in the gear-menu. That keeps the curator's choice
  // explicit and stable across reloads.
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        gemma: {
          blue:  "#1e40af",
          amber: "#b45309",
          green: "#15803d",
          rose:  "#be123c",
          gray:  "#475569",
        },
      },
    },
  },
  plugins: [],
};
