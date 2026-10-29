import { createContext, ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import { useApp } from "../../data/store";
import { summarize } from "../../domain/analytics";
import { today } from "../../domain/dates";
import { AppData } from "../../domain/types";
import { AnalyticsPeriod } from "./selection";

function useAnalyticsState() {
  const [weeks, setWeeks] = useState<AnalyticsPeriod>(8);
  const [chartIndex, setChartIndex] = useState(0);
  const scrollOffset = useRef(0);
  const getScrollOffset = useCallback(() => scrollOffset.current, []);
  const saveScrollOffset = useCallback((offset: number) => { scrollOffset.current = offset; }, []);
  const [snapshot, setSnapshot] = useState<{ data: AppData; endDate: string } | null>(null);
  const refresh = useCallback((data: AppData) => {
    const endDate = today();
    setSnapshot((previous) => previous?.data === data && previous.endDate === endDate ? previous : { data, endDate });
  }, []);
  // Keep the last visible immutable data snapshot while Analytics is hidden.
  const result = useMemo(() => snapshot ? summarize(snapshot.data, weeks, snapshot.endDate, snapshot.data.settings.unit) : null, [snapshot, weeks]);
  return useMemo(() => ({
    data: snapshot?.data ?? null, result, refresh, weeks, setWeeks,
    chartIndex, setChartIndex, getScrollOffset, saveScrollOffset,
  }), [snapshot, result, refresh, weeks, chartIndex, getScrollOffset, saveScrollOffset]);
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
