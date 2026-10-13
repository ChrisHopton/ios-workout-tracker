import { useState } from "react";
import { Platform, Pressable, View } from "react-native";
import { useSync } from "../sync/provider";
import { Button, Card, Field, SectionTitle, Txt } from "./ui";

const statusLabels = {
  disconnected: "Not connected",
  pending: "Waiting to upload",
  syncing: "Uploading",
  synced: "Up to date",
  error: "Upload needs attention",
};
export function SyncSettings({ disabled = false }: { disabled?: boolean }) {
  const { state, controller } = useSync();
  const [expanded, setExpanded] = useState(false);
  const [code, setCode] = useState("");
  const [draftLabel, setLabel] = useState<string | null>(null);
  const label = draftLabel ?? (state.deviceLabel || "My iPhone");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const connected = state.status !== "disconnected";
  const busy = disabled || acting || state.busy;
  async function act(operation: () => Promise<void>) {
    setActing(true);
    setError(null);
    try {
      await operation();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Unable to change sync settings.",
      );
    } finally {
      setActing(false);
    }
  }
  function previewCode() {
    return (
      "WORKOUT1." +
      btoa(
        JSON.stringify({
          version: 1,
          endpoint: "https://script.google.com/macros/s/preview/exec",
          deviceId: "00000000-0000-4000-8000-000000000001",
          token: "a".repeat(64),
        }),
      )
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
    );
  }
  return (
    <Card>
      <SectionTitle>Google Sheets</SectionTitle>
      <Txt bold>{statusLabels[state.status]}</Txt>
      {Platform.OS === "web" && (
        <Txt muted>
          Browser preview uses a local sync demo and does not contact Google
          Sheets.
        </Txt>
      )}
      {connected && (
        <>
          <Txt muted>{state.pending} pending rows</Txt>
          <Txt muted>
            Last upload:{" "}
            {state.lastSyncedAt
              ? new Date(state.lastSyncedAt).toLocaleString()
              : "No uploads yet"}
          </Txt>
          <Field
            label="Phone label"
            value={label}
            maxLength={80}
            editable={!busy}
            onChangeText={setLabel}
          />
          <Button
            title="Save phone label"
            secondary
            disabled={busy || label.trim() === state.deviceLabel}
            onPress={() =>
              void act(() =>
                controller.setLabel(label).then(() => setLabel(null)),
              )
            }
          />
          <Button
            title="Sync now"
            disabled={busy}
            onPress={() => void act(() => controller.syncNow())}
          />
          <Button
            title="Disconnect"
            secondary
            disabled={busy}
            onPress={() => void act(() => controller.disconnect())}
          />
          <Txt muted>
            Disconnecting stops uploads. Data already in the Sheet remains
            there.
          </Txt>
        </>
      )}
      {!connected && !expanded && (
        <Button
          title="Connect Google Sheets"
          disabled={busy}
          onPress={() => setExpanded(true)}
        />
      )}
      {!connected && expanded && (
        <>
          {Platform.OS !== "web" && (
            <Field
              label="Private connection code"
              value={code}
              secureTextEntry
              maxLength={4096}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
              placeholder="Paste your connection code"
              onChangeText={setCode}
            />
          )}
          <Field
            label="Phone label"
            value={label}
            maxLength={80}
            editable={!busy}
            onChangeText={setLabel}
          />
          <Txt>
            Connecting uploads your profile, settings, plans and full workout
            history to the spreadsheet owner. Each phone has separate records.
          </Txt>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: consent, disabled: busy }}
            disabled={busy}
            onPress={() => setConsent(!consent)}
            style={{ minHeight: 48, justifyContent: "center" }}
          >
            <Txt>
              {consent ? "☑" : "☐"} I understand and want to upload this
              phone’s data
            </Txt>
          </Pressable>
          <Button
            title={
              Platform.OS === "web" ? "Connect preview" : "Connect and upload"
            }
            disabled={
              busy ||
              !consent ||
              !label.trim() ||
              (Platform.OS !== "web" && !code.trim())
            }
            onPress={() =>
              void act(async () => {
                await controller.connect(
                  Platform.OS === "web" ? previewCode() : code,
                  label,
                );
                setCode("");
                setLabel(null);
                setExpanded(false);
                setConsent(false);
              })
            }
          />
          <Button
            title="Cancel"
            secondary
            disabled={busy}
            onPress={() => {
              setCode("");
              setExpanded(false);
              setConsent(false);
            }}
          />
        </>
      )}
      {!!(error || state.error) && (
        <View accessibilityRole="alert" accessibilityLiveRegion="polite">
          <Txt>{error || state.error}</Txt>
        </View>
      )}
      <Txt muted style={{ fontSize: 13 }}>
        Saved on this phone is separate from uploaded to Sheets. Offline changes
        upload the next time the app is open. Keep JSON backups for recovery.
      </Txt>
    </Card>
  );
}
