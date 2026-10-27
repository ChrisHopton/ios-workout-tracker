import { router } from "expo-router";
import { formatDate } from "../../domain/dates";
import { BarChart } from "../../components/charts";
import { Card, Row, Screen, SectionTitle, Txt, useTheme } from "../../components/ui";
import { useAnalytics } from "../../components/analytics/AnalyticsProvider";
import { AnalyticsLink, Disclosure, ExerciseRow, PeriodSelector } from "../../components/analytics/AnalyticsControls";
import { recentExercises } from "../../components/analytics/selection";

export default function Analytics() {
  const { data, result, weeks, setWeeks } = useAnalytics();
  const t = useTheme();
  if (!data || !result) return <Screen bottomSafeArea={false}><Txt muted>Loading progress…</Txt></Screen>;
  const recent = recentExercises(result.exerciseHistory);
  return <Screen bottomSafeArea={false}>
    <PeriodSelector weeks={weeks} onChange={setWeeks} />
    <Row style={{ alignItems: "stretch" }}>
      <Card style={{ flex: 1, padding: 16 }}>
        <Txt bold style={{ fontSize: 32, lineHeight: 38, color: t.accent }}>{result.completedWorkouts}</Txt>
        <Txt muted style={{ fontSize: 13 }}>Workouts</Txt>
      </Card>
      <Card style={{ flex: 1, padding: 16 }}>
        <Txt bold style={{ fontSize: 32, lineHeight: 38, color: t.accent }}>{result.completionRate === null ? "—" : `${Math.round(result.completionRate)}%`}</Txt>
        <Txt muted style={{ fontSize: 13 }}>Plan completion</Txt>
      </Card>
    </Row>
    <Card>
      <SectionTitle>Workouts by week</SectionTitle>
      <BarChart values={result.weeks.map((week) => week.completedWorkouts)} labels={result.weeks.map((week) => formatDate(week.startDate, { month: "numeric", day: "numeric" }))} description="Completed workouts each week" />
      <Disclosure title="About these numbers">
        <Txt muted style={{ fontSize: 13 }}>{formatDate(result.startDate)} – {formatDate(result.endDate)} · Finished workouts only.</Txt>
        <Txt muted style={{ fontSize: 13 }}>{result.scheduledWorkouts ? `${result.completedScheduledWorkouts} of ${result.scheduledWorkouts} scheduled workouts completed through today. Rest days and future dates are excluded.` : "Plan completion appears once your schedule has training days in this period."}</Txt>
        <Txt muted style={{ fontSize: 13 }}>Exercise rows show the heaviest completed working set from the latest workout, or best reps for bodyweight exercises. Warm-ups and unfinished workouts are excluded.</Txt>
      </Disclosure>
    </Card>
    <Card>
      <Row style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
        <SectionTitle>Recent exercises</SectionTitle>
        <AnalyticsLink title="See all" onPress={() => router.push("/analytics-exercises")} />
      </Row>
      {recent.length ? recent.map((history) => <ExerciseRow key={history.variantId} history={history} unit={data.settings.unit} />)
        : <Txt muted>Finish a workout with recorded working sets to see your progress here.</Txt>}
    </Card>
    <Card style={{ gap: 8 }}>
      <AnalyticsLink title="Training details" description="Muscle groups and working-set volume" onPress={() => router.push("/analytics-training")} />
      <AnalyticsLink title="Comparisons" description="Body weight and population reference" onPress={() => router.push("/analytics-comparisons")} />
    </Card>
  </Screen>;
}
