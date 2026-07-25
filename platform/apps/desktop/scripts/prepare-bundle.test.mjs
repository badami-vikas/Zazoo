import assert from "node:assert/strict";
import test from "node:test";
import {
  MAC_NATIVE_KEYRING_LOADER,
  sensitiveRuntimeFileReason,
  unsupportedInstallerReason,
} from "./prepare-bundle.mjs";

test("portable API rejects environment and first-party credential files", () => {
  assert.equal(sensitiveRuntimeFileReason(".env"), "environment file");
  assert.equal(
    sensitiveRuntimeFileReason("node_modules/@bridge/api/.env.local"),
    "environment file",
  );
  assert.equal(
    sensitiveRuntimeFileReason("node_modules/@bridge/db/service-account.json"),
    "credential file",
  );
  assert.equal(
    sensitiveRuntimeFileReason("node_modules/@bridge/api/release-key.pem"),
    "private key or certificate container",
  );
  assert.equal(
    sensitiveRuntimeFileReason("node_modules/example/public-ca.pem"),
    null,
  );
});

test("supported installer preparation fails closed on Windows", () => {
  assert.match(unsupportedInstallerReason("win32"), /Windows installers are disabled/);
  assert.equal(unsupportedInstallerReason("darwin"), null);
  assert.equal(unsupportedInstallerReason("linux"), null);
});

test("macOS keyring loader delegates to the signed Framework without the broken generated-loader override", () => {
  assert.match(MAC_NATIVE_KEYRING_LOADER, /BRIDGE_KEYRING_NATIVE_LIBRARY/);
  assert.match(MAC_NATIVE_KEYRING_LOADER, /process\.dlopen/);
  assert.doesNotMatch(MAC_NATIVE_KEYRING_LOADER, /NAPI_RS_NATIVE_LIBRARY_PATH/);
});
