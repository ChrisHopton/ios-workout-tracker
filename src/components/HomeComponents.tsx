import { useRef } from "react";
import {
  AccessibilityInfo,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { addDays, formatDate, mondayOf } from "../domain/dates";
import { scheduleForDate } from "../domain/schedule";
import { AppData, WEEKDAYS, WorkoutTemplate } from "../domain/types";
import { Button, Card, Row, Txt, useTheme } from "./ui";

export function HomeWeekStrip({
  data,
  selected,
  currentDate,
  disabled,
  onSelect,
}: {
  data: AppData;
  selected: string;
  currentDate: string;
  disabled: boolean;
  onSelect: (date: string) => void;
}) {
  const t = useTheme();
  const { fontScale } = useWindowDimensions();
  const start = mondayOf(selected);

  return (
    <View style={{ gap: 6 }}>
      <Row style={{ justifyContent: "space-between", gap: 6 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous week"
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={() => onSelect(addDays(selected, -7))}
          style={styles.iconButton}
        >
          <Ionicons name="chevron-back" size={20} color={t.text} />
        </Pressable>
        <Txt muted style={{ flex: 1, textAlign: "center" }}>
          {formatDate(start, { month: "short", day: "numeric" })} –{" "}
          {formatDate(addDays(start, 6), { month: "short", day: "numeric" })}
        </Txt>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next week"
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={() => onSelect(addDays(selected, 7))}
          style={styles.iconButton}
        >
          <Ionicons name="chevron-forward" size={20} color={t.text} />
        </Pressable>
      </Row>
      <ScrollView
        horizontal
        contentContainerStyle={{ flexGrow: 1, gap: 2 }}
        showsHorizontalScrollIndicator={fontScale > 1.4}
      >
        {WEEKDAYS.map((day, index) => {
          const date = addDays(start, index);
          const session = data.sessions.find((item) => item.date === date);
          const planned = scheduleForDate(data, date, currentDate);
          const current = selected === date;
          const dateStatus = session?.status === "completed"
            ? "completed"
            : session ? "in progress" : planned ? "workout planned" : "rest day";
          const color = current ? t.onAccent : t.text;
          return (
            <Pressable
              key={day}
              accessibilityRole="button"
              accessibilityLabel={`${formatDate(date, { weekday: "long", month: "long", day: "numeric" })}${date === currentDate ? ", today" : ""}, ${dateStatus}`}
              accessibilityState={{ selected: current, disabled }}
              disabled={disabled}
              onPress={() => onSelect(date)}
              style={[
                styles.day,
                {
                  minWidth: Math.max(44, Math.ceil(30 * fontScale)),
                  backgroundColor: current ? t.accent : "transparent",
                  borderColor: date === currentDate ? t.accent : "transparent",
                },
              ]}
            >
              <Txt style={{ fontSize: 12, color: current ? t.onAccent : t.muted }}>
                {day.charAt(0)}
              </Txt>
              <Txt bold style={{ fontSize: 18, color }}>{Number(date.slice(-2))}</Txt>
              <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.dayMarker}>
                {session?.status === "completed" ? (
                  <Ionicons name="checkmark" size={12} color={current ? t.onAccent : t.success} />
                ) : (
                  <View style={{
                    width: 4,
                    height: 4,
                    borderRadius: 2,
                    backgroundColor: session || planned ? (current ? t.onAccent : t.muted) : "transparent",
                  }} />
                )}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
      {selected !== currentDate && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Return to today"
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={() => onSelect(currentDate)}
          style={{ minHeight: 44, minWidth: 44, alignSelf: "flex-end", justifyContent: "center", paddingHorizontal: 10 }}
        >
          <Txt bold style={{ color: t.accent }}>Today</Txt>
        </Pressable>
      )}
    </View>
  );
}

export function HomeWorkoutChooser({
  visible,
  workouts,
  onSelect,
  onClose,
}: {
  visible: boolean;
  workouts: WorkoutTemplate[];
  onSelect: (workout: WorkoutTemplate) => void;
  onClose: () => void;
}) {
  const t = useTheme();
  const heading = useRef<View>(null);
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      onShow={() => {
        if (Platform.OS !== "web" && heading.current) {
          AccessibilityInfo.sendAccessibilityEvent(heading.current, "focus");
        }
      }}
    >
      <SafeAreaView
        edges={["top", "left", "right", "bottom"]}
        style={styles.backdrop}
        accessibilityViewIsModal
        onAccessibilityEscape={onClose}
      >
        <Card style={styles.sheet}>
          <ScrollView
            style={{ flexShrink: 1 }}
            contentContainerStyle={{ gap: 12 }}
            keyboardShouldPersistTaps="handled"
          >
            <View ref={heading} accessible accessibilityRole="header">
              <Txt bold style={{ fontSize: 24, lineHeight: 30 }}>Choose workout</Txt>
            </View>
            {workouts.length ? workouts.map((workout) => (
              <Pressable
                key={workout.id}
                accessibilityRole="button"
                accessibilityLabel={`Start ${workout.title}`}
                onPress={() => onSelect(workout)}
                style={({ pressed }) => [styles.workoutChoice, { borderColor: t.border, backgroundColor: t.bg, opacity: pressed ? 0.75 : 1 }]}
              >
                <Txt bold>{workout.title}</Txt>
                <Txt muted style={{ fontSize: 14 }}>
                  {workout.exercises.length} exercises · {workout.exercises.reduce((count, item) => count + item.sets, 0)} sets
                </Txt>
              </Pressable>
            )) : (
              <Txt muted>No workouts yet. Add your first workout from Plans.</Txt>
            )}
          </ScrollView>
          <Button title="Cancel" secondary onPress={onClose} />
        </Card>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  iconButton: {
    width: 44,
    height: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  day: {
    flex: 1,
    minHeight: 72,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderRadius: 14,
    borderWidth: 1,
  },
  dayMarker: { height: 12, justifyContent: "center", alignItems: "center" },
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0, 0, 0, 0.45)", padding: 16 },
  sheet: { maxHeight: "90%", width: "100%", maxWidth: 640, alignSelf: "center" },
  workoutChoice: { minHeight: 50, padding: 14, gap: 4, borderRadius: 14, borderWidth: 1 },
});
