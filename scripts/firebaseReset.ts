import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import type { CollectionReference, DocumentReference, Firestore } from "firebase-admin/firestore";
import type { Credential } from "firebase-admin/app";
import { readFirestoreEnforcement } from "./firebaseAutomatic";

export interface ResetTarget {
  path: string;
  kind: "automatic" | "legacy";
  exists: boolean;
  enabled: boolean;
  schemaVersion?: number;
  records: number;
}
export interface ResetBackend {
  verifyFence(): Promise<void>;
  targets(): Promise<ResetTarget[]>;
  inspect(target: ResetTarget): Promise<ResetTarget>;
  deleteRecords(target: ResetTarget): Promise<void>;
  deleteActiveRoot(target: ResetTarget): Promise<void>;
  retireLegacyMetadata(): Promise<void>;
}
function eligible(target: ResetTarget): void {
  const expected = target.kind === "automatic" ? /^automaticUploads\/[A-Za-z0-9_-]{1,128}$/ : /^devices\/[0-9a-f-]{36}$/;
  if (!expected.test(target.path) || !Number.isSafeInteger(target.records) || target.records < 0 ||
    (target.kind === "automatic" && target.exists && target.schemaVersion !== 2)) {
    throw new Error("Reset refused: unexpected or new-version data exists. No new profile data may be purged.");
  }
}
/** Counts only; never returns identifiers or personal record contents. Safe to rerun before new enrollment. */
export async function runProfileReset(backend: ResetBackend, apply: boolean) {
  await backend.verifyFence();
  const targets = await backend.targets();
  targets.forEach(eligible);
  const report = {
    apply, installations: targets.length,
    reportingRecords: targets.reduce((n, target) => n + target.records, 0),
    revokedBindingsRetained: targets.filter(target => target.kind === "automatic" && target.exists && !target.enabled).length,
  };
  if (!apply) return report;
  for (const target of targets) {
    await backend.verifyFence();
    const current = await backend.inspect(target);
    eligible(current);
    await backend.deleteRecords(current);
    // Disabled roots are authorization tombstones, not reporting data.
    if (current.kind === "legacy" || !current.exists || current.enabled) await backend.deleteActiveRoot(current);
  }
  await backend.verifyFence();
  await backend.retireLegacyMetadata();
  const remaining = await backend.targets();
  remaining.forEach(eligible);
  if (remaining.some(target => target.records > 0 || (target.exists && target.enabled))) {
    throw new Error("Reset cleanup is incomplete. Enrollment remains closed; rerun the same command.");
  }
  return report;
}
const sha = (text: string) => createHash("sha256").update(text.replace(/\r\n/g, "\n").trim()).digest("hex");
export async function verifyDeployedResetFence(projectId: string, credential: Pick<Credential, "getAccessToken">, expectedRules: string, fetcher: typeof fetch = fetch) {
  const token = await credential.getAccessToken();
  const get = async (path: string) => {
    const response = await fetcher("https://firebaserules.googleapis.com/v1/" + path, {
      headers: { Authorization: `Bearer ${token.access_token}` }, redirect: "error", signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error();
    return await response.json();
  };
  try {
    const release = await get(`projects/${projectId}/releases/cloud.firestore`);
    if (typeof release.rulesetName !== "string" || !release.rulesetName.startsWith(`projects/${projectId}/rulesets/`) ||
      !/^projects\/[a-z0-9-]+\/rulesets\/[A-Za-z0-9-]+$/.test(release.rulesetName)) throw new Error();
    const rules = await get(release.rulesetName);
    if (!Array.isArray(rules.source?.files) || rules.source.files.length !== 1 ||
      typeof rules.source.files[0].content !== "string" || sha(rules.source.files[0].content) !== sha(expectedRules) ||
      !expectedRules.includes("enrollment.schemaVersion == 3") || !expectedRules.includes("data.schemaVersion == 2")) throw new Error();
  } catch { throw new Error("Reset refused: deployed Firestore rules do not match the tested profile-reset fence."); }
}
export function createResetBackend(store: Firestore, verifyFence: () => Promise<void>): ResetBackend {
  async function onlyCollections(ref: DocumentReference, allowed: readonly string[]) {
    if ((await ref.listCollections()).some(collection => !allowed.includes(collection.id))) {
      throw new Error("Reset refused: unexpected child collections require owner review.");
    }
  }
  async function leaves(collection: CollectionReference): Promise<DocumentReference[]> {
    const documents = await collection.listDocuments();
    for (const document of documents) await onlyCollections(document, []);
    return documents;
  }
  async function recordDocuments(ref: DocumentReference, kind: ResetTarget["kind"]) {
    await onlyCollections(ref, kind === "automatic" ? ["records"] : ["generations"]);
    if (kind === "automatic") return leaves(ref.collection("records"));
    const documents: DocumentReference[] = [];
    for (const generation of await ref.collection("generations").listDocuments()) {
      await onlyCollections(generation, ["records"]);
      documents.push(...await leaves(generation.collection("records")));
    }
    return documents;
  }
  async function inspect(target: ResetTarget): Promise<ResetTarget> {
    const ref = store.doc(target.path);
    const root = await ref.get();
    const data = root.data();
    const records = (await recordDocuments(ref, target.kind)).length;
    if (target.kind === "automatic") {
      if (root.exists && typeof data?.enabled !== "boolean") throw new Error("Reset refused: invalid authorization metadata.");
      return { ...target, exists: root.exists, enabled: data?.enabled === true, schemaVersion: data?.schemaVersion, records };
    }
    return { ...target, exists: root.exists, enabled: true, records };
  }
  return {
    verifyFence,
    inspect,
    targets: async () => {
      // Inspect metadata leaves as well before any reporting data is changed.
      await leaves(store.collection("uploadAuthorizations"));
      await leaves(store.collection("uploadOwnerMetadata"));
      const targets: ResetTarget[] = [];
      for (const [kind, collection] of [["automatic", "automaticUploads"], ["legacy", "devices"]] as const) {
        for (const ref of await store.collection(collection).listDocuments()) {
          targets.push(await inspect({ kind, path: ref.path, exists: false, enabled: false, records: 0 }));
        }
      }
      return targets;
    },
    deleteRecords: async target => {
      eligible(await inspect(target));
      const ref = store.doc(target.path);
      if (target.kind === "legacy") {
        await store.recursiveDelete(ref.collection("generations"));
        return;
      }
      // A missing root must be reserved before deleting orphan records. Its v2
      // binding prevents v3 enrollment even if the enrollment gate reopens.
      // Existing disabled roots remain unchanged authorization tombstones.
      await store.runTransaction(async tx => {
        const current = await tx.get(ref);
        if (current.exists) {
          eligible({ ...target, exists: true, schemaVersion: current.data()?.schemaVersion });
          if (typeof current.data()?.enabled !== "boolean") throw new Error("Reset refused: invalid authorization metadata.");
        } else {
          tx.create(ref, { schemaVersion: 2, enabled: true, profileResetPending: true });
        }
      });
      const documents = await recordDocuments(ref, "automatic");
      for (let offset = 0; offset < documents.length; offset += 200) {
        await store.runTransaction(async tx => {
          const current = await tx.get(ref);
          if (!current.exists || current.data()?.schemaVersion !== 2 || typeof current.data()?.enabled !== "boolean") {
            throw new Error("Reset stopped: authorization changed during cleanup.");
          }
          // The root read and deletes share a transaction. Concurrent cleanup
          // or new enrollment invalidates this page before any new data is lost.
          for (const document of documents.slice(offset, offset + 200)) tx.delete(document);
        });
      }
    },
    deleteActiveRoot: async target => {
      const ref = store.doc(target.path);
      if ((await recordDocuments(ref, target.kind)).length) throw new Error("Reset stopped: reporting records remain.");
      await store.runTransaction(async tx => {
        const current = await tx.get(ref);
        if (!current.exists) return;
        if (target.kind === "automatic") {
          if (current.data()?.schemaVersion !== 2 || typeof current.data()?.enabled !== "boolean") {
            throw new Error("Reset stopped: authorization changed during cleanup.");
          }
          // A revocation made during cleanup must survive, too.
          if (current.data()?.enabled === false) return;
        }
        tx.delete(ref);
      });
    },
    retireLegacyMetadata: async () => {
      const authorizations = await leaves(store.collection("uploadAuthorizations"));
      const aliases = await leaves(store.collection("uploadOwnerMetadata"));
      for (const ref of authorizations) await ref.set({ enabled: false }, { merge: true });
      for (const ref of aliases) await ref.delete();
    },
  };
}
async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2 || args[0] !== "--project" || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(args[1]) ||
    (args.length !== 2 && (args.length !== 3 || args[2] !== "--apply"))) throw new Error("Usage: firebaseReset --project PROJECT [--apply]");
  const projectId = args[1];
  const { applicationDefault, initializeApp, deleteApp } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const credential = applicationDefault();
  const app = initializeApp({ credential, projectId });
  try {
    const store = getFirestore(app);
    const expectedRules = readFileSync(resolve(fileURLToPath(new URL("..", import.meta.url)), "firebase/firestore.rules"), "utf8");
    const verifyFence = async () => {
      const gate = await store.doc("uploadControl/automaticEnrollment").get();
      if (gate.data()?.enabled !== false) throw new Error("Reset refused: close automatic enrollment first.");
      if (await readFirestoreEnforcement(projectId, credential) !== "ENFORCED") throw new Error("Reset refused: App Check must remain enforced.");
      await verifyDeployedResetFence(projectId, credential, expectedRules);
    };
    console.log(JSON.stringify(await runProfileReset(createResetBackend(store, verifyFence), args[2] === "--apply")));
  } finally { await deleteApp(app); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch(() => { console.error("Profile reset did not complete. Check enrollment is closed, tested rules are deployed, and no new profiles exist; then retry. No credentials or record contents are logged."); process.exitCode = 1; });
}
