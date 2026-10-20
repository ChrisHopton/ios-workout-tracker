import { Platform, View } from "react-native";
import { useSync } from "../sync/provider";
import { uploadStatusLabel } from "./settingsPresentation";
import { Card, SectionTitle, Txt, useTheme } from "./ui";

export function SyncSettings() {
  const { state } = useSync();
  const t = useTheme();
  const label = uploadStatusLabel(state);
  const needsAttention = label === "Upload needs attention";

  return (
    <Card>
      <SectionTitle>Database uploads</SectionTitle>
      <View accessible accessibilityLiveRegion="polite">
        <Txt bold style={needsAttention ? { color: t.danger } : undefined}>
          {label}
        </Txt>
      </View>
      {state.status === "syncing" && !needsAttention && <Txt muted>Uploading your latest changes…</Txt>}
      {state.status !== "syncing" && !needsAttention && state.pending > 0 && (
        <Txt muted>Changes are waiting to upload automatically.</Txt>
      )}
      {needsAttention && <Txt muted>Automatic uploads could not finish.</Txt>}
      {Platform.OS === "web" && (
        <Txt muted>Browser preview uses a local mock. It does not contact the database.</Txt>
      )}
      <Txt muted style={{ fontSize: 13 }}>
        Your workout data uploads automatically to the app owner’s private database for analysis.
      </Txt>
    </Card>
  );
}
