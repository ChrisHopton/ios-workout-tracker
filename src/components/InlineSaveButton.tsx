import { useEffect } from "react";
import { AccessibilityInfo, Platform, Pressable, Text } from "react-native";
import type { SaveActionState } from "./saveAction";
import { useTheme } from "./ui";

export function InlineSaveButton({
  state, onPress, disabled = false, subject,
}: {
  state: SaveActionState;
  onPress: () => void;
  disabled?: boolean;
  subject: string;
}) {
  const t = useTheme();
  const saving = state.status === "saving";
  const title = saving ? "Saving…" : state.status === "saved" ? "✓ Saved" : state.status === "error" ? "Retry save" : "Save";
  const announcement = saving ? "Saving " + subject : state.status === "saved" ? subject + " saved" :
    state.status === "error" ? subject + " could not be saved. " + state.error : "";
  useEffect(() => {
    if (Platform.OS === "ios" && announcement)
      AccessibilityInfo.announceForAccessibilityWithOptions(announcement, { queue: true });
  }, [announcement]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title + " " + subject}
      accessibilityState={{ busy: saving, disabled: disabled || saving }}
      accessibilityLiveRegion="polite"
      disabled={disabled || saving}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 50, minWidth: 92, maxWidth: "100%", borderRadius: 14,
        paddingVertical: 14, paddingHorizontal: 18, justifyContent: "center",
        backgroundColor: state.status === "saved" ? t.accentSoft : t.accent,
        opacity: disabled && !saving ? 0.4 : pressed ? 0.75 : 1,
      })}
    >
      <Text style={{
        fontSize: 16, fontWeight: "700", textAlign: "center",
        color: state.status === "saved" ? t.success : t.onAccent,
      }}>{title}</Text>
    </Pressable>
  );
}
