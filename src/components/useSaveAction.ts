import { useState, useSyncExternalStore } from "react";
import { SaveAction } from "./saveAction";

export function useSaveAction() {
  const [action] = useState(() => new SaveAction());
  const state = useSyncExternalStore(action.subscribe, action.getSnapshot, action.getSnapshot);
  return { ...state, run: action.run, edited: action.edited };
}
