import test from "node:test";
import assert from "node:assert/strict";
import { createPreviewTransport } from "../src/sync/previewTransport";
import type { RowChange, SyncCredentials } from "../src/sync/protocol";

test("preview handles large uploads without retaining row history or mixing device revisions", async () => {
  const transport = createPreviewTransport();
  const credentials: SyncCredentials = {
    version: 1,
    endpoint: "https://script.google.com/macros/s/preview/exec",
    deviceId: "00000000-0000-4000-8000-000000000001",
    token: "a".repeat(64),
  };
  for (let index = 0; index < 190001; index += 100) {
    const changes: RowChange[] = Array.from(
      { length: Math.min(100, 190001 - index) },
      (_, offset) => ({
        table: "People",
        key: `People:${credentials.deviceId}:${index + offset}`,
        values: ["Phone", "", "", null, "lb"],
        revision: index + offset + 1,
        deleted: false,
      }),
    );
    const result = await transport(
      {
        version: 1,
        action: "upload",
        deviceId: credentials.deviceId,
        token: credentials.token,
        changes,
      },
      credentials,
    );
    assert.ok(result.ok);
    assert.equal(result.maxRevision, index + changes.length);
  }
  const another = {
    ...credentials,
    deviceId: "00000000-0000-4000-8000-000000000002",
  };
  const hello = await transport(
    {
      version: 1,
      action: "hello",
      deviceId: another.deviceId,
      token: another.token,
    },
    another,
  );
  assert.ok(hello.ok);
  assert.equal(hello.maxRevision, 0);
});
