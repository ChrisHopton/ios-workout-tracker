import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  Keyboard,
  Modal,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import {
  Button,
  Card,
  Chip,
  Field,
  Row,
  Screen,
  SectionTitle,
  Txt,
  useTheme,
} from "../components/ui";
import { useApp } from "../data/store";
import {
  addDays,
  dayDifference,
  formatDate,
  mondayOf,
  today,
} from "../domain/dates";
import { loadLabel } from "../domain/library";
import {
  archiveTemplate,
  saveTemplate,
  scheduleForDate,
} from "../domain/schedule";
import {
  AppData,
  EQUIPMENT,
  Equipment,
  ExerciseDefinition,
  MUSCLE_GROUPS,
  MuscleGroup,
  WEEKDAYS,
  WorkoutRecurrence,
  WorkoutTemplate,
  newId,
} from "../domain/types";

type DraftExercise = {
  exerciseId: string;
  sets: string;
  repMin: string;
  repMax: string;
};
const equipmentName = (value: Equipment) =>
  value.charAt(0).toUpperCase() + value.slice(1);
const groupName = (value: MuscleGroup) =>
  value === "Glutes" ? "Glutes / Butt" : value;
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "Unable to save. Please try again.";
const isWhole = (value: string, max: number) =>
  /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= max;

export default function WorkoutEditor() {
  const { id: routeId } = useLocalSearchParams<{ id?: string }>();
  const { data, update, flush, retry, status, error: storageError } = useApp();
  const colors = useTheme();
  const [initial] = useState(() =>
    data.templates.find((item) => item.id === routeId),
  );
  const [id] = useState(() => initial?.id ?? newId("workout"));
  const [title, setTitle] = useState(initial?.title ?? "");
  const [weekdays, setWeekdays] = useState<number[]>(initial?.weekdays ?? []);
  const [exercises, setExercises] = useState<DraftExercise[]>(
    () =>
      initial?.exercises.map((item) => ({
        exerciseId: item.exerciseId,
        sets: String(item.sets),
        repMin: String(item.repMin),
        repMax: String(item.repMax),
      })) ?? [],
  );
  const [recurrence, setRecurrence] = useState<WorkoutRecurrence>(
    initial?.recurrence ?? { kind: "weekly" },
  );
  const [confirmation, setConfirmation] = useState<
    "discard" | "archive" | "unsaved" | null
  >(null);
  const [picker, setPicker] = useState<"library" | "custom" | null>(null);
  const [query, setQuery] = useState("");
  const [customName, setCustomName] = useState("");
  const [customGroup, setCustomGroup] = useState<MuscleGroup>("Legs");
  const [customEquipment, setCustomEquipment] = useState<Equipment>("dumbbell");
  const [incrementLb, setIncrementLb] = useState("5");
  const [incrementKg, setIncrementKg] = useState("2.5");
  const customId = useRef<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [customError, setCustomError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingCommit, setPendingCommit] = useState<"save" | "archive" | null>(
    null,
  );
  const busyRef = useRef(false);
  const [dirty, setDirty] = useState(false);
  const date = today();
  const previewStart = mondayOf(date);
  const selectedIds = new Set(exercises.map((item) => item.exerciseId));
  const filtered = data.exercises.filter((item) =>
    `${item.name} ${item.group} ${groupName(item.group)} ${item.equipment}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );

  function markDirty() {
    setDirty(true);
    setMessage(null);
  }
  const draftTemplate = useCallback(
    (preview = false): WorkoutTemplate => {
      return {
        id,
        title: title.trim() || (preview ? "New workout" : ""),
        weekdays: [...weekdays].sort((a, b) => a - b),
        recurrence,
        archived: false,
        updatedAt: new Date().toISOString(),
        exercises: exercises.map((item) => ({
          exerciseId: item.exerciseId,
          sets: Number(item.sets) || 1,
          repMin: Number(item.repMin) || 1,
          repMax: Number(item.repMax) || 1,
        })),
      };
    },
    [id, title, weekdays, recurrence, exercises],
  );
  const applyDraft = useCallback(
    (current: AppData, template: WorkoutTemplate): AppData =>
      saveTemplate(current, template, date),
    [date],
  );
  const preview = useMemo(() => {
    try {
      return { data: applyDraft(data, draftTemplate(true)), error: null };
    } catch (error) {
      return { data: null, error: errorText(error) };
    }
  }, [data, applyDraft, draftTemplate]);
  function activeWeek(start: string): boolean {
    return (
      recurrence.kind === "biweekly" &&
      Math.abs(dayDifference(start, recurrence.anchorMonday) / 7) % 2 === 0
    );
  }
  function leave() {
    router.dismissTo("/plans");
  }
  function cancel() {
    if (busyRef.current) return;
    Keyboard.dismiss();
    if (pendingCommit) {
      setConfirmation("unsaved");
      return;
    }
    if (!dirty) {
      leave();
      return;
    }
    setConfirmation("discard");
  }
  function addExercise(definition: ExerciseDefinition) {
    if (busyRef.current || pendingCommit || selectedIds.has(definition.id))
      return;
    if (exercises.length >= 100) {
      setCustomError("A workout can contain up to 100 exercises.");
      return;
    }
    setExercises((current) => [
      ...current,
      { exerciseId: definition.id, sets: "3", repMin: "8", repMax: "12" },
    ]);
    markDirty();
    setPicker(null);
    setQuery("");
    Keyboard.dismiss();
  }
  function editTarget(
    index: number,
    key: "sets" | "repMin" | "repMax",
    value: string,
  ) {
    if (busyRef.current || pendingCommit) return;
    setExercises((current) =>
      current.map((item, i) =>
        i === index ? { ...item, [key]: value } : item,
      ),
    );
    markDirty();
  }
  function moveExercise(index: number, offset: number) {
    if (
      busyRef.current ||
      pendingCommit ||
      index + offset < 0 ||
      index + offset >= exercises.length
    )
      return;
    setExercises((current) => {
      const next = [...current];
      [next[index], next[index + offset]] = [next[index + offset], next[index]];
      return next;
    });
    markDirty();
  }
  function validation(): string | null {
    if (!title.trim()) return "Give your workout a name.";
    if (title.trim().length > 100)
      return "Use a workout name of 100 characters or fewer.";
    if (!exercises.length) return "Add at least one exercise.";
    for (const item of exercises) {
      const name =
        data.exercises.find((exercise) => exercise.id === item.exerciseId)
          ?.name ?? "Exercise";
      if (!isWhole(item.sets, 30)) return `${name}: enter 1 to 30 sets.`;
      if (!isWhole(item.repMin, 1000) || !isWhole(item.repMax, 1000))
        return `${name}: enter whole rep targets from 1 to 1,000.`;
      if (Number(item.repMin) > Number(item.repMax))
        return `${name}: minimum reps cannot exceed maximum reps.`;
    }
    return preview.error;
  }
  async function save() {
    if (busyRef.current) return;
    Keyboard.dismiss();
    if (pendingCommit) {
      busyRef.current = true;
      setBusy(true);
      setMessage(null);
      try {
        await retry();
        setPendingCommit(null);
        setDirty(false);
        leave();
      } catch (error) {
        setMessage(errorText(error));
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
      return;
    }
    const invalid = validation();
    if (invalid) {
      setMessage(invalid);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const template = draftTemplate();
      update((current) => applyDraft(current, template));
      setPendingCommit("save");
      await flush();
      setPendingCommit(null);
      setDirty(false);
      leave();
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function archive() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    try {
      update((current) => archiveTemplate(current, id, date));
      setPendingCommit("archive");
      await flush();
      setPendingCommit(null);
      setDirty(false);
      leave();
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  function confirmArchive() {
    if (!busyRef.current && !pendingCommit) setConfirmation("archive");
  }
  async function createCustom() {
    if (busyRef.current) return;
    const name = customName.trim();
    if (!name) {
      setCustomError("Enter an exercise name.");
      return;
    }
    if (
      data.exercises.some(
        (item) =>
          item.id !== customId.current &&
          item.name.toLowerCase() === name.toLowerCase() &&
          item.equipment === customEquipment,
      )
    ) {
      setCustomError(
        "This exercise and equipment already exist. Choose it from the library.",
      );
      return;
    }
    if (
      customEquipment !== "bodyweight" &&
      ![incrementLb, incrementKg].every(
        (value) =>
          /^\d+(\.\d+)?$/.test(value) &&
          Number(value) >= 0.001 &&
          Number(value) <= 1000,
      )
    ) {
      setCustomError("Enter weight increments from 0.001 to 1,000.");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setCustomError(null);
    const definition: ExerciseDefinition = {
      id: customId.current ?? newId("exercise"),
      name,
      group: customGroup,
      equipment: customEquipment,
      incrementLb: customEquipment === "bodyweight" ? 5 : Number(incrementLb),
      incrementKg: customEquipment === "bodyweight" ? 2.5 : Number(incrementKg),
    };
    customId.current = definition.id;
    try {
      update((current) => ({
        ...current,
        exercises: [
          ...current.exercises.filter((item) => item.id !== definition.id),
          definition,
        ],
      }));
      await flush();
      busyRef.current = false;
      addExercise(definition);
    } catch (error) {
      setCustomError(errorText(error));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  if (routeId && !initial)
    return (
      <Screen>
        <SectionTitle>Workout not found</SectionTitle>
        <Txt muted>This plan may have been removed by a restored backup.</Txt>
        <Button title="Back to plans" onPress={leave} />
      </Screen>
    );

  return (
    <>
      <Stack.Screen
        options={{
          title: initial ? "Edit plan" : "New plan",
          gestureEnabled: false,
          headerBackVisible: false,
          headerLeft: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel editing workout"
              disabled={busy}
              onPress={cancel}
              style={styles.cancel}
            >
              <Txt style={{ color: colors.accent }}>Cancel</Txt>
            </Pressable>
          ),
        }}
      />
      <Screen>
        <Txt muted style={styles.eyebrow}>
          BUILD YOUR ROUTINE
        </Txt>
        <Txt bold style={styles.heading}>
          {initial ? "Make it your own." : "A plan to come back to."}
        </Txt>
        <Txt muted>
          Choose your exercises, training days, and how often this plan repeats.
        </Txt>
        <Card>
          <Field
            label="Workout name"
            placeholder="e.g. Lower body strength"
            value={title}
            maxLength={100}
            editable={!busy && !pendingCommit}
            onChangeText={(value) => {
              setTitle(value);
              markDirty();
            }}
            returnKeyType="done"
          />
          <Txt bold>Repeat</Txt>
          <View style={styles.chips}>
            <Chip
              label="Weekly"
              selected={recurrence.kind === "weekly"}
              onPress={() => {
                if (busyRef.current || pendingCommit) return;
                setRecurrence({ kind: "weekly" });
                markDirty();
              }}
            />
            <Chip
              label="Every 2 weeks"
              selected={recurrence.kind === "biweekly"}
              onPress={() => {
                if (busyRef.current || pendingCommit) return;
                setRecurrence((current) =>
                  current.kind === "biweekly"
                    ? current
                    : { kind: "biweekly", anchorMonday: previewStart },
                );
                markDirty();
              }}
            />
          </View>
          {recurrence.kind === "legacy" && (
            <View style={{ gap: 8 }}>
              <Txt bold>Existing custom schedule</Txt>
              <Txt muted style={styles.small}>
                Your existing dates are kept when you edit the name or exercises.
                Choose Weekly or Every 2 weeks above before changing the schedule.
              </Txt>
            </View>
          )}
          {recurrence.kind === "biweekly" && (
            <View style={{ gap: 10 }}>
              <Txt bold>Active week</Txt>
              <View style={styles.chips}>
                {[0, 1].map((offset) => {
                  const start = addDays(previewStart, offset * 7);
                  return (
                    <Chip
                      key={start}
                      label={`${formatDate(start)} – ${formatDate(addDays(start, 6))}`}
                      selected={activeWeek(start)}
                      onPress={() => {
                        if (busyRef.current || pendingCommit) return;
                        setRecurrence({ kind: "biweekly", anchorMonday: start });
                        markDirty();
                      }}
                    />
                  );
                })}
              </View>
              <Txt muted style={styles.small}>
                Train in the selected week, then skip a week. These dates stay fixed
                even when a workout is missed.
              </Txt>
            </View>
          )}
          <Txt bold>Training days</Txt>
          {recurrence.kind === "legacy" ? (
            <Txt muted>
              {weekdays.map((day) => WEEKDAYS[day]).join(", ") || "On demand"}
            </Txt>
          ) : (
            <View style={styles.chips}>
              {WEEKDAYS.map((day, index) => (
                <Chip
                  key={day}
                  label={day}
                  selected={weekdays.includes(index)}
                  onPress={() => {
                    if (busyRef.current || pendingCommit) return;
                    setWeekdays((current) =>
                      current.includes(index)
                        ? current.filter((value) => value !== index)
                        : [...current, index],
                    );
                    markDirty();
                  }}
                />
              ))}
            </View>
          )}
          <Txt muted style={styles.small}>
            {weekdays.length
              ? "One workout per day. Plans every two weeks can share a day in opposite weeks."
              : "No days selected: keep this as an on-demand workout."}
          </Txt>
          {preview.error && exercises.length > 0 && (
            <Txt style={{ color: colors.danger }}>{preview.error}</Txt>
          )}
        </Card>
        <Row style={styles.sectionRow}>
          <SectionTitle>Exercises</SectionTitle>
          <Txt muted>{exercises.length} selected</Txt>
        </Row>
        {!exercises.length && (
          <Card>
            <Txt bold>Start with one movement</Txt>
            <Txt muted>
              Pick from the exercise library or add your own. Set a rep range
              that fits your routine.
            </Txt>
          </Card>
        )}
        {exercises.map((target, index) => {
          const exercise = data.exercises.find(
            (item) => item.id === target.exerciseId,
          );
          if (!exercise) return null;
          return (
            <Card key={target.exerciseId}>
              <Row style={styles.exerciseHeader}>
                <View
                  style={[
                    styles.number,
                    { backgroundColor: colors.accentSoft },
                  ]}
                >
                  <Txt bold style={{ color: colors.accent }}>
                    {index + 1}
                  </Txt>
                </View>
                <View style={styles.grow}>
                  <Txt bold>{exercise.name}</Txt>
                  <Txt muted style={styles.small}>
                    {groupName(exercise.group)} ·{" "}
                    {equipmentName(exercise.equipment)}
                  </Txt>
                </View>
              </Row>
              <Txt muted style={styles.small}>
                {loadLabel(exercise.equipment)}
              </Txt>
              <Row style={styles.fields}>
                <View style={styles.grow}>
                  <Field
                    label="Sets"
                    accessibilityLabel={`${exercise.name} number of sets`}
                    value={target.sets}
                    editable={!busy && !pendingCommit}
                    keyboardType="number-pad"
                    maxLength={2}
                    onChangeText={(value) => editTarget(index, "sets", value)}
                  />
                </View>
                <View style={styles.grow}>
                  <Field
                    label="Min reps"
                    accessibilityLabel={`${exercise.name} minimum reps`}
                    value={target.repMin}
                    editable={!busy && !pendingCommit}
                    keyboardType="number-pad"
                    maxLength={4}
                    onChangeText={(value) => editTarget(index, "repMin", value)}
                  />
                </View>
                <View style={styles.grow}>
                  <Field
                    label="Max reps"
                    accessibilityLabel={`${exercise.name} maximum reps`}
                    value={target.repMax}
                    editable={!busy && !pendingCommit}
                    keyboardType="number-pad"
                    maxLength={4}
                    onChangeText={(value) => editTarget(index, "repMax", value)}
                  />
                </View>
              </Row>
              <Row style={styles.actions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Move ${exercise.name} earlier`}
                  accessibilityState={{ disabled: index === 0 || busy }}
                  disabled={index === 0 || busy || !!pendingCommit}
                  onPress={() => moveExercise(index, -1)}
                  style={[
                    styles.smallAction,
                    { opacity: index === 0 ? 0.35 : 1 },
                  ]}
                >
                  <Txt style={{ color: colors.accent }}>↑ Earlier</Txt>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Move ${exercise.name} later`}
                  accessibilityState={{
                    disabled: index === exercises.length - 1 || busy,
                  }}
                  disabled={
                    index === exercises.length - 1 || busy || !!pendingCommit
                  }
                  onPress={() => moveExercise(index, 1)}
                  style={[
                    styles.smallAction,
                    { opacity: index === exercises.length - 1 ? 0.35 : 1 },
                  ]}
                >
                  <Txt style={{ color: colors.accent }}>↓ Later</Txt>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${exercise.name}`}
                  disabled={busy || !!pendingCommit}
                  onPress={() => {
                    setExercises((current) =>
                      current.filter((_, i) => i !== index),
                    );
                    markDirty();
                  }}
                  style={styles.smallAction}
                >
                  <Txt style={{ color: colors.danger }}>Remove</Txt>
                </Pressable>
              </Row>
            </Card>
          );
        })}
        <Button
          title="+ Add exercise"
          secondary
          disabled={busy || !!pendingCommit || exercises.length >= 100}
          onPress={() => {
            setPicker("library");
            setCustomError(null);
          }}
        />
        <SectionTitle>This week & next</SectionTitle>
        {preview.error ? (
          <Card>
            <Txt style={{ color: colors.danger }}>{preview.error}</Txt>
            <Txt muted>
              Complete the fields above to preview your schedule. Each date
              supports one workout.
            </Txt>
          </Card>
        ) : (
          preview.data && (
            <>
              {[0, 1].map((week) => {
                const start = addDays(previewStart, week * 7);
                return (
                  <Card key={start}>
                    <Row style={styles.sectionRow}>
                      <Txt bold>{week === 0 ? "This week" : "Next week"}</Txt>
                      <Txt muted style={styles.small}>
                        {formatDate(start)}
                      </Txt>
                    </Row>
                    {WEEKDAYS.map((day, index) => {
                      const previewDate = addDays(start, index);
                      const past = previewDate < date;
                      const workout = scheduleForDate(preview.data!, previewDate);
                      return (
                        <View
                          key={day}
                          style={[
                            styles.previewRow,
                            {
                              borderBottomColor: colors.border,
                              opacity: past ? 0.5 : 1,
                            },
                          ]}
                        >
                          <Txt muted style={styles.day}>
                            {day}
                            {"\n"}
                            {Number(previewDate.slice(-2))}
                          </Txt>
                          <Txt
                            bold={workout?.id === id}
                            style={[
                              styles.grow,
                              {
                                color:
                                  workout?.id === id
                                    ? colors.accent
                                    : workout
                                      ? colors.text
                                      : colors.muted,
                              },
                            ]}
                          >
                            {workout?.title ?? "Rest day"}
                          </Txt>
                        </View>
                      );
                    })}
                  </Card>
                );
              })}
            </>
          )
        )}
        <Txt muted style={styles.small}>
          Changes start today. Previous schedules and recorded workouts stay in
          your history.
        </Txt>
        {(message || status === "error") && (
          <Card>
            <Txt style={{ color: colors.danger }}>
              {message ?? storageError ?? "Saving failed. Please retry."}
            </Txt>
          </Card>
        )}
        <Button
          title={
            busy
              ? "Saving…"
              : pendingCommit === "archive"
                ? "Retry archive"
                : pendingCommit
                  ? "Retry save"
                  : "Save plan"
          }
          disabled={busy}
          onPress={() => {
            void save();
          }}
        />
        {initial && (
          <Button
            title="Archive plan"
            danger
            secondary
            disabled={busy || !!pendingCommit}
            onPress={confirmArchive}
          />
        )}
      </Screen>
      <Modal
        visible={confirmation !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmation(null)}
      >
        <View style={styles.dialogBackdrop}>
          <View style={styles.dialog}>
            <Card>
              <SectionTitle>
                {confirmation === "archive"
                  ? "Archive this plan?"
                  : confirmation === "unsaved"
                    ? "Changes have not saved"
                    : "Discard plan changes?"}
              </SectionTitle>
              <Txt muted>
                {confirmation === "archive"
                  ? "This plan leaves your schedule starting today. Previous workout records and schedules are kept."
                  : confirmation === "unsaved"
                    ? "Please retry saving before leaving. Your changes are still here."
                    : "Your unsaved plan changes will be discarded. Exercises already added to your library are kept."}
              </Txt>
              <Button
                title={confirmation === "unsaved" ? "Back to editing" : "Keep editing"}
                secondary
                onPress={() => setConfirmation(null)}
              />
              {confirmation !== "unsaved" && (
                <Button
                  title={confirmation === "archive" ? "Archive plan" : "Discard changes"}
                  danger
                  onPress={() => {
                    const action = confirmation;
                    setConfirmation(null);
                    if (action === "archive") void archive();
                    else leave();
                  }}
                />
              )}
            </Card>
          </View>
        </View>
      </Modal>
      <Modal
        visible={picker !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => {
          if (!busyRef.current) setPicker(null);
        }}
      >
        <Screen>
          <Row style={styles.sectionRow}>
            <SectionTitle>
              {picker === "custom" ? "Custom exercise" : "Exercise library"}
            </SectionTitle>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => {
                setPicker(null);
                Keyboard.dismiss();
              }}
              style={styles.smallAction}
            >
              <Txt style={{ color: colors.accent }}>Done</Txt>
            </Pressable>
          </Row>
          {picker === "custom" ? (
            <>
              <Txt muted>
                Create an exercise once, then use it in any workout.
              </Txt>
              <Field
                label="Exercise name"
                placeholder="e.g. Seated dumbbell curl"
                value={customName}
                maxLength={100}
                editable={!busy && !pendingCommit}
                onChangeText={setCustomName}
              />
              <Txt bold>Primary muscle group</Txt>
              <View style={styles.chips}>
                {MUSCLE_GROUPS.map((group) => (
                  <Chip
                    key={group}
                    label={groupName(group)}
                    selected={customGroup === group}
                    onPress={() => {
                      if (!busyRef.current) setCustomGroup(group);
                    }}
                  />
                ))}
              </View>
              <Txt bold>Equipment</Txt>
              <View style={styles.chips}>
                {EQUIPMENT.map((equipment) => (
                  <Chip
                    key={equipment}
                    label={equipmentName(equipment)}
                    selected={customEquipment === equipment}
                    onPress={() => {
                      if (!busyRef.current) setCustomEquipment(equipment);
                    }}
                  />
                ))}
              </View>
              <Txt muted>{loadLabel(customEquipment)}</Txt>
              {customEquipment !== "bodyweight" && (
                <Card>
                  <Txt bold>Weight increments</Txt>
                  <Txt muted style={styles.small}>
                    The smallest increase available for this exercise. For
                    dumbbells, enter the increase per dumbbell.
                  </Txt>
                  <Row style={styles.fields}>
                    <View style={styles.grow}>
                      <Field
                        label="Pounds (lb)"
                        value={incrementLb}
                        keyboardType="decimal-pad"
                        maxLength={8}
                        editable={!busy && !pendingCommit}
                        onChangeText={setIncrementLb}
                      />
                    </View>
                    <View style={styles.grow}>
                      <Field
                        label="Kilograms (kg)"
                        value={incrementKg}
                        keyboardType="decimal-pad"
                        maxLength={8}
                        editable={!busy && !pendingCommit}
                        onChangeText={setIncrementKg}
                      />
                    </View>
                  </Row>
                </Card>
              )}
              {customError && (
                <Txt style={{ color: colors.danger }}>{customError}</Txt>
              )}
              <Button
                title={busy ? "Saving exercise…" : "Create & add exercise"}
                disabled={busy}
                onPress={() => {
                  void createCustom();
                }}
              />
              <Button
                title="Back to library"
                secondary
                disabled={busy}
                onPress={() => setPicker("library")}
              />
            </>
          ) : (
            <>
              <Field
                label="Search exercises"
                placeholder="Name, muscle group or equipment"
                value={query}
                onChangeText={setQuery}
                autoCorrect={false}
                returnKeyType="search"
              />
              <Button
                title="+ Create custom exercise"
                secondary
                onPress={() => {
                  customId.current = null;
                  setCustomName(query.trim());
                  setCustomGroup("Legs");
                  setCustomEquipment("dumbbell");
                  setIncrementLb("5");
                  setIncrementKg("2.5");
                  setCustomError(null);
                  setPicker("custom");
                }}
              />
              {customError && (
                <Txt style={{ color: colors.danger }}>{customError}</Txt>
              )}
              {filtered.length === 0 && (
                <Card>
                  <Txt bold>No exercises found</Txt>
                  <Txt muted>
                    Try a muscle group or create a custom exercise above.
                  </Txt>
                </Card>
              )}
              {filtered.map((exercise) => (
                <Pressable
                  key={exercise.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${exercise.name}, ${equipmentName(exercise.equipment)}${selectedIds.has(exercise.id) ? ", already added" : ", add exercise"}`}
                  accessibilityState={{
                    disabled: selectedIds.has(exercise.id),
                  }}
                  disabled={selectedIds.has(exercise.id)}
                  onPress={() => addExercise(exercise)}
                >
                  <Card>
                    <Row>
                      <View style={styles.grow}>
                        <Txt bold>{exercise.name}</Txt>
                        <Txt muted style={styles.small}>
                          {groupName(exercise.group)} ·{" "}
                          {equipmentName(exercise.equipment)}
                        </Txt>
                      </View>
                      <Txt
                        style={{
                          color: selectedIds.has(exercise.id)
                            ? colors.muted
                            : colors.accent,
                        }}
                      >
                        {selectedIds.has(exercise.id) ? "Added" : "+"}
                      </Txt>
                    </Row>
                  </Card>
                </Pressable>
              ))}
            </>
          )}
        </Screen>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  eyebrow: { fontSize: 12, letterSpacing: 2, marginTop: 8 },
  heading: { fontSize: 30, lineHeight: 36, letterSpacing: -0.8 },
  small: { fontSize: 13, lineHeight: 19 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  sectionRow: { justifyContent: "space-between", flexWrap: "wrap" },
  exerciseHeader: { alignItems: "flex-start" },
  grow: { flex: 1, minWidth: 0 },
  number: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  fields: { alignItems: "flex-start", gap: 12 },
  actions: { justifyContent: "space-between", flexWrap: "wrap", gap: 0 },
  smallAction: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  cancel: { minHeight: 44, justifyContent: "center", paddingRight: 12 },
  previewRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  day: { width: 40, fontSize: 13 },
  dialogBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.45)",
    justifyContent: "center",
    padding: 20,
  },
  dialog: { width: "100%", maxWidth: 520, alignSelf: "center" },
});
