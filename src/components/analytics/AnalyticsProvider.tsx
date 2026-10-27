import { createContext, ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import { useApp } from "../../data/store";
import { summarize } from "../../domain/analytics";
import { ReferenceGroup, referenceGroupForGender } from "../../domain/benchmarks";
import { today } from "../../domain/dates";
import { AppData, MuscleGroup } from "../../domain/types";
import { AnalyticsPeriod, ExerciseFilter } from "./selection";

function useAnalyticsState() {
  const [weeks, setWeeks] = useState<AnalyticsPeriod>(8);
  const [query, setQuery] = useState("");
  const [exerciseGroup, setExerciseGroup] = useState<ExerciseFilter>("All");
  const [trainingGroup, setTrainingGroup] = useState<MuscleGroup>("Legs");
  const [referenceOverride, setReferenceOverride] = useState<ReferenceGroup | null | undefined>(undefined);
  const [snapshot, setSnapshot] = useState<{ data: AppData; endDate: string } | null>(null);
  const refresh = useCallback((data: AppData) => {
    const endDate = today();
    setSnapshot((previous) => previous?.data === data && previous.endDate === endDate ? previous : { data, endDate });
  }, []);
  // App data is already immutable. Keep its visible reference while every Analytics route is hidden.
  const result = useMemo(() => snapshot ? summarize(snapshot.data, weeks, snapshot.endDate, snapshot.data.settings.unit) : null, [snapshot, weeks]);
  const referenceGroup = referenceOverride === undefined ? referenceGroupForGender(snapshot?.data.settings.gender ?? "") : referenceOverride;
  return useMemo(() => ({
    data: snapshot?.data ?? null, result, refresh, weeks, setWeeks,
    query, setQuery, exerciseGroup, setExerciseGroup, trainingGroup, setTrainingGroup,
    referenceGroup, referenceOverride, setReferenceOverride,
  }), [snapshot, result, refresh, weeks, query, exerciseGroup, trainingGroup, referenceGroup, referenceOverride]);
}

const Context = createContext<ReturnType<typeof useAnalyticsState> | null>(null);
export function AnalyticsProvider({ children }: { children: ReactNode }) {
  return <Context.Provider value={useAnalyticsState()}>{children}</Context.Provider>;
}

export function useAnalytics() {
  const context = useContext(Context);
  const { data: currentData } = useApp();
  if (!context) throw new Error("AnalyticsProvider is missing.");
  const { refresh } = context;
  useFocusEffect(useCallback(() => {
    let midnight: ReturnType<typeof setTimeout>;
    function update() {
      clearTimeout(midnight);
      refresh(currentData);
      const now = new Date();
      const nextDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      midnight = setTimeout(update, nextDay.getTime() - now.getTime());
    }
    update();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") update();
    });
    return () => { clearTimeout(midnight); subscription.remove(); };
  }, [currentData, refresh]));
  return context;
}
