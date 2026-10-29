import test from "node:test";
import assert from "node:assert/strict";
import { ANALYTICS_PERIODS, ANALYTICS_CHARTS, carouselLayout, carouselIndex, chartNumber, chartDescription, workoutRoute } from "../src/components/analytics/selection";

test("analytics offers the three approved charts and bounded periods", () => {
  assert.deepEqual(ANALYTICS_PERIODS, [4, 8, 12]);
  assert.deepEqual(ANALYTICS_CHARTS, ["Weekly volume", "Workouts by week", "Sets by muscle group"]);
});

test("last workout navigation opens the existing session without creating or editing one", () => {
  assert.deepEqual(workoutRoute("workout:imported/2026-10-12"), {
    pathname: "/record", params: { id: "workout:imported/2026-10-12" },
  });
});

test("carousel preserves a 12 point gap and 16 point peek at narrow and wide phone sizes", () => {
  for (const viewport of [335, 390, 640]) {
    const layout = carouselLayout(viewport);
    assert.equal(viewport - layout.interval, 16);
    assert.equal(layout.interval - layout.cardWidth, 12);
    assert.equal(layout.endPadding, 28);
    const contentWidth = layout.cardWidth * 3 + 12 * 2 + layout.endPadding;
    assert.equal(contentWidth - viewport, layout.interval * 2, "last card can snap fully to the leading edge");
  }
});

test("resizing preserves the selected chart using its new stride, not an old pixel offset", () => {
  const narrow = carouselLayout(335);
  const wide = carouselLayout(390);
  for (const index of [0, 1, 2]) {
    assert.equal(carouselIndex(index * narrow.interval, narrow.interval), index);
    assert.equal(carouselIndex(index * wide.interval, wide.interval), index);
  }
  assert.equal(carouselIndex(0, 0), 0);
  assert.deepEqual(carouselLayout(Number.NaN), { cardWidth: 0, interval: 12, endPadding: 0 });
});

test("carousel selects the nearest card and clamps edge bounce", () => {
  const { interval } = carouselLayout(335);
  assert.equal(carouselIndex(-50, interval), 0);
  assert.equal(carouselIndex(interval * 0.49, interval), 0);
  assert.equal(carouselIndex(interval * 0.51, interval), 1);
  assert.equal(carouselIndex(interval * 1.5, interval), 2);
  assert.equal(carouselIndex(interval * 6, interval), 2);
  assert.equal(carouselIndex(Number.NaN, interval), 0);
});

test("axes compact large values while spoken chart data keeps readable full values and units", () => {
  assert.equal(chartNumber(12345, true), "12.3K");
  assert.equal(chartNumber(999999, true), "1M");
  assert.equal(chartNumber(12345.678), "12,345.68");
  assert.equal(chartDescription("Weekly volume", [0, 12345.67], ["10/5", "10/12"], "lb times reps"),
    "Weekly volume. 10/5: 0 lb times reps; 10/12: 12,345.67 lb times reps.");
  assert.equal(chartDescription("Sets", [2], ["Core"]), "Sets. Core: 2.");
});
