import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { AppState, Platform } from "react-native";
import * as Crypto from "expo-crypto";
import { useApp } from "../data/store";
import { syncRepository } from "../data/persistence";
import { SyncController } from "./controller";
import {
  loadCredentials,
  saveCredentials,
  removeCredentials,
} from "./credentials";
import { createUploadStartup } from "./startup";
import { createUploadRuntime } from "./runtime";
import { createAutomaticBootstrap } from "./bootstrap";

const Context = createContext<{ controller: SyncController; retry: () => void } | null>(null);
export function SyncProvider({ children }: { children: React.ReactNode }) {
  const { data, status } = useApp();
  const previous = useRef(data);
  const [runtime] = useState(createUploadRuntime);
  const [bootstrap] = useState(() => createAutomaticBootstrap(syncRepository, {
    load: loadCredentials, save: saveCredentials, remove: removeCredentials,
  }, { ...runtime, createId: () => Crypto.randomUUID() }));
  const [controller] = useState(
    () =>
      new SyncController(
        syncRepository,
        {
          load: loadCredentials,
          save: saveCredentials,
          remove: removeCredentials,
        },
        runtime.transport,
        { createInstallationId: () => Crypto.randomUUID() },
      ),
  );
  const startup = useRef<ReturnType<typeof createUploadStartup> | null>(null);
  const [context] = useState(() => ({ controller, retry: () => startup.current?.retry() }));
  useEffect(() => {
    const runner = createUploadStartup({
      bootstrap, initialize: () => controller.initialize(),
      started: () => controller.reportSetupStarted(),
      failed: (error, retryAt) => controller.reportStartupError(error, retryAt),
      retryUpload: () => controller.retry(),
    });
    startup.current = runner;
    const setActive = (active: boolean) => { controller.setActive(active); runner.setActive(active); };
    setActive(AppState.currentState === "active" || Platform.OS === "web");
    const subscription = AppState.addEventListener("change", (state) => setActive(state === "active"));
    return () => { runner.dispose(); startup.current = null; subscription.remove(); controller.setActive(false); };
  }, [bootstrap, controller]);
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
  return <Context.Provider value={context}>{children}</Context.Provider>;
}
export function useSync() {
  const context = useContext(Context);
  if (!context) throw new Error("SyncProvider is required");
  const { controller, retry } = context;
  const state = useSyncExternalStore(
    (listener) => controller.subscribe(listener),
    () => controller.getSnapshot(),
    () => controller.getSnapshot(),
  );
  return { state, controller, retry };
}
