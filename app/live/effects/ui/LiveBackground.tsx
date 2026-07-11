"use client";

import { useEffect, useRef, useState } from "react";

import { useDocumentHidden } from "../useDocumentHidden";
import { usePrefersReducedMotion } from "../usePrefersReducedMotion";
import styles from "./liveBackground.module.css";
import {
  createLiveBackgroundState,
  getUniqueLiveBackgroundSources,
  LIVE_BACKGROUND_SOURCE_BY_MOOD,
  reconcileLiveBackgroundState,
  settleLiveBackgroundState,
  type LiveBackgroundSnapshot,
} from "./liveBackgroundModel";
import { useLiveBackgroundMotion } from "./useLiveBackgroundMotion";

const loadedSources = new Set<string>();
const sourceRequests = new Map<string, Promise<void>>();

type LiveBackgroundProps = {
  readonly snapshot: LiveBackgroundSnapshot;
};

export function LiveBackground({ snapshot }: LiveBackgroundProps) {
  const reducedMotion = usePrefersReducedMotion();
  const isDocumentHidden = useDocumentHidden();
  const [state, setState] = useState(() => createLiveBackgroundState(snapshot));
  const requestVersionRef = useRef(0);
  const shouldAnimate = !reducedMotion && !isDocumentHidden;
  const reconciledState = reconcileLiveBackgroundState(state, snapshot, shouldAnimate);
  const source = LIVE_BACKGROUND_SOURCE_BY_MOOD[snapshot.mood];
  const isWaitingForSource =
    reconciledState !== state && reconciledState.scenes.length > 1 && !loadedSources.has(source);

  if (reconciledState !== state && !isWaitingForSource) {
    setState(reconciledState);
  }

  const renderedState = isWaitingForSource ? state : reconciledState;
  const rootRef = useLiveBackgroundMotion({
    state: renderedState,
    onSettled: (generation) => {
      setState((currentState) => settleLiveBackgroundState(currentState, generation));
    },
  });

  useEffect(() => {
    if (!isWaitingForSource) {
      return;
    }

    requestVersionRef.current += 1;
    const requestVersion = requestVersionRef.current;

    void requestLiveBackgroundSource(source)
      .then(() => {
        if (requestVersionRef.current !== requestVersion) {
          return;
        }

        setState((currentState) =>
          reconcileLiveBackgroundState(currentState, snapshot, shouldAnimate),
        );
      })
      .catch(() => {
        if (requestVersionRef.current !== requestVersion) {
          return;
        }

        setState((currentState) => reconcileLiveBackgroundState(currentState, snapshot, false));
      });

    return () => {
      requestVersionRef.current += 1;
    };
  }, [isWaitingForSource, shouldAnimate, snapshot, source]);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      for (const source of getUniqueLiveBackgroundSources()) {
        void requestLiveBackgroundSource(source).catch(() => undefined);
      }
    }, 150);

    return () => window.clearTimeout(timerId);
  }, []);

  return (
    <div aria-hidden="true" className={styles["root"]} data-live-ambient-background ref={rootRef}>
      {renderedState.scenes.map((scene) => (
        <div
          className={styles["scene"]}
          data-live-background-mood={scene.mood}
          data-live-background-scene
          data-live-background-scene-id={scene.id}
          key={scene.id}
        >
          <div
            className={styles["image"]}
            data-live-background-image
            style={{ backgroundImage: `url("${LIVE_BACKGROUND_SOURCE_BY_MOOD[scene.mood]}")` }}
          />
          <div className={styles["scrim"]} />
          <div className={styles["wash"]} />
          <div className={styles["vignette"]} />
        </div>
      ))}
    </div>
  );
}

function requestLiveBackgroundSource(source: string): Promise<void> {
  if (loadedSources.has(source)) {
    return Promise.resolve();
  }

  const activeRequest = sourceRequests.get(source);

  if (activeRequest !== undefined) {
    return activeRequest;
  }

  const request = new Promise<void>((resolve, reject) => {
    const image = new window.Image();

    image.decoding = "async";
    image.onload = () => {
      void image
        .decode()
        .catch(() => undefined)
        .then(() => {
          loadedSources.add(source);
          resolve();
        });
    };
    image.onerror = () => reject(new Error("Live background image could not be loaded."));
    image.src = source;
  }).finally(() => sourceRequests.delete(source));

  sourceRequests.set(source, request);

  return request;
}
