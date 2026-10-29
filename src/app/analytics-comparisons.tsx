import { ageFromDateOfBirth } from "../domain/profile";
import { useMemo } from "react";
import { BodyWeightComparison } from "../components/BenchmarkComparison";
import { Screen, Txt } from "../components/ui";
import { useAnalytics } from "../components/analytics/AnalyticsProvider";
import { benchmarkMeasurement, bodyWeightBenchmark } from "../domain/benchmarks";

export default function AnalyticsComparisons() {
  const { data, result, referenceGroup, referenceOverride, setReferenceOverride } = useAnalytics();
  const comparison = useMemo(() => data && result ? {
    body: bodyWeightBenchmark({ age: ageFromDateOfBirth(data.settings.dateOfBirth, result.endDate)?.toString() ?? "", heightCm: data.settings.heightCm }, referenceGroup),
    measurement: benchmarkMeasurement(data.bodyWeights, result.endDate),
  } : null, [data, result, referenceGroup]);
  if (!data || !comparison) return <Screen><Txt muted>Loading comparisons…</Txt></Screen>;
  return <Screen>
    <BodyWeightComparison benchmark={comparison.body} measurement={comparison.measurement} unit={data.settings.unit}
      group={referenceGroup} overridden={referenceOverride !== undefined} onGroup={setReferenceOverride} />
  </Screen>;
}
