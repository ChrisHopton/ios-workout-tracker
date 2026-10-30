import { ReactNode } from "react";
import { Modal, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { formatDate } from "../domain/dates";
import { Button, Card, Txt, useTheme } from "./ui";

export function WorkoutActionSheet({ visible, title, busy, onClose, children }: {
  visible: boolean; title: string; busy: boolean; onClose: () => void; children: ReactNode;
}) {
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={() => { if (!busy) onClose(); }}>
    <SafeAreaView edges={["top", "left", "right", "bottom"]} accessibilityViewIsModal
      onAccessibilityEscape={() => { if (!busy) onClose(); }}
      style={{ flex: 1, justifyContent: "flex-end", padding: 16, backgroundColor: "#00000080" }}>
      <Card style={{ maxHeight: "90%", width: "100%", maxWidth: 640, alignSelf: "center" }}>
        <ScrollView contentContainerStyle={{ gap: 14 }} keyboardShouldPersistTaps="handled">
          <View accessible accessibilityRole="header"><Txt bold style={{ fontSize: 22, lineHeight: 28 }}>{title}</Txt></View>
          {children}
        </ScrollView>
      </Card>
    </SafeAreaView>
  </Modal>;
}

export function CancelWorkoutSheet({ visible, title, busy, error, onClose, onConfirm }: {
  visible: boolean; title: string; busy: boolean; error: string; onClose: () => void; onConfirm: () => void;
}) {
  const t = useTheme();
  return <WorkoutActionSheet visible={visible} title={`Cancel ${title}?`} busy={busy} onClose={onClose}>
    <Txt muted>This removes the unfinished workout and its recorded sets. Your next routine workout stays the same.</Txt>
    {!!error && <View accessibilityRole="alert"><Txt style={{ color: t.danger }}>{error}</Txt></View>}
    <Button title="Keep workout" secondary disabled={busy} onPress={onClose} />
    <Button title={busy ? "Cancelling…" : "Cancel workout"} danger disabled={busy} onPress={onConfirm} />
  </WorkoutActionSheet>;
}

export function ResumeWorkoutSheet({ visible, title, date, canMove, busy, error, onClose, onKeepDate, onMove }: {
  visible: boolean; title: string; date: string; canMove: boolean; busy: boolean; error: string;
  onClose: () => void; onKeepDate: () => void; onMove: () => void;
}) {
  const t = useTheme();
  return <WorkoutActionSheet visible={visible} title={`Resume ${title}`} busy={busy} onClose={onClose}>
    <Txt muted>This unfinished workout is dated {formatDate(date)}. Keep that date, or move it to today with your recorded sets.</Txt>
    {!canMove && <Txt muted>Today already has a workout. You can keep the original date.</Txt>}
    {!!error && <View accessibilityRole="alert"><Txt style={{ color: t.danger }}>{error}</Txt></View>}
    <Button title={`Keep ${formatDate(date, { month: "short", day: "numeric" })}`} disabled={busy} onPress={onKeepDate} />
    <Button title={busy ? "Saving…" : "Move to today"} secondary disabled={busy || !canMove} onPress={onMove} />
    <Button title="Back" secondary disabled={busy} onPress={onClose} />
  </WorkoutActionSheet>;
}
