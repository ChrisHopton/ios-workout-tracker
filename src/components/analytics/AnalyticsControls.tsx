import { ReactNode, useState } from "react";
import { Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Chip, Row, Txt, useTheme } from "../ui";
import { ANALYTICS_PERIODS, AnalyticsPeriod } from "./selection";

export function PeriodSelector({ weeks, onChange }: { weeks: AnalyticsPeriod; onChange: (value: AnalyticsPeriod) => void }) {
  return <Row style={{ flexWrap: "wrap" }}>{ANALYTICS_PERIODS.map((count) => <Chip key={count} label={`${count} weeks`} selected={count === weeks} onPress={() => onChange(count)} />)}</Row>;
}

export function AnalyticsInfo({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const t = useTheme();
  return <View style={{ gap: open ? 8 : 0 }}>
    <Pressable accessibilityRole="button" accessibilityLabel="About these numbers" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)}
      style={{ minHeight: 44, alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 7 }}>
      <Ionicons name="information-circle-outline" color={t.muted} size={18} />
      <Txt muted style={{ fontSize: 13 }}>About these numbers</Txt>
    </Pressable>
    {open && children}
  </View>;
}
