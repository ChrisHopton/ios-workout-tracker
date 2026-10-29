/** Fixed diagnostic text only: native messages can contain URLs, tokens or identifiers. */
const messages = {
  timeout: "App verification timed out. Keep the app online and retry. [AT-TIMEOUT]",
  provider: "App verification has not initialized. The app owner needs to check this build. [AT-PROVIDER]",
  configuration: "App verification could not initialize. The app owner needs to check this build. [AT-CONFIG]",
  module: "This installation is missing app verification support. Contact the app owner. [AT-MODULE]",
  app: "Firebase could not load this app's configuration. Contact the app owner. [AT-APP]",
  rejected: "The verification service rejected this installation. Contact the app owner. [AT-REJECTED]",
  throttled: "App verification is temporarily rate limited. Keep the app open to retry later. [AT-LIMIT]",
  network: "App verification could not reach its service. Check the connection and retry. [AT-NETWORK]",
  token: "The phone could not obtain an app verification token. Contact the app owner. [AT-TOKEN]",
  empty: "App verification returned no token. Contact the app owner. [AT-EMPTY]",
} as const;

export function isAttestationDiagnostic(value: unknown): value is string {
  return typeof value === "string" && Object.values(messages).some((message) => message === value);
}
export function attestationDiagnostic(error: unknown, stage: "configuration" | "token"): string {
  if (isAttestationDiagnostic(error)) return error;
  const value = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const code = typeof value.code === "string" ? value.code.toLowerCase() : "";
  const message = typeof value.message === "string" ? value.message : "";
  if (code === "workout/attestation-timeout") return messages.timeout;
  if (code === "workout/attestation-empty") return messages.empty;
  if (code === "appcheck/provider-not-ready") return messages.provider;
  if (code === "app/no-app" || code === "app/no-options") return messages.app;
  if (/NativeRNFBTurboAppCheck|RNFBAppCheckModule/.test(message) && /not found|could not be found|not installed|not linked|not available/i.test(message)) return messages.module;
  // Inspect only recognized failure markers; never copy native text into the UI or logs.
  if (/\b(?:HTTP status code|status code|HTTP status|HTTP)[:= ]+403\b/i.test(message)) return messages.rejected;
  if (/\b(?:HTTP status code|status code|HTTP status|HTTP)[:= ]+429\b/i.test(message)) return messages.throttled;
  if (/NSURLErrorDomain|network request failed|internet connection appears to be offline/i.test(message)) return messages.network;
  if (code === "appcheck/token-null") return messages.empty;
  return stage === "configuration" ? messages.configuration : messages.token;
}
