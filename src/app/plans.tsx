import { router } from "expo-router";
import { StyleSheet, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import {
  Button,
  Card,
  Row,
  Screen,
  SectionTitle,
  Txt,
  useTheme,
} from "../components/ui";
import { useApp } from "../data/store";
import { formatDate, today } from "../domain/dates";
import { nextOccurrence, planEditEffectiveDate, recurrenceLabel } from "../domain/schedule";
import { routineAt } from "../domain/routine";
import { WEEKDAYS } from "../domain/types";
import { SaveIndicator } from "../components/SaveIndicator";

export default function WorkoutPlans() {
  const { data } = useApp();
  const colors = useTheme();
  const active = data.templates.filter((plan) => !plan.archived);
  const date = today();
  const routine = routineAt(data, date);
  const editDate = planEditEffectiveDate(data, date);
  const plannedRoutine = routineAt(data, editDate);
  const flexible = plannedRoutine.mode === "flexible";
  return (
    <Screen>
      <Txt bold style={styles.heading}>
        Your routine, in one place.
      </Txt>
      <Txt muted>
        Create a plan, edit your exercises, or choose how your workouts repeat.
      </Txt>
      <Card>
        <SectionTitle>Routine</SectionTitle>
        <Txt bold>{routine.mode === "flexible" ? "Flexible sequence" : "Fixed schedule"}</Txt>
        <Txt muted>
          {routine.mode === "flexible"
            ? routine.weekdays.map((day) => WEEKDAYS[day]).join(", ") + " · Workouts stay in order, even after a missed day."
            : "Plans repeat weekly or every two weeks on fixed dates."}
        </Txt>
        {editDate > date && (
          <Txt muted>Scheduled from {formatDate(editDate)}: {flexible ? "Flexible sequence" : "Fixed schedule"}.</Txt>
        )}
        <Button title="Edit routine" secondary onPress={() => router.push("/routine")} />
      </Card>
      <Button title="+ New plan" onPress={() => router.push("/editor")} />
      <Row style={styles.section}>
        <SectionTitle>Current plans</SectionTitle>
        <Txt muted>
          {active.length} {active.length === 1 ? "plan" : "plans"}
        </Txt>
      </Row>
      {active.length === 0 && (
        <Card>
          <Ionicons name="barbell-outline" color={colors.accent} size={32} />
          <Txt bold>Build your first workout</Txt>
          <Txt muted>
            Choose exercises and rep targets, then add the plan to your routine.
            You can also keep a plan on demand.
          </Txt>
        </Card>
      )}
      {active.map((plan) => {
        const next = nextOccurrence(data, plan.id, date);
        const sequenceCount = plannedRoutine.mode === "flexible"
          ? plannedRoutine.sequence.filter((id) => id === plan.id).length : 0;
        const sets = plan.exercises.reduce(
          (sum, exercise) => sum + exercise.sets,
          0,
        );
        return (
          <Card key={plan.id}>
            <Row style={styles.planHeader}>
              <View style={styles.grow}>
                <Txt bold style={styles.title}>
                  {plan.title}
                </Txt>
                <Txt muted>{plan.exercises.length} exercises · {sets} sets</Txt>
              </View>
            </Row>
            <Txt bold style={{ color: colors.accent }}>
              {flexible ? sequenceCount ? "In flexible sequence" : "On demand" : recurrenceLabel(plan)}
            </Txt>
            <Txt muted>
              {flexible
                ? sequenceCount ? sequenceCount + (sequenceCount === 1 ? " entry per cycle" : " entries per cycle") : "Add this plan in Edit routine."
                : plan.weekdays.length
                  ? plan.weekdays.map((day) => WEEKDAYS[day]).join(", ")
                  : "On demand"}
            </Txt>
            <Txt muted style={styles.small}>
              {next
                ? `Next: ${formatDate(next, {
                    weekday: "long",
                    month: "short",
                    day: "numeric",
                  })}`
                : flexible && sequenceCount ? "Dates move with your routine." : "Choose this plan manually on a rest day."}
            </Txt>
            <Button
              title={`Edit ${plan.title}`}
              secondary
              onPress={() =>
                router.push({ pathname: "/editor", params: { id: plan.id } })
              }
            />
          </Card>
        );
      })}
      <SaveIndicator />
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 28, lineHeight: 35, letterSpacing: -0.5 },
  section: { justifyContent: "space-between", flexWrap: "wrap" },
  planHeader: { alignItems: "flex-start" },
  grow: { flex: 1, minWidth: 0, gap: 6 },
  title: { fontSize: 22, lineHeight: 28 },
  small: { fontSize: 14, lineHeight: 21 },
});
