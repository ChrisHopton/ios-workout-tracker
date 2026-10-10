const DAY_MS = 86_400_000;

/** Calendar-only parsing: never interpret stored workout dates in the device timezone. */
export function parseDate(date: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw new Error("Use a valid date in YYYY-MM-DD format.");
  const value = new Date(date + "T00:00:00.000Z");
  if (
    !Number.isFinite(value.getTime()) ||
    value.toISOString().slice(0, 10) !== date
  ) {
    throw new Error("Use a valid calendar date.");
  }
  return value;
}

export function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function addDays(date: string, days: number): string {
  if (!Number.isInteger(days))
    throw new Error("Calendar offsets must be whole days.");
  return new Date(parseDate(date).getTime() + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/** Positive if a occurs after b. Immune to daylight-saving changes. */
export function dayDifference(a: string, b: string): number {
  return (parseDate(a).getTime() - parseDate(b).getTime()) / DAY_MS;
}

/** Monday = 0, Sunday = 6. */
export function weekdayIndex(date: string): number {
  return (parseDate(date).getUTCDay() + 6) % 7;
}

export function mondayOf(date: string): string {
  return addDays(date, -weekdayIndex(date));
}

export function formatDate(
  date: string,
  options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" },
): string {
  return new Intl.DateTimeFormat(undefined, {
    ...options,
    timeZone: "UTC",
  }).format(parseDate(date));
}
