import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { ActivityIndicator, AppState, View } from "react-native";
import { AppData, SaveStatus } from "../domain/types";
import { parseBackup } from "../domain/backup";
import { SaveQueue } from "./saveQueue";
import { loadData, writeData } from "./persistence";
import { Button, Txt, useTheme } from "../components/ui";
interface AppContextValue {
  data: AppData;
  status: SaveStatus;
  error: string | null;
  update: (fn: (data: AppData) => AppData) => void;
  flush: () => Promise<void>;
  retry: () => Promise<void>;
  replace: (next: AppData) => Promise<void>;
}
const Context = createContext<AppContextValue | null>(null);
export function AppProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<AppData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [error, setError] = useState<string | null>(null);
  const dataRef = useRef<AppData | null>(null);
  const restoring = useRef(false);
  const version = useRef(0);
  const t = useTheme();
  const [queue] = useState(() => new SaveQueue<AppData>(writeData));
  async function load() {
    setLoadError(null);
    try {
      const next = await loadData();
      dataRef.current = next;
      setData(next);
    } catch (e) {
      setLoadError(
        e instanceof Error ? e.message : "Unable to open your saved workouts.",
      );
    }
  }
  useEffect(() => {
    let active = true;
    void loadData().then(
      (next) => {
        if (active) {
          dataRef.current = next;
          setData(next);
        }
      },
      (e) => {
        if (active)
          setLoadError(
            e instanceof Error ? e.message : "Unable to open saved workouts.",
          );
      },
    );
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") void queue.flush().catch(() => {});
    });
    return () => sub.remove();
  }, [queue]);
  function update(fn: (current: AppData) => AppData) {
    if (restoring.current)
      throw new Error("Please wait for the backup to finish restoring.");
    if (!dataRef.current) throw new Error("Your workouts are still loading.");
    // Validate and detach the snapshot before displaying it or scheduling a durable write.
    const next = parseBackup(JSON.stringify(fn(dataRef.current)));
    dataRef.current = next;
    setData(next);
    setStatus("saving");
    setError(null);
    const v = ++version.current;
    void queue.enqueue(next).then(
      () => {
        if (v === version.current) {
          setStatus("saved");
          setError(null);
        }
      },
      (e) => {
        if (v === version.current) {
          setStatus("error");
          setError(
            e instanceof Error ? e.message : "Changes could not be saved.",
          );
        }
      },
    );
  }
  async function retry() {
    if (restoring.current)
      throw new Error("Please wait for the backup to finish restoring.");
    const v = ++version.current;
    setStatus("saving");
    setError(null);
    try {
      await queue.retry();
      if (v === version.current) {
        setStatus("saved");
        setError(null);
      }
    } catch (e) {
      if (v === version.current) {
        setStatus("error");
        setError(e instanceof Error ? e.message : "Save failed.");
      }
      throw e;
    }
  }
  async function replace(value: AppData) {
    if (restoring.current) throw new Error("A restore is already running.");
    if (!dataRef.current) throw new Error("Your workouts are still loading.");
    const next = parseBackup(JSON.stringify(value));
    const current = dataRef.current;
    restoring.current = true;
    const v = ++version.current;
    setStatus("saving");
    setError(null);
    try {
      await queue.replace(next, current);
      // Imported data becomes visible only after the complete snapshot has been committed.
      dataRef.current = next;
      setData(next);
      if (v === version.current) {
        setStatus("saved");
        setError(null);
      }
    } catch (e) {
      if (v === version.current) {
        setStatus("error");
        setError(
          e instanceof Error
            ? e.message
            : "Backup could not be restored. Your current workouts are unchanged.",
        );
      }
      throw e;
    } finally {
      restoring.current = false;
    }
  }
  if (!data)
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          padding: 30,
          gap: 20,
          backgroundColor: t.bg,
        }}
      >
        {loadError ? (
          <>
            <Txt bold>Unable to open your workouts</Txt>
            <Txt>{loadError}</Txt>
            <Txt muted>Your existing data has not been replaced.</Txt>
            <Button title="Try again" onPress={() => void load()} />
          </>
        ) : (
          <>
            <ActivityIndicator color={t.accent} />
            <Txt style={{ textAlign: "center" }}>Opening your workouts…</Txt>
          </>
        )}
      </View>
    );
  return (
    <Context.Provider
      value={{
        data,
        status,
        error,
        update,
        flush: () => queue.flush(),
        retry,
        replace,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useApp() {
  const value = useContext(Context);
  if (!value) throw new Error("AppProvider is required");
  return value;
}
