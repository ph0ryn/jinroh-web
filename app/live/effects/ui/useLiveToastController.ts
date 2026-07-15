"use client";

import { useCallback, useReducer } from "react";

import {
  createLiveToastState,
  reduceLiveToastState,
  type LiveToastRequest,
  type LiveToastScope,
  type LiveToastState,
} from "./liveToastModel";

type LiveToastController = {
  readonly state: LiveToastState;
  readonly clearScope: (scope: LiveToastScope) => void;
  readonly completeEntry: (toastId: number) => void;
  readonly completeExit: (toastId: number) => void;
  readonly dismiss: (toastId: number) => void;
  readonly discardScope: (scope: LiveToastScope) => void;
  readonly request: (request: LiveToastRequest) => void;
};

export function useLiveToastController(): LiveToastController {
  const [state, dispatch] = useReducer(reduceLiveToastState, undefined, createLiveToastState);

  const clearScope = useCallback((scope: LiveToastScope) => {
    dispatch({ scope, type: "clearScope" });
  }, []);
  const completeEntry = useCallback((toastId: number) => {
    dispatch({ toastId, type: "entryCompleted" });
  }, []);
  const completeExit = useCallback((toastId: number) => {
    dispatch({ toastId, type: "exitCompleted" });
  }, []);
  const dismiss = useCallback((toastId: number) => {
    dispatch({ toastId, type: "dismiss" });
  }, []);
  const discardScope = useCallback((scope: LiveToastScope) => {
    dispatch({ scope, type: "discardScope" });
  }, []);
  const request = useCallback((request: LiveToastRequest) => {
    dispatch({ request, type: "request" });
  }, []);

  return { clearScope, completeEntry, completeExit, dismiss, discardScope, request, state };
}
