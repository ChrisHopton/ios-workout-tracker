import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { router, Tabs } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useApp } from "../../data/store";
import { formatDate, today } from "../../domain/dates";
import { startSession } from "../../domain/sessions";
import { WorkoutTemplate } from "../../domain/types";
import { Button, Card, Row, Screen, Txt, useTheme } from "../../components/ui";
import { SaveIndicator } from "../../components/SaveIndicator";
import { HomeWeekStrip, HomeWorkoutChooser } from "../../components/HomeComponents";
import { homeDayPresentation } from "../../components/homePresentation";

export default function Home() {
  const { data, update, flush } = useApp();
  const t = useTheme();
  const [selected, setSelected] = useState(today());
  const [now, setNow] = useState(today());
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  useEffect(() => {
    const id = setInterval(() => setNow(today()), 30000);
    return () => clearInterval(id);
  }, []);
  const day = homeDayPresentation(data, selected, now);
  const { session, template } = day;
  const active = data.templates.filter((workout) => !workout.archived);

  function selectDate(date: string) {
    if (busyRef.current) return;
    setSelected(date);
    setChoosing(false);
    setError("");
  }

  async function record(chosen?: WorkoutTemplate) {
    if (busyRef.current || selected > today()) return;
    if (!session && !chosen && !template) {
      setError("");
      setChoosing(true);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setChoosing(false);
    setError("");
    try {
      let id = session?.id;
      if (!id) {
        const workout = chosen ?? template;
        if (!workout) return;
        update((current) => {
          const result = startSession(current, workout, selected);
          id = result.session.id;
          return result.data;
        });
      }
      await flush();
      router.push({ pathname: "/record", params: { id } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to open workout.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <Screen bottomSafeArea={false}>
      <Tabs.Screen
        options={{
          headerTitle: selected === now ? "Today" : formatDate(selected, { weekday: "long" }),
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Plans"
              accessibilityHint="Create or edit workout plans."
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              onPress={() => router.push("/plans")}
              style={{ minWidth: 44, minHeight: 44, justifyContent: "center", paddingHorizontal: 12, marginRight: 4 }}
            >
              <Txt bold style={{ color: t.accent }}>Plans</Txt>
            </Pressable>
          ),
        }}
      />
      <HomeWeekStrip data={data} selected={selected} currentDate={now} disabled={busy} onSelect={selectDate} />
      <Card>
        <Txt bold style={{ fontSize: 27, lineHeight: 35 }}>{day.title}</Txt>
        {session || template ? (
          <Txt muted>{day.exerciseCount} exercises · {day.setCount} sets</Txt>
        ) : (
          <Txt muted>
            {active.length ? "Rest, or choose a workout." : "Add your first workout from Plans."}
          </Txt>
        )}
        {session && (
          <View style={{ gap: 6 }}>
            {session.status === "completed" ? (
              <Row style={{ gap: 6, flexWrap: "wrap" }}>
                <Ionicons name="checkmark-circle" size={17} color={t.success} />
                <Txt style={{ color: t.success, fontSize: 14 }}>Completed</Txt>
              </Row>
            ) : (
              <Txt muted style={{ fontSize: 14 }}>{day.completedSets} of {day.setCount} sets recorded</Txt>
            )}
            {session.status !== "completed" && (
              <View
                accessible
                accessibilityRole="progressbar"
                accessibilityLabel="Sets recorded"
                accessibilityValue={{ min: 0, max: day.setCount, now: day.completedSets }}
                style={{ height: 4, borderRadius: 2, backgroundColor: t.border, overflow: "hidden" }}
              >
                <View style={{ height: "100%", width: `${day.setCount ? day.completedSets / day.setCount * 100 : 0}%`, backgroundColor: t.accent }} />
              </View>
            )}
          </View>
        )}
        {day.actionLabel ? (
          <Button title={busy ? "Opening…" : day.actionLabel} disabled={busy} onPress={() => void record()} />
        ) : (
          <Txt muted>Recording opens on this date.</Txt>
        )}
      </Card>
      {!!error && (
        <View accessibilityLiveRegion="polite">
          <Txt style={{ color: t.danger }}>{error}</Txt>
        </View>
      )}
      <SaveIndicator compact />
      <HomeWorkoutChooser
        visible={choosing}
        workouts={active}
        onSelect={(workout) => void record(workout)}
        onClose={() => setChoosing(false)}
      />
    </Screen>
  );
}
