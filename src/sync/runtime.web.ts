import { createPreviewTransport } from "./previewTransport";
import type { AnonymousSyncCredentials } from "./protocol";
export function createUploadRuntime() {
  return {
    projectId: "workout-preview", apiKey: "preview-key-" + "a".repeat(30), modelName: "Browser preview",
    transport: createPreviewTransport(),
    signup: async (identity: { deviceId: string; generationId: string }): Promise<AnonymousSyncCredentials> => ({
      version: 3, layout: "automatic", projectId: "workout-preview", apiKey: "preview-key-" + "a".repeat(30),
      deviceId: identity.deviceId, generationId: identity.generationId, uid: "preview_" + identity.deviceId.replace(/-/g, ""), refreshToken: "local-preview-token",
    }),
  };
}
