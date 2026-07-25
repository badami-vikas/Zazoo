fn main() {
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
    }
    tauri_build::build()
}
