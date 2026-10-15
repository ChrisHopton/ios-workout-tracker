import { useRef, useState } from "react";
import { Alert, View } from "react-native";
import { useApp } from "../../data/store";
import { parseBackup, serializeBackup } from "../../domain/backup";
import { exportFile, importFile, migrationBackupAvailable, exportMigrationBackup } from "../../data/backupIO";
import { AppData, Unit } from "../../domain/types";
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
} from "../../components/ui";
import { SyncSettings } from "../../components/SyncSettings";
import { BodyWeightSettings } from "../../components/BodyWeightSettings";
import { SaveIndicator } from "../../components/SaveIndicator";

type HeightFields = { cm: string; feet: string; inches: string };
function heightFields(cm: number | null): HeightFields {
  if (cm === null) return { cm: "", feet: "", inches: "" };
  const totalInches = Math.round((cm / 2.54) * 100) / 100;
  const feet = Math.floor(totalInches / 12);
  return {
    cm: String(Math.round(cm * 100) / 100),
    feet: String(feet),
    inches: String(Math.round((totalInches - feet * 12) * 100) / 100),
  };
}
function parseHeight(fields: HeightFields, unit: Unit): number | null {
  let cm: number | null = null;
  if (unit === "kg") {
    if (fields.cm !== "") {
      if (!/^\d+(\.\d+)?$/.test(fields.cm))
        throw new Error("Enter a valid height in centimeters.");
      cm = Number(fields.cm);
    }
  } else if (fields.feet !== "" || fields.inches !== "") {
    if (
      !/^\d*$/.test(fields.feet) ||
      !/^\d*(\.\d+)?$/.test(fields.inches) ||
      Number(fields.inches) >= 12
    ) {
      throw new Error("Enter feet and inches, with inches below 12.");
    }
    cm = (Number(fields.feet) * 12 + Number(fields.inches)) * 2.54;
  }
  if (cm !== null && (!Number.isFinite(cm) || cm < 1 || cm > 300)) {
    throw new Error("Enter a height between 1 and 300 cm, or leave it blank.");
  }
  return cm;
}

export default function Settings() {
  const { data, update, flush, replace } = useApp();
  const t = useTheme();
  const [age, setAge] = useState(data.settings.age);
  const [gender, setGender] = useState(data.settings.gender);
  const [height, setHeight] = useState(() =>
    heightFields(data.settings.heightCm),
  );
  // Keep exact height separately from rounded display fields
  const [canonicalHeight, setCanonicalHeight] = useState(
    data.settings.heightCm,
  );
  const [heightEdited, setHeightEdited] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [pendingRestore, setPendingRestore] = useState<AppData | null>(null);
  const [query, setQuery] = useState("");
  const [exerciseId, setExerciseId] = useState("");
  const [increment, setIncrement] = useState("");
  const exercise = data.exercises.find((item) => item.id === exerciseId);

  async function action(work: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Something went wrong.",
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  function currentHeight() {
    return heightEdited
      ? parseHeight(height, data.settings.unit)
      : canonicalHeight;
  }
  function editHeight(key: keyof HeightFields, value: string) {
    if (busyRef.current) return;
    setHeight((current) => ({ ...current, [key]: value.replace(",", ".") }));
    setHeightEdited(true);
  }
  function chooseUnit(unit: Unit) {
    if (busyRef.current || unit === data.settings.unit) return;
    void action(async () => {
      const cm = currentHeight();
      update((current) => ({
        ...current,
        settings: { ...current.settings, unit },
      }));
      setCanonicalHeight(cm);
      setHeight(heightFields(cm));
      setHeightEdited(false);
      setIncrement(
        exercise
          ? String(unit === "lb" ? exercise.incrementLb : exercise.incrementKg)
          : "",
      );
      await flush();
    });
  }
  function saveProfile() {
    void action(async () => {
      if (
        age !== "" &&
        (!/^\d+$/.test(age) || Number(age) < 1 || Number(age) > 130)
      )
        throw new Error("Enter an age from 1 to 130, or leave it blank.");
      const cm = currentHeight();
      update((current) => ({
        ...current,
        settings: {
          ...current.settings,
          age,
          gender: gender.trim(),
          heightCm: cm,
        },
      }));
      await flush();
      setCanonicalHeight(cm);
      setHeightEdited(false);
      setMessage("Profile saved.");
    });
  }
  async function restore() {
    if (!pendingRestore) return;
    const backup = pendingRestore;
    await action(async () => {
      await replace(backup);
      setAge(backup.settings.age);
      setGender(backup.settings.gender);
      setCanonicalHeight(backup.settings.heightCm);
      setHeightEdited(false);
      setHeight(heightFields(backup.settings.heightCm));
      setPendingRestore(null);
      setMessage("Backup restored.");
      setExerciseId("");
      setIncrement("");
    });
  }
  function confirmRestore() {
    if (busyRef.current) return;
    Alert.alert(
      "Replace data on this phone?",
      "Your current profile, plans, and workout history will be replaced. Export a backup first if you want to keep them.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Replace & restore",
          style: "destructive",
          onPress: () => {
            void restore();
          },
        },
      ],
    );
  }
  return (
    <Screen>
      <Txt bold style={{ fontSize: 30, lineHeight: 38 }}>
        Make it yours
      </Txt>
      <SaveIndicator />
      {!!error && (
        <Card>
          <Txt style={{ color: t.danger }}>{error}</Txt>
        </Card>
      )}
      {!!message && <Txt style={{ color: t.success }}>{message}</Txt>}
      <Card>
        <SectionTitle>Units</SectionTitle>
        <Row style={{ flexWrap: "wrap" }}>
          <Chip
            label="Pounds · ft / in"
            selected={data.settings.unit === "lb"}
            onPress={() => chooseUnit("lb")}
          />
          <Chip
            label="Kilograms · cm"
            selected={data.settings.unit === "kg"}
            onPress={() => chooseUnit("kg")}
          />
        </Row>
        <Txt muted style={{ fontSize: 12 }}>
          New workouts use your preferred unit. Existing recordings keep their
          original unit; charts convert for comparison.
        </Txt>
      </Card>
      <Card>
        <SectionTitle>Your profile</SectionTitle>
        <Txt muted style={{ fontSize: 13 }}>
          Optional. Included in database when connected.
        </Txt>
        <Field
          label="Age"
          value={age}
          editable={!busy}
          onChangeText={(value) => {
            if (!busyRef.current) setAge(value);
          }}
          keyboardType="number-pad"
          maxLength={3}
          placeholder="Optional"
        />
        <Field
          label="Gender"
          value={gender}
          editable={!busy}
          onChangeText={(value) => {
            if (!busyRef.current) setGender(value);
          }}
          maxLength={80}
          placeholder="Optional"
        />
        {data.settings.unit === "kg" ? (
          <Field
            label="Height (cm)"
            value={height.cm}
            editable={!busy}
            onChangeText={(value) => editHeight("cm", value)}
            keyboardType="decimal-pad"
            maxLength={7}
            placeholder="Optional"
          />
        ) : (
          <Row>
            <View style={{ flex: 1 }}>
              <Field
                label="Height (feet)"
                value={height.feet}
                editable={!busy}
                onChangeText={(value) => editHeight("feet", value)}
                keyboardType="number-pad"
                maxLength={1}
                placeholder="ft"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label="Inches"
                value={height.inches}
                editable={!busy}
                onChangeText={(value) => editHeight("inches", value)}
                keyboardType="decimal-pad"
                maxLength={5}
                placeholder="in"
              />
            </View>
          </Row>
        )}
        <Button title="Save profile" disabled={busy} onPress={saveProfile} />
        <Txt muted style={{ fontSize: 12 }}>
          Weight suggestions use your completed sets and reps. These profile
          details do not adjust lifting targets.
        </Txt>
      </Card>
      <Card>
        <SectionTitle>Weight increments</SectionTitle>
        <Txt muted style={{ fontSize: 13 }}>
          Set the smallest available increase for each exercise. Suggestions
          apply to future recordings.
        </Txt>
        <Field
          label="Find an exercise"
          value={query}
          editable={!busy}
          onChangeText={(value) => {
            if (!busyRef.current) setQuery(value);
          }}
          placeholder="Search exercises…"
        />
        <Row style={{ flexWrap: "wrap", gap: 7 }}>
          {data.exercises
            .filter(
              (item) =>
                item.equipment !== "bodyweight" &&
                item.name.toLowerCase().includes(query.toLowerCase()),
            )
            .slice(0, query ? 12 : 5)
            .map((item) => (
              <Chip
                key={item.id}
                label={item.name}
                selected={exerciseId === item.id}
                onPress={() => {
                  if (busyRef.current) return;
                  setExerciseId(item.id);
                  setIncrement(
                    String(
                      data.settings.unit === "lb"
                        ? item.incrementLb
                        : item.incrementKg,
                    ),
                  );
                }}
              />
            ))}
        </Row>
        {!!exercise && (
          <>
            <Field
              label={exercise.name + " increment (" + data.settings.unit + ")"}
              value={increment}
              editable={!busy}
              onChangeText={(value) => {
                if (!busyRef.current) setIncrement(value.replace(",", "."));
              }}
              keyboardType="decimal-pad"
              maxLength={8}
            />
            <Button
              secondary
              title="Save increment"
              disabled={busy}
              onPress={() => {
                void action(async () => {
                  if (
                    !/^\d+(\.\d+)?$/.test(increment) ||
                    Number(increment) < 0.001 ||
                    Number(increment) > 1000
                  )
                    throw new Error("Choose an increment from 0.001 to 1,000.");
                  update((current) => ({
                    ...current,
                    exercises: current.exercises.map((item) =>
                      item.id === exercise.id
                        ? {
                            ...item,
                            [current.settings.unit === "lb"
                              ? "incrementLb"
                              : "incrementKg"]: Number(increment),
                          }
                        : item,
                    ),
                  }));
                  await flush();
                  setMessage("Increment saved.");
                });
              }}
            />
          </>
        )}
      </Card>
      <BodyWeightSettings disabled={busy} />
      <SyncSettings disabled={busy} />
      <Card>
        <SectionTitle>Backup & restore</SectionTitle>
        {migrationBackupAvailable() && (
          <Button
            title="Export pre-migration backup"
            secondary
            disabled={busy}
            onPress={() => {
              void exportMigrationBackup().then(() => setMessage("Pre-migration backup shared.")).catch((error: unknown) => {
                setMessage(error instanceof Error ? error.message : "Unable to share the backup.");
              });
            }}
          />
        )}
        <Txt muted style={{ fontSize: 13 }}>
          Keep a copy in Files before replacing your phone or deleting the app.
          Backups include your profile and complete workout history.
        </Txt>
        <Button
          title="Export backup"
          disabled={busy}
          onPress={() => {
            void action(async () => {
              await flush();
              await exportFile(serializeBackup(data));
            });
          }}
        />
        <Button
          title="Choose backup to restore"
          secondary
          disabled={busy}
          onPress={() => {
            void action(async () => {
              const text = await importFile();
              if (text !== null) setPendingRestore(parseBackup(text));
            });
          }}
        />
        {!!pendingRestore && (
          <View
            style={{
              gap: 12,
              borderTopWidth: 1,
              borderColor: t.border,
              paddingTop: 16,
            }}
          >
            <Txt bold>Backup ready to restore</Txt>
            <Txt muted>
              {
                pendingRestore.templates.filter((workout) => !workout.archived)
                  .length
              }{" "}
              plans · {pendingRestore.sessions.length} workout records
            </Txt>
            <Txt style={{ fontSize: 13 }}>
              Restoring replaces the current data on this phone.
            </Txt>
            <Button
              title="Replace & restore"
              danger
              disabled={busy}
              onPress={confirmRestore}
            />
            <Button
              title="Cancel restore"
              secondary
              disabled={busy}
              onPress={() => {
                if (!busyRef.current) setPendingRestore(null);
              }}
            />
          </View>
        )}
      </Card>
      <Card>
        <Txt bold>Workout · 1.0</Txt>
        <Txt muted style={{ fontSize: 13 }}>
          Your routine saves on this phone. Database uploads are optional
          and use a private connection code without app sign-in.
        </Txt>
        <Txt muted style={{ fontSize: 12 }}>
          Progression suggestions are simple training heuristics. You always
          choose the weight.
        </Txt>
      </Card>
    </Screen>
  );
}
