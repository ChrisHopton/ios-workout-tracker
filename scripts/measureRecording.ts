import { performance } from "node:perf_hooks";
import { snapshot } from "../src/data/snapshot";
import { createJournalStorage } from "../src/data/journalStorage";
import { editLastSession, scheduleHistoryFixture, sqliteHarness } from "../tests/storageFixture";

function median(values: number[]) {
  return Number([...values].sort((a, b) => a - b)[Math.floor(values.length / 2)].toFixed(3));
}

async function main() {
  const results = [];
  for (const revisions of [0, 100, 500]) {
    const sql = sqliteHarness();
    try {
      const store = createJournalStorage(sql.db);
      await store.load();
      let data = snapshot(scheduleHistoryFixture(revisions));
      await store.write(data);
      const validation: number[] = [];
      const writes: number[] = [];
      for (let edit = 0; edit < 30; edit++) {
        const next = editLastSession(data, String(150 + edit));
        let start = performance.now();
        const checked = snapshot(next, data);
        const validationMs = performance.now() - start;
        start = performance.now();
        await store.write(checked);
        if (edit >= 5) {
          validation.push(validationMs);
          writes.push(performance.now() - start);
        }
        data = checked;
      }
      const { sessions: _sessions, ...metadata } = data;
      results.push({
        revisions, workouts: data.sessions.length, measuredEdits: validation.length,
        validationMedianMs: median(validation), writeMedianMs: median(writes),
        metadataBytes: Buffer.byteLength(JSON.stringify(metadata)),
      });
    } finally { sql.close(); }
  }
  console.log(JSON.stringify({ measuredAt: new Date().toISOString(), runtime: process.version, results }, null, 2));
}
void main();
