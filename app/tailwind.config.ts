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
        // Sidereal: deep night-sky base with a single accent.
        ink: "#0b0e1a",
        panel: "#141a2e",
        accent: "#6ea8fe",
      },
    },
  },
  plugins: [],
};

export default config;
