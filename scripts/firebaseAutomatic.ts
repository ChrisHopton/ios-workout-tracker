import { randomUUID } from "node:crypto";
import type { Credential } from "firebase-admin/app";

export type InstallationKind = "automatic" | "legacy";
export interface OwnerInstallation {
  kind: InstallationKind;
  uid: string;
  deviceId: string;
  generationId: string;
  installationId: string | null;
  enabled: boolean;
  phoneLabel: string | null;
  alias: string | null;
}
export interface AutomaticOwnerBackend {
  firestoreEnforcement(): Promise<string>;
  configureAutomatic(appId: string, teamId: string): Promise<void>;
  setEnrollmentEnabled(enabled: boolean): Promise<void>;
  listInstallations(): Promise<OwnerInstallation[]>;
  setAlias(kind: InstallationKind, uid: string, alias: string): Promise<void>;
  revokeAutomatic(uid: string): Promise<void>;
  disableUser(uid: string): Promise<void>;
}
export class OwnerManagementError extends Error {}
export type AutomaticOwnerArguments = {
  action: "list" | "alias" | "revoke-automatic" | "enable-automatic" | "disable-automatic" | "configure-automatic";
  projectId: string;
  uid?: string;
  kind?: InstallationKind;
  alias?: string;
  appId?: string;
  teamId?: string;
};
const ACTIONS = ["list", "alias", "revoke-automatic", "enable-automatic", "disable-automatic", "configure-automatic"] as const;
const PROJECT = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const APP_ID = /^[A-Za-z0-9:._-]{1,200}$/;
const TEAM_ID = /^[A-Z0-9]{10}$/;
const UID = /^[A-Za-z0-9_-]{1,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const AUTOMATIC_ENROLLMENT_CONTROL = "uploadControl/automaticEnrollment";

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function checkedAlias(value: string): string {
  const alias = value.trim();
  if (!alias || alias.length > 80 || /[\u0000-\u001f\u007f]/.test(alias)) {
    throw new OwnerManagementError("Provide an alias of 1 to 80 characters without control characters");
  }
  return alias;
}
export function isAutomaticOwnerAction(action: string | undefined): boolean {
  return ACTIONS.some((candidate) => candidate === action);
}
export function parseAutomaticOwnerArguments(args: string[]): AutomaticOwnerArguments {
  if (!isAutomaticOwnerAction(args[0])) throw new OwnerManagementError("Unknown installation management action");
  const options: AutomaticOwnerArguments = { action: args[0] as AutomaticOwnerArguments["action"], projectId: "" };
  const seen = new Set<string>();
  for (let index = 1; index < args.length; index++) {
    const option = args[index];
    if (seen.has(option) || !["--project", "--uid", "--kind", "--alias", "--app-id", "--team-id"].includes(option)) {
      throw new OwnerManagementError("Provide each supported installation option once");
    }
    seen.add(option);
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new OwnerManagementError("An installation option is missing its value");
    if (option === "--project") options.projectId = value;
    if (option === "--uid") options.uid = value;
    if (option === "--app-id") options.appId = value;
    if (option === "--team-id") options.teamId = value;
    if (option === "--kind") {
      if (value !== "automatic" && value !== "legacy") throw new OwnerManagementError("Choose automatic or legacy installation kind");
      options.kind = value;
    }
    if (option === "--alias") options.alias = checkedAlias(value);
  }
  if (!PROJECT.test(options.projectId)) throw new OwnerManagementError("Provide a valid Firebase project ID");
  const needsUid = options.action === "alias" || options.action === "revoke-automatic";
  if (needsUid ? !options.uid || !UID.test(options.uid) : options.uid !== undefined) {
    throw new OwnerManagementError("Provide an account UID only for alias or revoke-automatic");
  }
  if (options.action === "alias") {
    if (!options.kind || !options.alias) throw new OwnerManagementError("Alias requires --kind and --alias");
  } else if (options.kind || options.alias) {
    throw new OwnerManagementError("Only alias accepts --kind and --alias");
  }
  if (options.action === "configure-automatic") {
    if (!options.appId || !APP_ID.test(options.appId) || !options.teamId || !TEAM_ID.test(options.teamId)) {
      throw new OwnerManagementError("Configure requires a valid --app-id and Apple --team-id");
    }
  } else if (options.appId || options.teamId) throw new OwnerManagementError("Only configure-automatic accepts --app-id and --team-id");
  return options;
}

// API errors are sanitized by each public operation; owner tokens and response bodies never reach CLI output.
async function ownerApi(credential: Pick<Credential, "getAccessToken">, fetcher: typeof fetch) {
  const token = await credential.getAccessToken();
  if (typeof token.access_token !== "string" || !/^[!-~]{1,16384}$/.test(token.access_token)) throw new Error();
  return async (url: string, body?: unknown): Promise<unknown> => {
    const response = await fetcher(url, {
      method: body === undefined ? "GET" : "PATCH", redirect: "error", signal: AbortSignal.timeout(20_000),
      headers: { Authorization: `Bearer ${token.access_token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error();
    return response.json();
  };
}
async function projectNumber(projectId: string, request: Awaited<ReturnType<typeof ownerApi>>): Promise<string> {
  const project = await request(`https://firebase.googleapis.com/v1beta1/projects/${projectId}`);
  if (!object(project) || project.projectId !== projectId || typeof project.projectNumber !== "string" || !/^[0-9]+$/.test(project.projectNumber)) throw new Error();
  return project.projectNumber;
}
export async function readFirestoreEnforcement(
  projectId: string,
  credential: Pick<Credential, "getAccessToken">,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<string> {
  if (!PROJECT.test(projectId)) throw new OwnerManagementError("Provide a valid Firebase project ID");
  try {
    const request = await ownerApi(credential, fetcher);
    const number = await projectNumber(projectId, request);
    const name = `projects/${number}/services/firestore.googleapis.com`;
    const service = await request(`https://firebaseappcheck.googleapis.com/v1/${name}`);
    if (!object(service) || service.name !== name || typeof service.enforcementMode !== "string" ||
      !["ENFORCED", "UNENFORCED", "OFF"].includes(service.enforcementMode)) throw new Error();
    return service.enforcementMode;
  } catch {
    throw new OwnerManagementError("Firestore App Check enforcement could not be verified; automatic enrollment was not enabled");
  }
}
export async function configureAutomaticServices(
  projectId: string,
  appId: string,
  teamId: string,
  credential: Pick<Credential, "getAccessToken">,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<void> {
  if (!PROJECT.test(projectId) || !APP_ID.test(appId) || !TEAM_ID.test(teamId)) {
    throw new OwnerManagementError("Provide valid project, iOS app, and Apple team identifiers");
  }
  try {
    const request = await ownerApi(credential, fetcher);
    const number = await projectNumber(projectId, request);
    const appUrl = `https://firebase.googleapis.com/v1beta1/projects/${projectId}/iosApps/${encodeURIComponent(appId)}`;
    const app = await request(appUrl);
    if (!object(app) || app.appId !== appId || app.projectId !== projectId) throw new Error();
    const updatedApp = await request(appUrl + "?updateMask=teamId", { teamId });
    if (!object(updatedApp) || updatedApp.appId !== appId || updatedApp.projectId !== projectId || updatedApp.teamId !== teamId) throw new Error();
    const name = `projects/${number}/apps/${appId}/appAttestConfig`;
    const config = await request(`https://firebaseappcheck.googleapis.com/v1/projects/${number}/apps/${encodeURIComponent(appId)}/appAttestConfig?updateMask=tokenTtl`, { name, tokenTtl: "3600s" });
    if (!object(config) || config.name !== name || config.tokenTtl !== "3600s") throw new Error();
    const auth = await request(`https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/config?updateMask=signIn.anonymous.enabled,autodeleteAnonymousUsers`, {
      signIn: { anonymous: { enabled: true } }, autodeleteAnonymousUsers: false,
    });
    if (!object(auth) || !object(auth.signIn) || !object(auth.signIn.anonymous) || auth.signIn.anonymous.enabled !== true ||
      (auth.autodeleteAnonymousUsers !== undefined && auth.autodeleteAnonymousUsers !== false)) throw new Error();
  } catch {
    throw new OwnerManagementError("Automatic service configuration did not complete; inspect the owner console and retry. Enforcement and enrollment were not enabled");
  }
}

export async function runAutomaticOwnerCommand(options: AutomaticOwnerArguments, backend: AutomaticOwnerBackend): Promise<string> {
  if (options.action === "configure-automatic") {
    if (!options.appId || !APP_ID.test(options.appId) || !options.teamId || !TEAM_ID.test(options.teamId)) throw new OwnerManagementError("Provide valid iOS app and Apple team identifiers");
    await backend.configureAutomatic(options.appId, options.teamId);
    return "App Attest configured and anonymous sign-in enabled; password sign-in preserved. Enforcement and enrollment were not changed\n";
  }
  if (options.action === "list") {
    return `${JSON.stringify({ installations: await backend.listInstallations() }, null, 2)}\n`;
  }
  if (options.action === "enable-automatic") {
    await backend.setEnrollmentEnabled(false);
    let mode: string;
    try { mode = await backend.firestoreEnforcement(); }
    catch { throw new OwnerManagementError("Firestore App Check enforcement could not be verified; automatic enrollment was not enabled"); }
    if (mode !== "ENFORCED") throw new OwnerManagementError("Enforce Firestore App Check before enabling automatic enrollment");
    await backend.setEnrollmentEnabled(true);
    return "Automatic enrollment enabled after verifying Firestore App Check enforcement\n";
  }
  if (options.action === "disable-automatic") {
    await backend.setEnrollmentEnabled(false);
    return "New automatic enrollment disabled; existing uploads remain enabled\n";
  }
  if (options.action === "alias") {
    if (!options.uid || !UID.test(options.uid) || !options.kind || !["legacy", "automatic"].includes(options.kind) || !options.alias) {
      throw new OwnerManagementError("Provide the installation kind, UID, and alias");
    }
    await backend.setAlias(options.kind, options.uid, checkedAlias(options.alias));
    return "Owner-only installation alias saved\n";
  }
  if (options.action !== "revoke-automatic" || !options.uid || !UID.test(options.uid)) throw new OwnerManagementError("Provide a valid automatic account UID");
  await backend.revokeAutomatic(options.uid);
  try { await backend.disableUser(options.uid); }
  catch { throw new OwnerManagementError("Automatic upload access is revoked; repeat revoke-automatic to retry Auth cleanup"); }
  return "Automatic upload access revoked; existing records and disabled binding retained\n";
}

function identity(data: unknown, automatic: boolean) {
  if (!object(data) || typeof data.enabled !== "boolean" || typeof data.deviceId !== "string" || !UUID.test(data.deviceId) ||
    typeof data.generationId !== "string" || !UUID.test(data.generationId) ||
    (automatic && (data.schemaVersion !== 2 || typeof data.installationId !== "string" || !UUID.test(data.installationId)))) {
    throw new OwnerManagementError("An installation contains invalid authorization metadata");
  }
  return { enabled: data.enabled, deviceId: data.deviceId, generationId: data.generationId,
    installationId: automatic ? data.installationId as string : null };
}
function label(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 80 && !/[\u0000-\u001f\u007f]/.test(value) ? value : null;
}

export async function createAutomaticOwnerBackend(projectId: string) {
  if (!PROJECT.test(projectId)) throw new OwnerManagementError("Provide a valid Firebase project ID");
  const { applicationDefault, deleteApp, initializeApp } = await import("firebase-admin/app");
  const { getAuth } = await import("firebase-admin/auth");
  const { getFirestore } = await import("firebase-admin/firestore");
  const credential = applicationDefault();
  const app = initializeApp({ credential, projectId }, `workout-installations-${randomUUID()}`);
  const auth = getAuth(app);
  const store = getFirestore(app);
  const root = (kind: InstallationKind, uid: string) => store.collection(kind === "automatic" ? "automaticUploads" : "uploadAuthorizations").doc(uid);
  const metadata = (kind: InstallationKind, uid: string) => store.collection("uploadOwnerMetadata").doc(`${kind}:${uid}`);
  const backend: AutomaticOwnerBackend = {
    firestoreEnforcement: () => readFirestoreEnforcement(projectId, credential),
    configureAutomatic: (appId, teamId) => configureAutomaticServices(projectId, appId, teamId, credential),
    setEnrollmentEnabled: async (enabled) => { await store.doc(AUTOMATIC_ENROLLMENT_CONTROL).set({ enabled }); },
    listInstallations: async () => {
      const snapshots = await Promise.all([store.collection("automaticUploads").get(), store.collection("uploadAuthorizations").get()]);
      const installations: OwnerInstallation[] = [];
      for (const [index, snapshot] of snapshots.entries()) {
        const kind: InstallationKind = index === 0 ? "automatic" : "legacy";
        for (const document of snapshot.docs) {
          if (!UID.test(document.id)) throw new OwnerManagementError("An installation contains an invalid account UID");
          const data = identity(document.data(), kind === "automatic");
          const recordRoot = kind === "automatic" ? document.ref : store.doc(`devices/${data.deviceId}/generations/${data.generationId}`);
          const [ownerMetadata, profile, binding] = await store.getAll(metadata(kind, document.id),
            recordRoot.collection("records").doc(`profile:${data.deviceId}:settings`), recordRoot);
          const installationId = kind === "automatic" ? data.installationId : binding.data()?.installationId;
          installations.push({ kind, uid: document.id, ...data,
            installationId: typeof installationId === "string" && UUID.test(installationId) ? installationId : null,
            alias: label(ownerMetadata.data()?.alias), phoneLabel: label(profile.data()?.payload?.phoneLabel) });
        }
      }
      return installations.sort((left, right) => left.kind.localeCompare(right.kind) || left.uid.localeCompare(right.uid));
    },
    setAlias: async (kind, uid, alias) => {
      await store.runTransaction(async (transaction) => {
        const installation = await transaction.get(root(kind, uid));
        if (!installation.exists) throw new OwnerManagementError("The installation was not found");
        identity(installation.data(), kind === "automatic");
        await transaction.set(metadata(kind, uid), { kind, uid, alias: checkedAlias(alias) });
      });
    },
    revokeAutomatic: async (uid) => {
      await store.runTransaction(async (transaction) => {
        const reference = root("automatic", uid);
        const installation = await transaction.get(reference);
        if (!installation.exists) throw new OwnerManagementError("The automatic installation was not found");
        identity(installation.data(), true);
        transaction.update(reference, { enabled: false });
      });
    },
    disableUser: async (uid) => {
      try { await auth.updateUser(uid, { disabled: true }); await auth.revokeRefreshTokens(uid); }
      catch (error) {
        // Already-deleted accounts cannot refresh or sign in; the retained root still blocks old ID tokens.
        if (!object(error) || error.code !== "auth/user-not-found") throw error;
      }
    },
  };
  return { backend, close: () => deleteApp(app) };
}
