"use client";

import { useEffectEvent, useRef } from "react";

import { gsap, useGSAP } from "../liveGsap";

import type { LiveBackgroundState } from "./liveBackgroundModel";
import type { RefObject } from "react";

type GsapTimeline = ReturnType<typeof gsap.timeline>;

type UseLiveBackgroundMotionOptions = {
  readonly onSettled: (generation: number) => void;
  readonly state: LiveBackgroundState;
};

export function useLiveBackgroundMotion({
  onSettled,
  state,
}: UseLiveBackgroundMotionOptions): RefObject<HTMLDivElement | null> {
  const rootRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<GsapTimeline | null>(null);
  const runGenerationRef = useRef(0);
  const handleSettled = useEffectEvent(onSettled);
  const sceneKey = state.scenes.map((scene) => scene.id).join(":");

  useGSAP(
    () => {
      timelineRef.current?.kill();
      timelineRef.current = null;
      const root = rootRef.current;

      if (root === null) {
        return;
      }

      const scenes = gsap.utils.toArray<HTMLElement>("[data-live-background-scene]", root);
      const latestScene = state.scenes.at(-1);
      const incoming =
        latestScene === undefined
          ? null
          : root.querySelector<HTMLElement>(`[data-live-background-scene-id="${latestScene.id}"]`);

      if (state.scenes.length <= 1 || incoming === null) {
        clearSceneMotionProperties(scenes);
        delete root.dataset["liveBackgroundMotion"];
        return;
      }

      const runGeneration = (runGenerationRef.current += 1);

      gsap.set(incoming, { autoAlpha: 0, willChange: "opacity" });
      root.dataset["liveBackgroundMotion"] = "crossfade";

      const timeline = gsap.timeline({
        defaults: { overwrite: "auto" },
        onComplete: () => {
          if (runGenerationRef.current !== runGeneration) {
            return;
          }

          clearSceneMotionProperties([incoming]);
          delete root.dataset["liveBackgroundMotion"];
          timelineRef.current = null;
          handleSettled(state.generation);
        },
      });

      timeline.to(incoming, { autoAlpha: 1, duration: 0.72, ease: "power2.inOut" }, 0);

      timelineRef.current = timeline;

      return () => timeline.kill();
    },
    { dependencies: [sceneKey, state.generation], scope: rootRef },
  );

  return rootRef;
}

function clearSceneMotionProperties(scenes: readonly HTMLElement[]): void {
  for (const scene of scenes) {
    gsap.set(scene, { clearProps: "opacity,visibility,willChange" });
  }
}
