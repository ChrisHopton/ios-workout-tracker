import { View } from "react-native";
import { useApp } from "../data/store";
import { Button, Txt, useTheme } from "./ui";
export function SaveIndicator({ compact = false }: { compact?: boolean }) {
  const { status, error, retry } = useApp();
  const t = useTheme();
  if (compact && status === "saved" && !error) return null;
  return (
    <View accessibilityLiveRegion="polite" style={{ gap: 8 }}>
      <Txt
        style={{
          fontSize: 12,
          color:
            status === "error"
              ? t.danger
              : status === "saved"
                ? t.success
                : t.muted,
        }}
      >
        {status === "saved"
          ? "✓ All changes saved on this phone"
          : status === "saving"
            ? "Saving…"
            : "Changes have not been saved"}
      </Txt>
      {error && (
        <>
          <Txt style={{ color: t.danger, fontSize: 13 }}>{error}</Txt>
          <Button
            title="Retry saving"
            secondary
            onPress={() => {
              void retry().catch(() => {});
            }}
          />
        </>
      )}
    </View>
  );
}
