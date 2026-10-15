import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { buildOwnerAdc, exportOwnerAdc, loadFirebaseCliAdapter, main, parseOwnerAuthArguments, PINNED_FIREBASE_TOOLS, resolveOwnerOutput, type CliAccount, type OwnerCliAdapter } from "../scripts/firebaseOwnerAuth";

const PROJECT = "demo-workout-sync";
const ADC = { type: "authorized_user", client_id: "fixture.apps.googleusercontent.com", client_secret: "fixture-client-secret", refresh_token: "fixture-owner-refresh-secret" };
const ACCOUNT: CliAccount = { user: { email: "fixture@workout.invalid" }, tokens: { refresh_token: ADC.refresh_token } };
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "workout-owner-adc-"));
  const repo = join(directory, "repository");
  mkdirSync(repo);
  mkdirSync(join(repo, ".git"));
  const source = join(directory, "vendor-adc.json");
  const output = join(directory, "private", "owner-adc.json");
  writeFileSync(source, JSON.stringify(ADC));
  const adapter: OwnerCliAdapter = { getAccount: () => ACCOUNT, getCredentialPath: async () => source };
  return { directory, repo, source, output, adapter, cleanup: () => {
    assert.equal(resolve(dirname(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith("workout-owner-adc-"));
    rmSync(directory, { recursive: true, force: true });
  } };
}

test("owner login options default to a private home file and accept explicit quota project", () => {
  assert.deepEqual(parseOwnerAuthArguments([]), { output: join(homedir(), ".workout-sync", "firebase-owner-adc.json"), force: false });
  const args = ["--project", PROJECT, "--output", "private.json", "--force"];
  assert.deepEqual(parseOwnerAuthArguments(args), { projectId: PROJECT, output: "private.json", force: true });
  assert.equal(args.length, 5);
});
test("owner login options reject unknown duplicate missing and invalid arguments", () => {
  for (const args of [
    ["--password", "secret"], ["--project"], ["--project", "INVALID"],
    ["--output", "--force"], ["--force", "--force"], ["--output", "one", "--output", "two"],
  ]) assert.throws(() => parseOwnerAuthArguments(args));
});
test("the CLI adapter is pinned and fails closed when its private interface changes", async () => {
  const seen: unknown[] = [];
  const adapter = loadFirebaseCliAdapter((id) => {
    if (id.endsWith("package.json")) return { version: PINNED_FIREBASE_TOOLS };
    if (id.endsWith("auth.js")) return { getProjectDefaultAccount: (path: string) => { seen.push(path); return ACCOUNT; } };
    return { getCredentialPathAsync: async (account: CliAccount) => { seen.push(account); return "vendor-file"; } };
  });
  assert.equal(adapter.getAccount("repo"), ACCOUNT);
  assert.equal(await adapter.getCredentialPath(ACCOUNT), "vendor-file");
  assert.deepEqual(seen, ["repo", ACCOUNT]);
  assert.throws(() => loadFirebaseCliAdapter(() => ({ version: "99.0.0" })), /15\.33\.0/);
  assert.throws(() => loadFirebaseCliAdapter((id) => id.endsWith("package.json") ? { version: PINNED_FIREBASE_TOOLS } : {}), /unavailable/);
  assert.throws(() => loadFirebaseCliAdapter(() => { throw new Error(ADC.refresh_token); }), (error: unknown) => error instanceof Error && !error.message.includes(ADC.refresh_token));
});
test("standard user ADC is copied exactly with optional quota project and excludes other credential types", () => {
  assert.deepEqual(buildOwnerAdc(ADC), ADC);
  assert.deepEqual(buildOwnerAdc(ADC, PROJECT), { ...ADC, quota_project_id: PROJECT });
  assert.equal("quota_project_id" in ADC, false);
  assert.deepEqual(buildOwnerAdc({ ...ADC, quota_project_id: PROJECT }), { ...ADC, quota_project_id: PROJECT });
  for (const invalid of [null, [], { ...ADC, type: "service_account" }, { ...ADC, private_key: "never-copy" }, { ...ADC, refresh_token: "" }, { ...ADC, client_secret: {} }, { ...ADC, quota_project_id: "INVALID" }]) assert.throws(() => buildOwnerAdc(invalid));
});
test("an unsigned CLI fails clearly before generating credentials or writing output", async () => {
  const files = fixture();
  let generationCalls = 0;
  try {
    await assert.rejects(exportOwnerAdc({ output: files.output, force: false }, files.repo, {
      getAccount: () => undefined,
      getCredentialPath: async () => { generationCalls++; return files.source; },
    }), /npx firebase login/);
    assert.equal(generationCalls, 0);
    assert.equal(existsSync(files.output), false);
  } finally { files.cleanup(); }
});
test("vendor failures invalid JSON and oversized credentials are redacted without alternate login flows", async () => {
  const files = fixture();
  try {
    let calls = 0;
    await assert.rejects(exportOwnerAdc({ output: files.output, force: false }, files.repo, {
      getAccount: () => ACCOUNT,
      getCredentialPath: async () => { calls++; throw new Error(ADC.refresh_token); },
    }), (error: unknown) => error instanceof Error && !error.message.includes(ADC.refresh_token));
    assert.equal(calls, 1);
    writeFileSync(files.source, `${ADC.refresh_token} is invalid JSON`);
    await assert.rejects(exportOwnerAdc({ output: files.output, force: false }, files.repo, files.adapter), (error: unknown) => error instanceof Error && !error.message.includes(ADC.refresh_token));
    writeFileSync(files.source, "x".repeat(64 * 1024 + 1));
    await assert.rejects(exportOwnerAdc({ output: files.output, force: false }, files.repo, files.adapter), /oversized/);
    assert.equal(existsSync(files.output), false);
  } finally { files.cleanup(); }
});
test("owner export writes standard private ADC and prints only the final output path", async () => {
  const files = fixture();
  const printed: string[] = [];
  try {
    await main(["--project", PROJECT, "--output", files.output], files.adapter, (value) => printed.push(value));
    assert.deepEqual(JSON.parse(readFileSync(files.output, "utf8")), { ...ADC, quota_project_id: PROJECT });
    assert.deepEqual(printed, [`${files.output}\n`]);
    assert.equal(printed.join("").includes(ADC.refresh_token), false);
    if (process.platform !== "win32") assert.equal(statSync(files.output).mode & 0o777, 0o600);
    assert.equal(readFileSync(files.output).includes(13), false);
  } finally { files.cleanup(); }
});
test("owner ADC output is rejected inside this repository or another Git working tree", async () => {
  const files = fixture();
  try {
    assert.throws(() => resolveOwnerOutput(files.repo, join(files.repo, "owner-adc.json")));
    const other = join(files.directory, "other-repository");
    mkdirSync(other);
    writeFileSync(join(other, ".git"), "gitdir: placeholder\n");
    assert.throws(() => resolveOwnerOutput(files.repo, join(other, "owner-adc.json")), /Git/);
    assert.equal(existsSync(join(other, "owner-adc.json")), false);
  } finally { files.cleanup(); }
});
test("existing output requires force and invalid data cannot truncate a saved ADC or the vendor source", async () => {
  const files = fixture();
  try {
    await exportOwnerAdc({ output: files.output, force: false }, files.repo, files.adapter);
    const original = readFileSync(files.output, "utf8");
    await assert.rejects(exportOwnerAdc({ output: files.output, force: false }, files.repo, files.adapter), /--force/);
    writeFileSync(files.source, JSON.stringify({ ...ADC, type: "service_account" }));
    await assert.rejects(exportOwnerAdc({ output: files.output, force: true }, files.repo, files.adapter), /invalid/);
    assert.equal(readFileSync(files.output, "utf8"), original);
    writeFileSync(files.source, JSON.stringify(ADC));
    await assert.rejects(exportOwnerAdc({ output: files.source, force: true }, files.repo, files.adapter), /separate/);
    assert.deepEqual(JSON.parse(readFileSync(files.source, "utf8")), ADC);
    await exportOwnerAdc({ output: files.output, projectId: PROJECT, force: true }, files.repo, files.adapter);
    assert.equal(JSON.parse(readFileSync(files.output, "utf8")).quota_project_id, PROJECT);
  } finally { files.cleanup(); }
});
