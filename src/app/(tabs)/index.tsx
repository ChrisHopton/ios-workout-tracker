import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { router, Tabs } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useApp } from "../../data/store";
import {
  addDays,
  dayDifference,
  formatDate,
  mondayOf,
  today,
} from "../../domain/dates";
import { revisionForDate, scheduleForDate } from "../../domain/schedule";
import { startSession } from "../../domain/sessions";
import { WEEKDAYS, WorkoutTemplate } from "../../domain/types";
import {
  Button,
  Card,
  Row,
  Screen,
  SectionTitle,
  Txt,
  useTheme,
} from "../../components/ui";
import { SaveIndicator } from "../../components/SaveIndicator";
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
  const start = mondayOf(selected);
  const session = data.sessions.find((s) => s.date === selected);
  const template = scheduleForDate(data, selected);
  const rev = revisionForDate(data, selected);
  const isFuture = selected > now;
  const active = data.templates.filter((w) => !w.archived);
  const alternating = rev?.slots.some((s) => s.workoutIds.length === 2);
  const week =
    rev &&
    Math.abs(Math.floor(dayDifference(start, rev.anchorMonday) / 7) % 2) === 1
      ? "B"
      : "A";
  async function record(chosen?: WorkoutTemplate) {
    if (busyRef.current || isFuture) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      let id = session?.id;
      if (!id) {
        const workout = chosen ?? template;
        if (!workout) {
          setChoosing(true);
          return;
        }
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
    <Screen>
      <Tabs.Screen
        options={{
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Create workout plan"
              onPress={() => router.push("/editor")}
              style={{ padding: 12, marginRight: 6 }}
            >
              <Ionicons name="add-circle" size={30} color={t.accent} />
            </Pressable>
          ),
        }}
      />
      <Row style={{ justifyContent: "space-between" }}>
        <View>
          <Txt
            muted
            style={{ fontSize: 12, letterSpacing: 1.8, fontWeight: "700" }}
          >
            YOUR TRAINING, SIMPLIFIED
          </Txt>
          <Txt bold style={{ fontSize: 30, lineHeight: 38 }}>
            {selected === now
              ? "Today"
              : formatDate(selected, { weekday: "long" })}
          </Txt>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setSelected(now);
            setChoosing(false);
          }}
          style={{ padding: 12 }}
        >
          <Txt bold style={{ color: t.accent }}>
            Today
          </Txt>
        </Pressable>
      </Row>
      <Card>
        <Row style={{ justifyContent: "space-between" }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Previous week"
            onPress={() => {
              setSelected(addDays(selected, -7));
              setChoosing(false);
            }}
            style={{ padding: 10 }}
          >
            <Ionicons name="chevron-back" size={20} color={t.text} />
          </Pressable>
          <Txt bold>
            {formatDate(start, { month: "short", day: "numeric" })} –{" "}
            {formatDate(addDays(start, 6), { month: "short", day: "numeric" })}
          </Txt>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next week"
            onPress={() => {
              setSelected(addDays(selected, 7));
              setChoosing(false);
            }}
            style={{ padding: 10 }}
          >
            <Ionicons name="chevron-forward" size={20} color={t.text} />
          </Pressable>
        </Row>
        <Row style={{ gap: 3, justifyContent: "space-between" }}>
          {WEEKDAYS.map((day, i) => {
            const date = addDays(start, i);
            const logged = data.sessions.find((s) => s.date === date);
            const planned = scheduleForDate(data, date);
            const current = selected === date;
            return (
              <Pressable
                key={day}
                accessibilityRole="button"
                accessibilityLabel={
                  formatDate(date, {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  }) + (logged?.status === "completed" ? ", completed" : "")
                }
                accessibilityState={{ selected: current }}
                onPress={() => {
                  setSelected(date);
                  setChoosing(false);
                }}
                style={{
                  flex: 1,
                  minHeight: 78,
                  alignItems: "center",
                  paddingVertical: 8,
                  borderRadius: 16,
                  backgroundColor: current ? t.accent : "transparent",
                  gap: 4,
                }}
              >
                <Txt
                  style={{
                    fontSize: 11,
                    color: current ? t.onAccent : t.muted,
                  }}
                >
                  {day.charAt(0)}
                </Txt>
                <Txt
                  bold
                  style={{ fontSize: 18, color: current ? t.onAccent : t.text }}
                >
                  {Number(date.slice(-2))}
                </Txt>
                <View
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: 3,
                    backgroundColor:
                      logged?.status === "completed"
                        ? current
                          ? t.onAccent
                          : t.success
                        : logged
                          ? current
                            ? t.onAccent
                            : t.accent
                          : planned
                            ? t.muted
                            : "transparent",
                  }}
                />
              </Pressable>
            );
          })}
        </Row>
        {alternating && (
          <Txt muted style={{ fontSize: 12, textAlign: "center" }}>
            Week {week} · Fixed two-week rotation
          </Txt>
        )}
      </Card>
      <Card style={{ borderColor: t.accent, backgroundColor: t.accentSoft }}>
        <Txt
          style={{
            color: t.accent,
            fontSize: 12,
            fontWeight: "700",
            letterSpacing: 1,
          }}
        >
          {session?.status === "completed"
            ? "WORKOUT COMPLETE"
            : session
              ? "IN PROGRESS"
              : isFuture
                ? "UPCOMING"
                : template
                  ? "YOUR WORKOUT"
                  : "ROOM TO RECOVER"}
        </Txt>
        <Txt bold style={{ fontSize: 27, lineHeight: 34 }}>
          {session?.title ?? template?.title ?? "Rest day"}
        </Txt>
        {session || template ? (
          <Txt muted>
            {session?.exercises.length ?? template!.exercises.length} exercises
            ·{" "}
            {session
              ? session.exercises.reduce((n, e) => n + e.target.sets, 0)
              : template!.exercises.reduce((n, e) => n + e.sets, 0)}{" "}
            sets
          </Txt>
        ) : (
          <Txt muted>
            {active.length
              ? "Take a rest, or choose a workout to record."
              : "Create your first workout and give it a place in your week."}
          </Txt>
        )}
        {session && (
          <Txt muted>
            {session.exercises.reduce(
              (n, e) =>
                n + e.sets.filter((s) => s.status === "completed").length,
              0,
            )}{" "}
            sets recorded · {session.unit}
          </Txt>
        )}
        {!isFuture && (active.length > 0 || session || template) ? (
          <Button
            title={
              busy
                ? "Opening…"
                : session?.status === "completed"
                  ? "View workout"
                  : session
                    ? "Continue Workout"
                    : "Record Workout"
            }
            disabled={busy}
            onPress={() => void record()}
          />
        ) : isFuture ? (
          <Txt muted>Recording opens on this date.</Txt>
        ) : (
          <Button
            title="Create your first workout"
            onPress={() => router.push("/editor")}
          />
        )}
      </Card>
      {!!error && <Txt style={{ color: t.danger }}>{error}</Txt>}
      {choosing && (
        <Card>
          <SectionTitle>Choose a workout</SectionTitle>
          {active.map((w) => (
            <Button
              key={w.id}
              secondary
              title={w.title}
              disabled={busy}
              onPress={() => void record(w)}
            />
          ))}
          <Button title="Cancel" secondary onPress={() => setChoosing(false)} />
        </Card>
      )}
      <SaveIndicator />
      <Row style={{ justifyContent: "space-between" }}>
        <SectionTitle>Your plans</SectionTitle>
        <Txt muted>{active.length} workouts</Txt>
      </Row>
      {active.length === 0 ? (
        <Card>
          <Ionicons name="barbell-outline" color={t.accent} size={30} />
          <Txt bold>A routine that fits your week</Txt>
          <Txt muted>
            Choose your exercises, set your rep ranges, and assign training
            days. Your schedule repeats automatically.
          </Txt>
        </Card>
      ) : (
        active.map((w) => (
          <Pressable
            key={w.id}
            accessibilityRole="button"
            accessibilityLabel={"Edit " + w.title}
            onPress={() =>
              router.push({ pathname: "/editor", params: { id: w.id } })
            }
          >
            <Card>
              <Row style={{ justifyContent: "space-between" }}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Txt bold>{w.title}</Txt>
                  <Txt muted style={{ fontSize: 13 }}>
                    {w.exercises.length} exercises ·{" "}
                    {w.weekdays.length
                      ? w.weekdays.map((i) => WEEKDAYS[i]).join(", ")
                      : "Unscheduled"}
                  </Txt>
                </View>
                <Ionicons name="chevron-forward" color={t.muted} size={20} />
              </Row>
            </Card>
          </Pressable>
        ))
      )}
    </Screen>
  );
}
