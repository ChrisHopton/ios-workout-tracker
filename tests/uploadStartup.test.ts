import test from "node:test";
import assert from "node:assert/strict";
import { createUploadStartup } from "../src/sync/startup";
import { SyncError } from "../src/sync/transport";
async function settle() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
function harness(bootstrap: (canSend: () => boolean) => Promise<boolean>) {
  let time = 1000, id = 0, starts = 0, initialized = 0, uploadRetries = 0;
  const jobs = new Map<number, { callback: () => void; at: number }>();
  const failures: { error: unknown; at: number | null }[] = [];
  const runner = createUploadStartup({
    bootstrap, initialize: async () => { initialized++; return true; },
    started: () => { starts++; }, failed: (error, at) => failures.push({ error, at }),
    retryUpload: () => { uploadRetries++; }, now: () => time,
    schedule: (callback, delay) => { jobs.set(++id, { callback, at: time + delay }); return id; },
    cancel: (handle) => { jobs.delete(handle as number); },
  });
  return { runner, failures, jobs, counts: () => ({ starts, initialized, uploadRetries }),
    async advance(ms: number) {
      time += ms;
      const due = [...jobs.entries()].filter(([, job]) => job.at <= time);
      for (const [key, job] of due) { jobs.delete(key); job.callback(); await settle(); }
    },
  };
}
test("startup retry obeys backoff, recovers with the same bootstrap and hands off to uploads", async () => {
  let attempts = 0;
  const h = harness(async () => { if (++attempts === 1) throw new SyncError("Offline", true, "network"); return true; });
  h.runner.setActive(true); await settle();
  assert.equal(h.failures[0].at, 16000);
  h.runner.retry(); h.runner.retry();
  await h.advance(14999); assert.equal(attempts, 1);
  await h.advance(1); assert.equal(attempts, 2);
  assert.equal(h.counts().initialized, 1);
  h.runner.retry(); assert.equal(h.counts().uploadRetries, 1);
  h.runner.dispose();
});
test("repeated retry and resume cannot overlap an in-flight bootstrap", async () => {
  let resolve!: (value: boolean) => void;
  const h = harness(async () => new Promise<boolean>((done) => { resolve = done; }));
  h.runner.setActive(true); h.runner.retry(); h.runner.setActive(false); h.runner.setActive(true);
  assert.equal(h.counts().starts, 1);
  resolve(true); await settle();
  assert.equal(h.counts().initialized, 1);
  h.runner.dispose();
});
test("terminal startup failures never create a replacement through retry or resume", async () => {
  const h = harness(async () => { throw new SyncError("Saved identity damaged", false, "storage"); });
  h.runner.setActive(true); await settle();
  h.runner.retry(); h.runner.setActive(false); h.runner.setActive(true);
  await h.advance(600000);
  assert.equal(h.counts().starts, 1);
  assert.equal(h.failures[0].at, null);
  assert.equal(h.jobs.size, 0);
  h.runner.dispose();
});
test("background and disposal stop scheduled setup attempts", async () => {
  const h = harness(async () => { throw new SyncError("Verification unavailable", true, "attestation"); });
  h.runner.setActive(true); await settle(); h.runner.setActive(false);
  await h.advance(15000); assert.equal(h.counts().starts, 1);
  h.runner.setActive(true); await settle(); assert.equal(h.counts().starts, 2);
  h.runner.dispose(); await h.advance(600000); assert.equal(h.counts().starts, 2);
});
test("quota reset later than ordinary backoff controls setup retry", async () => {
  const h = harness(async () => { throw new SyncError("Quota", true, "quota", 100000); });
  h.runner.setActive(true); await settle();
  assert.equal(h.failures[0].at, 100000);
  h.runner.retry(); await h.advance(15000);
  assert.equal(h.counts().starts, 1); h.runner.dispose();
});
