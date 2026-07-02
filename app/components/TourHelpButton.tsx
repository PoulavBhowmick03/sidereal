// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useMemo, useState } from "react";
import { appConfig, isDeployed } from "@/lib/config";
import {
  TOUR_REPLAY_EVENT,
  TOUR_VISIBILITY_EVENT,
  clearTourPreference,
} from "@/lib/tour";

export function TourHelpButton() {
  const cfg = useMemo(() => appConfig(), []);
  const [mounted, setMounted] = useState(false);
  const [tourActive, setTourActive] = useState(false);

  useEffect(() => {
    setMounted(true);
    function onVisibility(event: Event) {
      const detail = event instanceof CustomEvent ? event.detail : null;
      setTourActive(Boolean(detail?.active));
    }

    window.addEventListener(TOUR_VISIBILITY_EVENT, onVisibility);
    return () => window.removeEventListener(TOUR_VISIBILITY_EVENT, onVisibility);
  }, []);

  if (!mounted || !isDeployed(cfg) || tourActive) return null;

  return (
    <button
      type="button"
      aria-label="Replay guided tour"
      title="Replay guided tour"
      onClick={() => {
        clearTourPreference(window.localStorage);
        window.dispatchEvent(new Event(TOUR_REPLAY_EVENT));
      }}
      className="rounded-pill border border-white/20 px-3 py-2 text-[13px] uppercase tracking-[0.12em] text-smoke transition hover:border-paper hover:text-paper"
      data-tour="tour-help"
    >
      ?
    </button>
  );
}
