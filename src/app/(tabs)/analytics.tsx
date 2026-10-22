import { useCallback, useMemo, useState } from "react";
import { AppState, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { useApp } from "../../data/store";
import { summarize } from "../../domain/analytics";
import { formatDate, today } from "../../domain/dates";
import { AppData, MUSCLE_GROUPS, MuscleGroup } from "../../domain/types";
import { loadLabel } from "../../domain/library";
import { BarChart, LineChart } from "../../components/charts";
import { BodyWeightComparison, BenchmarkDetails } from "../../components/BenchmarkComparison";
import { benchmarkMeasurement, bodyWeightBenchmark, referenceGroupForGender, ReferenceGroup, strengthBenchmark, supportsStrengthBenchmark } from "../../domain/benchmarks";
import { convertWeight } from "../../domain/recommendations";
import { Card, Chip, Row, Screen, SectionTitle, Txt, useTheme } from "../../components/ui";

const round = (value: number) => Math.round(value * 100) / 100;
const shortDate = (date: string) => formatDate(date, { month: "short", day: "numeric" });

export default function Analytics() {
  const { data: currentData } = useApp();
  const [data, setData] = useState<AppData | null>(null);
  const t = useTheme();
  const [weeks, setWeeks] = useState(8);
  const [group, setGroup] = useState<MuscleGroup>("Legs");
  const [variantId, setVariantId] = useState("");
  const [nextExerciseId, setNextExerciseId] = useState("");
  const [metric, setMetric] = useState<"weight" | "reps" | "strength">("weight");
  const [endDate, setEndDate] = useState(today);
  const [referenceOverride, setReferenceOverride] = useState<ReferenceGroup | null | undefined>(undefined);
  const [showReference, setShowReference] = useState(false);
  // Retain the visible snapshot on blur so hidden recording edits do not rebuild analytics
  useFocusEffect(useCallback(() => {
    setData(currentData);
  }, [currentData]));
  useFocusEffect(useCallback(() => {
    let midnight: ReturnType<typeof setTimeout>;
    function refreshDate() {
      clearTimeout(midnight);
      setEndDate(today());
      const now = new Date();
      const nextDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      midnight = setTimeout(refreshDate, nextDay.getTime() - now.getTime());
    }
    refreshDate();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refreshDate();
    });
    return () => {
      clearTimeout(midnight);
      subscription.remove();
    };
  }, []));
  const result = useMemo(() => data ? summarize(data, weeks, endDate, data.settings.unit) : null, [data, weeks, endDate]);
  const referenceGroup = referenceOverride === undefined ? referenceGroupForGender(data?.settings.gender ?? "") : referenceOverride;
  const comparison = useMemo(() => data ? {
    body: bodyWeightBenchmark(data.settings, referenceGroup),
    measurement: benchmarkMeasurement(data.bodyWeights, endDate),
  } : null, [data, referenceGroup, endDate]);
  const history = result?.exerciseHistory.find((entry) => entry.variantId === variantId) ?? result?.exerciseHistory[0];
  const strengthReference = useMemo(() => data && history ? strengthBenchmark(history.exerciseId, history.equipment, data.settings.age, referenceGroup, comparison?.measurement?.weightKg ?? null) : null, [data, history, referenceGroup, comparison]);
  if (!data || !result || !comparison) return <Screen bottomSafeArea={false}><Txt muted>Loading progress…</Txt></Screen>;
  const next = result.nextWorkout;
  const nextExercise = next?.exercises.find((entry) => entry.id === nextExerciseId) ?? next?.exercises[0];
  const labels = result.weeks.map((week) => formatDate(week.startDate, { month: "numeric", day: "numeric" }));
  const strength = history?.strengthPoints[history.strengthPoints.length - 1];
  const ratios = history?.strengthPoints.filter((point) => point.relativeStrength !== null) ?? [];
  const effectiveMetric = history?.equipment === "bodyweight" ? "reps" : metric;
  const chartPoints = effectiveMetric === "strength"
    ? history?.strengthPoints.map((point) => ({ date: point.date, value: round(point.estimate) })) ?? []
    : history?.points.map((point) => ({ date: point.date, value: round(effectiveMetric === "reps" ? point.reps : point.weight ?? 0) })) ?? [];
  return (
    <Screen bottomSafeArea={false}>
      <View style={{ gap: 6 }}>
        <Txt bold style={{ fontSize: 30, lineHeight: 38 }}>See your progress</Txt>
        <Txt muted>Small steps. A stronger routine.</Txt>
      </View>
      <Row>{[4, 8, 12].map((count) => <Chip key={count} label={count + " weeks"} selected={count === weeks} onPress={() => setWeeks(count)} />)}</Row>
      <Txt muted style={{ fontSize: 12 }}>{formatDate(result.startDate)} – {formatDate(result.endDate)} · Finished workouts · Working sets</Txt>
      <Row style={{ alignItems: "stretch" }}>
        <Card style={{ flex: 1, padding: 16 }}>
          <Txt bold style={{ fontSize: 32, lineHeight: 38, color: t.accent }}>{result.completedWorkouts}</Txt>
          <Txt muted style={{ fontSize: 13 }}>Workouts</Txt>
        </Card>
        <Card style={{ flex: 1, padding: 16 }}>
          <Txt bold style={{ fontSize: 32, lineHeight: 38, color: t.accent }}>{result.completionRate === null ? "—" : Math.round(result.completionRate) + "%"}</Txt>
          <Txt muted style={{ fontSize: 13 }}>Plan completion</Txt>
        </Card>
      </Row>
      {next && <Card>
        <SectionTitle>Next planned workout</SectionTitle>
        <Txt bold>{next.title} · {formatDate(next.date, { weekday: "short", month: "short", day: "numeric" })}</Txt>
        <Row style={{ flexWrap: "wrap", gap: 7 }}>{next.exercises.map((entry) => <Chip key={entry.id} label={entry.name} selected={entry.id === nextExercise?.id} onPress={() => setNextExerciseId(entry.id)} />)}</Row>
        {nextExercise && <>
          <Txt bold>{nextExercise.name} · {nextExercise.repMin}–{nextExercise.repMax} reps</Txt>
          <Txt muted style={{ fontSize: 12 }}>{loadLabel(nextExercise.equipment)}</Txt>
          <Txt bold style={{ color: t.accent, fontSize: 22 }}>{nextExercise.suggestion.weights[0] == null ? nextExercise.equipment === "bodyweight" ? "Reps only" : "Choose a starting weight" : round(nextExercise.suggestion.weights[0]) + " " + data.settings.unit + " per working set"}</Txt>
          <Txt style={{ fontSize: 13 }}>{nextExercise.suggestion.reason}</Txt>
        </>}
        <Txt muted style={{ fontSize: 12 }}>An estimate from prior finished workouts. Your actual results stay separate until you enter or accept a suggestion.</Txt>
      </Card>}
      <BodyWeightComparison benchmark={comparison.body} measurement={comparison.measurement} unit={data.settings.unit} group={referenceGroup} overridden={referenceOverride !== undefined} onGroup={setReferenceOverride} />
      {result.completedWorkouts === 0 && <Card><Txt bold>Your story starts with a set</Txt><Txt muted>Finish your first recorded workout to see your exercise history. Your charts will grow with your routine.</Txt></Card>}
      <Card>
        <SectionTitle>Training by muscle group</SectionTitle>
        <Txt muted style={{ fontSize: 13 }}>Completed working sets each week · one primary group per exercise</Txt>
        <Row style={{ flexWrap: "wrap", gap: 7 }}>{MUSCLE_GROUPS.map((entry) => <Chip key={entry} label={entry === "Glutes" ? "Glutes / Butt" : entry} selected={group === entry} onPress={() => setGroup(entry)} />)}</Row>
        <BarChart values={result.weeks.map((week) => week.setsByGroup[group])} labels={labels} description={group + " completed working sets by week"} />
        <Txt bold>{result.groups.find((entry) => entry.group === group)?.sets ?? 0} working sets · {group === "Glutes" ? "Glutes / Butt" : group}</Txt>
      </Card>
      <Card>
        <SectionTitle>Working-set volume</SectionTitle>
        <BarChart values={result.weeks.map((week) => Math.round(week.volume))} labels={labels} description={"Recorded working-load volume in " + data.settings.unit + " times reps by week"} />
        <Txt bold>{Math.round(result.volume).toLocaleString()} {data.settings.unit} × reps</Txt>
        <Txt muted style={{ fontSize: 12 }}>Sum of recorded weight × reps. Dumbbells use the weight of one dumbbell; bodyweight sets are excluded. Machine and equipment loads are different, so use exercise-level history for strength comparisons.</Txt>
      </Card>
      <Card>
        <SectionTitle>Consistency</SectionTitle>
        <BarChart values={result.weeks.map((week) => week.completedWorkouts)} labels={labels} description="Completed workouts each week" />
        <Txt muted style={{ fontSize: 13 }}>{result.scheduledWorkouts ? result.completedScheduledWorkouts + " of " + result.scheduledWorkouts + " scheduled workouts completed through today. Rest days and future dates are excluded." : "Your completion rate appears once your schedule has training days in this period."}</Txt>
      </Card>
      <SectionTitle>Exercise progress</SectionTitle>
      {history ? <>
        <Row style={{ flexWrap: "wrap", gap: 7 }}>{result.exerciseHistory.map((entry) => <Chip key={entry.variantId} label={entry.name + " · " + entry.equipment} selected={entry.variantId === history.variantId} onPress={() => setVariantId(entry.variantId)} />)}</Row>
        <Card>
          <Txt bold style={{ fontSize: 20 }}>{history.name}</Txt>
          <Txt muted style={{ fontSize: 12 }}>{loadLabel(history.equipment)}</Txt>
          {history.equipment !== "bodyweight" && <Row style={{ flexWrap: "wrap" }}>
            <Chip label="Weight" selected={metric === "weight"} onPress={() => setMetric("weight")} />
            <Chip label="Reps" selected={metric === "reps"} onPress={() => setMetric("reps")} />
            <Chip label="Estimated strength" selected={metric === "strength"} onPress={() => setMetric("strength")} />
          </Row>}
          <Txt muted style={{ fontSize: 13 }}>{effectiveMetric === "strength" ? "Approximate estimated maximum · " + data.settings.unit + " · completed working sets of 1–10 reps" : effectiveMetric === "reps" ? history.equipment === "bodyweight" ? "Best recorded working-set reps per workout" : "Reps accompanying the heaviest working set each workout" : "Heaviest completed working set per workout · " + data.settings.unit}</Txt>
          {chartPoints.length ? <LineChart values={chartPoints.map((point) => point.value)} labels={chartPoints.map((point) => shortDate(point.date))} description={history.name + " " + effectiveMetric + " history"} referenceLine={effectiveMetric === "strength" && showReference && strengthReference?.available ? { value: convertWeight(strengthReference.valueKg, "kg", data.settings.unit), label: "Competitor median: " + Math.round(convertWeight(strengthReference.valueKg, "kg", data.settings.unit)) + " " + data.settings.unit } : undefined} /> : <Txt muted>Complete a working set with 1–10 reps to see estimated strength.</Txt>}
          {effectiveMetric === "strength" && supportsStrengthBenchmark(history.exerciseId, history.equipment) && strengthReference && <View style={{ gap: 6 }}>
            {strengthReference.available ? <>
              <Chip label="Show competitor median" selected={showReference} onPress={() => setShowReference(!showReference)} />
              <Txt muted style={{ fontSize: 12 }}>Approximate comparison with competitive lifters, using your current profile and body weight.</Txt>
            </> : <Txt muted style={{ fontSize: 13 }}>{strengthReference.reason}</Txt>}
            {comparison.measurement && <Txt muted style={{ fontSize: 12 }}>Reference body weight: {round(convertWeight(comparison.measurement.weightKg, "kg", data.settings.unit))} {data.settings.unit} measured {formatDate(comparison.measurement.date)}{comparison.measurement.stale ? " (over 28 days old)" : ""}</Txt>}
            <BenchmarkDetails kind="strength" benchmark={strengthReference} group={referenceGroup} overridden={referenceOverride !== undefined} onGroup={setReferenceOverride} />
          </View>}
          {history.heaviestSet && <View style={{ padding: 14, borderRadius: 14, backgroundColor: t.accentSoft, gap: 4 }}>
            <Txt style={{ fontSize: 12, color: t.accent, fontWeight: "700" }}>HEAVIEST IN THIS PERIOD</Txt>
            <Txt bold>{round(history.heaviestSet.weight)} {data.settings.unit} × {history.heaviestSet.reps} reps · {formatDate(history.heaviestSet.date)}</Txt>
          </View>}
          {history.personalRecords.heaviestSet && <Txt bold style={{ fontSize: 14 }}>Personal best: {round(history.personalRecords.heaviestSet.weight)} {data.settings.unit} × {history.personalRecords.heaviestSet.reps} reps · {formatDate(history.personalRecords.heaviestSet.date)}</Txt>}
          {history.personalRecords.repRecord && <Txt muted style={{ fontSize: 13 }}>All-time rep record: {history.personalRecords.repRecord.reps} reps{history.personalRecords.repRecord.weight === null ? "" : " at " + round(history.personalRecords.repRecord.weight) + " " + data.settings.unit} · {formatDate(history.personalRecords.repRecord.date)}</Txt>}
          {history.repRecord && <Txt muted style={{ fontSize: 13 }}>Rep record: {history.repRecord.reps} reps{history.repRecord.weight === null ? "" : " at " + round(history.repRecord.weight) + " " + data.settings.unit} · {formatDate(history.repRecord.date)}</Txt>}
          {history.points.slice(-5).reverse().map((point, index) => <Row key={point.date + ":" + index} style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
            <Txt muted style={{ fontSize: 13 }}>{formatDate(point.date)}</Txt>
            <Txt style={{ fontSize: 14 }}>{point.weight === null ? "Bodyweight" : round(point.weight) + " " + data.settings.unit} × {point.reps} reps</Txt>
          </Row>)}
        </Card>
        {history.equipment !== "bodyweight" && <Card>
          <SectionTitle>Strength relative to body weight</SectionTitle>
          <Txt muted style={{ fontSize: 13 }}>Approximate estimated strength divided by the latest body weight recorded on or before each workout.</Txt>
          {ratios.length ? <>
            <LineChart values={ratios.map((point) => round(point.relativeStrength!))} labels={ratios.map((point) => shortDate(point.date))} description={history.name + " estimated strength as multiples of body weight"} />
            {ratios.slice(-3).reverse().map((point, index) => <Txt key={point.date + ":" + index} style={{ fontSize: 13 }}>{formatDate(point.date)}: {round(point.relativeStrength!)}× body weight · {round(point.bodyWeight!)} {data.settings.unit} measured {formatDate(point.measurementDate!)}{point.measurementStale ? " (over 28 days old)" : ""}</Txt>)}
          </> : <Txt muted>Add body weight in Settings and complete a working set of 1–10 reps to see relative strength.</Txt>}
          {strength?.measurementDate === null && <Txt muted style={{ fontSize: 12 }}>The latest strength estimate has no earlier body-weight measurement.</Txt>}
          <Txt muted style={{ fontSize: 12 }}>{loadLabel(history.equipment)}. Ratios describe this exercise and equipment only; they are not population rankings.</Txt>
        </Card>}
      </> : <Txt muted>Record and finish a workout to explore an exercise.</Txt>}
    </Screen>
  );
}
