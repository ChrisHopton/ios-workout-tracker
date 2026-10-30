import test from "node:test";
import assert from "node:assert/strict";
import { createJournalStorage } from "../src/data/journalStorage";
import { SaveQueue } from "../src/data/saveQueue";
import { initialData } from "../src/domain/library";
import { saveRoutine, skipNextWorkout, nextFlexibleOccurrence } from "../src/domain/routine";
import { cancelWorkout, editSessionSet, finishWorkout, moveWorkoutToToday, startSession } from "../src/domain/sessions";
import { AppData, SaveStatus } from "../src/domain/types";
import { projectSession } from "../src/sync/projection";
import { sqliteHarness } from "./storageFixture";

const monday = "2025-01-06", tuesday = "2025-01-07";
const identity = { projectId: "workout-test", deviceId: "00000000-0000-4000-8000-000000000011", generationId: "00000000-0000-4000-8000-000000000012" };
function fixture() {
  const data = initialData();
  data.templates = ["A", "B"].map((title) => ({ id: title, title, exercises: [{ exerciseId: data.exercises[0].id, sets: 1, repMin: 8, repMax: 12 }],
    weekdays: [], recurrence: { kind: "weekly" }, archived: false, updatedAt: "2025-01-01T12:00:00.000Z" }));
  return saveRoutine(data, { mode: "flexible", weekdays: [0, 2, 4], sequence: ["A", "B"], startIndex: 0 }, monday, monday);
}
async function drain(store: ReturnType<typeof createJournalStorage>) {
  for (;;) {
    const batch = await store.sync.inFlight();
    if (!batch) return;
    await store.sync.acknowledge(batch.id, batch.changes.map(({ key, revision }) => ({ key, revision })), "2025-01-07T12:00:00.000Z");
  }
}
type Outbox = { key: string; kind: string; deleted: number; revision: number; payload: string };

test("failed recording actions roll back journal, upload outbox and Saved state; retry commits the same action atomically", async () => {
  for (const action of ["cancel", "finish", "move", "skip-start"] as const) {
    const sql = sqliteHarness();
    try {
      const store = createJournalStorage(sql.db); await store.load();
      let initial = fixture();
      let id = "";
      if (action !== "skip-start") {
        const started = startSession(initial, initial.templates[0], monday, monday);
        id = started.session.id;
        initial = { ...started.data, sessions: [editSessionSet(started.session, 0, 0, { weight: "80", reps: "8" })] };
      }
      await store.write(initial);
      const enrollment = await store.sync.prepareEnrollment(identity, "Synthetic phone", "00000000-0000-4000-8000-000000000013");
      await store.sync.activateEnrollment(enrollment); await drain(store);
      const previousSync = await store.sync.state();
      const initialMetadata = sql.native.prepare("SELECT value FROM journal_meta WHERE id = 1").get()!.value;
      let visible = initial;
      const status: { value: SaveStatus } = { value: "saved" };
      const queue = new SaveQueue<AppData>((next) => store.write(next));
      const save = async () => {
        status.value = "saving";
        const next = action === "cancel" ? cancelWorkout(visible, id)
          : action === "finish" ? finishWorkout(visible, id, false, monday)
          : action === "move" ? moveWorkoutToToday(visible, id, tuesday)
          : (() => { const skipped = skipNextWorkout(visible, tuesday, tuesday);
            return startSession(skipped, nextFlexibleOccurrence(skipped, tuesday)!.template, tuesday, tuesday).data; })();
        try {
          await queue.replace(next, visible);
          visible = next;
          status.value = "saved";
        } catch (error) { status.value = "error"; throw error; }
      };
      sql.failCommit();
      const failed = save();
      assert.equal(status.value, "saving");
      assert.equal(visible, initial);
      await assert.rejects(failed, /commit failure/);
      assert.equal(status.value, "error");
      assert.equal(visible, initial);
      assert.deepEqual(await createJournalStorage(sql.db).load(), initial, action);
      assert.equal(sql.native.prepare("SELECT value FROM journal_meta WHERE id = 1").get()!.value, initialMetadata);
      assert.equal(await store.sync.pendingCount(), 0);
      assert.deepEqual(await store.sync.state(), previousSync);
      const retry = save();
      assert.equal(status.value, "saving"); assert.equal(visible, initial);
      await retry;
      assert.equal(status.value, "saved");
      assert.deepEqual(await createJournalStorage(sql.db).load(), visible);
      const rows = sql.native.prepare("SELECT * FROM upload_outbox ORDER BY key").all() as unknown as Outbox[];
      assert.ok(rows.length > 0);
      assert.equal(new Set(rows.map((row) => row.revision)).size, 1, "all documents share one committed local revision");
      if (action === "cancel") {
        const keys = projectSession(initial.sessions[0], identity.deviceId).map((doc) => doc.key).sort();
        assert.deepEqual(rows.map((row) => row.key).sort(), keys);
        assert.ok(rows.every((row) => row.deleted === 1 && row.payload === "{}"));
        assert.equal(visible.sessions.length, 0); assert.equal(visible.routineProgress.length, 0);
      } else if (action === "finish") {
        assert.equal(visible.sessions[0].hasFinished, true);
        assert.equal(visible.routineProgress.length, 1);
        assert.ok(rows.some((row) => row.kind === "schedule_progress" && JSON.parse(row.payload).outcome === "completed"));
        assert.ok(rows.some((row) => row.kind === "workout" && JSON.parse(row.payload).hasFinished === true));
      } else if (action === "move") {
        assert.equal(visible.sessions[0].id, id);
        assert.equal(visible.sessions[0].date, tuesday);
        assert.equal(visible.routineProgress.length, 0);
        assert.deepEqual(rows.map((row) => row.kind), ["workout"]);
        assert.equal(rows[0].deleted, 0);
      } else {
        assert.equal(visible.sessions.length, 1); assert.equal(visible.sessions[0].templateId, "B");
        assert.equal(visible.routineProgress.length, 1);
        assert.ok(rows.some((row) => row.kind === "schedule_progress" && JSON.parse(row.payload).outcome === "skipped"));
        assert.ok(rows.some((row) => row.kind === "workout" && JSON.parse(row.payload).hasFinished === false));
      }
    } finally { sql.close(); }
  }
});
