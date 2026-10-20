import test from "node:test";
import assert from "node:assert/strict";
import {
  configureAutomaticServices, isAutomaticOwnerAction, parseAutomaticOwnerArguments, readFirestoreEnforcement, runAutomaticOwnerCommand,
  type AutomaticOwnerBackend, type OwnerInstallation,
} from "../scripts/firebaseAutomatic";

const PROJECT = "demo-workout-sync";
const APP_ID = "1:123456789:ios:fixture";
const TEAM_ID = "ABCDEFGHIJ";
const UID = "automatic-fixture";
const PROJECT_NUMBER = "123456789";
const SERVICE_NAME = `projects/${PROJECT_NUMBER}/services/firestore.googleapis.com`;
const installation: OwnerInstallation = {
  kind: "automatic", uid: UID, enabled: true,
  deviceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", generationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  installationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", phoneLabel: "iPhone 16 - AAAAAA", alias: null,
};
function owner() {
  const events: string[] = [];
  const entries = [structuredClone(installation), { ...installation, kind: "legacy" as const, uid: "legacy-fixture" }];
  const aliases = new Map<string, string>();
  let gate = false;
  let mode = "ENFORCED";
  let failCheck = false;
  let failDisable = false;
  const backend: AutomaticOwnerBackend = {
    configureAutomatic: async (appId, teamId) => { events.push(`configure:${appId}:${teamId}`); },
    firestoreEnforcement: async () => { events.push("check"); if (failCheck) throw new Error("private service response"); return mode; },
    setEnrollmentEnabled: async (enabled) => { events.push(`gate:${enabled}`); gate = enabled; },
    listInstallations: async () => entries.map((entry) => ({ ...entry, alias: aliases.get(`${entry.kind}:${entry.uid}`) ?? null })),
    setAlias: async (kind, uid, alias) => { events.push(`alias:${kind}:${uid}`); aliases.set(`${kind}:${uid}`, alias); },
    revokeAutomatic: async (uid) => { events.push(`revoke:${uid}`); const entry = entries.find((value) => value.kind === "automatic" && value.uid === uid); if (!entry) throw new Error("missing"); entry.enabled = false; },
    disableUser: async (uid) => { events.push(`disable:${uid}`); if (failDisable) throw new Error("private Auth response"); },
  };
  return { backend, events, entries, aliases, gate: () => gate, setMode: (value: string) => { mode = value; }, failCheck: () => { failCheck = true; }, failDisable: () => { failDisable = true; } };
}
const command = (action: string, ...args: string[]) => parseAutomaticOwnerArguments([action, "--project", PROJECT, ...args]);

test("automatic owner arguments stay separate from legacy create rotate replace and revoke", () => {
  for (const action of ["create", "rotate", "replace", "revoke", undefined]) assert.equal(isAutomaticOwnerAction(action), false);
  for (const action of ["list", "enable-automatic", "disable-automatic"]) {
    assert.equal(isAutomaticOwnerAction(action), true);
    assert.equal(command(action).action, action);
    assert.throws(() => command(action, "--uid", UID));
  }
  assert.equal(command("revoke-automatic", "--uid", UID).uid, UID);
  assert.deepEqual(command("alias", "--uid", UID, "--kind", "automatic", "--alias", "  Mathe's phone  "), {
    action: "alias", projectId: PROJECT, uid: UID, kind: "automatic", alias: "Mathe's phone",
  });
  for (const args of [
    ["list", "--project", "INVALID"], ["revoke-automatic", "--project", PROJECT],
    ["alias", "--project", PROJECT, "--uid", UID, "--alias", "Name"],
    ["alias", "--project", PROJECT, "--uid", UID, "--kind", "automatic", "--alias", "bad\nlabel"],
    ["list", "--project", PROJECT, "--project", PROJECT],
    ["enable-automatic", "--project", PROJECT, "--force"],
  ]) assert.throws(() => parseAutomaticOwnerArguments(args));
});

test("enable closes the enrollment gate and opens it only after confirmed Firestore App Check enforcement", async () => {
  const admin = owner();
  await runAutomaticOwnerCommand(command("enable-automatic"), admin.backend);
  assert.equal(admin.gate(), true);
  assert.deepEqual(admin.events, ["gate:false", "check", "gate:true"]);
  for (const mode of ["OFF", "UNENFORCED", "", "ENFORCEMENT_MODE_UNSPECIFIED"]) {
    admin.setMode(mode);
    await assert.rejects(runAutomaticOwnerCommand(command("enable-automatic"), admin.backend), /Enforce Firestore App Check/);
    assert.equal(admin.gate(), false);
  }
  admin.failCheck();
  await assert.rejects(runAutomaticOwnerCommand(command("enable-automatic"), admin.backend), /could not be verified/);
  assert.equal(admin.gate(), false);
  assert.equal(admin.entries[0].enabled, true);
});

test("disabling new enrollment requires no App Check request and preserves current installation access", async () => {
  const admin = owner();
  admin.failCheck();
  await runAutomaticOwnerCommand(command("disable-automatic"), admin.backend);
  assert.deepEqual(admin.events, ["gate:false"]);
  assert.equal(admin.entries[0].enabled, true);
});

test("automatic revocation retains the disabled binding before Auth cleanup and can be retried", async () => {
  const admin = owner();
  admin.failDisable();
  await assert.rejects(runAutomaticOwnerCommand(command("revoke-automatic", "--uid", UID), admin.backend), /access is revoked.*retry Auth cleanup/);
  assert.equal(admin.entries[0].enabled, false);
  assert.equal(admin.entries[0].installationId, installation.installationId);
  assert.deepEqual(admin.events, [`revoke:${UID}`, `disable:${UID}`]);
  await assert.rejects(runAutomaticOwnerCommand(command("revoke-automatic", "--uid", UID), admin.backend));
  assert.equal(admin.entries[0].enabled, false);
});

test("list includes automatic and legacy installations and aliases remain separate from bindings", async () => {
  const admin = owner();
  const before = structuredClone(admin.entries);
  await runAutomaticOwnerCommand(command("alias", "--uid", UID, "--kind", "automatic", "--alias", "Mathe"), admin.backend);
  await runAutomaticOwnerCommand(command("alias", "--uid", "legacy-fixture", "--kind", "legacy", "--alias", "Other phone"), admin.backend);
  assert.deepEqual(admin.entries, before);
  const result = JSON.parse(await runAutomaticOwnerCommand(command("list"), admin.backend));
  assert.deepEqual(result.installations.map((entry: OwnerInstallation) => [entry.kind, entry.alias]), [["automatic", "Mathe"], ["legacy", "Other phone"]]);
  assert.equal("password" in result.installations[0], false);
  assert.equal("refreshToken" in result.installations[0], false);
});

const credential = { getAccessToken: async () => ({ access_token: "test-owner-token", expires_in: 3600 }) };
function responses(values: { value?: unknown; status?: number; throws?: boolean }[]) {
  const requests: { url: string; init?: RequestInit }[] = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), init });
    const next = values.shift();
    if (!next || next.throws) throw new Error("private upstream response");
    return new Response(JSON.stringify(next.value), { status: next.status ?? 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { fetcher, requests };
}

test("enforcement verification uses official project-number resolution and exact Firestore service identity", async () => {
  const request = responses([
    { value: { projectId: PROJECT, projectNumber: PROJECT_NUMBER } },
    { value: { name: SERVICE_NAME, enforcementMode: "ENFORCED" } },
  ]);
  assert.equal(await readFirestoreEnforcement(PROJECT, credential, request.fetcher), "ENFORCED");
  assert.deepEqual(request.requests.map((item) => item.url), [
    `https://firebase.googleapis.com/v1beta1/projects/${PROJECT}`,
    `https://firebaseappcheck.googleapis.com/v1/${SERVICE_NAME}`,
  ]);
  for (const requestItem of request.requests) {
    assert.equal(requestItem.init?.method, "GET");
    assert.equal(requestItem.init?.redirect, "error");
    assert.equal(new Headers(requestItem.init?.headers).get("Authorization"), "Bearer test-owner-token");
    assert.ok(requestItem.init?.signal);
  }
});

test("enforcement verification fails closed on wrong project service unknown modes HTTP and network errors", async () => {
  const validProject = { value: { projectId: PROJECT, projectNumber: PROJECT_NUMBER } };
  for (const values of [
    [{ value: { projectId: "other-project", projectNumber: PROJECT_NUMBER } }],
    [{ value: { projectId: PROJECT, projectNumber: 123 } }],
    [validProject, { value: { name: "projects/999/services/firestore.googleapis.com", enforcementMode: "ENFORCED" } }],
    [validProject, { value: { name: `projects/${PROJECT_NUMBER}/services/identitytoolkit.googleapis.com`, enforcementMode: "ENFORCED" } }],
    [validProject, { value: { name: SERVICE_NAME, enforcementMode: "UNKNOWN" } }],
    [validProject, { value: { name: SERVICE_NAME } }],
    [validProject, { value: { name: SERVICE_NAME, enforcementMode: "ENFORCED" }, status: 403 }],
    [validProject, { throws: true }], [{ throws: true }],
  ]) {
    await assert.rejects(readFirestoreEnforcement(PROJECT, credential, responses([...values]).fetcher), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /could not be verified/);
      assert.equal(error.message.includes("private"), false);
      assert.equal(error.message.includes("test-owner-token"), false);
      return true;
    });
  }
});


test("configure arguments require an iOS app and Apple team without changing the enrollment gate", async () => {
  const options = command("configure-automatic", "--app-id", APP_ID, "--team-id", TEAM_ID);
  const admin = owner();
  const output = await runAutomaticOwnerCommand(options, admin.backend);
  assert.deepEqual(admin.events, [`configure:${APP_ID}:${TEAM_ID}`]);
  assert.equal(admin.gate(), false);
  assert.match(output, /Enforcement and enrollment were not changed/);
  for (const args of [
    ["configure-automatic"], ["configure-automatic", "--app-id", APP_ID],
    ["configure-automatic", "--app-id", "path/escape", "--team-id", TEAM_ID],
    ["configure-automatic", "--app-id", APP_ID, "--team-id", "bad"],
    ["list", "--app-id", APP_ID, "--team-id", TEAM_ID],
  ]) assert.throws(() => command(args[0], ...args.slice(1)));
});

function configurationResponses() {
  return [
    { value: { projectId: PROJECT, projectNumber: PROJECT_NUMBER } },
    { value: { projectId: PROJECT, appId: APP_ID } },
    { value: { projectId: PROJECT, appId: APP_ID, teamId: TEAM_ID } },
    { value: { name: `projects/${PROJECT_NUMBER}/apps/${APP_ID}/appAttestConfig`, tokenTtl: "3600s" } },
    { value: { signIn: { anonymous: { enabled: true }, email: { enabled: true } }, autodeleteAnonymousUsers: false } },
  ];
}

test("configure uses narrow official patches preserving password sign-in and never enables enforcement or enrollment", async () => {
  const request = responses(configurationResponses());
  await configureAutomaticServices(PROJECT, APP_ID, TEAM_ID, credential, request.fetcher);
  const calls = request.requests;
  assert.deepEqual(calls.map((call) => call.init?.method), ["GET", "GET", "PATCH", "PATCH", "PATCH"]);
  assert.equal(calls[2].url, `https://firebase.googleapis.com/v1beta1/projects/${PROJECT}/iosApps/${encodeURIComponent(APP_ID)}?updateMask=teamId`);
  assert.deepEqual(JSON.parse(calls[2].init?.body as string), { teamId: TEAM_ID });
  assert.equal(calls[3].url, `https://firebaseappcheck.googleapis.com/v1/projects/${PROJECT_NUMBER}/apps/${encodeURIComponent(APP_ID)}/appAttestConfig?updateMask=tokenTtl`);
  assert.deepEqual(JSON.parse(calls[3].init?.body as string), { name: `projects/${PROJECT_NUMBER}/apps/${APP_ID}/appAttestConfig`, tokenTtl: "3600s" });
  assert.equal(calls[4].url, `https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT}/config?updateMask=signIn.anonymous.enabled,autodeleteAnonymousUsers`);
  assert.deepEqual(JSON.parse(calls[4].init?.body as string), { signIn: { anonymous: { enabled: true } }, autodeleteAnonymousUsers: false });
  for (const call of calls) {
    assert.equal(call.url.includes("/services/"), false);
    assert.equal(call.url.includes("firestore.googleapis.com"), false);
    assert.equal(call.url.includes("uploadControl"), false);
  }
});

test("configure stops on wrong app identity or partial API failure without leaking service responses", async () => {
  const wrongApp = responses([
    { value: { projectId: PROJECT, projectNumber: PROJECT_NUMBER } },
    { value: { projectId: PROJECT, appId: "other-app" } },
  ]);
  await assert.rejects(configureAutomaticServices(PROJECT, APP_ID, TEAM_ID, credential, wrongApp.fetcher), /did not complete/);
  assert.deepEqual(wrongApp.requests.map((call) => call.init?.method), ["GET", "GET"]);
  for (let failed = 0; failed < 5; failed++) {
    const values: { value?: unknown; status?: number; throws?: boolean }[] = configurationResponses();
    values[failed] = { throws: true };
    const request = responses(values);
    await assert.rejects(configureAutomaticServices(PROJECT, APP_ID, TEAM_ID, credential, request.fetcher), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /did not complete/);
      assert.equal(error.message.includes("private"), false);
      assert.equal(error.message.includes("test-owner-token"), false);
      return true;
    });
    assert.equal(request.requests.length, failed + 1);
  }
});
