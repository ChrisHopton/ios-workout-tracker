import { randomBytes, randomUUID } from "node:crypto";
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateCredentials, type LegacySyncCredentials } from "../src/sync/protocol";
import { createAutomaticOwnerBackend, isAutomaticOwnerAction, OwnerManagementError, parseAutomaticOwnerArguments, runAutomaticOwnerCommand } from "./firebaseAutomatic";

export type Authorization = { enabled: boolean; deviceId: string; generationId: string };
export type PrivateDevice = { uid: string; deviceId: string; generationId: string; email: string; connectionCode: string };
export type PrivateSetup = { version: 1; createdAt: string; projectId: string; devices: PrivateDevice[] };
export interface OwnerBackend {
  createUser(credentials: LegacySyncCredentials): Promise<void>;
  deleteUser(uid: string): Promise<void>;
  disableUser(uid: string): Promise<void>;
  getAuthorization(uid: string): Promise<Authorization | null>;
  publish(credentials: LegacySyncCredentials[], previous?: { uid: string; expected: Authorization }): Promise<void>;
  revoke(uid: string): Promise<void>;
}
const PROJECT = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const API_KEY = /^[A-Za-z0-9_-]{20,128}$/;
const UID = /^[A-Za-z0-9_-]{1,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function validateProject(projectId: string, apiKey?: string) {
  if (!PROJECT.test(projectId) || (apiKey !== undefined && !API_KEY.test(apiKey))) {
    throw new Error("Provide a valid Firebase project ID and public web API key");
  }
}
export function generateCredentials(projectId: string, apiKey: string, identity?: { deviceId: string; generationId: string }): LegacySyncCredentials {
  validateProject(projectId, apiKey);
  if (identity && (!UUID.test(identity.deviceId) || !UUID.test(identity.generationId))) throw new Error("Invalid device or generation ID");
  const uid = randomUUID();
  return {
    version: 1, projectId, apiKey,
    deviceId: identity?.deviceId ?? randomUUID(),
    generationId: identity?.generationId ?? randomUUID(),
    uid, email: `phone-${uid}@workout.invalid`, password: randomBytes(32).toString("base64url"),
  };
}
export function setupBundle(credentials: LegacySyncCredentials[]): PrivateSetup {
  credentials = credentials.map((value) => {
    const checked = validateCredentials(value);
    if (checked.version !== 1) throw new Error("Legacy account setup requires password credentials");
    return checked;
  });
  if (!credentials.length || credentials.length > 2 || credentials.some((value) => value.projectId !== credentials[0].projectId)) {
    throw new Error("Generate one or two devices in one project");
  }
  return {
    version: 1, createdAt: new Date().toISOString(), projectId: credentials[0].projectId,
    devices: credentials.map((value) => ({
      uid: value.uid, deviceId: value.deviceId, generationId: value.generationId, email: value.email,
      connectionCode: `WORKOUTFB1.${Buffer.from(JSON.stringify(value), "utf8").toString("base64url")}`,
    })),
  };
}
function isWithin(root: string, candidate: string) {
  const child = relative(root, candidate);
  return child === "" || (!child.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && child !== ".." && !isAbsolute(child));
}
export function resolvePrivateOutput(repoRoot: string, requested: string) {
  const destination = resolve(requested);
  let ancestor = destination;
  const missing: string[] = [];
  while (!existsSync(ancestor)) {
    missing.unshift(basename(ancestor));
    const parent = dirname(ancestor);
    if (parent === ancestor) throw new Error("Choose an existing output drive");
    ancestor = parent;
  }
  const canonical = join(realpathSync(ancestor), ...missing);
  if (isWithin(realpathSync(repoRoot), canonical) || isWithin(resolve(repoRoot), destination)) {
    throw new Error("Save private connection codes outside the repository");
  }
  if (existsSync(destination) && lstatSync(destination).isSymbolicLink()) throw new Error("Choose a regular private output file");
  return canonical;
}
export function reservePrivateOutput(repoRoot: string, requested: string, force = false) {
  const output = resolvePrivateOutput(repoRoot, requested);
  mkdirSync(dirname(output), { recursive: true });
  const descriptor = openSync(output, force ? "w" : "wx", 0o600);
  closeSync(descriptor);
  return output;
}
export function savePrivateSetup(output: string, bundle: PrivateSetup) {
  writeFileSync(output, `${JSON.stringify(bundle, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}
export async function provision(backend: OwnerBackend, credentials: LegacySyncCredentials[], previous?: { uid: string; expected: Authorization }) {
  const created: string[] = [];
  try {
    for (const credential of credentials) {
      created.push(credential.uid);
      await backend.createUser(credential);
    }
    await backend.publish(credentials, previous);
  } catch {
    for (const uid of created) {
      try { await backend.revoke(uid); } catch {}
      try { await backend.deleteUser(uid); } catch { try { await backend.disableUser(uid); } catch {} }
    }
    throw new Error("Account setup did not complete check the owner console before retrying");
  }
  if (previous) {
    try { await backend.disableUser(previous.uid); }
    catch { throw new Error("Registry cutover completed but old account cleanup needs a revoke retry"); }
  }
}
export async function revoke(backend: OwnerBackend, uid: string) {
  if (!UID.test(uid)) throw new Error("Provide a valid account UID");
  await backend.revoke(uid);
  await backend.disableUser(uid);
}
export type SetupArguments = { action: "create" | "rotate" | "replace" | "revoke"; projectId: string; apiKey?: string; uid?: string; devices: 1 | 2; output?: string; force: boolean };
export function parseSetupArguments(args: string[]): SetupArguments {
  args = [...args];
  const action = args[0] && !args[0].startsWith("--") ? args.shift()! : "create";
  if (!["create", "rotate", "replace", "revoke"].includes(action)) throw new Error("Choose create rotate replace or revoke");
  const options: SetupArguments = { action: action as SetupArguments["action"], projectId: "", devices: 2, force: false };
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index++) {
    const option = args[index];
    if (seen.has(option)) throw new Error("Provide each option once");
    seen.add(option);
    if (option === "--force") { options.force = true; continue; }
    if (!["--project", "--api-key", "--uid", "--devices", "--output"].includes(option)) throw new Error("Unknown setup option");
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new Error("A setup option is missing its value");
    if (option === "--project") options.projectId = value;
    if (option === "--api-key") options.apiKey = value;
    if (option === "--uid") options.uid = value;
    if (option === "--output") options.output = value;
    if (option === "--devices") {
      if (value !== "1" && value !== "2") throw new Error("Choose one or two devices");
      options.devices = Number(value) as 1 | 2;
    }
  }
  validateProject(options.projectId, options.apiKey);
  if (options.action !== "revoke" && !options.apiKey) throw new Error("Provide the public web API key");
  if (options.action !== "create" && (!options.uid || !UID.test(options.uid))) throw new Error("Provide the existing account UID");
  if (options.action === "create" && options.uid) throw new Error("Create generates new account UIDs");
  if (options.action !== "create" && seen.has("--devices")) throw new Error("Only create accepts --devices");
  if (options.action === "revoke" && (options.output || options.force)) throw new Error("Revoke does not create a private file");
  return options;
}
async function ownerBackend(projectId: string) {
  const { applicationDefault, deleteApp, initializeApp } = await import("firebase-admin/app");
  const { getAuth } = await import("firebase-admin/auth");
  const { getFirestore } = await import("firebase-admin/firestore");
  const app = initializeApp({ credential: applicationDefault(), projectId }, `workout-owner-${randomUUID()}`);
  const auth = getAuth(app);
  const store = getFirestore(app);
  const reference = (uid: string) => store.collection("uploadAuthorizations").doc(uid);
  const backend: OwnerBackend = {
    createUser: async (value) => { await auth.createUser({ uid: value.uid, email: value.email, password: value.password }); },
    deleteUser: async (uid) => { await auth.deleteUser(uid); },
    disableUser: async (uid) => { await auth.updateUser(uid, { disabled: true }); await auth.revokeRefreshTokens(uid); },
    getAuthorization: async (uid) => {
      const value = await reference(uid).get();
      if (!value.exists) return null;
      const data = value.data();
      if (!data || typeof data.enabled !== "boolean" || !UUID.test(data.deviceId) || !UUID.test(data.generationId)) throw new Error("Invalid authorization");
      return { enabled: data.enabled, deviceId: data.deviceId, generationId: data.generationId };
    },
    publish: async (credentials, previous) => {
      await store.runTransaction(async (transaction) => {
        const active = await transaction.get(store.collection("uploadAuthorizations").where("enabled", "==", true));
        const retained = active.docs.filter((document) => document.id !== previous?.uid);
        if (retained.some((document) => credentials.some((value) => value.deviceId === document.data().deviceId))) throw new Error("Use the current account UID for this device");
        if (retained.length + credentials.length > 2) throw new Error("Two device accounts are already enabled");
        if (previous) {
          const existing = await transaction.get(reference(previous.uid));
          const data = existing.data();
          if (!data || data.deviceId !== previous.expected.deviceId || data.generationId !== previous.expected.generationId || data.enabled !== previous.expected.enabled) {
            throw new Error("Authorization changed retry owner setup");
          }
        }
        for (const value of credentials) transaction.create(reference(value.uid), { enabled: true, deviceId: value.deviceId, generationId: value.generationId });
        if (previous) transaction.update(reference(previous.uid), { enabled: false });
      });
    },
    revoke: async (uid) => { await reference(uid).update({ enabled: false }); },
  };
  return { backend, close: () => deleteApp(app) };
}
export async function runSetup(options: SetupArguments, backend: OwnerBackend, repoRoot: string) {
  if (options.action === "revoke") { await revoke(backend, options.uid!); return null; }
  let previous: { uid: string; expected: Authorization } | undefined;
  let identity: { deviceId: string; generationId: string } | undefined;
  if (options.action === "rotate" || options.action === "replace") {
    const expected = await backend.getAuthorization(options.uid!);
    if (!expected) throw new Error("The existing authorization was not found");
    previous = { uid: options.uid!, expected };
    identity = { deviceId: expected.deviceId, generationId: options.action === "replace" ? randomUUID() : expected.generationId };
  }
  const credentials = Array.from({ length: options.action === "create" ? options.devices : 1 }, () => generateCredentials(options.projectId, options.apiKey!, identity));
  const requested = options.output ?? join(homedir(), ".workout-sync", `firebase-${Date.now()}-${randomBytes(4).toString("hex")}.json`);
  const output = reservePrivateOutput(repoRoot, requested, options.force);
  savePrivateSetup(output, setupBundle(credentials));
  await provision(backend, credentials, previous);
  return output;
}
export async function main(args = process.argv.slice(2)) {
  if (isAutomaticOwnerAction(args[0])) {
    const options = parseAutomaticOwnerArguments(args);
    const owner = await createAutomaticOwnerBackend(options.projectId);
    try { process.stdout.write(await runAutomaticOwnerCommand(options, owner.backend)); }
    finally { await owner.close(); }
    return;
  }
  const options = parseSetupArguments([...args]);
  const owner = await ownerBackend(options.projectId);
  try {
    const output = await runSetup(options, owner.backend, resolve(dirname(fileURLToPath(import.meta.url)), ".."));
    process.stdout.write(output ? `Private connection file saved to ${output}\n` : "Device access revoked\n");
  } finally { await owner.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    process.stderr.write(error instanceof OwnerManagementError ? `${error.message}\n` : "Owner setup did not complete inspect the local private file and Firebase console before retrying\n");
    process.exitCode = 1;
  });
}
