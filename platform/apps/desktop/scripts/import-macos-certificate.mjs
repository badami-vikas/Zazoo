import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

function runSecurity(args) {
  const result = spawnSync("security", args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `security ${args[0]} failed: ${(result.stderr || result.stdout).trim()}`,
    );
  }
  return `${result.stdout}\n${result.stderr}`;
}

export function firstCodesignIdentity(output) {
  return output.match(/^\s*\d+\)\s+[0-9a-f]+\s+"([^"]+)"$/imu)?.[1] ?? null;
}

export async function importMacosCertificate(environment = process.env) {
  const certificate = environment.APPLE_CERTIFICATE?.trim();
  if (!certificate) return null;
  if (process.platform !== "darwin") {
    throw new Error("Apple signing certificates may only be imported on macOS");
  }
  const runnerTemp = environment.RUNNER_TEMP;
  const githubEnv = environment.GITHUB_ENV;
  if (!runnerTemp || !githubEnv) {
    throw new Error("RUNNER_TEMP and GITHUB_ENV are required for CI certificate import");
  }

  const keychain = join(runnerTemp, `bridge-signing-${process.pid}.keychain-db`);
  const certificatePath = join(runnerTemp, `bridge-signing-${process.pid}.p12`);
  const keychainPassword = randomBytes(32).toString("hex");
  await writeFile(certificatePath, Buffer.from(certificate, "base64"), {
    mode: 0o600,
  });
  try {
    runSecurity(["create-keychain", "-p", keychainPassword, keychain]);
    runSecurity(["set-keychain-settings", "-lut", "21600", keychain]);
    runSecurity(["unlock-keychain", "-p", keychainPassword, keychain]);
    runSecurity([
      "import",
      certificatePath,
      "-P",
      environment.APPLE_CERTIFICATE_PASSWORD ?? "",
      "-A",
      "-t",
      "cert",
      "-f",
      "pkcs12",
      "-k",
      keychain,
    ]);
    runSecurity([
      "set-key-partition-list",
      "-S",
      "apple-tool:,apple:,codesign:",
      "-s",
      "-k",
      keychainPassword,
      keychain,
    ]);
    const identity = firstCodesignIdentity(
      runSecurity(["find-identity", "-v", "-p", "codesigning", keychain]),
    );
    if (!identity || identity === "-") {
      throw new Error("the imported certificate has no code-signing identity");
    }
    const expectedIdentity = environment.APPLE_SIGNING_IDENTITY?.trim();
    if (expectedIdentity && expectedIdentity !== identity) {
      throw new Error("the imported certificate does not match APPLE_SIGNING_IDENTITY");
    }
    await appendFile(
      githubEnv,
      [
        `APPLE_SIGNING_IDENTITY=${identity}`,
        `BRIDGE_CODESIGN_KEYCHAIN=${keychain}`,
        "BRIDGE_RELEASE_SIGNING=1",
        "",
      ].join("\n"),
    );
    return { identity, keychain };
  } catch (error) {
    spawnSync("security", ["delete-keychain", keychain], { encoding: "utf8" });
    throw error;
  } finally {
    await rm(certificatePath, { force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await importMacosCertificate();
}
