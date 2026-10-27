import { BarChart } from "../components/charts";
import { Card, Chip, Row, Screen, SectionTitle, Txt } from "../components/ui";
import { useAnalytics } from "../components/analytics/AnalyticsProvider";
import { Disclosure, PeriodSelector } from "../components/analytics/AnalyticsControls";
import { formatDate } from "../domain/dates";
import { MUSCLE_GROUPS } from "../domain/types";

export default function AnalyticsTraining() {
  const { data, result, weeks, setWeeks, trainingGroup: group, setTrainingGroup: setGroup } = useAnalytics();
  if (!data || !result) return <Screen><Txt muted>Loading training…</Txt></Screen>;
  const labels = result.weeks.map((week) => formatDate(week.startDate, { month: "numeric", day: "numeric" }));
  return <Screen>
    <PeriodSelector weeks={weeks} onChange={setWeeks} />
    <Card>
      <SectionTitle>Training by muscle group</SectionTitle>
      <Row style={{ flexWrap: "wrap", gap: 7 }}>{MUSCLE_GROUPS.map((entry) => <Chip key={entry} label={entry === "Glutes" ? "Glutes / Butt" : entry} selected={group === entry} onPress={() => setGroup(entry)} />)}</Row>
      <BarChart values={result.weeks.map((week) => week.setsByGroup[group])} labels={labels} description={`${group} completed working sets by week`} />
      <Txt bold>{result.groups.find((entry) => entry.group === group)?.sets ?? 0} working sets · {group === "Glutes" ? "Glutes / Butt" : group}</Txt>
      <Disclosure title="Muscle-group info"><Txt muted style={{ fontSize: 13 }}>Completed working sets from finished workouts, counted under one primary muscle group per exercise. Warm-ups are excluded.</Txt></Disclosure>
    </Card>
    <Card>
      <SectionTitle>Working-set volume</SectionTitle>
      <BarChart values={result.weeks.map((week) => Math.round(week.volume))} labels={labels} description={`Recorded working-load volume in ${data.settings.unit} times reps by week`} />
      <Txt bold>{Math.round(result.volume).toLocaleString()} {data.settings.unit} × reps</Txt>
      <Disclosure title="Volume info"><Txt muted style={{ fontSize: 13 }}>Sum of recorded weight × reps. Dumbbells use the weight of one dumbbell; bodyweight sets are excluded. Machine and equipment loads differ, so use exercise history for strength comparisons.</Txt></Disclosure>
    </Card>
  </Screen>;
}
