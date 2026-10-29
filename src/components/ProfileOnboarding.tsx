import { useState } from "react";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useApp } from "../data/store";
import { completeProfile, normalizePhone, profileDraft, ProfileDraft } from "../domain/profile";
import { today } from "../domain/dates";
import { Button, Card, Field, Screen, SectionTitle, Txt, useTheme } from "./ui";
import { PhoneFields, PersonalProfileFields } from "./ProfileFields";
import { useSaveAction } from "./useSaveAction";

export function ProfileOnboarding() {
  const { data, replace } = useApp();
  const t = useTheme();
  const [step, setStep] = useState<"phone" | "profile">("phone");
  const [draft, setDraft] = useState(() => profileDraft(data.settings));
  const [weight, setWeight] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const save = useSaveAction();
  const busy = save.status === "saving";
  function edit(patch: Partial<ProfileDraft>) {
    if (busy) return;
    setDraft((current) => ({ ...current, ...patch }));
    setPhoneError("");
    save.edited();
  }
  function continueToProfile() {
    try {
      normalizePhone(draft.phoneCountryCode, draft.phoneNumber);
      setPhoneError("");
      setStep("profile");
    } catch (error) {
      setPhoneError(error instanceof Error ? error.message : "Check your phone number.");
    }
  }
  function saveProfile() {
    // replace publishes the snapshot only after its local journal transaction commits.
    void save.run(async () => {
      await replace(completeProfile(data, draft, weight));
    }, async () => {});
  }
  return <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: t.bg }}>
    <Screen>
      <View style={{ gap: 8, paddingTop: 16 }}>
        <Txt muted>Step {step === "phone" ? "1" : "2"} of 2</Txt>
        <Txt bold style={{ fontSize: 30, lineHeight: 38 }}>
          {step === "phone" ? "Welcome to Workout" : "Your profile"}
        </Txt>
        <Txt muted>
          {step === "phone"
            ? "Add a phone number for your profile on this device. No code or sign-in is needed."
            : "Complete these details to start logging. You can edit them later in Settings."}
        </Txt>
      </View>
      <Card>
        {step === "phone" ? <>
          <SectionTitle>Your phone number</SectionTitle>
          <PhoneFields value={draft} onChange={edit} />
          <Txt muted style={{ fontSize: 13 }}>Change the country code if needed. Enter the rest of your phone number beside it.</Txt>
          {!!phoneError && <View accessibilityRole="alert" accessibilityLiveRegion="polite">
            <Txt style={{ color: t.danger }}>{phoneError}</Txt>
          </View>}
          <Button title="Continue" onPress={continueToProfile} />
        </> : <>
          <PersonalProfileFields value={draft} onChange={edit} disabled={busy} />
          <Field label={"Body weight (" + data.settings.unit + ")"} value={weight} editable={!busy}
            onChangeText={(value) => { if (!busy) { setWeight(value.replace(",", ".")); save.edited(); } }}
            keyboardType="decimal-pad" maxLength={8} placeholder={data.settings.unit === "lb" ? "e.g. 165" : "e.g. 75"} />
          <Txt muted style={{ fontSize: 13 }}>This weight will be saved for today, {today()}.</Txt>
          {!!save.error && <View accessibilityRole="alert" accessibilityLiveRegion="polite">
            <Txt style={{ color: t.danger }}>{save.error}</Txt>
            <Txt muted style={{ fontSize: 13 }}>Your entries are still here. Try saving again.</Txt>
          </View>}
          <Txt muted style={{ fontSize: 13 }}>Your workout data uploads automatically to the app owner’s private database for analysis.</Txt>
          <Button title={busy ? "Saving…" : save.status === "error" ? "Retry save" : "Save profile"}
            disabled={busy} onPress={saveProfile} />
          <Button title="Back to phone number" secondary disabled={busy} onPress={() => setStep("phone")} />
        </>}
      </Card>
      <Txt muted style={{ fontSize: 13 }}>Your profile saves on this device and works offline.</Txt>
    </Screen>
  </SafeAreaView>;
}
