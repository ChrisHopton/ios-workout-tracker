import React from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TextStyle,
  useColorScheme,
  View,
  ViewStyle,
  StyleProp,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
export function useTheme() {
  const dark = useColorScheme() === "dark";
  return dark
    ? {
        bg: "#10141C",
        card: "#1B2230",
        text: "#F4F7FC",
        muted: "#ABB7CA",
        border: "#303B4F",
        accent: "#84AEFF",
        accentSoft: "#253A61",
        danger: "#FF9B9B",
        success: "#81D7B0",
        onAccent: "#10203B",
      }
    : {
        bg: "#F4F6FA",
        card: "#FFFFFF",
        text: "#17243B",
        muted: "#65748C",
        border: "#DDE4EF",
        accent: "#235BD7",
        accentSoft: "#EAF0FF",
        danger: "#B02A39",
        success: "#167A55",
        onAccent: "#FFFFFF",
      };
}
export function Screen({
  children,
  scroll = true,
}: {
  children: React.ReactNode;
  scroll?: boolean;
}) {
  const t = useTheme();
  return (
    <SafeAreaView
      edges={["left", "right", "bottom"]}
      style={{ flex: 1, backgroundColor: t.bg }}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={100}
      >
        {scroll ? (
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={s.screen}
          >
            {children}
          </ScrollView>
        ) : (
          <View style={[s.screen, { flex: 1 }]}>{children}</View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  return (
    <View
      style={[
        s.card,
        { backgroundColor: t.card, borderColor: t.border },
        style,
      ]}
    >
      {children}
    </View>
  );
}
export function Txt({
  children,
  style,
  muted,
  bold,
}: {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
  muted?: boolean;
  bold?: boolean;
}) {
  const t = useTheme();
  return (
    <Text
      style={[
        s.text,
        { color: muted ? t.muted : t.text },
        bold && { fontWeight: "700" },
        style,
      ]}
    >
      {children}
    </Text>
  );
}
export function Button({
  title,
  onPress,
  secondary,
  danger,
  disabled,
}: {
  title: string;
  onPress: () => void;
  secondary?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        {
          backgroundColor: secondary
            ? t.accentSoft
            : danger
              ? t.danger
              : t.accent,
          opacity: disabled ? 0.4 : pressed ? 0.75 : 1,
        },
      ]}
    >
      <Text
        style={{
          fontSize: 16,
          fontWeight: "700",
          textAlign: "center",
          color: secondary ? (danger ? t.danger : t.accent) : t.onAccent,
        }}
      >
        {title}
      </Text>
    </Pressable>
  );
}
export function Field({
  label,
  style,
  ...props
}: TextInputProps & { label?: string }) {
  const t = useTheme();
  return (
    <View style={{ gap: 6, flexShrink: 1 }}>
      {label && (
        <Txt muted style={{ fontSize: 13, fontWeight: "600" }}>
          {label}
        </Txt>
      )}
      <TextInput
        {...props}
        accessibilityLabel={props.accessibilityLabel ?? label}
        placeholderTextColor={t.muted}
        style={[
          s.field,
          { backgroundColor: t.bg, borderColor: t.border, color: t.text },
          style,
        ]}
      />
    </View>
  );
}
export function Row({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[{ flexDirection: "row", alignItems: "center", gap: 10 }, style]}
    >
      {children}
    </View>
  );
}
export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      style={[
        s.chip,
        {
          backgroundColor: selected ? t.accent : t.card,
          borderColor: selected ? t.accent : t.border,
        },
      ]}
    >
      <Txt
        style={{
          fontSize: 14,
          fontWeight: "600",
          color: selected ? t.onAccent : t.text,
        }}
      >
        {label}
      </Txt>
    </Pressable>
  );
}
export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <Txt bold style={{ fontSize: 20, marginTop: 8 }}>
      {children}
    </Txt>
  );
}
const s = StyleSheet.create({
  screen: {
    padding: 20,
    gap: 18,
    paddingBottom: 36,
    maxWidth: 680,
    width: "100%",
    alignSelf: "center",
  },
  card: { borderWidth: 1, borderRadius: 22, padding: 20, gap: 14 },
  text: { fontSize: 16, lineHeight: 23 },
  button: {
    minHeight: 50,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 18,
    justifyContent: "center",
  },
  field: {
    minHeight: 48,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    fontSize: 17,
  },
  chip: {
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 24,
    borderWidth: 1,
    justifyContent: "center",
    alignItems: "center",
  },
});
