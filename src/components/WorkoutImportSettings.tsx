import { useMemo, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { importFile } from "../data/backupIO";
import { useApp } from "../data/store";
import { formatDate } from "../domain/dates";
import { mergeWorkoutImport, parseWorkoutImport, previewWorkoutImport, type WorkoutImport, type WorkoutImportPreview } from "../domain/workoutImport";
import { Button, Card, Chip, Row, Txt, useTheme } from "./ui";
import { useSaveAction } from "./useSaveAction";

function count(value: number, singular: string) {
  return value + " " + singular + (value === 1 ? "" : "s");
}
function addedSummary(preview: WorkoutImportPreview) {
  return "Added " + count(preview.plansAdded, "plan") + ", " + count(preview.workoutsAdded, "workout")
    + " and " + count(preview.exercisesAdded, "exercise") + ".";
}

export function WorkoutImportSettings({ disabled = false }: { disabled?: boolean }) {
  const { data, replace } = useApp();
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<WorkoutImport | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [allowUnscheduled, setAllowUnscheduled] = useState(false);
  const [fileError, setFileError] = useState("");
  const [message, setMessage] = useState("");
  const busyRef = useRef(false);
  const save = useSaveAction();
  const busy = selecting || save.status === "saving";
  const review = useMemo(() => {
    try {
      return { preview: source ? previewWorkoutImport(data, source) : null, error: "" };
    } catch (error) {
      return { preview: null, error: error instanceof Error ? error.message : "This file cannot be imported." };
    }
  }, [data, source]);
  const preview = review.preview;
  const error = fileError || review.error || save.error;
  const hasAdditions = !!preview && preview.plansAdded + preview.workoutsAdded + preview.exercisesAdded > 0;
  const needsConsent = !!preview?.requiresUnscheduledConsent && !allowUnscheduled;

  async function chooseFile() {
    if (disabled || busyRef.current) return;
    busyRef.current = true;
    setSelecting(true);
    setSource(null);
    setFileError("");
    setMessage("");
    setAllowUnscheduled(false);
    save.edited();
    try {
      const text = await importFile();
      if (text !== null) setSource(parseWorkoutImport(text));
    } catch (cause) {
      setFileError(cause instanceof Error ? cause.message : "The import file could not be opened.");
    } finally {
      busyRef.current = false;
      setSelecting(false);
    }
  }

  async function confirmImport() {
    if (disabled || busyRef.current || !source || !preview || !hasAdditions || needsConsent) return;
    busyRef.current = true;
    setMessage("");
    let applied: WorkoutImportPreview | null = null;
    try {
      const succeeded = await save.run(async () => {
        await replace((current) => {
          // Recompute at commit so a pending file picker cannot replace newer phone edits.
          applied = previewWorkoutImport(current, source);
          return mergeWorkoutImport(current, source, { allowUnscheduledPlans: allowUnscheduled });
        });
      }, async () => {});
      if (succeeded && applied) {
        const result = applied as WorkoutImportPreview;
        setMessage(addedSummary(result)
          + (result.duplicatesSkipped ? " " + count(result.duplicatesSkipped, "item") + " already present." : "")
          + (result.plansUnscheduled ? " " + count(result.plansUnscheduled, "plan") + " added without assigned days." : "")
          + (result.conflicts.some((conflict) => conflict.kind !== "schedule") ? " Existing entries were kept where they conflicted." : ""));
        setSource(null);
        setAllowUnscheduled(false);
      }
    } finally {
      busyRef.current = false;
    }
  }

  return <Card style={{ padding: 16, gap: open ? 14 : 0 }}>
    <Pressable accessibilityRole="button" accessibilityLabel="Import plans and workouts"
      accessibilityState={{ expanded: open, disabled: disabled || busy }}
      disabled={disabled || busy} onPress={() => setOpen(!open)}
      style={{ minHeight: 44, justifyContent: "center" }}>
      <Row style={{ justifyContent: "space-between" }}>
        <Txt bold>Import plans and workouts</Txt>
        <Txt muted>{open ? "⌃" : "⌄"}</Txt>
      </Row>
    </Pressable>
    {open && <>
      <Txt muted style={{ fontSize: 13 }}>Choose a prepared Workout import JSON file from Files. Review it before adding anything.</Txt>
      <Button title={selecting ? "Opening Files…" : source ? "Choose another file" : "Choose import file"}
        secondary disabled={disabled || busy} onPress={() => void chooseFile()} />
      {preview && <>
        <View style={{ gap: 4 }}>
          <Txt bold>Ready to add</Txt>
          <Txt>{count(preview.plansAdded, "plan")} · {count(preview.workoutsAdded, "workout")} · {count(preview.exercisesAdded, "exercise")}</Txt>
          {!!preview.duplicatesSkipped && <Txt muted style={{ fontSize: 13 }}>{count(preview.duplicatesSkipped, "item")} already present; those will be kept.</Txt>}
          {!!source?.templates.some((plan) => !plan.archived && plan.weekdays.length > 0) && preview.plansAdded > 0 &&
            <Txt muted style={{ fontSize: 13 }}>Schedule begins {formatDate(preview.effectiveDate, { month: "long", day: "numeric", year: "numeric" })}.</Txt>}
        </View>
        {!!preview.conflicts.length && <View style={{ gap: 7 }}>
          <Txt bold>{count(preview.conflicts.length, "conflict")}</Txt>
          {preview.conflicts.slice(0, 8).map((conflict, index) =>
            <Txt key={conflict.kind + "-" + conflict.id + "-" + index} muted style={{ fontSize: 13 }}>{conflict.message}</Txt>)}
          {preview.conflicts.length > 8 && <Txt muted style={{ fontSize: 13 }}>And {preview.conflicts.length - 8} more. Existing conflicting entries will be kept.</Txt>}
        </View>}
        {preview.requiresUnscheduledConsent && <View style={{ gap: 8 }}>
          <Txt muted style={{ fontSize: 13 }}>Conflicting new plans can be added without assigned days. You can schedule them later.</Txt>
          <Chip label="Leave conflicting plans unscheduled" selected={allowUnscheduled}
            onPress={() => { if (!disabled && !busyRef.current) setAllowUnscheduled(!allowUnscheduled); }} />
        </View>}
        <Txt muted style={{ fontSize: 13 }}>Your profile, body weights and existing workouts stay in place.</Txt>
        {!hasAdditions && <Txt muted>This file has no new items to add.</Txt>}
        <Button title={save.status === "saving" ? "Importing…" : save.status === "error" ? "Retry import" : "Import plans and workouts"}
          disabled={disabled || busy || !hasAdditions || needsConsent} onPress={() => void confirmImport()} />
      </>}
      {!!error && <View accessibilityRole="alert" accessibilityLiveRegion="polite">
        <Txt style={{ color: t.danger }}>{error}</Txt>
        {save.error && <Txt muted style={{ fontSize: 13 }}>Nothing from this import was saved. You can retry with the same file.</Txt>}
      </View>}
      {!!message && <View accessibilityLiveRegion="polite">
        <Txt style={{ color: t.success }}>{message}</Txt>
      </View>}
    </>}
  </Card>;
}
