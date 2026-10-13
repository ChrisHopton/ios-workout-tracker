import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type SetupBundle = {
  version: 1;
  createdAt: string;
  endpoint: string;
  scriptProperties: { WORKOUT_DEVICES: string };
  devices: { deviceId: string; setupCode: string }[];
};

const deviceIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function validateEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Use the deployed Google Apps Script exec URL");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "script.google.com" ||
    url.port || url.username || url.password || url.search || url.hash ||
    !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname) ||
    value !== url.href
  ) {
    throw new Error("Use the deployed Google Apps Script exec URL");
  }
  return url.href;
}

export function createSetupBundle(
  endpoint: string,
  count: 1 | 2 = 2,
  existingDeviceId?: string,
): SetupBundle {
  endpoint = validateEndpoint(endpoint);
  if (count !== 1 && count !== 2) throw new Error("Choose one or two devices");
  if (existingDeviceId && (!deviceIdPattern.test(existingDeviceId) || count !== 1)) {
    throw new Error("A rotation needs one existing lowercase device UUID");
  }
  const hashes: { deviceId: string; tokenHash: string }[] = [];
  const devices = Array.from({ length: count }, () => {
    const deviceId = existingDeviceId ?? randomUUID();
    const token = randomBytes(32).toString("hex");
    hashes.push({ deviceId, tokenHash: createHash("sha256").update(token).digest("hex") });
    const payload = { version: 1, endpoint, deviceId, token };
    return {
      deviceId,
      setupCode: `WORKOUT1.${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`,
    };
  });
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    endpoint,
    scriptProperties: { WORKOUT_DEVICES: JSON.stringify(hashes) },
    devices,
  };
}

function isWithin(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return child === "" || (!child.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && child !== ".." && !isAbsolute(child));
}

export function resolvePrivateOutput(repoRoot: string, requested: string): string {
  const destination = resolve(requested);
  let ancestor = destination;
  const missing: string[] = [];
  while (!existsSync(ancestor)) {
    missing.unshift(basename(ancestor));
    const parent = dirname(ancestor);
    if (parent === ancestor) throw new Error("Choose an existing output drive");
    ancestor = parent;
  }
  const canonical = join(realpathSync(ancestor), ...missing);
  const canonicalRoot = realpathSync(repoRoot);
  if (isWithin(canonicalRoot, canonical) || isWithin(resolve(repoRoot), destination)) {
    throw new Error("Save private setup codes outside the repository");
  }
  if (existsSync(destination) && lstatSync(destination).isSymbolicLink()) {
    throw new Error("Choose an output file that is not a symbolic link");
  }
  return canonical;
}

export function writeSetupBundle(
  bundle: SetupBundle,
  repoRoot: string,
  requested: string,
  force = false,
): string {
  const output = resolvePrivateOutput(repoRoot, requested);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(bundle, null, 2)}\n`, {
    encoding: "utf8",
    flag: force ? "w" : "wx",
    mode: 0o600,
  });
  return output;
}

export function parseSetupArguments(args: string[]) {
  let endpoint = "";
  let count: 1 | 2 | undefined;
  let deviceId: string | undefined;
  let output: string | undefined;
  let force = false;
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const argument = args[i];
    if (seen.has(argument)) throw new Error("Provide each option once");
    seen.add(argument);
    if (argument === "--force") { force = true; continue; }
    if (!["--endpoint", "--devices", "--device-id", "--output"].includes(argument)) {
      throw new Error("Unknown setup option");
    }
    const value = args[++i];
    if (!value || value.startsWith("--")) throw new Error("A setup option is missing its value");
    if (argument === "--endpoint") endpoint = value;
    if (argument === "--output") output = value;
    if (argument === "--device-id") deviceId = value;
    if (argument === "--devices") {
      if (value !== "1" && value !== "2") throw new Error("Choose one or two devices");
      count = Number(value) as 1 | 2;
    }
  }
  if (!endpoint) throw new Error("Provide --endpoint with the deployed exec URL");
  return { endpoint, count: count ?? (deviceId ? 1 : 2), deviceId, output, force };
}

export function main(args = process.argv.slice(2)) {
  const options = parseSetupArguments(args);
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const output = options.output ?? join(
    homedir(), ".workout-sync", `setup-${Date.now()}-${randomBytes(4).toString("hex")}.json`,
  );
  const bundle = createSetupBundle(options.endpoint, options.count, options.deviceId);
  const saved = writeSetupBundle(bundle, repoRoot, output, options.force);
  process.stdout.write(`Private setup file saved to ${saved}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error && !('code' in error)
      ? error.message
      : "Could not save setup file check the path or use --force to replace an existing file";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
