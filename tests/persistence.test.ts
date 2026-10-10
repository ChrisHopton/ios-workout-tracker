import test from "node:test";
import assert from "node:assert/strict";
import { createRetryableResource } from "../src/data/retryableResource";

test("failed open can be retried, then successful resource is reused", async () => {
  let attempts = 0;
  const resource = { database: "workout" };
  const get = createRetryableResource(async () => {
    if (++attempts === 1) throw new Error("locked on launch");
    return resource;
  });
  await assert.rejects(get(), /locked on launch/);
  assert.equal(await get(), resource);
  assert.equal(await get(), resource);
  assert.equal(attempts, 2);
});
test("concurrent callers share a pending attempt and all can recover after it fails", async () => {
  let attempts = 0;
  const get = createRetryableResource(async () => {
    if (++attempts === 1) throw new Error("temporarily unavailable");
    return "opened";
  });
  const first = get();
  const second = get();
  assert.equal(first, second);
  await Promise.all([
    assert.rejects(first, /temporarily/),
    assert.rejects(second, /temporarily/),
  ]);
  const third = get();
  const fourth = get();
  assert.equal(third, fourth);
  assert.equal(await third, "opened");
  assert.equal(attempts, 2);
});
test("synchronous opener failures also reset the cached attempt", async () => {
  let attempts = 0;
  const get = createRetryableResource(() => {
    if (++attempts === 1) throw new Error("sync failure");
    return Promise.resolve("opened");
  });
  await assert.rejects(get(), /sync failure/);
  assert.equal(await get(), "opened");
});
