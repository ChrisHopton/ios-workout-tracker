import { useRef, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useApp } from "../data/store";
import { formatDate, today } from "../domain/dates";
import { finishSession, validateSet } from "../domain/sessions";
import { RecordedSet, WorkoutSession } from "../domain/types";
import { loadLabel } from "../domain/library";
import {
  Button,
  Card,
  Field,
  Row,
  Screen,
  Txt,
  useTheme,
} from "../components/ui";
import { SaveIndicator } from "../components/SaveIndicator";
export default function RecordWorkout() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, update, flush, retry, status } = useApp();
  const t = useTheme();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const session = data.sessions.find((s) => s.id === id);
  if (!session)
    return (
      <Screen>
        <Txt>This workout could not be found.</Txt>
        <Button title="Back to Home" onPress={() => router.replace("/")} />
      </Screen>
    );
  const future = session.date > today();
  function change(fn: (s: WorkoutSession) => WorkoutSession) {
    setError("");
    update((d) => ({
      ...d,
      sessions: d.sessions.map((s) =>
        s.id === id ? { ...fn(s), updatedAt: new Date().toISOString() } : s,
      ),
    }));
  }
  function editSet(ei: number, si: number, patch: Partial<RecordedSet>) {
    if (busyRef.current) return;
    if (
      patch.weight !== undefined &&
      (patch.weight.length > 16 ||
        !/^\d*(\.\d*)?$/.test(patch.weight) ||
        (patch.weight !== "." && Number(patch.weight) > 100000))
    )
      return;
    if (
      patch.reps !== undefined &&
      (patch.reps.length > 4 ||
        !/^\d*$/.test(patch.reps) ||
        Number(patch.reps) > 1000)
    )
      return;
    try {
      change((s) => ({
        ...s,
        status: "in_progress",
        finishedAt: null,
        exercises: s.exercises.map((e, i) =>
          i !== ei
            ? e
            : {
                ...e,
                sets: e.sets.map((set, j) =>
                  j !== si ? set : { ...set, ...patch },
                ),
              },
        ),
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to edit set.");
    }
  }
  async function finish(skip: boolean) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      change((s) => finishSession(s, skip));
      await flush();
      if (router.canGoBack()) router.back();
      else router.replace("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to finish.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function leaveSaved() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      if (status === "error") await retry();
      await flush();
      if (router.canGoBack()) router.back();
      else router.replace("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please retry saving.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  function finishPressed() {
    const missing = session!.exercises.reduce(
      (n, e) => n + e.sets.filter((s) => s.status === "pending").length,
      0,
    );
    if (missing) {
      Alert.alert(
        "Finish with missing sets?",
        missing +
          " unfinished sets will be marked skipped. They will not count toward your analytics.",
        [
          { text: "Keep recording", style: "cancel" },
          { text: "Skip & finish", onPress: () => void finish(true) },
        ],
      );
    } else void finish(false);
  }
  const done = session.exercises.reduce(
    (n, e) => n + e.sets.filter((s) => s.status === "completed").length,
    0,
  );
  const total = session.exercises.reduce((n, e) => n + e.sets.length, 0);
  return (
    <Screen>
      <Txt muted>
        {formatDate(session.date, {
          weekday: "long",
          month: "long",
          day: "numeric",
          year: "numeric",
        })}
      </Txt>
      <Txt bold style={{ fontSize: 30, lineHeight: 38 }}>
        {session.title}
      </Txt>
      <Row style={{ justifyContent: "space-between" }}>
        <Txt muted>
          {done} of {total} sets completed
        </Txt>
        <Txt bold style={{ color: t.accent }}>
          {session.unit.toUpperCase()}
        </Txt>
      </Row>
      <SaveIndicator />
      {session.status === "completed" && (
        <Card>
          <Txt bold style={{ color: t.success }}>
            Workout complete
          </Txt>
          <Txt muted>
            You can correct any set below. Finish again when your edits are
            complete.
          </Txt>
        </Card>
      )}
      {!!error && <Txt style={{ color: t.danger }}>{error}</Txt>}
      {session.exercises.map((e, ei) => (
        <Card key={e.exercise.id}>
          <View style={{ gap: 4 }}>
            <Txt bold style={{ fontSize: 20 }}>
              {e.exercise.name}
            </Txt>
            <Txt muted style={{ fontSize: 13 }}>
              {e.target.sets} sets × {e.target.repMin}–{e.target.repMax} reps ·{" "}
              {e.exercise.group === "Glutes"
                ? "Glutes / Butt"
                : e.exercise.group}
            </Txt>
            <Txt muted style={{ fontSize: 12 }}>
              {loadLabel(e.exercise.equipment)}
            </Txt>
          </View>
          <View
            style={{
              backgroundColor: t.accentSoft,
              padding: 12,
              borderRadius: 12,
              gap: 4,
            }}
          >
            <Txt bold style={{ fontSize: 12, color: t.accent }}>
              NEXT STEP
            </Txt>
            <Txt style={{ fontSize: 13 }}>{e.suggestion.reason}</Txt>
          </View>
          <Row style={{ gap: 8 }}>
            <Txt muted style={{ width: 26, fontSize: 11 }}>
              SET
            </Txt>
            <Txt muted style={{ flex: 1, fontSize: 11 }}>
              {e.exercise.equipment === "bodyweight"
                ? "LOAD"
                : "WEIGHT (" + session.unit + ")"}
            </Txt>
            <Txt muted style={{ flex: 1, fontSize: 11 }}>
              REPS
            </Txt>
            <Txt muted style={{ width: 44, fontSize: 11, textAlign: "center" }}>
              DONE
            </Txt>
          </Row>
          {e.sets.map((set, si) => (
            <View key={si} style={{ gap: 6 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={e.exercise.name + " set " + (si + 1) + " type: " + (set.classification === "warmup" ? "Warm-up" : "Working") + ". Tap to change."}
                disabled={future || busy}
                onPress={() => editSet(ei, si, { classification: set.classification === "warmup" ? "working" : "warmup" })}
                style={{ minHeight: 44, justifyContent: "center", alignSelf: "flex-start", paddingHorizontal: 12, backgroundColor: t.bg, borderRadius: 12 }}
              >
                <Txt muted style={{ fontSize: 12 }}>{set.classification === "warmup" ? "Warm-up" : "Working set"} · tap to change</Txt>
              </Pressable>
              <Row style={{ gap: 8 }}>
                <Txt bold style={{ width: 26 }}>
                  {si + 1}
                </Txt>
                <View style={{ flex: 1 }}>
                  {e.exercise.equipment === "bodyweight" ? (
                    <Txt muted style={{ fontSize: 13 }}>
                      Bodyweight
                    </Txt>
                  ) : (
                    <Field
                      accessibilityLabel={
                        e.exercise.name +
                        " set " +
                        (si + 1) +
                        " weight in " +
                        session.unit
                      }
                      value={set.weight}
                      editable={!future && !busy}
                      keyboardType="decimal-pad"
                      placeholder={
                        set.classification === "warmup" || e.suggestion.weights[si] == null
                          ? "—"
                          : String(e.suggestion.weights[si])
                      }
                      onChangeText={(value) =>
                        editSet(ei, si, {
                          weight: value.replace(",", "."),
                          status: "pending",
                        })
                      }
                    />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Field
                    accessibilityLabel={
                      e.exercise.name + " set " + (si + 1) + " reps"
                    }
                    value={set.reps}
                    editable={!future && !busy}
                    keyboardType="number-pad"
                    placeholder={e.target.repMin + "–" + e.target.repMax}
                    onChangeText={(value) =>
                      editSet(ei, si, { reps: value, status: "pending" })
                    }
                  />
                </View>
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityLabel={
                    "Complete " + e.exercise.name + " set " + (si + 1)
                  }
                  accessibilityState={{
                    checked: set.status === "completed",
                    disabled: future || busy,
                  }}
                  disabled={future || busy}
                  onPress={() => {
                    if (set.status === "completed") {
                      editSet(ei, si, { status: "pending" });
                      return;
                    }
                    const message = validateSet(set, e.exercise.equipment);
                    if (message) {
                      setError(
                        e.exercise.name + " set " + (si + 1) + ": " + message,
                      );
                      Alert.alert("Check this set", message);
                      return;
                    }
                    editSet(ei, si, { status: "completed" });
                  }}
                  style={{
                    width: 44,
                    height: 48,
                    borderRadius: 12,
                    justifyContent: "center",
                    alignItems: "center",
                    backgroundColor:
                      set.status === "completed" ? t.success : t.bg,
                    borderWidth: 1,
                    borderColor:
                      set.status === "completed" ? t.success : t.border,
                  }}
                >
                  <Ionicons
                    name={
                      set.status === "completed"
                        ? "checkmark"
                        : "ellipse-outline"
                    }
                    size={22}
                    color={set.status === "completed" ? t.onAccent : t.muted}
                  />
                </Pressable>
              </Row>
              {set.status === "skipped" ? (
                <Txt muted style={{ fontSize: 12 }}>
                  Skipped · enter a value to record this set.
                </Txt>
              ) : (
                e.exercise.equipment !== "bodyweight" &&
                set.classification !== "warmup" &&
                e.suggestion.weights[si] != null &&
                !set.weight && (
                  <Pressable
                    disabled={future || busy}
                    accessibilityRole="button"
                    accessibilityLabel={
                      "Use suggested " +
                      e.suggestion.weights[si] +
                      " " +
                      session.unit +
                      " for set " +
                      (si + 1)
                    }
                    onPress={() =>
                      editSet(ei, si, {
                        weight: String(e.suggestion.weights[si]),
                        status: "pending",
                      })
                    }
                    style={{
                      minHeight: 44,
                      justifyContent: "center",
                      paddingLeft: 34,
                    }}
                  >
                    <Txt style={{ fontSize: 12, color: t.accent }}>
                      Use suggested {e.suggestion.weights[si]} {session.unit}
                    </Txt>
                  </Pressable>
                )
              )}
            </View>
          ))}
        </Card>
      ))}
      {!future && (
        <Button
          title={
            busy
              ? "Saving workout…"
              : session.status === "completed"
                ? "Done"
                : "Finish Workout"
          }
          disabled={busy}
          onPress={() =>
            session.status === "completed" ? void leaveSaved() : finishPressed()
          }
        />
      )}
      <Txt muted style={{ fontSize: 12, textAlign: "center" }}>
        Suggestions are based on your recorded training. Adjust the weight to
        suit how you feel. Warm-ups do not count toward working-set progression or strength analytics.
      </Txt>
    </Screen>
  );
}
