import { parseDate, today } from "./dates";
import { saveBodyWeight } from "./bodyWeight";
import { AppData, ProfileSettings } from "./types";

export type ProfileDraft = Pick<ProfileSettings, "phoneCountryCode" | "phoneNumber" | "firstName" | "lastName" | "dateOfBirth" | "gender">;

export function emptyProfileSettings(): ProfileSettings {
  return {
    phoneCountryCode: "+1", phoneNumber: "", firstName: "", lastName: "",
    dateOfBirth: "", gender: "", heightCm: null, unit: "lb", profileCompletedAt: null,
  };
}

/** Calendar comparison uses March 1 for February 29 birthdays in non-leap years. */
export function ageFromDateOfBirth(dateOfBirth: string, asOf = today()): number | null {
  try {
    parseDate(dateOfBirth);
    parseDate(asOf);
    if (dateOfBirth > asOf) return null;
    const age = Number(asOf.slice(0, 4)) - Number(dateOfBirth.slice(0, 4))
      - (asOf.slice(5) < dateOfBirth.slice(5) ? 1 : 0);
    return age >= 0 && age <= 130 ? age : null;
  } catch {
    return null;
  }
}

export function normalizePhone(countryCode: string, phoneNumber: string): { phoneCountryCode: string; phoneNumber: string } {
  const code = countryCode.trim();
  if (!/^\+[1-9]\d{0,2}$/.test(code))
    throw new Error("Enter a country code beginning with +, such as +1 or +44.");
  const input = phoneNumber.trim().replace(/[\s().-]/g, "");
  const full = input.startsWith("+") ? input : code + input;
  if (!/^\+[1-9]\d{6,14}$/.test(full) || !full.startsWith(code) || full.length <= code.length + 3)
    throw new Error("Enter a valid phone number for this country code (7–15 digits including the code).");
  return { phoneCountryCode: code, phoneNumber: full };
}

function normalizedName(value: string, label: string): string {
  const name = value.trim();
  if (!name || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name))
    throw new Error("Enter your " + label + " (1–100 characters).");
  return name;
}

export function validateProfileDraft(draft: ProfileDraft, asOf = today()): ProfileDraft {
  const phone = normalizePhone(draft.phoneCountryCode, draft.phoneNumber);
  const firstName = normalizedName(draft.firstName, "first name");
  const lastName = normalizedName(draft.lastName, "last name");
  const dateOfBirth = draft.dateOfBirth.trim();
  if (ageFromDateOfBirth(dateOfBirth, asOf) === null)
    throw new Error("Enter a real date of birth in YYYY-MM-DD format, today or earlier (age 0–130).");
  if (draft.gender !== "Male" && draft.gender !== "Female")
    throw new Error("Choose Male or Female.");
  return { ...phone, firstName, lastName, dateOfBirth, gender: draft.gender };
}

export function isProfileComplete(data: Pick<AppData, "settings">, asOf = today()): boolean {
  const completed = data.settings.profileCompletedAt;
  if (!completed || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(completed)
    || !Number.isFinite(new Date(completed).getTime()) || new Date(completed).toISOString() !== completed) return false;
  try {
    validateProfileDraft(data.settings, asOf);
    return true;
  } catch {
    return false;
  }
}

/** One journal snapshot saves the required profile and today's initial measurement in canonical kg. */
export function completeProfile(
  data: AppData, draft: ProfileDraft, weightText: string, asOf = today(), completedAt = new Date().toISOString(),
): AppData {
  const settings = validateProfileDraft(draft, asOf);
  const existing = data.bodyWeights.find((entry) => entry.date === asOf);
  const next = saveBodyWeight(data, asOf, weightText, data.settings.unit, existing?.id, asOf);
  return {
    ...next,
    settings: { ...data.settings, ...settings, profileCompletedAt: data.settings.profileCompletedAt ?? completedAt },
  };
}

export function editProfile(data: AppData, draft: ProfileDraft, heightCm: number | null, asOf = today()): AppData {
  const settings = validateProfileDraft(draft, asOf);
  if (heightCm !== null && (!Number.isFinite(heightCm) || heightCm < 1 || heightCm > 300))
    throw new Error("Enter a height between 1 and 300 cm, or leave it blank.");
  return { ...data, settings: { ...data.settings, ...settings, heightCm } };
}

export function profileDraft(settings: ProfileSettings): ProfileDraft {
  return {
    phoneCountryCode: settings.phoneCountryCode,
    phoneNumber: settings.phoneNumber.startsWith(settings.phoneCountryCode)
      ? settings.phoneNumber.slice(settings.phoneCountryCode.length) : settings.phoneNumber,
    firstName: settings.firstName, lastName: settings.lastName,
    dateOfBirth: settings.dateOfBirth, gender: settings.gender,
  };
}
