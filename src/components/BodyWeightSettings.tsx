import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { useApp } from "../data/store";
import { latestBodyWeight } from "../domain/bodyWeight";
import { formatDate, today } from "../domain/dates";
import { convertWeight } from "../domain/recommendations";
import { BodyWeightEntry } from "../domain/types";
import { convertBodyWeightDraft, removeBodyWeightDraft, saveBodyWeightDraft, type SavedBodyWeightDraft } from "./bodyWeightDraft";
import { InlineSaveButton } from "./InlineSaveButton";
import { useSaveAction } from "./useSaveAction";
import { Button, Card, Field, Row, SectionTitle, Txt, useTheme } from "./ui";

export function BodyWeightSettings({ disabled = false }: { disabled?: boolean }) {
  const { data, update, flush } = useApp();
  const t = useTheme();
  const [id, setId] = useState<string | undefined>();
  const [dateOverride, setDateOverride] = useState<string | null>(null);
  const [weight, setWeight] = useState("");
  const [inputUnit, setInputUnit] = useState(data.settings.unit);
  const [showDate, setShowDate] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const busyRef = useRef(false);
  const canonicalWeight = useRef<number | null>(null);
  const savedDraft = useRef<SavedBodyWeightDraft | null>(null);
  const measurementSave = useSaveAction();
  const historySave = useSaveAction();
  const date = dateOverride ?? today();
  const latest = latestBodyWeight(data.bodyWeights, today());
  const entries = [...data.bodyWeights].sort((a, b) => b.date.localeCompare(a.date));

  useEffect(() => {
    if (inputUnit !== data.settings.unit) {
      const converted = convertBodyWeightDraft(weight, inputUnit, data.settings.unit, canonicalWeight.current);
      canonicalWeight.current = converted.canonicalKg;
      setWeight(converted.weight);
      setInputUnit(data.settings.unit);
    }
  }, [data.settings.unit, inputUnit, weight]);

  function reset() {
    canonicalWeight.current = null;
    savedDraft.current = null;
    setId(undefined);
    setDateOverride(null);
    setWeight("");
    setShowDate(false);
    measurementSave.edited();
  }
  function edit(entry: BodyWeightEntry) {
    if (busyRef.current || disabled) return;
    canonicalWeight.current = entry.weightKg;
    savedDraft.current = null;
    setId(entry.id);
    setDateOverride(entry.date);
    setWeight(String(Math.round(convertWeight(entry.weightKg, "kg", inputUnit) * 1000) / 1000));
    setShowDate(true);
    measurementSave.edited();
  }
  async function locked(work: () => Promise<void>) {
    if (busyRef.current || disabled) return;
    busyRef.current = true;
    setBusy(true);
    try { await work(); } finally { busyRef.current = false; setBusy(false); }
  }
  function save() {
    void locked(async () => {
      let saved: BodyWeightEntry | undefined;
      const succeeded = await measurementSave.run(() => {
        update((current) => {
          const result = saveBodyWeightDraft(current, {
            id, date: dateOverride ?? today(), weight, unit: inputUnit,
            canonicalKg: canonicalWeight.current,
          }, today(), savedDraft.current);
          saved = result.entry;
          // Keep the optimistic ID for retries even if the following flush fails.
          savedDraft.current = { id: result.entry.id, date: result.entry.date };
          return result.data;
        });
      }, flush);
      if (succeeded && saved) {
        canonicalWeight.current = saved.weightKg;
      }
    });
  }
  function deleteMeasurement(entryId: string) {
    void locked(async () => {
      setDeleteId(entryId);
      const succeeded = await historySave.run(() => {
        update((current) => {
          const result = removeBodyWeightDraft(current, entryId, id, savedDraft.current);
          savedDraft.current = result.saved;
          if (result.detached) {
            setId(result.id);
            measurementSave.edited();
          }
          return result.data;
        });
      }, flush);
      if (succeeded) {
        setDeleteId(null);
      }
    });
  }
  function disclosure(title: string, expanded: boolean, onPress: () => void) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded, disabled: disabled || busy }}
        disabled={disabled || busy}
        onPress={onPress}
        style={({ pressed }) => ({
          minHeight: 44, paddingVertical: 10, paddingHorizontal: 2,
          justifyContent: "center", maxWidth: "100%",
          opacity: disabled || busy ? 0.4 : pressed ? 0.75 : 1,
        })}
      >
        <Txt style={{ fontSize: 13, fontWeight: "600", color: t.accent }}>{title}</Txt>
      </Pressable>
    );
  }
  return (
    <Card style={{ padding: 16, gap: 8 }}>
      <SectionTitle>Body weight</SectionTitle>
      {latest ? (
        <Txt bold>
          {Math.round(convertWeight(latest.weightKg, "kg", data.settings.unit) * 100) / 100} {data.settings.unit} · {formatDate(latest.date)}
        </Txt>
      ) : <Txt muted style={{ fontSize: 13 }}>Add your first measurement.</Txt>}
      {!!id && <Txt muted style={{ fontSize: 13 }}>Editing a measurement from your history.</Txt>}
      <Row style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
        <View style={{ flexGrow: 1, flexBasis: 150, minWidth: 0 }}>
          <Field
            label={"Body weight (" + inputUnit + ")"}
            value={weight}
            editable={!disabled && !busy}
            keyboardType="decimal-pad"
            maxLength={12}
            placeholder="Enter weight"
            onChangeText={(value) => {
              if (busyRef.current || disabled) return;
              const next = value.replace(",", ".");
              if (next === weight) return;
              canonicalWeight.current = null;
              setWeight(next);
              measurementSave.edited();
            }}
          />
        </View>
        <View style={{ maxWidth: "100%" }}>
          <InlineSaveButton state={measurementSave} subject="body weight" disabled={disabled || busy} onPress={save} />
        </View>
      </Row>
      {!!measurementSave.error && (
        <View accessibilityRole="alert" accessibilityLiveRegion="polite">
          <Txt style={{ color: t.danger }}>{measurementSave.error}</Txt>
        </View>
      )}
      <Row style={{ flexWrap: "wrap", justifyContent: "space-between", gap: 4 }}>
        {disclosure(showDate ? "Hide date" : (dateOverride === null ? "Today · Change date" : date + " · Change date"), showDate, () => setShowDate(!showDate))}
        {!!entries.length && disclosure((showHistory ? "Hide history" : "History") + " (" + entries.length + ")", showHistory, () => setShowHistory(!showHistory))}
      </Row>
      {showDate && (
        <Field
          label="Measurement date (YYYY-MM-DD)"
          value={date}
          editable={!disabled && !busy}
          maxLength={10}
          autoCapitalize="none"
          placeholder={today()}
          onChangeText={(value) => {
            if (busyRef.current || disabled || value === date) return;
            setDateOverride(value);
            measurementSave.edited();
          }}
        />
      )}
      {(id || dateOverride !== null) && (
        <Button title={id ? "Cancel editing" : "Back to today"} secondary disabled={disabled || busy} onPress={reset} />
      )}
      {!!entries.length && (
        <Txt muted style={{ fontSize: 13, lineHeight: 18 }}>
          For consistent tracking, try weighing once a week, using the same scale at a similar time—preferably in the morning.
        </Txt>
      )}
      {historySave.status === "saving" && <View accessibilityLiveRegion="polite"><Txt muted>Deleting measurement…</Txt></View>}
      {historySave.status === "saved" && <View accessibilityLiveRegion="polite"><Txt style={{ color: t.success }}>Measurement deleted.</Txt></View>}
      {!!historySave.error && (
        <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ gap: 8 }}>
          <Txt style={{ color: t.danger }}>{historySave.error}</Txt>
          {!!deleteId && <Button title="Retry delete" secondary disabled={disabled || busy} onPress={() => deleteMeasurement(deleteId)} />}
        </View>
      )}
      {showHistory && entries.map((entry) => (
        <View key={entry.id} style={{ gap: 8, borderTopWidth: 1, borderColor: t.border, paddingTop: 12 }}>
          <Txt>{formatDate(entry.date, { month: "short", day: "numeric", year: "numeric" })} · {Math.round(convertWeight(entry.weightKg, "kg", inputUnit) * 100) / 100} {inputUnit}</Txt>
          <Row style={{ flexWrap: "wrap" }}>
            <Button title="Edit" secondary disabled={disabled || busy} onPress={() => edit(entry)} />
            <Button title="Delete" secondary danger disabled={disabled || busy} onPress={() => deleteMeasurement(entry.id)} />
          </Row>
        </View>
      ))}
    </Card>
  );
}
