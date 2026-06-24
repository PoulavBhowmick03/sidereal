// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from "vitest/config";

// Unit tests live in tests/ (*.test.ts). The e2e/ Playwright specs (*.spec.ts)
// run via `pnpm test:e2e`, not vitest, so they are excluded here.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["e2e/**", "node_modules/**"],
  },
});
