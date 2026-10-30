import React, { useCallback, useMemo, useRef, useState } from "react";
import { BackHandler, Keyboard, Modal, Pressable, StyleSheet, View } from "react-native";
import { router, Stack, useFocusEffect } from "expo-router";
import { Button, Card, Chip, Field, Row, Screen, SectionTitle, Txt, useTheme } from "../components/ui";
import { useApp } from "../data/store";
import { addDays, formatDate, parseDate, today } from "../domain/dates";
import { nextFlexibleOccurrence, routineAt, saveRoutine, seedFlexibleRoutine } from "../domain/routine";
import { planEditEffectiveDate, scheduleForDate } from "../domain/schedule";
import { AppData, WEEKDAYS } from "../domain/types";

type Entry = { key: string; templateId: string };
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "Unable to save your routine. Please try again.";

export default function RoutineEditor() {
  const { data, replace } = useApp();
  const colors = useTheme();
  const [initial] = useState(() => {
    const effectiveDate = planEditEffectiveDate(data, today());
    const seed = seedFlexibleRoutine(data, effectiveDate);
    const entries = seed.sequence.map((templateId, index) => ({ key: String(index), templateId }));
    return {
      effectiveDate,
      mode: routineAt(data, effectiveDate).mode,
      weekdays: seed.weekdays,
      entries,
      startKey: entries[seed.startIndex]?.key ?? null,
    };
  });
  const [mode, setMode] = useState(initial.mode);
  const [weekdays, setWeekdays] = useState(initial.weekdays);
  const [entries, setEntries] = useState<Entry[]>(initial.entries);
  const [startKey, setStartKey] = useState<string | null>(initial.startKey);
  const [startDate, setStartDate] = useState(initial.effectiveDate);
  const [replacementConfirmed, setReplacementConfirmed] = useState(false);
  const nextKey = useRef(initial.entries.length);
  const [adding, setAdding] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const active = data.templates.filter((template) => !template.archived);
  const earliestDate = planEditEffectiveDate(data, today());
  const pending = nextFlexibleOccurrence(data, earliestDate);

  function change() {
    setDirty(true);
    setMessage(null);
  }

  const cancel = useCallback(() => {
    if (busyRef.current) return;
    Keyboard.dismiss();
    if (dirty) setConfirmDiscard(true);
    else router.dismissTo("/plans");
  }, [dirty]);

  useFocusEffect(useCallback(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      cancel();
      return true;
    });
    return () => subscription.remove();
  }, [cancel]));

  const candidate = useCallback((current: AppData) => {
    const effectiveDate = startDate.trim();
    parseDate(effectiveDate);
    const minimumDate = planEditEffectiveDate(current, today());
    if (effectiveDate < minimumDate)
      throw new Error("Choose a start date on or after " + formatDate(minimumDate, {
        month: "long", day: "numeric", year: "numeric",
      }) + ".");
    if (mode === "fixed") return saveRoutine(current, { mode }, effectiveDate);
    const startIndex = entries.findIndex((entry) => entry.key === startKey);
    if (startIndex < 0)
      throw new Error("Choose a starting workout below. Removing the starting workout requires a new choice.");
    return saveRoutine(current, {
      mode,
      weekdays: [...weekdays].sort((a, b) => a - b),
      sequence: entries.map((entry) => entry.templateId),
      startIndex,
      replacementConfirmed,
      restart: effectiveDate !== initial.effectiveDate,
    }, effectiveDate);
  }, [mode, weekdays, entries, startKey, startDate, replacementConfirmed, initial.effectiveDate]);

  const preview = useMemo(() => {
    try {
      const effectiveDate = startDate.trim();
      const projected = candidate(data);
      const days = Array.from({ length: 14 }, (_, index) => {
        const date = addDays(effectiveDate, index);
        return { date, template: scheduleForDate(projected, date, effectiveDate) };
      });
      return { days, error: null };
    } catch (error) {
      return { days: [], error: errorText(error) };
    }
  }, [candidate, data, startDate]);

  function move(index: number, offset: number) {
    if (busyRef.current || index + offset < 0 || index + offset >= entries.length) return;
    setEntries((current) => {
      const next = [...current];
      [next[index], next[index + offset]] = [next[index + offset], next[index]];
      return next;
    });
    change();
  }

  function remove(entry: Entry) {
    if (busyRef.current) return;
    const remaining = entries.filter((item) => item.key !== entry.key);
    setEntries(remaining);
    const removesPending = pending?.template.id === entry.templateId &&
      !remaining.some((item) => item.templateId === entry.templateId);
    if (entry.key === startKey || removesPending) {
      setStartKey(null);
      setReplacementConfirmed(false);
    }
    change();
  }

  async function save() {
    if (busyRef.current) return;
    Keyboard.dismiss();
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    try {
      await replace((current) => candidate(current));
      setDirty(false);
      router.dismissTo("/plans");
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{
        title: "Edit routine",
        gestureEnabled: false,
        headerBackVisible: false,
        headerLeft: () => (
          <Pressable accessibilityRole="button" accessibilityLabel="Cancel editing routine"
            disabled={busy} onPress={cancel} style={styles.cancel}>
            <Txt style={{ color: colors.accent }}>Cancel</Txt>
          </Pressable>
        ),
      }} />
      <Screen>
        <Card>
          <SectionTitle>Scheduling</SectionTitle>
          <View style={styles.chips}>
            <Chip label="Fixed schedule" selected={mode === "fixed"} onPress={() => {
              if (busyRef.current) return;
              setMode("fixed");
              change();
            }} />
            <Chip label="Flexible sequence" selected={mode === "flexible"} onPress={() => {
              if (busyRef.current) return;
              setMode("flexible");
              change();
            }} />
          </View>
          <Txt muted>
            {mode === "fixed"
              ? "Each plan keeps its weekly or every-two-weeks dates. Missing a workout does not shift later workouts."
              : "Use your training days in order. If you miss a workout, choose to make it up or skip it; the following workouts move with that choice."}
          </Txt>
          <Field label="Changes start (YYYY-MM-DD)" value={startDate} placeholder="YYYY-MM-DD"
            maxLength={10} autoCapitalize="none" autoCorrect={false} editable={!busy}
            onChangeText={(value) => { setStartDate(value); change(); }} />
          <Txt muted style={styles.small}>
            Earliest change: {formatDate(earliestDate, { month: "long", day: "numeric", year: "numeric" })}.
            {" "}Earlier schedules and recorded workouts stay in your history.
          </Txt>
        </Card>
        {mode === "flexible" ? (
          <>
            <Card>
              <SectionTitle>Training days</SectionTitle>
              <View style={styles.chips}>
                {WEEKDAYS.map((day, index) => (
                  <Chip key={day} label={day} selected={weekdays.includes(index)} onPress={() => {
                    if (busyRef.current) return;
                    setWeekdays((current) => current.includes(index)
                      ? current.filter((value) => value !== index) : [...current, index]);
                    change();
                  }} />
                ))}
              </View>
              <Txt muted style={styles.small}>One routine workout per training day.</Txt>
            </Card>
            <SectionTitle>Repeating order</SectionTitle>
            <Txt muted>
              Add a plan more than once to repeat it in the cycle. Choose the workout to start with;
              after the last entry, the sequence returns to the first.
            </Txt>
            {!entries.length && <Card><Txt muted>Add at least one workout to your sequence.</Txt></Card>}
            {entries.map((entry, index) => {
              const template = data.templates.find((item) => item.id === entry.templateId);
              const name = template?.title ?? "Unavailable plan";
              return (
                <Card key={entry.key}>
                  <Txt bold>{index + 1}. {name}</Txt>
                  <Pressable accessibilityRole="radio"
                    aria-checked={entry.key === startKey}
                    accessibilityState={{ checked: entry.key === startKey, disabled: busy }}
                    accessibilityLabel={"Start with entry " + (index + 1) + ": " + name}
                    disabled={busy}
                    onPress={() => { setStartKey(entry.key); setReplacementConfirmed(true); change(); }}
                    style={[styles.startChoice, {
                      borderColor: entry.key === startKey ? colors.accent : colors.border,
                      backgroundColor: entry.key === startKey ? colors.accentSoft : colors.card,
                    }]}>
                    <Txt bold style={{ color: colors.accent }}>
                      {entry.key === startKey ? "Starting workout" : "Start here"}
                    </Txt>
                  </Pressable>
                  <Row style={styles.actions}>
                    <Pressable accessibilityRole="button"
                      accessibilityLabel={"Move up entry " + (index + 1) + ": " + name}
                      accessibilityState={{ disabled: busy || index === 0 }} disabled={busy || index === 0}
                      onPress={() => move(index, -1)} style={[styles.action, { opacity: busy || index === 0 ? 0.4 : 1 }]}>
                      <Txt style={{ color: colors.accent }}>Move up</Txt>
                    </Pressable>
                    <Pressable accessibilityRole="button"
                      accessibilityLabel={"Move down entry " + (index + 1) + ": " + name}
                      accessibilityState={{ disabled: busy || index === entries.length - 1 }} disabled={busy || index === entries.length - 1}
                      onPress={() => move(index, 1)} style={[styles.action, { opacity: busy || index === entries.length - 1 ? 0.4 : 1 }]}>
                      <Txt style={{ color: colors.accent }}>Move down</Txt>
                    </Pressable>
                    <Pressable accessibilityRole="button"
                      accessibilityLabel={"Remove entry " + (index + 1) + ": " + name}
                      accessibilityState={{ disabled: busy }} disabled={busy}
                      onPress={() => remove(entry)} style={styles.action}>
                      <Txt style={{ color: colors.danger }}>Remove</Txt>
                    </Pressable>
                  </Row>
                </Card>
              );
            })}
            <Button title={adding ? "Close workout list" : "+ Add workout"} secondary disabled={busy}
              onPress={() => setAdding((value) => !value)} />
            {adding && (
              <Card>
                <SectionTitle>Add to sequence</SectionTitle>
                {!active.length && <Txt muted>Create a workout plan from Plans first, then add it here.</Txt>}
                {active.map((template) => (
                  <Button key={template.id} title={"+ " + template.title} secondary disabled={busy}
                    onPress={() => {
                      if (busyRef.current) return;
                      const entry = { key: String(nextKey.current++), templateId: template.id };
                      setEntries((current) => [...current, entry]);
                      setAdding(false);
                      change();
                    }} />
                ))}
              </Card>
            )}
            {startKey === null && (
              <Txt style={{ color: colors.danger }}>Choose Start here on a workout before saving.</Txt>
            )}
          </>
        ) : (
          <Card>
            <Txt bold>Plan dates stay in each plan</Txt>
            <Txt muted>
              Edit a plan to choose its weekdays and weekly or every-two-weeks repeat.
              Switching back to fixed scheduling restores those plan dates.
            </Txt>
          </Card>
        )}
        <SectionTitle>Two-week preview</SectionTitle>
        {preview.error ? (
          <Card><Txt style={{ color: colors.danger }}>{preview.error}</Txt></Card>
        ) : [0, 1].map((week) => {
          const days = preview.days.slice(week * 7, week * 7 + 7);
          return (
            <Card key={week}>
              <Txt bold>{formatDate(days[0].date)} – {formatDate(days[6].date)}</Txt>
              {days.map(({ date, template }) => (
                <View key={date} style={[styles.previewRow, { borderBottomColor: colors.border }]}>
                  <Txt muted style={styles.day}>{formatDate(date, { weekday: "short", day: "numeric" })}</Txt>
                  <Txt bold={!!template} style={styles.grow}>{template?.title ?? "Rest day"}</Txt>
                </View>
              ))}
            </Card>
          );
        })}
        {mode === "flexible" && (
          <Txt muted style={styles.small}>
            Preview assumes each workout is completed or skipped on its shown day.
            Finish or cancel an unfinished routine workout before changing its mode, order, or training days.
          </Txt>
        )}
        {message && <Card><Txt style={{ color: colors.danger }}>{message}</Txt></Card>}
        <Button title={busy ? "Saving…" : "Save routine"} disabled={busy} onPress={() => void save()} />
      </Screen>
      <Modal visible={confirmDiscard} transparent animationType="fade"
        onRequestClose={() => setConfirmDiscard(false)}>
        <View style={styles.dialogBackdrop}>
          <View style={styles.dialog}>
            <Card>
              <SectionTitle>Discard routine changes?</SectionTitle>
              <Txt muted>Your unsaved changes will be discarded. Your saved routine stays as it is.</Txt>
              <Button title="Keep editing" secondary onPress={() => setConfirmDiscard(false)} />
              <Button title="Discard changes" danger onPress={() => {
                setConfirmDiscard(false);
                router.dismissTo("/plans");
              }} />
            </Card>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  small: { fontSize: 14, lineHeight: 21 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  cancel: { minHeight: 44, minWidth: 64, justifyContent: "center" },
  actions: { flexWrap: "wrap", gap: 8 },
  action: { minHeight: 44, paddingHorizontal: 8, justifyContent: "center" },
  startChoice: { minHeight: 44, justifyContent: "center", paddingHorizontal: 12, borderWidth: 1, borderRadius: 10 },
  previewRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  day: { width: 76, fontSize: 14 },
  grow: { flex: 1, minWidth: 0 },
  dialogBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", padding: 20 },
  dialog: { width: "100%", maxWidth: 520, alignSelf: "center" },
});
