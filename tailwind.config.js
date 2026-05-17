/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        gemma: {
          ink: "#1f2937",
          subtle: "#6b7280",
          grid: "#e5e7eb",
          accent: "#2563eb",
          accent2: "#10b981",
          accent3: "#f59e0b",
          accent4: "#ef4444",
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica", "Arial", "sans-serif"],
      },
    },
  },
  plugins: [],
};
