import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { router, Tabs } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useApp } from "../../data/store";
import { formatDate, today } from "../../domain/dates";
import { canCancelWorkout, cancelWorkout, moveWorkoutToToday, startSession } from "../../domain/sessions";
import { nextFlexibleOccurrence, skipNextWorkout } from "../../domain/routine";
import { WorkoutSession, WorkoutTemplate } from "../../domain/types";
import { Button, Card, Row, Screen, Txt, useTheme } from "../../components/ui";
import { SaveIndicator } from "../../components/SaveIndicator";
import { HomeWeekStrip, HomeWorkoutChooser } from "../../components/HomeComponents";
import { homeDayPresentation } from "../../components/homePresentation";
import { CancelWorkoutSheet, ResumeWorkoutSheet } from "../../components/WorkoutActionSheets";

export default function Home() {
  const { data, replace, flush, retry, status } = useApp();
  const t = useTheme();
  const [selected, setSelected] = useState(today());
  const [now, setNow] = useState(today());
  const [choosing, setChoosing] = useState(false);
  const [resumeId, setResumeId] = useState<string | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
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
  const resuming = data.sessions.find((item) => item.id === resumeId);
  const cancelling = data.sessions.find((item) => item.id === cancelId);

  function selectDate(date: string) {
    if (busyRef.current) return;
    setSelected(date); setChoosing(false); setError("");
  }
  async function openSession(workout: WorkoutSession, choice?: "keep" | "move") {
    if (busyRef.current || workout.date > today()) return;
    setError("");
    if (!choice && canCancelWorkout(workout) && workout.date !== today()) {
      setResumeId(workout.id);
      return;
    }
    busyRef.current = true; setBusy(true);
    try {
      if (choice === "move") await replace((current) => moveWorkoutToToday(current, workout.id));
      else {
        if (status === "error") await retry();
        await flush();
      }
      setResumeId(null);
      router.push({ pathname: "/record", params: { id: workout.id } });
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to resume workout."); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function record(chosen?: WorkoutTemplate) {
    if (busyRef.current || selected > today()) return;
    if (session) { await openSession(session); return; }
    const workout = chosen ?? template;
    if (!workout) { setError(""); setChoosing(true); return; }
    busyRef.current = true; setBusy(true); setChoosing(false); setError("");
    try {
      let id = "";
      await replace((current) => {
        const result = startSession(current, workout, selected);
        id = result.session.id;
        return result.data;
      });
      router.push({ pathname: "/record", params: { id } });
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to open workout."); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function skipAndContinue() {
    if (busyRef.current || selected !== today()) return;
    busyRef.current = true; setBusy(true); setError("");
    try {
      let id = "";
      await replace((current) => {
        if (current.sessions.some((item) => item.date === today())) throw new Error("Today already has a workout.");
        const skipped = skipNextWorkout(current, today());
        const next = nextFlexibleOccurrence(skipped);
        if (!next) throw new Error("The next workout is unavailable.");
        const result = startSession(skipped, next.template, today());
        id = result.session.id;
        return result.data;
      });
      router.push({ pathname: "/record", params: { id } });
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to skip workout. Please retry."); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function cancel() {
    if (busyRef.current || !cancelId) return;
    busyRef.current = true; setBusy(true); setError("");
    try {
      await replace((current) => cancelWorkout(current, cancelId));
      setCancelId(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to cancel workout. Please retry."); }
    finally { busyRef.current = false; setBusy(false); }
  }
  return <Screen bottomSafeArea={false}>
    <Tabs.Screen options={{
      headerTitle: selected === now ? "Today" : formatDate(selected, { weekday: "long" }),
      headerRight: () => <Pressable accessibilityRole="button" accessibilityLabel="Plans" accessibilityHint="Create or edit workout plans."
        accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => router.push("/plans")}
        style={{ minWidth: 44, minHeight: 44, justifyContent: "center", paddingHorizontal: 12, marginRight: 4 }}>
        <Txt bold style={{ color: t.accent }}>Plans</Txt>
      </Pressable>,
    }} />
    <HomeWeekStrip data={data} selected={selected} currentDate={now} disabled={busy} onSelect={selectDate} />
    <Card>
      <Txt bold style={{ fontSize: 27, lineHeight: 35 }}>{day.title}</Txt>
      {day.isCarryover && <Txt muted>Unfinished from {formatDate(session!.date)}</Txt>}
      {day.missed && <Txt muted>Missed {formatDate(day.missed.occurrence.dueDate)}. Your routine is waiting here.</Txt>}
      {session || template ? <Txt muted>{day.exerciseCount} exercises · {day.setCount} sets</Txt>
        : <Txt muted>{active.length ? "Rest, or choose a workout." : "Add your first workout from Plans."}</Txt>}
      {session && <View style={{ gap: 6 }}>
        {session.status === "completed" ? <Row style={{ gap: 6, flexWrap: "wrap" }}>
          <Ionicons name="checkmark-circle" size={17} color={t.success} />
          <Txt style={{ color: t.success, fontSize: 14 }}>Completed</Txt>
        </Row> : <>
          <Txt muted style={{ fontSize: 14 }}>{day.completedSets} of {day.setCount} sets recorded</Txt>
          <View accessible accessibilityRole="progressbar" accessibilityLabel="Sets recorded"
            accessibilityValue={{ min: 0, max: day.setCount, now: day.completedSets }}
            style={{ height: 4, borderRadius: 2, backgroundColor: t.border, overflow: "hidden" }}>
            <View style={{ height: "100%", width: `${day.setCount ? day.completedSets / day.setCount * 100 : 0}%`, backgroundColor: t.accent }} />
          </View>
        </>}
      </View>}
      {day.actionLabel ? <Button title={busy ? "Saving…" : day.actionLabel} disabled={busy} onPress={() => void record()} />
        : <Txt muted>Recording opens on this date.</Txt>}
      {day.missed && day.continueWith && <Button title={`Skip ${day.missed.template.title} and continue ${day.continueWith.title}`}
        secondary disabled={busy} onPress={() => void skipAndContinue()} />}
      {day.canCancel && <Button title="Cancel workout" secondary danger disabled={busy}
        onPress={() => { setError(""); setCancelId(session!.id); }} />}
      {day.upcoming && <Txt muted style={{ fontSize: 14 }}>Up next: {day.upcoming.template.title} · {formatDate(day.upcoming.date, { weekday: "long", month: "short", day: "numeric" })}</Txt>}
    </Card>
    {!!error && !resuming && !cancelling && <View accessibilityLiveRegion="polite"><Txt style={{ color: t.danger }}>{error}</Txt></View>}
    {selected === now && day.unfinished.map((workout) => <Card key={workout.id}>
      <Txt muted style={{ fontSize: 13 }}>Unfinished · {formatDate(workout.date)}</Txt>
      <Txt bold>{workout.title}</Txt>
      <Button title="Resume workout" disabled={busy} onPress={() => void openSession(workout)} />
      {canCancelWorkout(workout) && <Button title="Cancel workout" secondary danger disabled={busy}
        onPress={() => { setError(""); setCancelId(workout.id); }} />}
    </Card>)}
    <SaveIndicator compact />
    <HomeWorkoutChooser visible={choosing} workouts={active} onSelect={(workout) => void record(workout)} onClose={() => setChoosing(false)} />
    {resuming && <ResumeWorkoutSheet visible title={resuming.title} date={resuming.date} busy={busy} error={error}
      canMove={!data.sessions.some((item) => item.id !== resuming.id && item.date === now)}
      onClose={() => { if (!busy) { setResumeId(null); setError(""); } }}
      onKeepDate={() => void openSession(resuming, "keep")} onMove={() => void openSession(resuming, "move")} />}
    {cancelling && <CancelWorkoutSheet visible title={cancelling.title} busy={busy} error={error}
      onClose={() => { if (!busy) { setCancelId(null); setError(""); } }} onConfirm={() => void cancel()} />}
  </Screen>;
}
