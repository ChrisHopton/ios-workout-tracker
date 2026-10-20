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
import { SyncError } from "./transport";
import { createUploadRuntime } from "./runtime";
import { createAutomaticBootstrap } from "./bootstrap";

const Context = createContext<SyncController | null>(null);
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
  useEffect(() => {
    let mounted = true;
    let ready = false;
    let running = false;
    let blocked = false;
    let active = AppState.currentState === "active" || Platform.OS === "web";
    let retryDelay = 15_000;
    let retryAt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const clear = () => { if (timer) clearTimeout(timer); timer = undefined; };
    async function start() {
      if (!mounted || !active || ready || running || blocked) return;
      clear();
      if (Date.now() < retryAt) { timer = setTimeout(() => void start(), retryAt - Date.now()); return; }
      running = true;
      try {
        if (await bootstrap(() => mounted && active)) {
          if (!mounted) return;
          if (!await controller.initialize()) throw new SyncError("The saved upload connection could not be loaded. Your workouts remain on this phone.", true, "storage");
          ready = true;
        }
      } catch (error) {
        if (!mounted) return;
        controller.reportStartupError(error);
        if (!(error instanceof SyncError) || error.retryable) {
          retryAt = Math.max(Date.now() + retryDelay, error instanceof SyncError ? error.retryAt ?? 0 : 0);
          retryDelay = Math.min(retryDelay * 2, 300_000);
        } else blocked = true;
      } finally {
        running = false;
        // A resume can arrive while setup is finishing in the background.
        if (mounted && active && !ready && !blocked && !timer)
          timer = setTimeout(() => void start(), Math.max(0, retryAt - Date.now()));
      }
    }
    controller.setActive(active);
    void start();
    const subscription = AppState.addEventListener("change", (state) => {
      active = state === "active";
      controller.setActive(active);
      if (active) void start(); else clear();
    });
    return () => { mounted = false; clear(); subscription.remove(); controller.setActive(false); };
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
