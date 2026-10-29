import { getApp } from "@react-native-firebase/app";
import { initializeAppCheck, getToken, type AppCheck } from "@react-native-firebase/app-check";
import * as Device from "expo-device";
import { attestationDiagnostic } from "./attestationDiagnostic";
import { FIREBASE_CONFIG } from "./firebaseConfig";
import { createAnonymousCredentials, createSyncTransport, SyncError } from "./transport";
import { loadRefreshToken, saveRefreshToken } from "./credentials";

let appCheck: AppCheck | undefined;
async function appCheckToken(forceRefresh = false): Promise<string> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let stage: "configuration" | "token" = "configuration";
  try {
    appCheck ??= initializeAppCheck(getApp(), {
      provider: { providerOptions: { apple: { provider: "appAttest" } } },
      isTokenAutoRefreshEnabled: true,
    });
    stage = "token";
    const { token } = await Promise.race([
      getToken(appCheck, forceRefresh),
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject({ code: "workout/attestation-timeout" }), 20_000); }),
    ]);
    if (!token) throw { code: "workout/attestation-empty" };
    return token;
  } catch (error) {
    throw new SyncError(attestationDiagnostic(error, stage), true, "attestation");
  } finally { if (timeout) clearTimeout(timeout); }
}
export function createUploadRuntime() {
  return {
    projectId: FIREBASE_CONFIG.projectId,
    apiKey: FIREBASE_CONFIG.apiKey,
    modelName: Device.modelName,
    transport: createSyncTransport(undefined, {
      loadRefreshToken, saveRefreshToken, getAppCheckToken: appCheckToken, requireAppCheck: true,
    }),
    signup: async (identity: { deviceId: string; generationId: string }, canSend: () => boolean) => {
      // Verify the genuine native app before creating an anonymous account. Firestore enforcement
      // is the server security boundary; public Auth account creation alone grants no data access.
      await appCheckToken();
      return createAnonymousCredentials(FIREBASE_CONFIG, identity, { canSend });
    },
  };
}
