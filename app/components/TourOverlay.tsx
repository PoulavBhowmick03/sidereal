// SPDX-License-Identifier: Apache-2.0

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { appConfig, isDeployed } from "@/lib/config";
import { useWallet } from "@/lib/wallet";
import { useBlendPosition } from "@/lib/useBlendPosition";
import { usePosition } from "@/lib/usePosition";
import { layoutCalloutBox, type CalloutBox } from "@/lib/tourOverlayLayout";
import {
  TOUR_REPLAY_EVENT,
  TOUR_VISIBILITY_EVENT,
  clearTourPreference,
  isTourComplete,
  readTourPreference,
  resolveTourStep,
  writeTourPreference,
  type TourPreference,
  type TourStep,
} from "@/lib/tour";

const REFRESH_MS = 15_000;
const MEASURE_MS = 500;

interface TargetBox {
  left: number;
  top: number;
  width: number;
  height: number;
  radius: string;
}

function targetSelector(key: string): string {
  return `[data-tour="${key}"]`;
}

function findTarget(step: TourStep): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>(targetSelector(step.target)) ??
    (step.fallbackTarget
      ? document.querySelector<HTMLElement>(targetSelector(step.fallbackTarget))
      : null)
  );
}

function measureTarget(step: TourStep): { target: TargetBox; callout: CalloutBox } | null {
  const element = findTarget(step);
  if (!element) return null;

  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const headerBottom = element.closest("header")?.getBoundingClientRect().bottom ?? null;

  const target: TargetBox = {
    left: rect.left - 6,
    top: rect.top - 6,
    width: rect.width + 12,
    height: rect.height + 12,
    radius: window.getComputedStyle(element).borderRadius || "9999px",
  };

  return {
    target,
    callout: layoutCalloutBox(rect, { width: window.innerWidth, height: window.innerHeight }, headerBottom),
  };
}

function sameBoxes(
  a: { target: TargetBox; callout: CalloutBox } | null,
  b: { target: TargetBox; callout: CalloutBox } | null,
): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return (
    a.target.left === b.target.left &&
    a.target.top === b.target.top &&
    a.target.width === b.target.width &&
    a.target.height === b.target.height &&
    a.target.radius === b.target.radius &&
    a.callout.left === b.callout.left &&
    a.callout.top === b.callout.top &&
    a.callout.width === b.callout.width &&
    a.callout.arrowLeft === b.callout.arrowLeft &&
    a.callout.placement === b.callout.placement
  );
}

export function TourOverlay() {
  const cfg = useMemo(() => appConfig(), []);
  const pathname = usePathname();
  const { address } = useWallet();
  const [mounted, setMounted] = useState(false);
  const [preference, setPreference] = useState<TourPreference>(null);
  const [goalChosen, setGoalChosen] = useState(false);
  const [tick, setTick] = useState(0);
  const [boxes, setBoxes] = useState<{ target: TargetBox; callout: CalloutBox } | null>(null);

  const blendPosition = useBlendPosition(address, tick);
  const position = usePosition(address, tick);

  useEffect(() => {
    setMounted(true);
    setPreference(readTourPreference(window.localStorage));
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setTick((value) => value + 1), REFRESH_MS);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    function replay() {
      clearTourPreference(window.localStorage);
      setPreference(null);
      setGoalChosen(false);
      setTick((value) => value + 1);
    }

    window.addEventListener(TOUR_REPLAY_EVENT, replay);
    return () => window.removeEventListener(TOUR_REPLAY_EVENT, replay);
  }, []);

  useEffect(() => {
    function markGoalChosen(event: Event) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(targetSelector("tokenize-goal")) || target.closest(targetSelector("mint-amount"))) {
        window.setTimeout(() => setGoalChosen(true), 0);
      }
    }

    document.addEventListener("click", markGoalChosen);
    document.addEventListener("input", markGoalChosen);
    return () => {
      document.removeEventListener("click", markGoalChosen);
      document.removeEventListener("input", markGoalChosen);
    };
  }, []);

  const state = useMemo(
    () => ({
      address,
      pathname,
      preference,
      goalChosen,
      blendPosition,
      position,
    }),
    [address, blendPosition, goalChosen, pathname, position, preference],
  );

  const step = useMemo(
    () => (mounted && isDeployed(cfg) ? resolveTourStep(state) : null),
    [cfg, mounted, state],
  );

  useEffect(() => {
    if (!mounted || preference !== null || !isTourComplete(state)) return;
    writeTourPreference(window.localStorage, "done");
    setPreference("done");
  }, [mounted, preference, state]);

  const measure = useCallback(() => {
    const next = step ? measureTarget(step) : null;
    setBoxes((current) => (sameBoxes(current, next) ? current : next));
  }, [step]);

  useEffect(() => {
    measure();
    if (!step) return;

    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    const id = window.setInterval(measure, MEASURE_MS);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      window.clearInterval(id);
    };
  }, [measure, step]);

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent(TOUR_VISIBILITY_EVENT, { detail: { active: step !== null && boxes !== null } }),
    );
  }, [boxes, step]);

  function skipTour() {
    writeTourPreference(window.localStorage, "dismissed");
    setPreference("dismissed");
    setBoxes(null);
  }

  if (!mounted || !step || !boxes) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-50" aria-live="polite">
      <div
        data-tour-halo
        className="absolute border-2 border-amber"
        style={{
          left: boxes.target.left,
          top: boxes.target.top,
          width: boxes.target.width,
          height: boxes.target.height,
          borderRadius: boxes.target.radius,
          boxShadow: "0 0 0 6px rgba(234, 179, 8, 0.12), 0 0 28px rgba(234, 179, 8, 0.28)",
        }}
      >
        <div className="absolute inset-0 motion-safe:animate-ping border border-amber/70" style={{ borderRadius: boxes.target.radius }} />
      </div>

      <section
        role="dialog"
        aria-label="Guided tour"
        className="pointer-events-auto absolute border border-amber/30 bg-carbon p-4 shadow-2xl shadow-black/40"
        style={{
          left: boxes.callout.left,
          top: boxes.callout.top,
          width: boxes.callout.width,
        }}
      >
        <span
          aria-hidden
          className={`absolute h-3 w-3 rotate-45 border border-amber/30 bg-carbon ${
            boxes.callout.placement === "below"
              ? "-top-1.5 border-b-0 border-r-0"
              : "-bottom-1.5 border-l-0 border-t-0"
          }`}
          style={{ left: boxes.callout.arrowLeft }}
        />
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="label-data">
              Step {step.index} of {step.total}
            </p>
            <h2 className="mt-2 text-base font-semibold text-paper">{step.title}</h2>
          </div>
          <button
            type="button"
            onClick={skipTour}
            className="rounded-pill border border-white/20 px-3 py-1.5 text-[13px] uppercase tracking-[0.1em] text-smoke transition hover:border-paper hover:text-paper"
          >
            Skip
          </button>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-smoke">{step.instruction}</p>
      </section>
    </div>
  );
}
