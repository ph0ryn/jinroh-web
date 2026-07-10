"use client";

import { useLayoutEffect, useRef } from "react";

import type { UIEvent } from "react";

const END_THRESHOLD_PX = 24;

export function useFollowScrollEnd(itemKey: string | null) {
  const containerRef = useRef<HTMLOListElement | null>(null);
  const shouldFollowRef = useRef(true);

  useLayoutEffect(() => {
    const container = containerRef.current;

    if (container === null || !shouldFollowRef.current) {
      return;
    }

    container.scrollTop = container.scrollHeight;
  }, [itemKey]);

  function handleScroll(event: UIEvent<HTMLOListElement>): void {
    const container = event.currentTarget;
    const distanceFromEnd = container.scrollHeight - container.scrollTop - container.clientHeight;

    shouldFollowRef.current = distanceFromEnd <= END_THRESHOLD_PX;
  }

  return { containerRef, handleScroll };
}
