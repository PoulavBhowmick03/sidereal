// SPDX-License-Identifier: Apache-2.0

import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Sidereal: deep night-sky base with twin accents (Principal/Yield).
        ink: "#070912",
        panel: "#111729",
        accent: "#6ea8fe", // Principal, calm blue
        accent2: "#b18cff", // Yield, violet
        glow: "#3b82f6",
      },
      fontFamily: {
        sans: [
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      backgroundImage: {
        "grid-faint":
          "linear-gradient(to right, rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.04) 1px, transparent 1px)",
        "radial-glow":
          "radial-gradient(60% 60% at 50% 0%, rgba(110,168,254,0.18) 0%, rgba(177,140,255,0.08) 40%, transparent 70%)",
      },
      keyframes: {
        floaty: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-12px)" },
        },
        "pulse-glow": {
          "0%, 100%": { opacity: "0.55" },
          "50%": { opacity: "1" },
        },
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(14px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "gradient-pan": {
          "0%, 100%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
        },
        "spin-slow": {
          to: { transform: "rotate(360deg)" },
        },
      },
      animation: {
        floaty: "floaty 6s ease-in-out infinite",
        "pulse-glow": "pulse-glow 4s ease-in-out infinite",
        "fade-up": "fade-up 0.7s cubic-bezier(0.22,1,0.36,1) both",
        "gradient-pan": "gradient-pan 8s ease infinite",
        "spin-slow": "spin-slow 40s linear infinite",
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(110,168,254,0.15), 0 18px 60px -18px rgba(110,168,254,0.45)",
      },
    },
  },
  plugins: [],
};

export default config;
