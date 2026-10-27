import { useState } from "react";
import { Platform, Pressable, View } from "react-native";
import Constants from "expo-constants";
import * as Updates from "expo-updates";
import { useSync } from "../sync/provider";
import { uploadStatusLabel, uploadProblem } from "./settingsPresentation";
import { Button, Card, Row, Txt, useTheme } from "./ui";

const dateTime = (value: string | null) => value ? new Date(value).toLocaleString() : "Not yet";

export function SyncSettings() {
  const { state, retry } = useSync();
  const [open, setOpen] = useState(false);
  const t = useTheme();
  const label = uploadStatusLabel(state);
  const problem = uploadProblem(state);
  return <Card style={{ padding: 16, gap: open ? 12 : 0 }}>
    <Pressable accessibilityRole="button" accessibilityLabel="Upload details"
      accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)}
      style={{ minHeight: 44, justifyContent: "center" }}>
      <Row style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
        <Txt bold>Uploads</Txt>
        <View accessible accessibilityLiveRegion="polite">
          <Txt style={{ fontSize: 14, color: label === "Uploads paused" ? t.danger : t.muted }}>{label} {open ? "⌃" : "⌄"}</Txt>
        </View>
      </Row>
    </Pressable>
    {open && <>
      {!!state.deviceLabel && <Txt muted style={{ fontSize: 13 }}>{state.deviceLabel}</Txt>}
      <Txt>Pending changes: {state.bound ? state.pending : "Preparing history"}</Txt>
      <Txt>Last upload: {dateTime(state.lastSyncedAt)}</Txt>
      <Txt muted style={{ fontSize: 13 }}>Initial history: {state.initialComplete ? "Uploaded" : state.bound ? (state.status === "syncing" ? "Uploading" : "Pending") : "Waiting for setup"}</Txt>
      {problem && <Txt style={{ color: label === "Uploads paused" ? t.danger : t.text, fontSize: 14 }}>{problem}</Txt>}
      {state.nextRetryAt && <Txt muted style={{ fontSize: 13 }}>Next attempt: {dateTime(state.nextRetryAt)}</Txt>}
      {state.error && state.retryable && <Button title="Retry" secondary disabled={state.busy} onPress={retry} />}
      {state.error && <Txt muted style={{ fontSize: 12 }}>Your workouts remain saved on this phone.</Txt>}
      <View style={{ borderTopWidth: 1, borderTopColor: t.border, paddingTop: 12, gap: 5 }}>
        <Txt muted style={{ fontSize: 12 }}>App {Constants.expoConfig?.version ?? "Unknown"} · Build {Constants.platform?.ios?.buildNumber ?? "Preview"}</Txt>
        <Txt muted style={{ fontSize: 12 }}>Channel: {Updates.channel ?? "Preview"}</Txt>
        <Txt muted style={{ fontSize: 12 }}>Runtime: {Updates.runtimeVersion ?? "Preview"}</Txt>
        <Txt muted style={{ fontSize: 12 }}>Update: {Updates.isEmbeddedLaunch ? "Included in installation" : Updates.updateId ?? "Local preview"}</Txt>
        {state.errorKind && <Txt muted style={{ fontSize: 12 }}>Upload stage: {state.phase} · {state.errorKind}</Txt>}
      </View>
      {Platform.OS === "web" && <Txt muted style={{ fontSize: 12 }}>Browser preview uses a local mock.</Txt>}
      <Txt muted style={{ fontSize: 12 }}>Your workout data uploads automatically to the app owner’s private database for analysis.</Txt>
    </>}
  </Card>;
}
