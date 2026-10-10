import { useState } from "react";
import { View } from "react-native";
import { useApp } from "../../data/store";
import { summarize } from "../../domain/analytics";
import { formatDate, today } from "../../domain/dates";
import { MUSCLE_GROUPS, MuscleGroup } from "../../domain/types";
import { loadLabel } from "../../domain/library";
import { BarChart, LineChart } from "../../components/charts";
import {
  Card,
  Chip,
  Row,
  Screen,
  SectionTitle,
  Txt,
  useTheme,
} from "../../components/ui";
export default function Analytics() {
  const { data } = useApp();
  const t = useTheme();
  const [weeks, setWeeks] = useState(8);
  const [group, setGroup] = useState<MuscleGroup>("Legs");
  const [exerciseId, setExerciseId] = useState("");
  const result = summarize(data, weeks, today(), data.settings.unit);
  const history =
    result.exerciseHistory.find((e) => e.exerciseId === exerciseId) ??
    result.exerciseHistory[0];
  const labels = result.weeks.map((w) =>
    formatDate(w.startDate, { month: "numeric", day: "numeric" }),
  );
  return (
    <Screen>
      <View style={{ gap: 6 }}>
        <Txt bold style={{ fontSize: 30, lineHeight: 38 }}>
          See your progress
        </Txt>
        <Txt muted>Small steps. A stronger routine.</Txt>
      </View>
      <Row>
        {[4, 8, 12].map((n) => (
          <Chip
            key={n}
            label={n + " weeks"}
            selected={n === weeks}
            onPress={() => setWeeks(n)}
          />
        ))}
      </Row>
      <Txt muted style={{ fontSize: 12 }}>
        {formatDate(result.startDate)} – {formatDate(result.endDate)} · Finished
        workouts only
      </Txt>
      <Row style={{ alignItems: "stretch" }}>
        <Card style={{ flex: 1, padding: 16 }}>
          <Txt bold style={{ fontSize: 32, lineHeight: 38, color: t.accent }}>
            {result.completedWorkouts}
          </Txt>
          <Txt muted style={{ fontSize: 13 }}>
            Workouts
          </Txt>
        </Card>
        <Card style={{ flex: 1, padding: 16 }}>
          <Txt bold style={{ fontSize: 32, lineHeight: 38, color: t.accent }}>
            {result.completionRate === null
              ? "—"
              : Math.round(result.completionRate) + "%"}
          </Txt>
          <Txt muted style={{ fontSize: 13 }}>
            Plan completion
          </Txt>
        </Card>
      </Row>
      {result.completedWorkouts === 0 && (
        <Card>
          <Txt bold>Your story starts with a set</Txt>
          <Txt muted>
            Finish your first recorded workout to see your exercise history.
            Your charts will grow with your routine.
          </Txt>
        </Card>
      )}
      <Card>
        <SectionTitle>Training by muscle group</SectionTitle>
        <Txt muted style={{ fontSize: 13 }}>
          Completed sets each week · one primary group per exercise
        </Txt>
        <Row style={{ flexWrap: "wrap", gap: 7 }}>
          {MUSCLE_GROUPS.map((g) => (
            <Chip
              key={g}
              label={g === "Glutes" ? "Glutes / Butt" : g}
              selected={group === g}
              onPress={() => setGroup(g)}
            />
          ))}
        </Row>
        <BarChart
          values={result.weeks.map((w) => w.setsByGroup[group])}
          labels={labels}
          description={group + " completed sets by week"}
        />
        <Txt bold>
          {result.groups.find((g) => g.group === group)?.sets ?? 0} sets ·{" "}
          {group === "Glutes" ? "Glutes / Butt" : group}
        </Txt>
      </Card>
      <Card>
        <SectionTitle>Consistency</SectionTitle>
        <Txt muted style={{ fontSize: 13 }}>
          Completed workouts each week
        </Txt>
        <BarChart
          values={result.weeks.map((w) => w.completedWorkouts)}
          labels={labels}
          description="Completed workouts each week"
        />
        <Txt muted style={{ fontSize: 13 }}>
          {result.scheduledWorkouts
            ? result.completedScheduledWorkouts +
              " of " +
              result.scheduledWorkouts +
              " scheduled workouts completed through today. Rest days and future dates are excluded."
            : "Your completion rate appears once your schedule has training days in this period."}
        </Txt>
      </Card>
      <SectionTitle>Exercise progress</SectionTitle>
      {history ? (
        <>
          <Row style={{ flexWrap: "wrap", gap: 7 }}>
            {result.exerciseHistory.map((e) => (
              <Chip
                key={e.exerciseId}
                label={e.name}
                selected={e.exerciseId === history.exerciseId}
                onPress={() => setExerciseId(e.exerciseId)}
              />
            ))}
          </Row>
          <Card>
            <Txt bold style={{ fontSize: 20 }}>
              {history.name}
            </Txt>
            <Txt muted style={{ fontSize: 13 }}>
              {history.equipment === "bodyweight"
                ? "Best recorded reps per workout"
                : "Heaviest completed set per workout · " + data.settings.unit}
            </Txt>
            <Txt muted style={{ fontSize: 12 }}>
              {loadLabel(history.equipment)}
            </Txt>
            <LineChart
              values={history.points.map((p) => p.weight ?? p.reps)}
              labels={history.points.map((p) =>
                formatDate(p.date, { month: "short", day: "numeric" }),
              )}
              description={history.name + " history"}
            />
            {history.heaviestSet && (
              <View
                style={{
                  padding: 14,
                  borderRadius: 14,
                  backgroundColor: t.accentSoft,
                  gap: 4,
                }}
              >
                <Txt
                  style={{ fontSize: 12, color: t.accent, fontWeight: "700" }}
                >
                  BEST IN THIS PERIOD
                </Txt>
                <Txt bold>
                  {Math.round(history.heaviestSet.weight * 100) / 100}{" "}
                  {data.settings.unit} × {history.heaviestSet.reps} reps
                </Txt>
              </View>
            )}
            {history.points
              .slice(-5)
              .reverse()
              .map((p) => (
                <Row key={p.date} style={{ justifyContent: "space-between" }}>
                  <Txt muted style={{ fontSize: 13 }}>
                    {formatDate(p.date)}
                  </Txt>
                  <Txt style={{ fontSize: 14 }}>
                    {p.weight === null
                      ? "Bodyweight"
                      : Math.round(p.weight * 100) / 100 +
                        " " +
                        data.settings.unit}{" "}
                    × {p.reps} reps
                  </Txt>
                </Row>
              ))}
          </Card>
        </>
      ) : (
        <Txt muted>Record and finish a workout to explore an exercise.</Txt>
      )}
      <Txt muted style={{ fontSize: 12 }}>
        These charts describe your logged training, not muscle growth or calorie
        expenditure. Current-week totals are partial.
      </Txt>
    </Screen>
  );
}
