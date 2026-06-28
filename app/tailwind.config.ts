// SPDX-License-Identifier: Apache-2.0

import type { Config } from "tailwindcss";

// "Cinematic darkroom" monochrome design system. One accent (signal-amber) that
// marks live/active signals only. Shape is binary: pill (999px) for buttons and
// tags, sharp (0px) for cards, inputs, and panels. No shadows or glows; depth is
// white/dark tonal contrast only.
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        paper: "#FFFFFF",
        ink: "#000000",
        carbon: "#181818",
        ash: "#6D6D6D",
        smoke: "#9A9A9A",
        pewter: "#808080",
        graphite: "#636363",
        // The single accent. One job: live/active signals.
        amber: "#FFAC2E",
      },
      fontFamily: {
        // Inter everywhere, wired through next/font's CSS variable.
        sans: ["var(--font-inter)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      borderRadius: {
        // Binary radius only: sharp panels, pill controls.
        none: "0px",
        pill: "999px",
      },
      keyframes: {
        // Slow "mercury flow" ambient drift for the marketing hero render only.
        "mercury-drift": {
          "0%, 100%": { transform: "scale(1.14) translate3d(0, 0, 0)" },
          "33%": { transform: "scale(1.2) translate3d(2.5%, -2%, 0)" },
          "66%": { transform: "scale(1.18) translate3d(-2%, 1.5%, 0)" },
        },
        // Drifting specular highlight for the frosted "liquid glass" sheen.
        "glass-sheen": {
          "0%, 100%": { transform: "translate3d(0, 0, 0)", opacity: "0.55" },
          "50%": { transform: "translate3d(5%, 4%, 0)", opacity: "1" },
        },
        "spin-slow": { to: { transform: "rotate(360deg)" } },
      },
      animation: {
        "mercury-drift": "mercury-drift 20s ease-in-out infinite",
        "glass-sheen": "glass-sheen 14s ease-in-out infinite",
        "spin-slow": "spin-slow 18s linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;
