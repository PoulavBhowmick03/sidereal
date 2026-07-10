// SPDX-License-Identifier: Apache-2.0

const CALLOUT_WIDTH = 320;
const CALLOUT_WIDTH_COMPACT = 280;
const CALLOUT_HEIGHT = 176;
const GAP = 18;
const EDGE = 16;

export interface CalloutBox {
  left: number;
  top: number;
  width: number;
  arrowLeft: number;
  placement: "above" | "below";
}

export interface RectBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function layoutCalloutBox(
  rect: RectBox,
  viewport: { width: number; height: number },
  headerBottom: number | null,
): CalloutBox {
  const compactViewport = viewport.width < 640;
  const width = Math.min(
    compactViewport ? CALLOUT_WIDTH_COMPACT : CALLOUT_WIDTH,
    viewport.width - EDGE * 2,
  );
  const center = rect.left + rect.width / 2;
  // Header targets need extra care on narrow screens: if the callout sits
  // directly beneath the wallet/nav target, it can spill back across the
  // wrapped header and intercept sibling nav links. Align it tighter to the
  // target and push it below the full header instead.
  const left = clamp(
    compactViewport && headerBottom !== null ? rect.right - width : center - width / 2,
    EDGE,
    viewport.width - width - EDGE,
  );
  const belowTop =
    headerBottom !== null ? Math.max(rect.bottom + GAP, headerBottom + GAP) : rect.bottom + GAP;
  const fitsBelow = belowTop + CALLOUT_HEIGHT <= viewport.height - EDGE;
  const top = fitsBelow
    ? belowTop
    : clamp(rect.top - CALLOUT_HEIGHT - GAP, EDGE, viewport.height - CALLOUT_HEIGHT - EDGE);

  return {
    left,
    top,
    width,
    arrowLeft: clamp(center - left - 6, 22, width - 22),
    placement: fitsBelow ? "below" : "above",
  };
}
