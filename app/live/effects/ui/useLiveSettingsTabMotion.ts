"use client";

import { useCallback, useEffectEvent, useRef } from "react";

import { gsap, useGSAP } from "../liveGsap";
import { usePrefersReducedMotion } from "../usePrefersReducedMotion";
import {
  LIVE_SETTINGS_TABS,
  type LiveSettingsTab,
  type LiveSettingsTabState,
} from "./liveSettingsTabModel";

import type { RefObject } from "react";

type GsapTimeline = ReturnType<typeof gsap.timeline>;

type PanelMotionSnapshot = {
  readonly opacity: number;
  readonly x: number;
};

type TabMotionSnapshot = {
  readonly indicatorRect: DOMRect | null;
  readonly panels: ReadonlyMap<LiveSettingsTab, PanelMotionSnapshot>;
};

type UseLiveSettingsTabMotionOptions = {
  readonly state: LiveSettingsTabState;
  readonly onSettled: (generation: number) => void;
};

type LiveSettingsTabMotion = {
  readonly captureTransition: () => void;
  readonly rootRef: RefObject<HTMLDivElement | null>;
};

export function useLiveSettingsTabMotion({
  state,
  onSettled,
}: UseLiveSettingsTabMotionOptions): LiveSettingsTabMotion {
  const rootRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<GsapTimeline | null>(null);
  const runGenerationRef = useRef(0);
  const snapshotRef = useRef<TabMotionSnapshot | null>(null);
  const reducedMotion = usePrefersReducedMotion();
  const handleSettled = useEffectEvent(onSettled);

  const captureTransition = useCallback(() => {
    const root = rootRef.current;

    if (root === null) {
      snapshotRef.current = null;
      return;
    }

    const indicator = root.querySelector<HTMLElement>("[data-live-settings-tab-indicator]");
    const panels = new Map<LiveSettingsTab, PanelMotionSnapshot>();

    for (const tab of LIVE_SETTINGS_TABS) {
      const panel = getPanelMotionElement(root, tab);

      if (panel === null) {
        continue;
      }

      if (panel.closest("[hidden]") !== null) {
        continue;
      }

      panels.set(tab, {
        opacity: toFiniteNumber(gsap.getProperty(panel, "opacity"), 1),
        x: toFiniteNumber(gsap.getProperty(panel, "x"), 0),
      });
    }

    snapshotRef.current = {
      indicatorRect: indicator?.getBoundingClientRect() ?? null,
      panels,
    };
  }, []);

  useGSAP(
    () => {
      timelineRef.current?.kill();
      timelineRef.current = null;
      const runGeneration = (runGenerationRef.current += 1);
      const root = rootRef.current;

      if (root === null) {
        return;
      }

      const indicator = root.querySelector<HTMLElement>("[data-live-settings-tab-indicator]");
      const tabList = root.querySelector<HTMLElement>("[data-live-settings-tab-list]");
      const activeButton = root.querySelector<HTMLElement>(
        `[data-live-settings-tab="${state.activeTab}"]`,
      );
      const motionElements = LIVE_SETTINGS_TABS.map((tab) =>
        getPanelMotionElement(root, tab),
      ).filter((element): element is HTMLElement => element !== null);
      const incoming = getPanelMotionElement(root, state.activeTab);
      const outgoing =
        state.outgoingTab === null ? null : getPanelMotionElement(root, state.outgoingTab);
      const snapshot = snapshotRef.current;

      snapshotRef.current = null;
      keepSelectedTabVisible(tabList, activeButton);

      if (state.outgoingTab === null || incoming === null || outgoing === null) {
        clearPanelMotionProperties(motionElements);
        clearIndicatorMotionProperties(indicator);
        delete root.dataset["liveSettingsTabMotionKind"];
        return;
      }

      const retainedElements = new Set([incoming, outgoing]);

      clearPanelMotionProperties(
        motionElements.filter((element) => !retainedElements.has(element)),
      );
      prepareIndicator(indicator, snapshot?.indicatorRect ?? null);
      preparePanel(
        incoming,
        snapshot?.panels.get(state.activeTab) ?? null,
        state.direction * 22,
        0,
      );
      preparePanel(outgoing, snapshot?.panels.get(state.outgoingTab) ?? null, 0, 1);
      root.dataset["liveSettingsTabMotionKind"] = "switch";

      if (reducedMotion || document.visibilityState !== "visible") {
        gsap.set(incoming, { opacity: 1, x: 0 });
        gsap.set(outgoing, { opacity: 0, x: state.direction * -14 });
        clearPanelMotionProperties([incoming]);
        clearIndicatorMotionProperties(indicator);
        delete root.dataset["liveSettingsTabMotionKind"];
        handleSettled(state.generation);
        return;
      }

      const timeline = gsap.timeline({
        defaults: { overwrite: "auto" },
        onComplete: () => {
          if (runGenerationRef.current !== runGeneration) {
            return;
          }

          clearPanelMotionProperties([incoming]);
          clearIndicatorMotionProperties(indicator);
          delete root.dataset["liveSettingsTabMotionKind"];
          timelineRef.current = null;
          handleSettled(state.generation);
        },
      });

      timeline
        .to(
          outgoing,
          {
            duration: 0.14,
            ease: "power2.in",
            opacity: 0,
            x: state.direction * -14,
          },
          0,
        )
        .to(
          incoming,
          {
            duration: 0.24,
            ease: "power3.out",
            opacity: 1,
            x: 0,
          },
          0.07,
        );

      if (indicator !== null) {
        timeline.to(
          indicator,
          {
            duration: 0.22,
            ease: "power3.out",
            scaleX: 1,
            x: 0,
          },
          0,
        );
      }

      timelineRef.current = timeline;
    },
    {
      dependencies: [
        reducedMotion,
        state.activeTab,
        state.direction,
        state.generation,
        state.outgoingTab,
      ],
      scope: rootRef,
    },
  );

  return { captureTransition, rootRef };
}

function getPanelMotionElement(root: HTMLElement, tab: LiveSettingsTab): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[data-live-settings-panel-motion="${tab}"]`);
}

function preparePanel(
  element: HTMLElement,
  snapshot: PanelMotionSnapshot | null,
  fallbackX: number,
  fallbackOpacity: number,
): void {
  gsap.set(element, {
    opacity: snapshot?.opacity ?? fallbackOpacity,
    willChange: "transform, opacity",
    x: snapshot?.x ?? fallbackX,
  });
}

function prepareIndicator(indicator: HTMLElement | null, previousRect: DOMRect | null): void {
  if (indicator === null) {
    return;
  }

  gsap.set(indicator, { clearProps: "transform,transformOrigin,willChange" });

  if (previousRect === null) {
    return;
  }

  const nextRect = indicator.getBoundingClientRect();

  gsap.set(indicator, {
    scaleX: nextRect.width > 0 ? previousRect.width / nextRect.width : 1,
    transformOrigin: "0 50%",
    willChange: "transform",
    x: previousRect.left - nextRect.left,
  });
}

function clearPanelMotionProperties(elements: readonly HTMLElement[]): void {
  if (elements.length === 0) {
    return;
  }

  gsap.set(elements, { clearProps: "opacity,transform,willChange" });
}

function clearIndicatorMotionProperties(indicator: HTMLElement | null): void {
  if (indicator === null) {
    return;
  }

  gsap.set(indicator, { clearProps: "transform,transformOrigin,willChange" });
}

function keepSelectedTabVisible(tabList: HTMLElement | null, tab: HTMLElement | null): void {
  if (tabList === null || tab === null) {
    return;
  }

  const leftEdge = tab.offsetLeft;
  const rightEdge = leftEdge + tab.offsetWidth;
  const visibleLeft = tabList.scrollLeft;
  const visibleRight = visibleLeft + tabList.clientWidth;

  if (leftEdge < visibleLeft) {
    tabList.scrollLeft = leftEdge;
  } else if (rightEdge > visibleRight) {
    tabList.scrollLeft = rightEdge - tabList.clientWidth;
  }
}

function toFiniteNumber(value: unknown, fallback: number): number {
  const number = typeof value === "number" ? value : Number(value);

  return Number.isFinite(number) ? number : fallback;
}
