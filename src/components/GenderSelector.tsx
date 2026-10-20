import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { GENDER_OPTIONS, genderLabel } from "./settingsPresentation";
import { Button, Card, SectionTitle, Txt, useTheme } from "./ui";

export function GenderSelector({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const label = genderLabel(value);
  const close = () => setOpen(false);

  return (
    <>
      <View style={{ gap: 6 }}>
        <Txt muted style={{ fontSize: 13, fontWeight: "600" }}>Gender</Txt>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Gender"
          accessibilityValue={{ text: label }}
          accessibilityHint="Opens gender choices."
          accessibilityState={{ disabled, expanded: open }}
          disabled={disabled}
          onPress={() => setOpen(true)}
          style={({ pressed }) => [
            styles.choice,
            {
              backgroundColor: t.bg,
              borderColor: t.border,
              opacity: disabled ? 0.4 : pressed ? 0.75 : 1,
            },
          ]}
        >
          <Txt style={{ flex: 1, fontSize: 17 }}>{label}</Txt>
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Txt muted>⌄</Txt>
          </View>
        </Pressable>
      </View>
      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={close}
      >
        <SafeAreaView
          edges={["top", "left", "right", "bottom"]}
          style={styles.backdrop}
          accessibilityViewIsModal
          onAccessibilityEscape={close}
        >
          <Card style={styles.sheet}>
            <ScrollView
              style={{ flexShrink: 1 }}
              contentContainerStyle={{ gap: 14 }}
              keyboardShouldPersistTaps="handled"
            >
              <View accessible accessibilityRole="header">
                <SectionTitle>Gender</SectionTitle>
              </View>
              <Txt muted>Optional. Choose a value, then save your profile.</Txt>
              {GENDER_OPTIONS.map((option) => {
                const selected = value.trim().toLowerCase() === option.value;
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="radio"
                    accessibilityLabel={option.label}
                    accessibilityState={{ checked: selected, disabled }}
                    disabled={disabled}
                    onPress={() => {
                      onChange(option.value);
                      close();
                    }}
                    style={({ pressed }) => [
                      styles.choice,
                      {
                        backgroundColor: selected ? t.accentSoft : t.bg,
                        borderColor: selected ? t.accent : t.border,
                        opacity: disabled ? 0.4 : pressed ? 0.75 : 1,
                      },
                    ]}
                  >
                    <Txt style={{ flex: 1 }} bold={selected}>{option.label}</Txt>
                    {selected && (
                      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                        <Txt style={{ color: t.accent }}>✓</Txt>
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>
            <Button title="Cancel" secondary onPress={close} />
          </Card>
        </SafeAreaView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0, 0, 0, 0.45)",
    padding: 16,
  },
  sheet: {
    alignSelf: "center",
    width: "100%",
    maxWidth: 560,
    maxHeight: "90%",
  },
  choice: {
    minHeight: 50,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
});
