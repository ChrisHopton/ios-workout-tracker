import { useRef, useState } from "react";
import { View } from "react-native";
import { useApp } from "../../data/store";
import { Unit } from "../../domain/types";
import {
  Card,
  Chip,
  Field,
  Row,
  Screen,
  SectionTitle,
  Txt,
  useTheme,
} from "../../components/ui";
import { SyncSettings } from "../../components/SyncSettings";
import { WorkoutImportSettings } from "../../components/WorkoutImportSettings";
import { BodyWeightSettings } from "../../components/BodyWeightSettings";
import { SaveIndicator } from "../../components/SaveIndicator";
import { PhoneFields, PersonalProfileFields } from "../../components/ProfileFields";
import { editProfile, profileDraft, ProfileDraft } from "../../domain/profile";
import { InlineSaveButton } from "../../components/InlineSaveButton";
import { useSaveAction } from "../../components/useSaveAction";

type HeightFields = { cm: string; feet: string; inches: string };
function heightFields(cm: number | null): HeightFields {
  if (cm === null) return { cm: "", feet: "", inches: "" };
  const totalInches = Math.round((cm / 2.54) * 100) / 100;
  const feet = Math.floor(totalInches / 12);
  return {
    cm: String(Math.round(cm * 100) / 100),
    feet: String(feet),
    inches: String(Math.round((totalInches - feet * 12) * 100) / 100),
  };
}
function parseHeight(fields: HeightFields, unit: Unit): number | null {
  let cm: number | null = null;
  if (unit === "kg") {
    if (fields.cm !== "") {
      if (!/^\d+(\.\d+)?$/.test(fields.cm))
        throw new Error("Enter a valid height in centimeters.");
      cm = Number(fields.cm);
    }
  } else if (fields.feet !== "" || fields.inches !== "") {
    if (
      !/^\d*$/.test(fields.feet) ||
      !/^\d*(\.\d+)?$/.test(fields.inches) ||
      Number(fields.inches) >= 12
    ) {
      throw new Error("Enter feet and inches, with inches below 12.");
    }
    cm = (Number(fields.feet) * 12 + Number(fields.inches)) * 2.54;
  }
  if (cm !== null && (!Number.isFinite(cm) || cm < 1 || cm > 300)) {
    throw new Error("Enter a height between 1 and 300 cm, or leave it blank.");
  }
  return cm;
}

export default function Settings() {
  const { data, update, flush } = useApp();
  const t = useTheme();
  const [profile, setProfile] = useState(() => profileDraft(data.settings));
  const [height, setHeight] = useState(() =>
    heightFields(data.settings.heightCm),
  );
  // Keep exact height separately from rounded display fields
  const [canonicalHeight, setCanonicalHeight] = useState(
    data.settings.heightCm,
  );
  const [heightEdited, setHeightEdited] = useState(false);
  const profileSave = useSaveAction();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  async function action(work: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Something went wrong.",
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  function currentHeight() {
    return heightEdited
      ? parseHeight(height, data.settings.unit)
      : canonicalHeight;
  }
  function editHeight(key: keyof HeightFields, value: string) {
    if (busyRef.current || value.replace(",", ".") === height[key]) return;
    setHeight((current) => ({ ...current, [key]: value.replace(",", ".") }));
    setHeightEdited(true);
    profileSave.edited();
  }
  function chooseUnit(unit: Unit) {
    if (busyRef.current || unit === data.settings.unit) return;
    void action(async () => {
      const cm = currentHeight();
      update((current) => ({
        ...current,
        settings: { ...current.settings, unit },
      }));
      setCanonicalHeight(cm);
      setHeight(heightFields(cm));
      setHeightEdited(false);
      await flush();
    });
  }
  function editProfileFields(patch: Partial<ProfileDraft>) {
    if (busyRef.current) return;
    setProfile((current) => ({ ...current, ...patch }));
    profileSave.edited();
  }
  function saveProfile() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    void (async () => {
      let cm: number | null = null;
      try {
        const succeeded = await profileSave.run(() => {
          cm = currentHeight();
          update((current) => editProfile(current, profile, cm));
        }, flush);
        if (succeeded) {
          setCanonicalHeight(cm);
          setHeightEdited(false);
        }
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    })();
  }
  return (
    <Screen bottomSafeArea={false}>
      <SaveIndicator />
      {!!error && (
        <Card>
          <Txt style={{ color: t.danger }}>{error}</Txt>
        </Card>
      )}
      <Card>
        <SectionTitle>Units</SectionTitle>
        <Row style={{ flexWrap: "wrap" }}>
          <Chip
            label="Pounds · ft / in"
            selected={data.settings.unit === "lb"}
            onPress={() => chooseUnit("lb")}
          />
          <Chip
            label="Kilograms · cm"
            selected={data.settings.unit === "kg"}
            onPress={() => chooseUnit("kg")}
          />
        </Row>
        <Txt muted style={{ fontSize: 12 }}>
          Used for new workouts and chart display.
        </Txt>
      </Card>
      <BodyWeightSettings disabled={busy} />
      <Card>
        <SectionTitle>Your profile</SectionTitle>
        <Txt muted style={{ fontSize: 13 }}>Your required details. Height is optional.</Txt>
        <PhoneFields value={profile} onChange={editProfileFields} disabled={busy} />
        <PersonalProfileFields value={profile} onChange={editProfileFields} disabled={busy} />
        {data.settings.unit === "kg" ? (
          <Field
            label="Height (cm)"
            value={height.cm}
            editable={!busy}
            onChangeText={(value) => editHeight("cm", value)}
            keyboardType="decimal-pad"
            maxLength={7}
            placeholder="Optional"
          />
        ) : (
          <Row>
            <View style={{ flex: 1 }}>
              <Field
                label="Height (feet)"
                value={height.feet}
                editable={!busy}
                onChangeText={(value) => editHeight("feet", value)}
                keyboardType="number-pad"
                maxLength={1}
                placeholder="ft"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label="Inches"
                value={height.inches}
                editable={!busy}
                onChangeText={(value) => editHeight("inches", value)}
                keyboardType="decimal-pad"
                maxLength={5}
                placeholder="in"
              />
            </View>
          </Row>
        )}
        <InlineSaveButton state={profileSave} subject="profile" disabled={busy} onPress={saveProfile} />
        {!!profileSave.error && (
          <View accessibilityRole="alert" accessibilityLiveRegion="polite">
            <Txt style={{ color: t.danger }}>{profileSave.error}</Txt>
          </View>
        )}
      </Card>
      <WorkoutImportSettings disabled={busy} />
      <SyncSettings />
    </Screen>
  );
}
