import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useApp } from "../data/store";
import { latestBodyWeight, removeBodyWeight, saveBodyWeight } from "../domain/bodyWeight";
import { formatDate, today } from "../domain/dates";
import { convertWeight } from "../domain/recommendations";
import { BodyWeightEntry } from "../domain/types";
import { Button, Card, Field, Row, SectionTitle, Txt, useTheme } from "./ui";

export function BodyWeightSettings({ disabled = false }: { disabled?: boolean }) {
  const { data, update, flush, retry, status } = useApp();
  const t = useTheme();
  const [id, setId] = useState<string | undefined>();
  const [date, setDate] = useState(today());
  const [weight, setWeight] = useState("");
  const [inputUnit, setInputUnit] = useState(data.settings.unit);
  const [showHistory, setShowHistory] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const canonicalWeight = useRef<number | null>(null);
  const latest = latestBodyWeight(data.bodyWeights, today());
  const entries = [...data.bodyWeights].sort((a, b) => b.date.localeCompare(a.date));
  useEffect(() => {
    if (inputUnit !== data.settings.unit) {
      const numeric = Number(weight);
      if (weight.trim() && Number.isFinite(numeric) && numeric > 0)
        setWeight(String(Math.round((canonicalWeight.current === null ? convertWeight(numeric, inputUnit, data.settings.unit) : convertWeight(canonicalWeight.current, "kg", data.settings.unit)) * 1000) / 1000));
      setInputUnit(data.settings.unit);
    }
  }, [data.settings.unit, inputUnit, weight]);
  function reset() {
    canonicalWeight.current = null;
    setId(undefined);
    setDate(today());
    setWeight("");
  }
  function edit(entry: BodyWeightEntry) {
    if (busyRef.current || disabled) return;
    canonicalWeight.current = entry.weightKg;
    setId(entry.id);
    setDate(entry.date);
    setWeight(String(Math.round(convertWeight(entry.weightKg, "kg", inputUnit) * 1000) / 1000));
    setMessage("");
    setError("");
  }
  async function action(work: () => void) {
    if (busyRef.current || disabled) return;
    busyRef.current = true;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      if (status === "error") await retry();
      work();
      await flush();
      setMessage("Body-weight history saved.");
      reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save the measurement. Retry to save your pending changes.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  return (
    <Card>
      <SectionTitle>Body weight</SectionTitle>
      <Txt muted style={{ fontSize: 13 }}>
        Optional dated measurements add context to your strength progress.
      </Txt>
      {latest && <Txt bold>{Math.round(convertWeight(latest.weightKg, "kg", data.settings.unit) * 100) / 100} {data.settings.unit} · {formatDate(latest.date)}</Txt>}
      <Field label="Measurement date (YYYY-MM-DD)" value={date} editable={!disabled && !busy} maxLength={10} autoCapitalize="none" onChangeText={setDate} placeholder={today()} />
      <Field label={"Body weight (" + inputUnit + ")"} value={weight} editable={!disabled && !busy} keyboardType="decimal-pad" maxLength={12} placeholder="Optional" onChangeText={(value) => { canonicalWeight.current = null; setWeight(value.replace(",", ".")); }} />
      <Button title={busy ? "Saving…" : id ? "Save measurement" : "Add measurement"} disabled={disabled || busy} onPress={() => {
        void action(() => {
          let savedId = id;
          update((current) => {
            const next = saveBodyWeight(current, date, canonicalWeight.current === null ? weight : String(convertWeight(canonicalWeight.current, "kg", inputUnit)), inputUnit, savedId);
            if (!savedId) savedId = next.bodyWeights[next.bodyWeights.length - 1].id;
            if (canonicalWeight.current !== null) return { ...next, bodyWeights: next.bodyWeights.map((entry) => entry.id === savedId ? { ...entry, weightKg: canonicalWeight.current! } : entry) };
            return next;
          });
          setId(savedId);
        });
      }} />
      {id && <Button title="Cancel editing" secondary disabled={disabled || busy} onPress={reset} />}
      {!!error && <>
        <Txt style={{ color: t.danger }}>{error}</Txt>
        {status === "error" && <Button title="Retry saving" secondary disabled={disabled || busy} onPress={() => void action(() => {})} />}
      </>}
      {!!message && <Txt style={{ color: t.success }}>{message}</Txt>}
      {!!entries.length && <Button title={showHistory ? "Hide measurement history" : "Edit measurement history"} secondary disabled={disabled || busy} onPress={() => setShowHistory(!showHistory)} />}
      {showHistory && entries.map((entry) => (
        <View key={entry.id} style={{ gap: 8, borderTopWidth: 1, borderColor: t.border, paddingTop: 12 }}>
          <Txt>{formatDate(entry.date, { month: "short", day: "numeric", year: "numeric" })} · {Math.round(convertWeight(entry.weightKg, "kg", inputUnit) * 100) / 100} {inputUnit}</Txt>
          <Row style={{ flexWrap: "wrap" }}>
            <Button title="Edit" secondary disabled={disabled || busy} onPress={() => edit(entry)} />
            <Button title="Delete" secondary danger disabled={disabled || busy} onPress={() => void action(() => update((current) => removeBodyWeight(current, entry.id)))} />
          </Row>
        </View>
      ))}
    </Card>
  );
}
