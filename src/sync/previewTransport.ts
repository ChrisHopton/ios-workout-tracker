import type { SyncResponse } from "./protocol";
import type { SyncTransport } from "./transport";

export function createPreviewTransport(): SyncTransport {
  const revisions = new Map<string, number>();
  return async (request): Promise<SyncResponse> => {
    let maximum = revisions.get(request.deviceId) ?? 0;
    const acknowledged = (request.changes ?? []).map((change) => {
      maximum = Math.max(maximum, change.revision);
      return { key: change.key, revision: change.revision };
    });
    revisions.set(request.deviceId, maximum);
    return {
      version: 1,
      ok: true,
      deviceId: request.deviceId,
      maxRevision: maximum,
      acknowledged,
    };
  };
}
