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
import { nextOccurrence, recurrenceLabel } from "../domain/schedule";
import { WEEKDAYS } from "../domain/types";
import { SaveIndicator } from "../components/SaveIndicator";

export default function WorkoutPlans() {
  const { data } = useApp();
  const colors = useTheme();
  const active = data.templates.filter((plan) => !plan.archived);
  const date = today();
  return (
    <Screen>
      <Txt bold style={styles.heading}>
        Your routine, in one place.
      </Txt>
      <Txt muted>
        Create a plan, edit your exercises, or choose when each workout repeats.
      </Txt>
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
            Choose exercises and rep targets, then schedule it weekly or every
            two weeks. You can also keep a plan on demand.
          </Txt>
        </Card>
      )}
      {active.map((plan) => {
        const next = nextOccurrence(data, plan.id, date);
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
              {recurrenceLabel(plan)}
            </Txt>
            <Txt muted>
              {plan.weekdays.length
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
                : "Choose this plan manually on a rest day."}
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
