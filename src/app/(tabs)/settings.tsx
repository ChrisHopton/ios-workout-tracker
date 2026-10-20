import { useRef, useState } from "react";
import { View } from "react-native";
import { useApp } from "../../data/store";
import { Unit } from "../../domain/types";
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
import { GenderSelector } from "../../components/GenderSelector";

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
  const { data, update, flush } = useApp();
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
  const [query, setQuery] = useState("");
  const [exerciseId, setExerciseId] = useState("");
  const [increment, setIncrement] = useState("");
  const [showIncrements, setShowIncrements] = useState(false);
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
          gender,
          heightCm: cm,
        },
      }));
      await flush();
      setCanonicalHeight(cm);
      setHeightEdited(false);
      setMessage("Profile saved.");
    });
  }
  return (
    <Screen bottomSafeArea={false}>
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
          Used for new workouts and chart display.
        </Txt>
      </Card>
      <BodyWeightSettings disabled={busy} />
      <Card>
        <SectionTitle>Your profile</SectionTitle>
        <Txt muted style={{ fontSize: 13 }}>
          Optional. Included with your automatic workout uploads.
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
        <GenderSelector
          value={gender}
          disabled={busy}
          onChange={(value) => {
            if (!busyRef.current) setGender(value);
          }}
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
      </Card>
      <Card>
        <SectionTitle>Weight increments</SectionTitle>
        <Button title={showIncrements ? "Hide increments" : "Adjust weight increments"} secondary disabled={busy} onPress={() => setShowIncrements(!showIncrements)} />
        {showIncrements && <>
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
        </>}
      </Card>
      <SyncSettings />
    </Screen>
  );
}
