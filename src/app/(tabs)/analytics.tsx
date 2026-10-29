import { useCallback, useRef } from "react";
import { LayoutChangeEvent, Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import { formatDate } from "../../domain/dates";
import { BarChart, HorizontalBarChart, LineChart } from "../../components/charts";
import { Card, Row, Screen, Txt, useTheme } from "../../components/ui";
import { useAnalytics } from "../../components/analytics/AnalyticsProvider";
import { AnalyticsInfo, PeriodSelector } from "../../components/analytics/AnalyticsControls";
import { ChartCarousel } from "../../components/analytics/ChartCarousel";
import { chartDescription, chartNumber, workoutRoute } from "../../components/analytics/selection";

export default function Analytics() {
  const { data, result, weeks, setWeeks, chartIndex, setChartIndex, getScrollOffset, saveScrollOffset } = useAnalytics();
  const t = useTheme();
  const scroll = useRef<ScrollView>(null);
  const focused = useRef(false);
  const restoring = useRef(true);
  const targetOffset = useRef(0);
  const observedOffset = useRef(0);
  const requestedOffset = useRef<number | null>(null);
  const restoreFrame = useRef<number | undefined>(undefined);
  const layoutHeight = useRef(0);
  const contentHeight = useRef(0);
  const chartsReady = useRef(false);
  const restoreScroll = useCallback(() => {
    if (!focused.current || !restoring.current || !scroll.current) return;
    if (restoreFrame.current !== undefined) cancelAnimationFrame(restoreFrame.current);
    // Coalesce the viewport, content and chart layout callbacks from the same layout pass.
    restoreFrame.current = requestAnimationFrame(() => {
      if (!focused.current || !restoring.current || !chartsReady.current
        || layoutHeight.current <= 0 || contentHeight.current <= 0) return;
      const offset = Math.min(targetOffset.current, Math.max(0, contentHeight.current - layoutHeight.current));
      requestedOffset.current = offset;
      scroll.current?.scrollTo({ y: offset, animated: false });
      // Scrolling to an already-current offset does not emit another scroll event.
      if (Math.abs(observedOffset.current - offset) < 1) {
        restoring.current = false;
        saveScrollOffset(offset);
      }
    });
  }, [saveScrollOffset]);
  useFocusEffect(useCallback(() => {
    focused.current = true;
    restoring.current = true;
    requestedOffset.current = null;
    targetOffset.current = getScrollOffset();
    restoreScroll();
    return () => {
      focused.current = false;
      restoring.current = true;
      requestedOffset.current = null;
      if (restoreFrame.current !== undefined) cancelAnimationFrame(restoreFrame.current);
    };
  }, [getScrollOffset, restoreScroll]));
  const onChartLayout = useCallback((event: LayoutChangeEvent) => {
    chartsReady.current = event.nativeEvent.layout.width > 0 && event.nativeEvent.layout.height > 0;
    restoreScroll();
  }, [restoreScroll]);
  const cancelRestoration = useCallback(() => {
    if (focused.current) {
      restoring.current = false;
      requestedOffset.current = null;
      if (restoreFrame.current !== undefined) cancelAnimationFrame(restoreFrame.current);
    }
  }, []);
  if (!data || !result) return <Screen bottomSafeArea={false}><Txt muted>Loading progress…</Txt></Screen>;
  const labels = result.weeks.map((week) => formatDate(week.startDate, { month: "numeric", day: "numeric" }));
  const volume = result.weeks.map((week) => week.volume);
  const workouts = result.weeks.map((week) => week.completedWorkouts);
  const sets = result.groups.map((group) => group.sets);
  const groups = result.groups.map((group) => group.group);
  const last = result.lastWorkout;
  return <SafeAreaView edges={["left", "right"]} style={{ flex: 1, backgroundColor: t.bg }}>
    <ScrollView ref={scroll} scrollEventThrottle={16}
      onScroll={(event) => {
        const offset = Math.max(0, event.nativeEvent.contentOffset.y);
        observedOffset.current = offset;
        if (!focused.current) return;
        if (restoring.current && requestedOffset.current !== null && Math.abs(offset - requestedOffset.current) < 1)
          restoring.current = false;
        if (!restoring.current) saveScrollOffset(offset);
      }}
      onScrollBeginDrag={cancelRestoration}
      onTouchStart={cancelRestoration}
      onLayout={(event) => {
        layoutHeight.current = event.nativeEvent.layout.height;
        if (layoutHeight.current <= 0) chartsReady.current = false;
        restoreScroll();
      }}
      onContentSizeChange={(_width, height) => {
        contentHeight.current = height;
        if (height <= 0) chartsReady.current = false;
        restoreScroll();
      }}
      contentContainerStyle={{ padding: 20, gap: 18, paddingBottom: 36, maxWidth: 680, width: "100%", alignSelf: "center" }}>
      <PeriodSelector weeks={weeks} onChange={setWeeks} />
      <Row style={{ alignItems: "stretch" }}>
        <Card style={{ flex: 1, padding: 16, gap: 6 }}>
          <Txt bold style={{ fontSize: 28, lineHeight: 34, color: t.accent }}>{result.completedWorkouts}</Txt>
          <Txt muted style={{ fontSize: 13 }}>Workouts</Txt>
        </Card>
        <Card style={{ flex: 1, padding: 16, gap: 6 }}>
          <Txt bold style={{ fontSize: 28, lineHeight: 34, color: t.accent }}>{result.completionRate === null ? "—" : `${Math.round(result.completionRate)}%`}</Txt>
          <Txt muted style={{ fontSize: 13 }}>Plan completion</Txt>
        </Card>
      </Row>
      <Card style={{ padding: 16, gap: 6 }}>
        <Txt muted style={{ fontSize: 13 }}>Last workout completed</Txt>
        {last ? <Pressable accessibilityRole="button"
          accessibilityLabel={`${last.title}, ${formatDate(last.date)}, ${last.workingSets} working sets. Open completed workout.`}
          onPress={() => {
            focused.current = false;
            router.push(workoutRoute(last.id));
          }}
          style={({ pressed }) => ({ minHeight: 48, opacity: pressed ? 0.6 : 1, flexDirection: "row", alignItems: "center", gap: 12 })}>
          <View style={{ flex: 1, gap: 3 }}>
            <Txt bold>{last.title}</Txt>
            <Txt muted style={{ fontSize: 13 }}>{formatDate(last.date)} · {last.workingSets} working {last.workingSets === 1 ? "set" : "sets"}</Txt>
          </View>
          <Txt muted style={{ fontSize: 26 }}>›</Txt>
        </Pressable> : <Txt muted>Finish your first workout to see it here.</Txt>}
      </Card>
      <ChartCarousel index={chartIndex} onChange={setChartIndex}>
        {[
          <View key="volume" onLayout={onChartLayout} style={{ gap: 8 }}>
            <Txt bold>Weekly volume</Txt>
            <Txt muted style={{ fontSize: 13 }}>{chartNumber(result.volume)} {result.unit} × reps total</Txt>
            <LineChart values={volume} labels={labels} description={chartDescription("Weekly volume", volume, labels, `${result.unit} times reps`)} />
            {result.volume === 0 && <Txt muted style={{ fontSize: 13 }}>No recorded working-load volume in this period.</Txt>}
          </View>,
          <View key="workouts" onLayout={onChartLayout} style={{ gap: 8 }}>
            <Txt bold>Workouts by week</Txt>
            <Txt muted style={{ fontSize: 13 }}>{result.completedWorkouts} completed in this period</Txt>
            <BarChart values={workouts} labels={labels} description={chartDescription("Completed workouts by week", workouts, labels, "workouts")} />
          </View>,
          <View key="groups" onLayout={onChartLayout} style={{ gap: 10 }}>
            <Txt bold>Sets by muscle group</Txt>
            <Txt muted style={{ fontSize: 13 }}>{result.completedSets} completed working sets</Txt>
            <HorizontalBarChart values={sets} labels={groups} description={chartDescription("Sets by muscle group", sets, groups, "working sets")} />
          </View>,
        ]}
      </ChartCarousel>
      <AnalyticsInfo>
        <Txt muted style={{ fontSize: 13 }}>{formatDate(result.startDate)} – {formatDate(result.endDate)}. Weeks start on Monday; the current week ends today.</Txt>
        <Txt muted style={{ fontSize: 13 }}>{result.scheduledWorkouts ? `${result.completedScheduledWorkouts} of ${result.scheduledWorkouts} scheduled workouts completed. Rest days and future dates are excluded.` : "Plan completion appears once your schedule has training days in this period."}</Txt>
        <Txt muted style={{ fontSize: 13 }}>Finished workouts only. Charts include valid completed working sets; warm-ups and skipped sets are excluded. Volume is recorded load × reps in {result.unit}, using the load you entered without doubling dumbbell weights. Bodyweight sets count toward sets, but not volume. The latest workout can be outside the selected period.</Txt>
      </AnalyticsInfo>
    </ScrollView>
  </SafeAreaView>;
}
