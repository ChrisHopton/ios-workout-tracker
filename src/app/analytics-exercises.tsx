import { useMemo } from "react";
import { Card, Chip, Field, Row, Screen, Txt } from "../components/ui";
import { useAnalytics } from "../components/analytics/AnalyticsProvider";
import { ExerciseRow, PeriodSelector } from "../components/analytics/AnalyticsControls";
import { filterExercises } from "../components/analytics/selection";
import { MUSCLE_GROUPS } from "../domain/types";

export default function AnalyticsExercises() {
  const { data, result, weeks, setWeeks, query, setQuery, exerciseGroup, setExerciseGroup } = useAnalytics();
  const filtered = useMemo(() => filterExercises(result?.exerciseHistory ?? [], query, exerciseGroup), [result, query, exerciseGroup]);
  if (!data || !result) return <Screen><Txt muted>Loading exercises…</Txt></Screen>;
  return <Screen>
    <PeriodSelector weeks={weeks} onChange={setWeeks} />
    <Field label="Find an exercise" placeholder="Search name or equipment" value={query} onChangeText={setQuery} autoCorrect={false} />
    <Row style={{ flexWrap: "wrap", gap: 7 }}>
      <Chip label="All muscles" selected={exerciseGroup === "All"} onPress={() => setExerciseGroup("All")} />
      {MUSCLE_GROUPS.map((group) => <Chip key={group} label={group === "Glutes" ? "Glutes / Butt" : group} selected={exerciseGroup === group} onPress={() => setExerciseGroup(group)} />)}
    </Row>
    <Txt muted style={{ fontSize: 13 }}>Recently performed · {filtered.length} {filtered.length === 1 ? "exercise" : "exercises"}</Txt>
    <Card>
      {filtered.length ? filtered.map((history) => <ExerciseRow key={history.variantId} history={history} unit={data.settings.unit} />)
        : <Txt muted>{result.exerciseHistory.length ? "No exercises match. Try another search or muscle group." : "No recorded working sets in this period. Try a longer period or finish a workout."}</Txt>}
    </Card>
  </Screen>;
}
