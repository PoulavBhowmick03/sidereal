// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { layoutCalloutBox } from "../lib/tourOverlayLayout";

describe("layoutCalloutBox", () => {
  it("pushes compact header callouts below the full header instead of the target row", () => {
    const callout = layoutCalloutBox(
      {
        left: 260,
        top: 24,
        right: 344,
        bottom: 60,
        width: 84,
        height: 36,
      },
      { width: 390, height: 844 },
      112,
    );

    expect(callout.placement).toBe("below");
    expect(callout.top).toBeGreaterThanOrEqual(130);
    expect(callout.left).toBeGreaterThanOrEqual(16);
    expect(callout.left + callout.width).toBeLessThanOrEqual(390 - 16);
    expect(callout.width).toBeLessThanOrEqual(280);
  });

  it("keeps non-header layouts centered around the target on wider screens", () => {
    const callout = layoutCalloutBox(
      {
        left: 480,
        top: 180,
        right: 600,
        bottom: 220,
        width: 120,
        height: 40,
      },
      { width: 1280, height: 720 },
      null,
    );

    expect(callout.placement).toBe("below");
    expect(callout.width).toBe(320);
    expect(callout.left).toBe(380);
  });
});
