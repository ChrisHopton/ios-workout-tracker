import { useRef, useState } from "react";
import { View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useApp } from "../data/store";
import { formatDate, today } from "../domain/dates";
import { canCancelWorkout, cancelWorkout, editSessionSet, finishWorkout, inspectSessionRecording, RecordingSetPatch } from "../domain/sessions";
import { WorkoutSession } from "../domain/types";
import { loadLabel } from "../domain/library";
import { Button, Card, Field, Row, Screen, Txt, useTheme } from "../components/ui";
import { SaveIndicator } from "../components/SaveIndicator";
import { nextStepForDisplay } from "../components/suggestionPresentation";
import { CancelWorkoutSheet, WorkoutActionSheet } from "../components/WorkoutActionSheets";

export default function RecordWorkout() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, update, flush, retry, status, replace } = useApp();
  const t = useTheme();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmMissing, setConfirmMissing] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const busyRef = useRef(false);
  const session = data.sessions.find((s) => s.id === id);
  if (!session) return <Screen><Txt>This workout could not be found.</Txt><Button title="Back to Home" onPress={() => router.replace("/")} /></Screen>;
  const future = session.date > today();

  function change(fn: (s: WorkoutSession) => WorkoutSession) {
    setError("");
    update((d) => ({
      ...d,
      sessions: d.sessions.map((s) => s.id === id ? { ...fn(s), updatedAt: new Date().toISOString() } : s),
    }));
  }
  function editSet(ei: number, si: number, patch: RecordingSetPatch) {
    if (busyRef.current) return;
    if (patch.weight !== undefined && (patch.weight.length > 16 || !/^\d*(\.\d*)?$/.test(patch.weight)
      || (patch.weight !== "." && Number(patch.weight) > 100000))) return;
    if (patch.reps !== undefined && (patch.reps.length > 4 || !/^\d*$/.test(patch.reps) || Number(patch.reps) > 1000)) return;
    try { change((s) => editSessionSet(s, ei, si, patch)); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to edit set."); }
  }
  function leave() {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  }
  async function finish(skip: boolean) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    try {
      await replace((current) => finishWorkout(current, id, skip));
      setConfirmMissing(false);
      leave();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to finish. Please retry."); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function leaveSaved() {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    try {
      if (status === "error") await retry();
      await flush();
      leave();
    } catch (e) { setError(e instanceof Error ? e.message : "Please retry saving."); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function cancel() {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    try {
      await replace((current) => cancelWorkout(current, id));
      setConfirmCancel(false);
      router.replace("/");
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to cancel. Please retry."); }
    finally { busyRef.current = false; setBusy(false); }
  }
  function finishPressed() {
    if (busyRef.current) return;
    const recording = inspectSessionRecording(session!);
    const message = recording.error ?? (!recording.completedSets ? "Complete at least one set before finishing your workout." : null);
    if (message) { setError(message); return; }
    setError("");
    if (recording.missingSets) setConfirmMissing(true);
    else void finish(false);
  }
  const { completedSets: done } = inspectSessionRecording(session);
  const total = session.exercises.reduce((n, e) => n + e.sets.length, 0);
  return <Screen>
    <WorkoutActionSheet visible={confirmMissing} title="Skip missing sets and finish?" busy={busy} onClose={() => setConfirmMissing(false)}>
      <Txt muted>Missing sets will be marked skipped and excluded from your analytics.</Txt>
      {!!error && <View accessibilityRole="alert"><Txt style={{ color: t.danger }}>{error}</Txt></View>}
      <Button title="Keep recording" secondary disabled={busy} onPress={() => setConfirmMissing(false)} />
      <Button title={busy ? "Saving…" : "Skip and finish"} disabled={busy} onPress={() => void finish(true)} />
    </WorkoutActionSheet>
    <CancelWorkoutSheet visible={confirmCancel} title={session.title} busy={busy} error={error}
      onClose={() => setConfirmCancel(false)} onConfirm={() => void cancel()} />
    <Txt muted>{formatDate(session.date, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</Txt>
    <Txt bold style={{ fontSize: 30, lineHeight: 38 }}>{session.title}</Txt>
    <Row style={{ justifyContent: "space-between" }}>
      <Txt muted>{done} of {total} sets completed</Txt>
      <Txt bold style={{ color: t.accent }}>{session.unit.toUpperCase()}</Txt>
    </Row>
    <SaveIndicator />
    {session.status === "completed" && <Card>
      <Txt bold style={{ color: t.success }}>Workout complete</Txt>
      <Txt muted>You can correct any set below. Finish again when your edits are complete.</Txt>
    </Card>}
    {!!error && !confirmMissing && !confirmCancel && <View accessibilityRole="alert" accessibilityLiveRegion="polite"><Txt style={{ color: t.danger }}>{error}</Txt></View>}
    {session.exercises.map((item, ei) => <Card key={item.exercise.id}>
      <View style={{ gap: 4 }}>
        <Txt bold style={{ fontSize: 20 }}>{item.exercise.name}</Txt>
        <Txt muted style={{ fontSize: 13 }}>{item.target.sets} sets × {item.target.repMin}–{item.target.repMax} reps · {item.exercise.group === "Glutes" ? "Glutes / Butt" : item.exercise.group}</Txt>
        <Txt muted style={{ fontSize: 12 }}>{loadLabel(item.exercise.equipment)}</Txt>
      </View>
      <View style={{ backgroundColor: t.accentSoft, padding: 12, borderRadius: 12, gap: 4 }}>
        <Txt bold style={{ fontSize: 12, color: t.accent }}>NEXT STEP</Txt>
        <Txt style={{ fontSize: 14 }}>{nextStepForDisplay(item, session.unit)}</Txt>
      </View>
      <Row style={{ gap: 8 }}>
        <Txt muted style={{ width: 26, fontSize: 11 }}>SET</Txt>
        <Txt muted style={{ flex: 1, fontSize: 11 }}>{item.exercise.equipment === "bodyweight" ? "LOAD" : `WEIGHT (${session.unit})`}</Txt>
        <Txt muted style={{ flex: 1, fontSize: 11 }}>REPS</Txt>
      </Row>
      {item.sets.map((set, si) => <View key={si} style={{ gap: 6 }}>
        {set.classification === "warmup" && <Txt muted style={{ fontSize: 12 }}>Warm-up</Txt>}
        <Row style={{ gap: 8 }}>
          <Txt bold style={{ width: 26 }}>{si + 1}</Txt>
          <View style={{ flex: 1 }}>
            {item.exercise.equipment === "bodyweight" ? <Txt muted style={{ fontSize: 13 }}>Bodyweight</Txt> : <Field
              accessibilityLabel={`${item.exercise.name} set ${si + 1} weight in ${session.unit}`}
              value={set.weight} editable={!future && !busy} keyboardType="decimal-pad" placeholder="—"
              onChangeText={(value) => editSet(ei, si, { weight: value.replace(",", ".") })} />}
          </View>
          <View style={{ flex: 1 }}>
            <Field accessibilityLabel={`${item.exercise.name} set ${si + 1} reps`} value={set.reps}
              editable={!future && !busy} keyboardType="number-pad" placeholder={`${item.target.repMin}–${item.target.repMax}`}
              onChangeText={(value) => editSet(ei, si, { reps: value })} />
          </View>
        </Row>
        {set.status === "skipped" && <Txt muted style={{ fontSize: 12 }}>Skipped · change {item.exercise.equipment === "bodyweight" ? "reps" : "weight or reps"} to record this set.</Txt>}
      </View>)}
    </Card>)}
    {!future && <Button title={busy ? "Saving workout…" : session.status === "completed" ? "Done" : "Finish workout"}
      disabled={busy} onPress={() => session.status === "completed" ? void leaveSaved() : finishPressed()} />}
    {session.status !== "completed" && <Button title="Save and leave" secondary disabled={busy} onPress={() => void leaveSaved()} />}
    {canCancelWorkout(session) && <Button title="Cancel workout" secondary danger disabled={busy}
      onPress={() => { setError(""); setConfirmCancel(true); }} />}
  </Screen>;
}
