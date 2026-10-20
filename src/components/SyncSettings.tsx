import { useState } from "react";
import { Platform, View } from "react-native";
import { useSync } from "../sync/provider";
import { Button, Card, Field, SectionTitle, Txt } from "./ui";

const statusLabels = {
  disconnected: "Not connected", pending: "Waiting to upload", syncing: "Uploading",
  synced: "Up to date", error: "Upload needs attention", paused: "Uploads paused",
};
export function SyncSettings({ disabled = false }: { disabled?: boolean }) {
  const { state, controller } = useSync();
  const [expanded, setExpanded] = useState(false);
  const [managing, setManaging] = useState(false);
  const [code, setCode] = useState("");
  const [draftLabel, setLabel] = useState<string | null>(null);
  const label = draftLabel ?? (state.deviceLabel || "My iPhone");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const connected = state.bound;
  const busy = disabled || acting || state.busy;
  async function act(operation: () => Promise<void>) {
    setActing(true); setError(null);
    try { await operation(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to change upload settings."); }
    finally { setActing(false); }
  }
  function previewCode() {
    return "WORKOUTFB1." + btoa(JSON.stringify({
      version: 1, projectId: "workout-preview", apiKey: "preview-key-" + "a".repeat(30),
      deviceId: "00000000-0000-4000-8000-000000000001",
      generationId: "00000000-0000-4000-8000-000000000002",
      uid: "preview-phone", email: "preview@workout.invalid", password: "a".repeat(64),
    })).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  }
  return (
    <Card>
      <SectionTitle>Database uploads</SectionTitle>
      <Txt bold>{statusLabels[state.status]}</Txt>
      {Platform.OS === "web" && <Txt muted>Browser preview uses a local demo. It does not contact Firebase.</Txt>}
      {connected && <>
        <Txt bold>{state.deviceLabel || "My iPhone"}</Txt>
        <Txt muted>{state.pending} pending records</Txt>
        {!state.initialComplete && <Txt muted>Initial history upload is incomplete</Txt>}
        <Txt muted>Last upload: {state.lastSyncedAt ? new Date(state.lastSyncedAt).toLocaleString() : "No uploads yet"}</Txt>
        {!!state.pausedUntil && <Txt muted>Next automatic attempt: {new Date(state.pausedUntil).toLocaleString()}</Txt>}
        <Button title="Sync now" disabled={busy} onPress={() => void act(() => controller.syncNow())} />
        <Button title={managing ? "Hide connection settings" : "Manage connection"} secondary disabled={busy}
          onPress={() => { setManaging(!managing); setExpanded(false); setCode(""); setConsent(false); }} />
        {managing && !expanded && <>
          <Field label="Phone label" value={label} maxLength={80} editable={!busy} onChangeText={setLabel} />
          <Button title="Save phone label" secondary disabled={busy || label.trim() === state.deviceLabel}
            onPress={() => void act(() => controller.setLabel(label).then(() => setLabel(null)))} />
          <Button title="Replace connection code" secondary disabled={busy} onPress={() => { setExpanded(true); setConsent(false); }} />
          <Button title="Disconnect" secondary disabled={busy} onPress={() => void act(async () => {
            await controller.disconnect();
            setManaging(false); setExpanded(false); setCode(""); setLabel(null); setConsent(false);
          })} />
        </>}
      </>}
      {!connected && !expanded && <Button title={Platform.OS === "web" ? "Connect preview" : "Connect Database"}
        disabled={busy} onPress={() => setExpanded(true)} />}
      {expanded && <>
        <Txt muted>Uploads include your profile, settings, exercises, plans, and complete workout history. The database owner can view these records. Each phone needs its own private code.</Txt>
        {Platform.OS !== "web" && <Field label="Private connection code" value={code} onChangeText={setCode}
          editable={!busy} secureTextEntry autoCapitalize="none" autoCorrect={false} maxLength={4096} />}
        <Field label="Phone label" value={label} maxLength={80} editable={!busy} onChangeText={setLabel} />
        <Button title={consent ? "✓ I agree to upload my data to the owner" : "I agree to upload my data to the owner"}
          secondary disabled={busy} onPress={() => setConsent(!consent)} />
        <Button title={connected ? "Replace code" : "Connect"} disabled={busy || !consent || !label.trim() || (Platform.OS !== "web" && !code.trim())}
          onPress={() => void act(async () => {
            await controller.connect(Platform.OS === "web" ? previewCode() : code, label);
            setCode(""); setLabel(null); setExpanded(false); setManaging(false); setConsent(false);
          })} />
        <Button title="Cancel" secondary disabled={busy} onPress={() => { setCode(""); setExpanded(false); setConsent(false); }} />
      </>}
      {!!(error || state.error) && <View accessibilityRole="alert" accessibilityLiveRegion="polite"><Txt>{error || state.error}</Txt></View>}
      <Txt muted style={{ fontSize: 13 }}>Your training data uploads for analysis while this app is open.</Txt>
    </Card>
  );
}
