import { chmodSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { reservePrivateOutput, resolvePrivateOutput } from "./firebaseSetup";

export const PINNED_FIREBASE_TOOLS = "15.33.0";
const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const MAX_ADC_BYTES = 64 * 1024;
class OwnerAuthError extends Error {}
export interface CliAccount {
  user: Record<string, unknown>;
  tokens: Record<string, unknown>;
}
export interface OwnerCliAdapter {
  getAccount(repoRoot: string): CliAccount | undefined;
  getCredentialPath(account: CliAccount): Promise<string | undefined>;
}
export type OwnerAdc = {
  type: "authorized_user";
  client_id: string;
  client_secret: string;
  refresh_token: string;
  quota_project_id?: string;
};
export type OwnerAuthOptions = { projectId?: string; output: string; force: boolean };
type ModuleLoader = (id: string) => unknown;
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function loadFirebaseCliAdapter(load: ModuleLoader = createRequire(import.meta.url)): OwnerCliAdapter {
  try {
    const packageInfo = load("firebase-tools/package.json");
    if (!object(packageInfo) || packageInfo.version !== PINNED_FIREBASE_TOOLS) {
      throw new OwnerAuthError("Owner ADC helper requires firebase-tools 15.33.0 check compatibility before upgrading");
    }
    const auth = load("firebase-tools/lib/auth.js");
    const credentials = load("firebase-tools/lib/defaultCredentials.js");
    if (!object(auth) || typeof auth.getProjectDefaultAccount !== "function" ||
        !object(credentials) || typeof credentials.getCredentialPathAsync !== "function") {
      throw new OwnerAuthError("Pinned Firebase CLI credential adapter is unavailable run npm ci and check its version");
    }
    const accountModule = auth as { getProjectDefaultAccount(repoRoot: string): CliAccount | undefined };
    const credentialModule = credentials as { getCredentialPathAsync(account: CliAccount): Promise<string | undefined> };
    return {
      getAccount: (repoRoot) => accountModule.getProjectDefaultAccount(repoRoot),
      getCredentialPath: (account) => credentialModule.getCredentialPathAsync(account),
    };
  } catch (error) {
    if (error instanceof OwnerAuthError) throw error;
    throw new OwnerAuthError("Pinned Firebase CLI credential adapter is unavailable run npm ci and check its version");
  }
}
function project(value: string | undefined) {
  if (value !== undefined && !PROJECT_ID.test(value)) throw new OwnerAuthError("Provide a valid public Firebase project ID");
}
export function parseOwnerAuthArguments(args: string[]): OwnerAuthOptions {
  const options: OwnerAuthOptions = { output: join(homedir(), ".workout-sync", "firebase-owner-adc.json"), force: false };
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index++) {
    const option = args[index];
    if (seen.has(option)) throw new OwnerAuthError("Provide each owner login option once");
    seen.add(option);
    if (option === "--force") { options.force = true; continue; }
    if (option !== "--project" && option !== "--output") throw new OwnerAuthError("Use only --project --output and optional --force");
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new OwnerAuthError("An owner login option is missing its value");
    if (option === "--project") options.projectId = value;
    else options.output = value;
  }
  project(options.projectId);
  return options;
}
export function buildOwnerAdc(value: unknown, projectId?: string): OwnerAdc {
  project(projectId);
  if (!object(value) || value.type !== "authorized_user" ||
      Object.keys(value).some((key) => !["type", "client_id", "client_secret", "refresh_token", "quota_project_id"].includes(key)) ||
      !["client_id", "client_secret", "refresh_token"].every((key) =>
        typeof value[key] === "string" && value[key].length > 0 && value[key].length <= 32768)) {
    throw new OwnerAuthError("Firebase CLI returned invalid owner ADC sign in again with npx firebase login");
  }
  const adc: OwnerAdc = {
    type: "authorized_user", client_id: value.client_id as string,
    client_secret: value.client_secret as string, refresh_token: value.refresh_token as string,
  };
  const quota = projectId ?? value.quota_project_id;
  if (quota !== undefined) {
    if (typeof quota !== "string") throw new OwnerAuthError("Firebase CLI returned an invalid quota project");
    project(quota);
    adc.quota_project_id = quota;
  }
  return adc;
}
export function resolveOwnerOutput(repoRoot: string, requested: string) {
  const destination = resolvePrivateOutput(repoRoot, requested);
  let directory = dirname(destination);
  while (true) {
    if (existsSync(join(directory, ".git"))) throw new OwnerAuthError("Save owner ADC outside every Git working tree");
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return destination;
}
export async function exportOwnerAdc(options: OwnerAuthOptions, repoRoot: string, adapter: OwnerCliAdapter): Promise<string> {
  try {
    project(options.projectId);
    const destination = resolveOwnerOutput(repoRoot, options.output);
    if (existsSync(destination) && !options.force) throw new OwnerAuthError("Private owner ADC already exists use --force only to replace it deliberately");
    const account = adapter.getAccount(repoRoot);
    if (!account) throw new OwnerAuthError("Sign in as the owner with npx firebase login before creating owner ADC");
    const source = await adapter.getCredentialPath(account);
    if (!source) throw new OwnerAuthError("Firebase CLI has no owner ADC sign in again with npx firebase login");
    if (resolve(source) === destination) throw new OwnerAuthError("Choose a separate private output file for owner ADC");
    if (statSync(source).size > MAX_ADC_BYTES) throw new OwnerAuthError("Firebase CLI returned an oversized owner ADC file");
    const adc = buildOwnerAdc(JSON.parse(readFileSync(source, "utf8").replace(/^\uFEFF/, "")), options.projectId);
    const output = reservePrivateOutput(repoRoot, destination, options.force);
    if (process.platform !== "win32") chmodSync(output, 0o600);
    writeFileSync(output, `${JSON.stringify(adc, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    return output;
  } catch (error) {
    if (error instanceof OwnerAuthError) throw error;
    throw new OwnerAuthError("Owner ADC export failed check Firebase CLI login and the private output folder");
  }
}
export async function main(args = process.argv.slice(2), adapter?: OwnerCliAdapter, writeOutput: (value: string) => unknown = (value) => process.stdout.write(value)) {
  const options = parseOwnerAuthArguments(args);
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const output = await exportOwnerAdc(options, repoRoot, adapter ?? loadFirebaseCliAdapter());
  writeOutput(`${output}\n`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof OwnerAuthError ? error.message : "Owner ADC export failed check the pinned Firebase CLI and private folder"}\n`);
    process.exitCode = 1;
  });
}
