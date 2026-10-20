import { getApp } from "@react-native-firebase/app";
import { initializeAppCheck, getToken, type AppCheck } from "@react-native-firebase/app-check";
import * as Device from "expo-device";
import { FIREBASE_CONFIG } from "./firebaseConfig";
import { createAnonymousCredentials, createSyncTransport, SyncError } from "./transport";
import { loadRefreshToken, saveRefreshToken } from "./credentials";

let appCheck: AppCheck | undefined;
async function appCheckToken(forceRefresh = false): Promise<string> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    appCheck ??= initializeAppCheck(getApp(), {
      provider: { providerOptions: { apple: { provider: "appAttest" } } },
      isTokenAutoRefreshEnabled: true,
    });
    const { token } = await Promise.race([
      getToken(appCheck, forceRefresh),
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error()), 20_000); }),
    ]);
    if (!token) throw new Error();
    return token;
  } catch {
    throw new SyncError("App verification is temporarily unavailable. Your workouts remain saved on this phone.", true, "attestation");
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
