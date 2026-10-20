import { documentRoot, identityOf, sameIdentity, type SyncIdentity } from "./protocol";
import { makeCommitBody, SyncError, type SyncTransport } from "./transport";

function canonical(value: unknown): string {
  const sort = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(sort);
    if (item !== null && typeof item === "object") {
      return Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sort(child)]));
    }
    return item;
  };
  return JSON.stringify(sort(value));
}

export function createPreviewTransport(): SyncTransport {
  const bindings = new Map<string, { installationId: string; identity: SyncIdentity }>();
  const records = new Map<string, { revision: number; value: string }>();
  return async (request, credentials, canSend = () => true) => {
    makeCommitBody(request, credentials);
    if (!canSend()) throw new SyncError("Cloud preview upload paused.", true);
    const namespace = documentRoot(credentials);
    const identity = identityOf(credentials);
    const binding = bindings.get(namespace);
    if (request.action === "bind") {
      if (binding && (binding.installationId !== request.installationId || !sameIdentity(binding.identity, identity))) {
        throw new SyncError("This preview is already bound to another installation or identity.", false, "auth");
      }
      bindings.set(namespace, { installationId: request.installationId, identity });
      return { acknowledged: [] };
    }
    if (!binding || binding.installationId !== request.installationId || !sameIdentity(binding.identity, identity)) {
      throw new SyncError("Connect this preview installation before uploading.", false, "auth");
    }
    for (const change of request.changes) {
      const previous = records.get(`${namespace}:${change.key}`);
      if (previous && (previous.revision > change.revision ||
        (previous.revision === change.revision && previous.value !== canonical(change)))) {
        throw new SyncError("This preview revision is stale or changed. Reload the browser demo.", false, "auth");
      }
    }
    for (const change of request.changes) {
      records.set(`${namespace}:${change.key}`, { revision: change.revision, value: canonical(change) });
    }
    return { acknowledged: request.changes.map(({ key, revision }) => ({ key, revision })) };
  };
}
