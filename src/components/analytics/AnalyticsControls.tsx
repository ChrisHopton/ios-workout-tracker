import { ReactNode, useState } from "react";
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { ExerciseHistory } from "../../domain/analytics";
import { formatDate } from "../../domain/dates";
import { Unit } from "../../domain/types";
import { Chip, Row, Txt, useTheme } from "../ui";
import { ANALYTICS_PERIODS, AnalyticsPeriod, exerciseRoute, round } from "./selection";

export function PeriodSelector({ weeks, onChange }: { weeks: AnalyticsPeriod; onChange: (value: AnalyticsPeriod) => void }) {
  return <Row style={{ flexWrap: "wrap" }}>{ANALYTICS_PERIODS.map((count) => <Chip key={count} label={`${count} weeks`} selected={count === weeks} onPress={() => onChange(count)} />)}</Row>;
}

export function Disclosure({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const t = useTheme();
  return <View style={{ gap: open ? 10 : 0 }}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)}
      style={{ minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <Txt style={{ color: t.accent, fontSize: 14, flexShrink: 1 }}>{title}</Txt>
      <Txt muted>{open ? "−" : "+"}</Txt>
    </Pressable>
    {open && children}
  </View>;
}

export function AnalyticsLink({ title, description, onPress }: { title: string; description?: string; onPress: () => void }) {
  const t = useTheme();
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({
    minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, opacity: pressed ? 0.6 : 1,
  })}>
    <View style={{ flex: 1, gap: 3 }}>
      <Txt bold style={{ color: t.accent }}>{title}</Txt>
      {description && <Txt muted style={{ fontSize: 13 }}>{description}</Txt>}
    </View>
    <Txt muted>›</Txt>
  </Pressable>;
}

export function ExerciseRow({ history, unit }: { history: ExerciseHistory; unit: Unit }) {
  const latest = history.points[history.points.length - 1];
  const t = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={`${history.name}, ${history.equipment}, view progress`}
    onPress={() => router.push(exerciseRoute(history.variantId))}
    style={({ pressed }) => ({ minHeight: 72, paddingVertical: 12, borderBottomWidth: 1, borderColor: t.border, opacity: pressed ? 0.6 : 1 })}>
    <Row style={{ justifyContent: "space-between" }}>
      <View style={{ flex: 1, gap: 3 }}>
        <Txt bold>{history.name}</Txt>
        <Txt muted style={{ fontSize: 12 }}>{history.equipment} · {formatDate(latest.date, { month: "short", day: "numeric" })}</Txt>
        <Txt style={{ fontSize: 14 }}>{latest.weight === null ? "Bodyweight" : `${round(latest.weight)} ${unit}`} × {latest.reps} reps</Txt>
      </View>
      <Txt muted>›</Txt>
    </Row>
  </Pressable>;
}
