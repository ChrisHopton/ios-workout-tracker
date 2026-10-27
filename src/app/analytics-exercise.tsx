import { useMemo, useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { BenchmarkDetails } from "../components/BenchmarkComparison";
import { LineChart } from "../components/charts";
import { Card, Chip, Row, Screen, Txt, useTheme } from "../components/ui";
import { useAnalytics } from "../components/analytics/AnalyticsProvider";
import { Disclosure, PeriodSelector } from "../components/analytics/AnalyticsControls";
import { effectiveMetric, ProgressMetric, round, selectedExercise } from "../components/analytics/selection";
import { ExerciseHistory } from "../domain/analytics";
import { benchmarkMeasurement, ReferenceGroup, strengthBenchmark, supportsStrengthBenchmark } from "../domain/benchmarks";
import { formatDate } from "../domain/dates";
import { loadLabel } from "../domain/library";
import { convertWeight } from "../domain/recommendations";
import { AppData } from "../domain/types";

const shortDate = (date: string) => formatDate(date, { month: "short", day: "numeric" });

export default function AnalyticsExercise() {
  const { variantId } = useLocalSearchParams<{ variantId?: string | string[] }>();
  const { data, result, weeks, setWeeks, referenceGroup, referenceOverride, setReferenceOverride } = useAnalytics();
  const history = selectedExercise(result?.exerciseHistory ?? [], variantId);
  if (!data || !result) return <Screen><Txt muted>Loading progress…</Txt></Screen>;
  return <Screen>
    <PeriodSelector weeks={weeks} onChange={setWeeks} />
    {history ? <ExerciseProgress key={history.variantId} history={history} data={data} endDate={result.endDate}
      referenceGroup={referenceGroup} overridden={referenceOverride !== undefined} onGroup={setReferenceOverride} />
      : <Card><Txt bold>No history in this period</Txt><Txt muted>Try a longer period, or go back to choose another exercise.</Txt></Card>}
  </Screen>;
}

function ExerciseProgress({ history, data, endDate, referenceGroup, overridden, onGroup }: {
  history: ExerciseHistory; data: AppData; endDate: string; referenceGroup: ReferenceGroup | null;
  overridden: boolean; onGroup: (group: ReferenceGroup | null | undefined) => void;
}) {
  const [metric, setMetric] = useState<ProgressMetric>("weight");
  const [showReference, setShowReference] = useState(false);
  const t = useTheme();
  const unit = data.settings.unit;
  const selectedMetric = effectiveMetric(history.equipment, metric);
  const measurement = useMemo(() => benchmarkMeasurement(data.bodyWeights, endDate), [data.bodyWeights, endDate]);
  const strengthReference = useMemo(() => strengthBenchmark(history.exerciseId, history.equipment, data.settings.age, referenceGroup, measurement?.weightKg ?? null), [history.exerciseId, history.equipment, data.settings.age, referenceGroup, measurement]);
  const chartPoints = selectedMetric === "strength"
    ? history.strengthPoints.map((point) => ({ date: point.date, value: round(point.estimate) }))
    : history.points.map((point) => ({ date: point.date, value: round(selectedMetric === "reps" ? point.reps : point.weight ?? 0) }));
  const ratios = history.strengthPoints.filter((point) => point.relativeStrength !== null);
  const record = history.equipment === "bodyweight" ? history.personalRecords.repRecord : history.personalRecords.heaviestSet;
  return <>
    <View style={{ gap: 4 }}>
      <Txt bold style={{ fontSize: 26, lineHeight: 34 }}>{history.name}</Txt>
      <Txt muted style={{ fontSize: 13 }}>{history.equipment}</Txt>
    </View>
    <Card>
      {history.equipment !== "bodyweight" && <Row style={{ flexWrap: "wrap", gap: 7 }}>
        <Chip label="Weight" selected={metric === "weight"} onPress={() => setMetric("weight")} />
        <Chip label="Reps" selected={metric === "reps"} onPress={() => setMetric("reps")} />
        <Chip label="Estimated max" selected={metric === "strength"} onPress={() => setMetric("strength")} />
      </Row>}
      <Txt muted style={{ fontSize: 13 }}>{selectedMetric === "strength" ? `Estimated max · ${unit}` : selectedMetric === "reps" ? history.equipment === "bodyweight" ? "Best working-set reps" : "Reps at heaviest working set" : `Heaviest working set · ${unit}`}</Txt>
      {chartPoints.length ? <LineChart values={chartPoints.map((point) => point.value)} labels={chartPoints.map((point) => shortDate(point.date))}
        description={`${history.name} ${selectedMetric === "strength" ? "estimated maximum" : selectedMetric} history`}
        referenceLine={selectedMetric === "strength" && showReference && strengthReference.available ? {
          value: convertWeight(strengthReference.valueKg, "kg", unit),
          label: `Competitor median: ${Math.round(convertWeight(strengthReference.valueKg, "kg", unit))} ${unit}`,
        } : undefined} />
        : <Txt muted>Complete a working set with 1–10 reps to see an estimated max.</Txt>}
      <Disclosure title="Chart info">
        <Txt muted style={{ fontSize: 13 }}>{loadLabel(history.equipment)}. Each point comes from a finished workout; warm-ups are excluded.</Txt>
        <Txt muted style={{ fontSize: 13 }}>{selectedMetric === "strength"
          ? "Approximate Epley maximum from completed working sets of 1–10 reps. A one-rep set uses its recorded load. This estimate is not a tested one-rep max."
          : selectedMetric === "reps" ? history.equipment === "bodyweight" ? "The highest working-set rep count in each workout." : "The reps accompanying the heaviest working set in each workout. For equal loads, the higher rep count is shown."
          : "The heaviest completed working set in each workout. Dumbbell loads are for one dumbbell; equipment variants stay separate."}</Txt>
      </Disclosure>
      {selectedMetric === "strength" && supportsStrengthBenchmark(history.exerciseId, history.equipment) && <View style={{ gap: 6 }}>
        {strengthReference.available ? <Chip label="Show competitor median" selected={showReference} onPress={() => setShowReference(!showReference)} />
          : <Txt muted style={{ fontSize: 13 }}>{strengthReference.reason}</Txt>}
        <BenchmarkDetails kind="strength" benchmark={strengthReference} group={referenceGroup} overridden={overridden} onGroup={onGroup}
          measurement={measurement} unit={unit} />
      </View>}
      {record && <View style={{ padding: 14, borderRadius: 14, backgroundColor: t.accentSoft, gap: 4 }}>
        <Txt style={{ fontSize: 12, color: t.accent, fontWeight: "700" }}>PERSONAL BEST · ALL TIME</Txt>
        <Txt bold>{record.weight === null ? "" : `${round(record.weight)} ${unit} × `}{record.reps} reps</Txt>
        <Txt muted style={{ fontSize: 12 }}>{formatDate(record.date)}{history.equipment === "bodyweight" ? " · Most reps" : " · Heaviest working set"}</Txt>
      </View>}
      <Disclosure title="Workout history">
        {[...history.points].reverse().map((point, index) => <Row key={`${point.date}:${index}`} style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
          <Txt muted style={{ fontSize: 13 }}>{formatDate(point.date)}</Txt>
          <Txt style={{ fontSize: 14 }}>{point.weight === null ? "Bodyweight" : `${round(point.weight)} ${unit}`} × {point.reps} reps</Txt>
        </Row>)}
      </Disclosure>
    </Card>
    {history.equipment !== "bodyweight" && <Card>
      <Disclosure title="Relative strength">
        <Txt muted style={{ fontSize: 13 }}>Estimated max ÷ recorded body weight</Txt>
        {ratios.length ? <>
          <LineChart values={ratios.map((point) => round(point.relativeStrength!))} labels={ratios.map((point) => shortDate(point.date))}
            description={`${history.name} estimated max as multiples of body weight`} />
          {ratios.slice(-3).reverse().map((point, index) => <Txt key={`${point.date}:${index}`} style={{ fontSize: 13 }}>{formatDate(point.date)}: {round(point.relativeStrength!)}× body weight · {round(point.bodyWeight!)} {unit} measured {formatDate(point.measurementDate!)}{point.measurementStale ? " (over 28 days old)" : ""}</Txt>)}
        </> : <Txt muted>Add body weight in Settings and complete a working set of 1–10 reps to see relative strength.</Txt>}
        {history.strengthPoints[history.strengthPoints.length - 1]?.measurementDate === null && <Txt muted style={{ fontSize: 12 }}>The latest estimate has no earlier body-weight measurement.</Txt>}
        <Disclosure title="Relative-strength info">
          <Txt muted style={{ fontSize: 12 }}>Uses the latest body weight recorded on or before each workout. Ratios describe this exercise and equipment only; they are not population rankings.</Txt>
        </Disclosure>
      </Disclosure>
    </Card>}
  </>;
}
