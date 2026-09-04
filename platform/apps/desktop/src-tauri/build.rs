/// The vendored wa-js bundle is executed inside the user's live WhatsApp
/// session, so it is pinned by SHA-256 and verified HERE — a mismatch fails the
/// build rather than shipping an unreviewed third-party script.
fn verify_vendored_wa_js() {
    let dir = std::path::PathBuf::from(
        std::env::var("CARGO_MANIFEST_DIR").expect("Cargo must provide CARGO_MANIFEST_DIR"),
    )
    .join("vendor");
    let bundle = dir.join("wppconnect-wa.js");
    let expected_path = dir.join("wppconnect-wa.js.sha256");
    println!("cargo:rerun-if-changed={}", bundle.display());
    println!("cargo:rerun-if-changed={}", expected_path.display());

    let bytes = std::fs::read(&bundle).expect("vendored wa-js bundle is missing");
    let expected = std::fs::read_to_string(&expected_path)
        .expect("vendored wa-js SHA-256 file is missing");
    let expected = expected.trim().to_ascii_lowercase();

    use sha2::{Digest, Sha256};
    let actual = format!("{:x}", Sha256::digest(&bytes));
    if actual != expected {
        panic!(
            "vendored wa-js hash mismatch\n  expected: {expected}\n  actual:   {actual}\n\
             Refusing to build. If this update is intended, review the new bundle and \
             update vendor/wppconnect-wa.js.sha256."
        );
    }
}

fn main() {
    verify_vendored_wa_js();
    if std::env::var("PROFILE").as_deref() != Ok("release") {
        let target = std::env::var("TARGET").expect("Cargo must provide TARGET");
        let extension = if target.contains("windows") {
            ".exe"
        } else {
            ""
        };
        let path = std::path::PathBuf::from(
            std::env::var("CARGO_MANIFEST_DIR").expect("Cargo must provide CARGO_MANIFEST_DIR"),
        )
        .join("binaries")
        .join(format!("bridge-node-{target}{extension}"));
        if !path.exists() {
            std::fs::create_dir_all(
                path.parent()
                    .expect("the generated debug sidecar path must have a parent"),
            )
            .expect("could not create the debug sidecar directory");
            std::fs::write(&path, []).expect("could not create the debug sidecar placeholder");
        }
        if target.contains("apple-darwin") {
            let native_keyring = std::path::PathBuf::from(
                std::env::var("CARGO_MANIFEST_DIR").expect("Cargo must provide CARGO_MANIFEST_DIR"),
            )
            .join("generated/native/bridge-keyring.dylib");
            if !native_keyring.exists() {
                std::fs::create_dir_all(
                    native_keyring
                        .parent()
                        .expect("the generated native framework path must have a parent"),
                )
                .expect("could not create the generated native framework directory");
                std::fs::write(native_keyring, [])
                    .expect("could not create the debug native framework placeholder");
            }
        }
        // tauri.conf.json's bundle.macOS.frameworks list is validated by
        // tauri_build::build() below for EVERY profile, not just release — so a
        // fresh debug build fails with "Library not found" before the sqlite
        // Framework has ever been produced by prepare-bundle.mjs's
        // extractMacNativeSqlite() (TASK-071/072, decisions-log). Same fix as
        // the keyring placeholder above: debug never loads this path at runtime
        // (resolve_native_sqlite3() in api_sidecar.rs returns None whenever
        // cfg!(debug_assertions), always preferring better-sqlite3's own
        // prebuild), so an empty placeholder is enough to satisfy the manifest
        // check without affecting behavior.
        if target.contains("apple-darwin") {
            let native_sqlite3 = std::path::PathBuf::from(
                std::env::var("CARGO_MANIFEST_DIR").expect("Cargo must provide CARGO_MANIFEST_DIR"),
            )
            .join("generated/native/bridge-sqlite3.dylib");
            if !native_sqlite3.exists() {
                std::fs::create_dir_all(
                    native_sqlite3
                        .parent()
                        .expect("the generated native framework path must have a parent"),
                )
                .expect("could not create the generated native framework directory");
                std::fs::write(native_sqlite3, [])
                    .expect("could not create the debug native framework placeholder");
            }
        }
    }
    tauri_build::build()
}
