import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { parseConnectionCode, type LegacySyncCredentials } from "../src/sync/protocol";
import { generateCredentials, parseSetupArguments, provision, reservePrivateOutput, resolvePrivateOutput, revoke, runSetup, setupBundle, type Authorization, type OwnerBackend, type PrivateSetup } from "../scripts/firebaseSetup";

const PROJECT = "demo-workout-sync";
const API_KEY = "A".repeat(39);
function owner() {
  const users = new Map<string, { disabled: boolean; credentials: LegacySyncCredentials }>();
  const registry = new Map<string, Authorization>();
  const events: string[] = [];
  let failCreation = 0;
  let failCommit = false;
  let failDisable = false;
  const backend: OwnerBackend = {
    createUser: async (value) => {
      events.push(`create:${value.uid}`);
      if (failCreation && --failCreation === 0) throw new Error(value.password);
      users.set(value.uid, { disabled: false, credentials: value });
    },
    deleteUser: async (uid) => { events.push(`delete:${uid}`); users.delete(uid); },
    disableUser: async (uid) => { events.push(`disable:${uid}`); if (failDisable) throw new Error("cleanup"); const user = users.get(uid); if (user) user.disabled = true; },
    getAuthorization: async (uid) => registry.get(uid) ?? null,
    publish: async (credentials, previous) => {
      events.push("registry:atomic");
      if (failCommit) throw new Error("transaction");
      const retained = [...registry.entries()].filter(([uid, value]) => value.enabled && uid !== previous?.uid);
      if (retained.some(([, entry]) => credentials.some((value) => value.deviceId === entry.deviceId))) throw new Error("identity already active");
      if (retained.length + credentials.length > 2) throw new Error("capacity");
      if (previous) {
        assert.deepEqual(registry.get(previous.uid), previous.expected);
        registry.set(previous.uid, { ...previous.expected, enabled: false });
      }
      for (const value of credentials) registry.set(value.uid, { enabled: true, deviceId: value.deviceId, generationId: value.generationId });
    },
    revoke: async (uid) => { events.push(`revoke:${uid}`); const entry = registry.get(uid); if (entry) registry.set(uid, { ...entry, enabled: false }); },
  };
  return { backend, users, registry, events, failCreation: (count: number) => { failCreation = count; }, failCommit: () => { failCommit = true; }, failDisable: () => { failDisable = true; } };
}
function privateFolder() {
  const directory = mkdtempSync(join(tmpdir(), "workout-firebase-owner-"));
  return { directory, cleanup: () => {
    assert.equal(resolve(dirname(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith("workout-firebase-owner-"));
    rmSync(directory, { recursive: true, force: true });
  } };
}
function readBundle(path: string): PrivateSetup { return JSON.parse(readFileSync(path, "utf8")); }

test("owner generation uses distinct 256-bit credentials and fake account emails", () => {
  const credentials = [generateCredentials(PROJECT, API_KEY), generateCredentials(PROJECT, API_KEY)];
  const bundle = setupBundle(credentials);
  assert.equal(bundle.devices.length, 2);
  assert.notEqual(credentials[0].uid, credentials[1].uid);
  assert.notEqual(credentials[0].deviceId, credentials[1].deviceId);
  for (const [index, device] of bundle.devices.entries()) {
    const parsed = parseConnectionCode(device.connectionCode);
    assert.deepEqual(parsed, credentials[index]);
    assert.equal(Buffer.from(parsed.password, "base64url").length, 32);
    assert.match(parsed.email, /^phone-[0-9a-f-]+@workout\.invalid$/);
    assert.equal("password" in device, false);
  }
});
test("owner argument and private output validation rejects unsafe inputs and overwrites", () => {
  assert.throws(() => generateCredentials("INVALID", API_KEY));
  assert.throws(() => generateCredentials(PROJECT, "short"));
  assert.throws(() => parseSetupArguments(["rotate", "--project", PROJECT, "--api-key", API_KEY]));
  assert.throws(() => parseSetupArguments(["create", "--project", PROJECT, "--api-key", API_KEY, "--devices", "3"]));
  assert.throws(() => parseSetupArguments(["revoke", "--project", PROJECT, "--uid", "valid", "--output", "file"]));
  assert.throws(() => resolvePrivateOutput(process.cwd(), join(process.cwd(), "secret.json")));
  const folder = privateFolder();
  try {
    const output = join(folder.directory, "private.json");
    reservePrivateOutput(process.cwd(), output);
    assert.throws(() => reservePrivateOutput(process.cwd(), output));
    reservePrivateOutput(process.cwd(), output, true);
  } finally { folder.cleanup(); }
});
test("create writes private codes before account publication and creates only upload registries", async () => {
  const admin = owner();
  const folder = privateFolder();
  try {
    const output = join(folder.directory, "private.json");
    const original = admin.backend.createUser;
    admin.backend.createUser = async (value) => { assert.equal(readBundle(output).devices.length, 2); await original(value); };
    const saved = await runSetup(parseSetupArguments(["create", "--project", PROJECT, "--api-key", API_KEY, "--output", output]), admin.backend, process.cwd());
    assert.equal(saved, output);
    assert.equal(admin.users.size, 2);
    assert.equal(admin.registry.size, 2);
    assert.equal(admin.events.at(-1), "registry:atomic");
    for (const entry of admin.registry.values()) assert.deepEqual(Object.keys(entry).sort(), ["deviceId", "enabled", "generationId"]);
  } finally { folder.cleanup(); }
});
test("creation or publication failures roll back accounts and do not echo secrets", async () => {
  for (const failure of ["creation", "publication"]) {
    const admin = owner();
    const credentials = [generateCredentials(PROJECT, API_KEY), generateCredentials(PROJECT, API_KEY)];
    if (failure === "creation") admin.failCreation(2); else admin.failCommit();
    await assert.rejects(provision(admin.backend, credentials), (error: unknown) => {
      assert.ok(error instanceof Error);
      for (const value of credentials) assert.equal(error.message.includes(value.password), false);
      return true;
    });
    assert.equal(admin.users.size, 0);
    assert.equal(admin.registry.size, 0);
    assert.ok(admin.events.some((event) => event.startsWith("revoke:")));
  }
});
test("rotation switches registry authorization atomically while keeping generation and installation binding", async () => {
  const admin = owner();
  const old = generateCredentials(PROJECT, API_KEY);
  await provision(admin.backend, [old]);
  const folder = privateFolder();
  try {
    const output = join(folder.directory, "rotated.json");
    await runSetup(parseSetupArguments(["rotate", "--project", PROJECT, "--api-key", API_KEY, "--uid", old.uid, "--output", output]), admin.backend, process.cwd());
    const next = parseConnectionCode(readBundle(output).devices[0].connectionCode);
    assert.notEqual(next.uid, old.uid);
    assert.notEqual(next.password, old.password);
    assert.equal(next.deviceId, old.deviceId);
    assert.equal(next.generationId, old.generationId);
    assert.equal(admin.registry.get(old.uid)?.enabled, false);
    assert.equal(admin.registry.get(next.uid)?.enabled, true);
    assert.equal(admin.users.get(old.uid)?.disabled, true);
    assert.ok(admin.events.indexOf("registry:atomic", 3) < admin.events.indexOf(`disable:${old.uid}`));
  } finally { folder.cleanup(); }
});
test("phone replacement retains device identity and creates a new generation", async () => {
  const admin = owner();
  const old = generateCredentials(PROJECT, API_KEY);
  await provision(admin.backend, [old]);
  const folder = privateFolder();
  try {
    const output = join(folder.directory, "replacement.json");
    await runSetup(parseSetupArguments(["replace", "--project", PROJECT, "--api-key", API_KEY, "--uid", old.uid, "--output", output]), admin.backend, process.cwd());
    const next = parseConnectionCode(readBundle(output).devices[0].connectionCode);
    assert.equal(next.deviceId, old.deviceId);
    assert.notEqual(next.generationId, old.generationId);
    assert.equal(admin.registry.get(old.uid)?.enabled, false);
  } finally { folder.cleanup(); }
});
test("revocation disables rules authorization before disabling Auth", async () => {
  const admin = owner();
  const credentials = generateCredentials(PROJECT, API_KEY);
  await provision(admin.backend, [credentials]);
  await revoke(admin.backend, credentials.uid);
  assert.equal(admin.registry.get(credentials.uid)?.enabled, false);
  assert.equal(admin.users.get(credentials.uid)?.disabled, true);
  assert.ok(admin.events.indexOf(`revoke:${credentials.uid}`) < admin.events.indexOf(`disable:${credentials.uid}`));
});
test("old Auth cleanup failure leaves its registry revoked and the new credential usable", async () => {
  const admin = owner();
  const old = generateCredentials(PROJECT, API_KEY);
  await provision(admin.backend, [old]);
  const next = generateCredentials(PROJECT, API_KEY, old);
  admin.failDisable();
  await assert.rejects(provision(admin.backend, [next], { uid: old.uid, expected: admin.registry.get(old.uid)! }), /cutover completed/);
  assert.equal(admin.registry.get(old.uid)?.enabled, false);
  assert.equal(admin.registry.get(next.uid)?.enabled, true);
  assert.equal(admin.users.has(next.uid), true);
});

test("two enabled owner slots reject a third account and preserve existing access", async () => {
  const admin = owner();
  const first = generateCredentials(PROJECT, API_KEY);
  const second = generateCredentials(PROJECT, API_KEY);
  await provision(admin.backend, [first, second]);
  const third = generateCredentials(PROJECT, API_KEY);
  await assert.rejects(provision(admin.backend, [third]));
  assert.equal(admin.users.size, 2);
  assert.equal(admin.registry.get(first.uid)?.enabled, true);
  assert.equal(admin.registry.get(second.uid)?.enabled, true);
  assert.equal(admin.registry.has(third.uid), false);
  const rotated = generateCredentials(PROJECT, API_KEY, first);
  await provision(admin.backend, [rotated], { uid: first.uid, expected: admin.registry.get(first.uid)! });
  assert.equal([...admin.registry.values()].filter((value) => value.enabled).length, 2);
});
test("using a stale rotated UID cannot activate a second account for the same device", async () => {
  const admin = owner();
  const old = generateCredentials(PROJECT, API_KEY);
  await provision(admin.backend, [old]);
  const current = generateCredentials(PROJECT, API_KEY, old);
  await provision(admin.backend, [current], { uid: old.uid, expected: admin.registry.get(old.uid)! });
  const duplicate = generateCredentials(PROJECT, API_KEY, old);
  await assert.rejects(provision(admin.backend, [duplicate], { uid: old.uid, expected: admin.registry.get(old.uid)! }));
  assert.equal(admin.registry.get(current.uid)?.enabled, true);
  assert.equal(admin.registry.has(duplicate.uid), false);
});
