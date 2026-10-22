import { useState } from "react";
import { Pressable, View } from "react-native";
import { Link } from "expo-router";
import { Benchmark, ReferenceGroup, cohortLabel } from "../domain/benchmarks";
import { formatDate } from "../domain/dates";
import { convertWeight } from "../domain/recommendations";
import { BodyWeightEntry, Unit } from "../domain/types";
import { Card, Chip, Row, SectionTitle, Txt, useTheme } from "./ui";

interface ReferenceControls {
  group: ReferenceGroup | null;
  overridden: boolean;
  onGroup: (group: ReferenceGroup | null | undefined) => void;
}
export function BenchmarkDetails({ kind, benchmark, group, overridden, onGroup }: ReferenceControls & {
  kind: "body" | "strength"; benchmark: Benchmark;
}) {
  const [open, setOpen] = useState(false);
  const t = useTheme();
  return <>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }}
      accessibilityLabel={kind === "body" ? "Body-weight comparison details" : "Strength comparison details"}
      onPress={() => setOpen(!open)} style={{ minHeight: 44, justifyContent: "center", alignSelf: "flex-start" }}>
      <Txt style={{ color: t.accent, fontSize: 13 }}>{open ? "Hide comparison details" : "Comparison details"} {open ? "⌃" : "⌄"}</Txt>
    </Pressable>
    {open && <View style={{ gap: 10 }}>
      <Txt bold style={{ fontSize: 13 }}>Reference group</Txt>
      <Row style={{ flexWrap: "wrap" }}>
        <Chip label="Female" selected={group === "female"} onPress={() => onGroup("female")} />
        <Chip label="Male" selected={group === "male"} onPress={() => onGroup("male")} />
        {overridden && <Chip label="Use profile" selected={false} onPress={() => onGroup(undefined)} />}
      </Row>
      <Txt muted style={{ fontSize: 12 }}>Source datasets use Male/Female categories. This choice changes Analytics only.</Txt>
      {benchmark.available && <>
        <Txt style={{ fontSize: 13 }}>{cohortLabel(benchmark.cohort, kind === "body" ? "height" : "weight")}</Txt>
        <Txt muted style={{ fontSize: 12 }}>{benchmark.cohort.count.toLocaleString()} {kind === "body" ? "respondents" : "distinct lifters"}{benchmark.widerBand ? " · wider matching band because the narrower sample was too small" : ""}</Txt>
      </>}
      {kind === "body" ? <>
        <Txt muted style={{ fontSize: 12 }}>NHANES August 2021–August 2023 · U.S. civilian, noninstitutionalized adults. Survey-weighted mean, matched by age, reference group and height; reported pregnancy excluded. At least 100 respondents and a weight-based effective count of 50 are required. These are descriptive safeguards, not statistical certainty or a healthy-weight target.</Txt>
        <Link href="https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2021/DataFiles/BMX_L.htm" style={{ color: t.accent, fontSize: 13 }}>CDC NHANES source and methodology</Link>
        <Txt muted style={{ fontSize: 12 }}>Adapted from public CDC data, available free from CDC. CDC does not endorse this app or its calculations.</Txt>
      </> : <>
        <Txt muted style={{ fontSize: 12 }}>OpenPowerlifting · 2021–2025 meets. Median successful raw squat, bench or deadlift from full-power competitors in tested categories, using each lifter’s latest eligible meet. A tested category does not mean every lifter was tested. Matched by age, category and body weight; at least 100 lifters required.</Txt>
        <Txt muted style={{ fontSize: 12 }}>Competition lifts are actual one-rep results; your chart uses approximate Epley estimates from 1–10 reps. These competitors do not represent the average person. The fixed reference uses your current profile and latest dated measurement, not a historical population trend.</Txt>
        <Link href="https://openpowerlifting.gitlab.io/opl-csv/bulk-csv.html" style={{ color: t.accent, fontSize: 13 }}>OpenPowerlifting public-domain source</Link>
      </>}
    </View>}
  </>;
}

export function BodyWeightComparison({ benchmark, measurement, unit, ...controls }: ReferenceControls & {
  benchmark: Benchmark; measurement: (BodyWeightEntry & { stale: boolean }) | null; unit: Unit;
}) {
  return <Card style={{ padding: 16, gap: 6 }}>
    <SectionTitle>Body-weight comparison</SectionTitle>
    {measurement ? <>
      <Row style={{ flexWrap: "wrap", justifyContent: "space-between" }}>
        <Txt bold>You: {Math.round(convertWeight(measurement.weightKg, "kg", unit) * 10) / 10} {unit}</Txt>
        {benchmark.available && <Txt bold>U.S. average: {Math.round(convertWeight(benchmark.valueKg, "kg", unit))} {unit}</Txt>}
      </Row>
      <Txt muted style={{ fontSize: 12 }}>Measured {formatDate(measurement.date, { month: "short", day: "numeric", year: "numeric" })}{measurement.stale ? " · over 28 days old" : ""}</Txt>
      {!benchmark.available && <Txt muted style={{ fontSize: 13 }}>{benchmark.reason}</Txt>}
    </> : <Txt muted style={{ fontSize: 13 }}>Add body weight in Settings to compare.</Txt>}
    <Txt muted style={{ fontSize: 12 }}>Body weight and population averages alone cannot assess health.</Txt>
    <BenchmarkDetails kind="body" benchmark={benchmark} {...controls} />
  </Card>;
}
