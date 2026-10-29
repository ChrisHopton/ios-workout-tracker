export const ANALYTICS_PERIODS = [4, 8, 12] as const;
export type AnalyticsPeriod = typeof ANALYTICS_PERIODS[number];
export const ANALYTICS_CHARTS = ["Weekly volume", "Workouts by week", "Sets by muscle group"] as const;
export const CHART_GAP = 12;
export const CHART_PEEK = 16;

export function carouselLayout(width: number) {
  const viewport = Number.isFinite(width) ? Math.max(0, width) : 0;
  const cardWidth = Math.max(0, viewport - CHART_GAP - CHART_PEEK);
  return { cardWidth, interval: cardWidth + CHART_GAP, endPadding: viewport - cardWidth };
}

export function carouselIndex(offset: number, interval: number, count = ANALYTICS_CHARTS.length): number {
  if (!Number.isFinite(offset) || !Number.isFinite(interval) || interval <= 0 || count <= 0) return 0;
  return Math.max(0, Math.min(count - 1, Math.round(offset / interval)));
}

export function workoutRoute(id: string) {
  return { pathname: "/record" as const, params: { id } };
}

export function chartNumber(value: number, compact = false): string {
  return new Intl.NumberFormat("en-US", compact
    ? { notation: "compact", maximumFractionDigits: 1 }
    : { maximumFractionDigits: 2 }).format(value);
}

export function chartDescription(title: string, values: readonly number[], labels: readonly string[], unit = ""): string {
  return `${title}. ${values.map((value, index) => `${labels[index]}: ${chartNumber(value)}${unit ? ` ${unit}` : ""}`).join("; ")}.`;
}
