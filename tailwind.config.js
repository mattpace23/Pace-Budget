/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Pace Budget palette — subtle, calm
        ink: "#0f1722",
        paper: "#fafaf7",
        accent: "#2b6e57",
        warn: "#c2410c",
        muted: "#94a3b8",
      },
    },
  },
  plugins: [],
};
