"use client";

import { useSyncExternalStore } from "react";

export function useDocumentHidden(): boolean {
  return useSyncExternalStore(
    subscribeToDocumentVisibility,
    readDocumentHidden,
    readServerDocumentHidden,
  );
}

export function readDocumentHidden(): boolean {
  return document.visibilityState === "hidden";
}

function subscribeToDocumentVisibility(onStoreChange: () => void): () => void {
  if (typeof document === "undefined") {
    return () => undefined;
  }

  document.addEventListener("visibilitychange", onStoreChange);

  return () => document.removeEventListener("visibilitychange", onStoreChange);
}

function readServerDocumentHidden(): boolean {
  return false;
}
