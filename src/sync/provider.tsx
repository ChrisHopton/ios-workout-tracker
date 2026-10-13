import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { AppState, Platform } from "react-native";
import { useApp } from "../data/store";
import { syncRepository } from "../data/persistence";
import { SyncController } from "./controller";
import {
  loadCredentials,
  saveCredentials,
  removeCredentials,
} from "./credentials";
import { requestSync } from "./transport";
import { createPreviewTransport } from "./previewTransport";

const Context = createContext<SyncController | null>(null);
export function SyncProvider({ children }: { children: React.ReactNode }) {
  const { data, status } = useApp();
  const previous = useRef(data);
  const [controller] = useState(
    () =>
      new SyncController(
        syncRepository,
        {
          load: loadCredentials,
          save: saveCredentials,
          remove: removeCredentials,
        },
        Platform.OS === "web" ? createPreviewTransport() : requestSync,
      ),
  );
  useEffect(() => {
    controller.setActive(
      AppState.currentState === "active" || Platform.OS === "web",
    );
    void controller.initialize().catch(() => {});
    const subscription = AppState.addEventListener("change", (state) =>
      controller.setActive(state === "active"),
    );
    return () => {
      subscription.remove();
      controller.setActive(false);
    };
  }, [controller]);
  useEffect(() => {
    if (status !== "saved" || previous.current === data) return;
    const prior = new Map(
      previous.current.sessions.map((session) => [session.id, session.status]),
    );
    const finished = data.sessions.some(
      (session) =>
        session.status === "completed" && prior.get(session.id) !== "completed",
    );
    previous.current = data;
    controller.changed(finished);
  }, [controller, data, status]);
  return <Context.Provider value={controller}>{children}</Context.Provider>;
}
export function useSync() {
  const controller = useContext(Context);
  if (!controller) throw new Error("SyncProvider is required");
  const state = useSyncExternalStore(
    (listener) => controller.subscribe(listener),
    () => controller.getSnapshot(),
    () => controller.getSnapshot(),
  );
  return { state, controller };
}
