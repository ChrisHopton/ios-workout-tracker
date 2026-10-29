import { View } from "react-native";
import { ProfileDraft } from "../domain/profile";
import { GenderSelector } from "./GenderSelector";
import { Field, Row } from "./ui";

type Props = {
  value: ProfileDraft;
  onChange: (patch: Partial<ProfileDraft>) => void;
  disabled?: boolean;
};

export function PhoneFields({ value, onChange, disabled = false }: Props) {
  return <Row style={{ alignItems: "flex-start" }}>
    <View style={{ width: 110 }}>
      <Field label="Country code" value={value.phoneCountryCode} editable={!disabled}
        onChangeText={(phoneCountryCode) => onChange({ phoneCountryCode })}
        keyboardType="phone-pad" autoComplete="off" maxLength={4} placeholder="+1" />
    </View>
    <View style={{ flex: 1 }}>
      <Field label="Phone number" value={value.phoneNumber} editable={!disabled}
        onChangeText={(phoneNumber) => onChange({ phoneNumber })}
        keyboardType="phone-pad" autoComplete="tel-national" maxLength={30} placeholder="312 555 0123" />
    </View>
  </Row>;
}

export function PersonalProfileFields({ value, onChange, disabled = false }: Props) {
  return <>
    <Field label="First name" value={value.firstName} editable={!disabled}
      onChangeText={(firstName) => onChange({ firstName })} autoComplete="given-name"
      autoCapitalize="words" maxLength={100} placeholder="First name" />
    <Field label="Last name" value={value.lastName} editable={!disabled}
      onChangeText={(lastName) => onChange({ lastName })} autoComplete="family-name"
      autoCapitalize="words" maxLength={100} placeholder="Last name" />
    <Field label="Date of birth (YYYY-MM-DD)" value={value.dateOfBirth} editable={!disabled}
      onChangeText={(dateOfBirth) => onChange({ dateOfBirth })}
      autoCapitalize="none" autoCorrect={false} maxLength={10} placeholder="1990-05-23" />
    <GenderSelector value={value.gender} disabled={disabled} required
      onChange={(gender) => onChange({ gender: gender === "male" ? "Male" : "Female" })} />
  </>;
}
