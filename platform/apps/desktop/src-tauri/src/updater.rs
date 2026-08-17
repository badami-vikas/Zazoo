//! Mac installer auto-update (TASK-077).
//!
//! On launch, checks the update manifest the release workflow publishes
//! (`latest.json`, see `.github/workflows/release-desktop.yml`) via the
//! endpoint configured in `tauri.conf.json`'s `plugins.updater`. A found
//! update is downloaded, signature-verified against the pinned public key,
//! installed, and the shell relaunches to pick it up.
//!
//! Runs off `tauri::async_runtime::spawn` so it never blocks window
//! creation, and every failure path (offline, no release published yet, a
//! signature mismatch) is logged and swallowed rather than surfaced —
//! same graceful-degradation rule the rest of this shell follows for
//! optional capabilities (see the module doc on `lib.rs`).

use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

pub fn spawn_background_check(app: AppHandle) {
    // A debug build has no matching published release to compare against,
    // and updating a dev build over the release channel would be actively
    // wrong, not just unnecessary.
    if cfg!(debug_assertions) {
        return;
    }
    tauri::async_runtime::spawn(async move {
        let updater = match app.updater() {
            Ok(updater) => updater,
            Err(error) => {
                eprintln!("[bridge-desktop] updater unavailable: {error}");
                return;
            }
        };
        let update = match updater.check().await {
            Ok(Some(update)) => update,
            Ok(None) => return, // already on the latest published build
            Err(error) => {
                eprintln!("[bridge-desktop] update check failed (continuing on current build): {error}");
                return;
            }
        };
        eprintln!(
            "[bridge-desktop] update {} -> {} found, downloading",
            update.current_version, update.version
        );
        if let Err(error) = update.download_and_install(|_, _| {}, || {}).await {
            eprintln!("[bridge-desktop] update download/install failed: {error}");
            return;
        }
        eprintln!("[bridge-desktop] update installed, relaunching");
        app.restart();
    });
}
