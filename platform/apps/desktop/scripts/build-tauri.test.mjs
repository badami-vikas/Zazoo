import assert from "node:assert/strict";
import test from "node:test";
import { staleBridgeImages } from "./build-tauri.mjs";

const info = `================================================
image-path      : /Users/x/platform/apps/desktop/src-tauri/target/release/bundle/macos/rw.89598.Bridge_0.1.0_aarch64.dmg
image-alias     : /Users/x/.../rw.89598.Bridge_0.1.0_aarch64.dmg
/dev/disk4              GUID_partition_scheme
/dev/disk4s1            Apple_HFS                       /Volumes/Bridge
================================================
image-path      : /Users/x/Downloads/Other.dmg
/dev/disk6              GUID_partition_scheme
/dev/disk6s1            Apple_HFS                       /Volumes/Other
`;

test("only mounted Bridge dmgs are detached, once per device", () => {
  assert.deepEqual(staleBridgeImages(info), ["/dev/disk4"]);
  assert.deepEqual(staleBridgeImages(""), []);
});
