import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { parseBackup, serializeBackup } from "../src/domain/backup";
import { createJournalStorage } from "../src/data/journalStorage";
import { snapshot } from "../src/data/snapshot";
import {
  editLastSession,
  historyFixture,
  sqliteHarness,
} from "../tests/storageFixture";

function directoryBytes(path: string): number {
  return readdirSync(path, { withFileTypes: true }).reduce((total, entry) => {
    const child = join(path, entry.name);
    return (
      total +
      (entry.isDirectory() ? directoryBytes(child) : statSync(child).size)
    );
  }, 0);
}
function median(values: number[]): number {
  return Number(
    [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)].toFixed(3),
  );
}
async function main() {
  const iterations = 20;
  const fixture = historyFixture();
  const oldDb = sqliteHarness();
  const newDb = sqliteHarness();
  try {
    oldDb.native.exec(
      "CREATE TABLE app_state (id INTEGER PRIMARY KEY, value TEXT NOT NULL)",
    );
    const oldTimings: number[] = [];
    let oldData = fixture;
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      oldData = parseBackup(
        JSON.stringify(editLastSession(oldData, String(100 + i))),
      );
      const text = JSON.stringify(oldData);
      parseBackup(text);
      await oldDb.db.runAsync(
        "INSERT INTO app_state VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value",
        text,
      );
      oldTimings.push(performance.now() - start);
    }
    const store = createJournalStorage(newDb.db);
    await store.load();
    let data = snapshot(fixture);
    await store.write(data);
    const before = newDb.stats();
    const timings: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      data = snapshot(editLastSession(data, String(100 + i)), data);
      await store.write(data);
      timings.push(performance.now() - start);
    }
    const pageCount = Number(
      newDb.native.prepare("PRAGMA page_count").get()?.page_count,
    );
    const pageSize = Number(
      newDb.native.prepare("PRAGMA page_size").get()?.page_size,
    );
    const optimizedStats = newDb.stats();
    const baselineBytes = pageCount * pageSize;
    await store.sync.connect(
      "00000000-0000-4000-8000-000000000001",
      "Sizing fixture",
      0,
    );
    const initialPending = await store.sync.pendingCount();
    const peakBytes =
      Number(newDb.native.prepare("PRAGMA page_count").get()?.page_count) *
      pageSize;
    while (await store.sync.pendingCount()) {
      const batch = await store.sync.pending();
      await store.sync.acknowledge(batch, "2026-10-13T12:00:00.000Z");
    }
    const retainedBytes =
      (Number(newDb.native.prepare("PRAGMA page_count").get()?.page_count) -
        Number(
          newDb.native.prepare("PRAGMA freelist_count").get()?.freelist_count,
        )) *
      pageSize;
    const syncBefore = newDb.stats();
    const syncTimings: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      data = snapshot(editLastSession(data, String(200 + i)), data);
      await store.write(data);
      syncTimings.push(performance.now() - start);
    }
    const syncSizing = {
      initialPendingRows: initialPending,
      baselineBytes,
      peakInitialUploadBytes: peakBytes,
      retainedAllocatedBytesAfterUpload: retainedBytes,
      editPendingRows: await store.sync.pendingCount(),
      editWriteBytes: newDb.stats().bytes - syncBefore.bytes,
      editWriteStatements: newDb.stats().writes - syncBefore.writes,
      editMedianMs: median(syncTimings),
    };
    const metadata = JSON.parse(readFileSync("dist/metadata.json", "utf8"));
    const ios = metadata.fileMetadata.ios;
    const fonts = ios.assets.filter(
      (asset: { ext: string }) => asset.ext === "ttf",
    );
    console.log(
      JSON.stringify(
        {
          measuredAt: new Date().toISOString(),
          runtime: process.version,
          export: {
            totalBytes: directoryBytes("dist"),
            hermesBytes: statSync(join("dist", ios.bundle)).size,
            fontCount: fonts.length,
            fontBytes: fonts.reduce(
              (total: number, font: { path: string }) =>
                total +
                statSync(join("dist", font.path.replaceAll("\\", "/"))).size,
              0,
            ),
          },
          sync: syncSizing,
          storage: {
            workouts: fixture.sessions.length,
            exercisesPerWorkout: 6,
            setsPerExercise: 3,
            sqliteBytes: pageCount * pageSize,
            compactBackupBytes: Buffer.byteLength(serializeBackup(data)),
            formattedBackupBytes: Buffer.byteLength(
              JSON.stringify(data, null, 2),
            ),
            edits: iterations,
            previousWriteBytes: oldDb.stats().bytes,
            optimizedWriteBytes: optimizedStats.bytes - before.bytes,
            optimizedWriteStatements: optimizedStats.writes - before.writes,
            previousMedianMs: median(oldTimings),
            optimizedMedianMs: median(timings),
          },
        },
        null,
        2,
      ),
    );
  } finally {
    oldDb.close();
    newDb.close();
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
