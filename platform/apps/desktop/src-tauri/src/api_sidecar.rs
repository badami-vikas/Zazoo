//! api_sidecar — the managed @bridge/api child process (R-001 offline desktop).
//!
//! The desktop shell is self-contained offline by spawning the Fastify API
//! build (`apps/api/dist/src/server.js`) as a child Node process on a free
//! localhost port, health-checking `/health`, and injecting the resolved URL
//! into both webviews as `window.__BRIDGE_API_URL__` (an initialization
//! script, so it exists before the tRPC client module evaluates).
//!
//! Decisions (ADR-024 in docs/raw/decisions-log.md):
//!  - `std::process::Command` child, NOT a Tauri "sidecar" externalBin: the
//!    API is a Node build, bundling a Node runtime per-arch is out of scope
//!    while `bundle.active` is false. System `node` (override: BRIDGE_NODE_BIN).
//!  - Free-port strategy: bind 127.0.0.1:0, take the kernel-assigned port,
//!    release it, pass it as PORT. No fixed port to collide with a dev API.
//!  - Debug builds (`tauri dev`) NEVER spawn the sidecar — dev keeps external
//!    servers (Vite 5173 + API 4000) exactly as before.
//!
//! PERSISTENCE IS HONEST, NOT PRETTY: without DATABASE_URL the API runs its
//! in-memory wiring, so ALL workspace state is lost when the app quits. The
//! child inherits this process's environment, so a user with local Postgres
//! can set DATABASE_URL (or BRIDGE_DATABASE_URL) before launching Bridge and
//! get real persistence with zero code changes here.

use std::io::{Read as _, Write as _};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::Duration;

/// Managed handle to the spawned API child so app-exit can kill it. `None`
/// in dev mode / when the spawn failed.
#[derive(Default)]
pub struct ApiSidecarState(pub Mutex<Option<Child>>);

pub struct SpawnedApi {
    pub port: u16,
    pub child: Child,
}

/// Ask the kernel for a free localhost port (bind :0, read, release).
/// Small race window between release and the Node process binding it —
/// acceptable for a single-user desktop app on localhost.
pub fn pick_free_port() -> std::io::Result<u16> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    drop(listener);
    Ok(port)
}

/// Resolve the built API entrypoint. Order:
///  1. BRIDGE_API_SERVER_JS env override (power users / tests)
///  2. Tauri resource dir (`<resources>/api/server.js`) — where a future
///     bundling pass will place the API build
///  3. Monorepo-relative path from this crate (running the release binary
///     out of the repo without bundling)
pub fn resolve_api_entry(resource_dir: Option<PathBuf>) -> Option<PathBuf> {
    if let Ok(p) = std::env::var("BRIDGE_API_SERVER_JS") {
        let p = PathBuf::from(p);
        if p.is_file() {
            return Some(p);
        }
    }
    if let Some(dir) = resource_dir {
        let p = dir.join("api").join("server.js");
        if p.is_file() {
            return Some(p);
        }
    }
    // apps/desktop/src-tauri → apps/api/dist/src/server.js
    let repo_relative = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../api/dist/src/server.js");
    if repo_relative.is_file() {
        return Some(repo_relative);
    }
    None
}

/// Spawn `node server.js` with PORT set. Environment is inherited, which is
/// exactly the DATABASE_URL passthrough contract described in the module doc.
pub fn spawn_api(entry: &PathBuf, port: u16) -> std::io::Result<Child> {
    let node = std::env::var("BRIDGE_NODE_BIN").unwrap_or_else(|_| "node".to_string());
    Command::new(node)
        .arg(entry)
        .env("PORT", port.to_string())
        // Bind loopback only — never expose the kernel API on the LAN.
        .env("HOST", "127.0.0.1")
        .spawn()
}

/// Minimal HTTP/1.0 GET against the API's `/health` route (apps/api
/// src/server.js registers it). std-only on purpose: pulling reqwest+tokio
/// into the shell for one localhost probe is not worth the dependency tree.
pub fn health_ok(port: u16, timeout: Duration) -> bool {
    let addr = format!("127.0.0.1:{port}");
    let Ok(mut stream) = TcpStream::connect_timeout(
        &match addr.parse() {
            Ok(a) => a,
            Err(_) => return false,
        },
        timeout,
    ) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(timeout));
    let req = format!(
        "GET /health HTTP/1.0\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
    );
    if stream.write_all(req.as_bytes()).is_err() {
        return false;
    }
    let mut buf = String::new();
    if stream.read_to_string(&mut buf).is_err() {
        return false;
    }
    buf.starts_with("HTTP/1.1 200") || buf.starts_with("HTTP/1.0 200")
}

/// Retry `/health` until it answers 200 or the budget runs out.
pub fn wait_healthy(port: u16, attempts: u32, interval: Duration) -> bool {
    for _ in 0..attempts {
        if health_ok(port, Duration::from_millis(750)) {
            return true;
        }
        std::thread::sleep(interval);
    }
    false
}

/// Spawn + wait for readiness. Returns None (with a logged reason) when the
/// API build or Node itself is missing — the shell still opens, the web app
/// falls back to VITE_API_URL / localhost:4000 and surfaces connection errors.
pub fn start(resource_dir: Option<PathBuf>) -> Option<SpawnedApi> {
    let Some(entry) = resolve_api_entry(resource_dir) else {
        eprintln!(
            "[bridge-desktop] api sidecar: no API build found \
             (set BRIDGE_API_SERVER_JS or build apps/api). Running shell without embedded API."
        );
        return None;
    };
    let port = match pick_free_port() {
        Ok(p) => p,
        Err(err) => {
            eprintln!("[bridge-desktop] api sidecar: could not pick a free port: {err}");
            return None;
        }
    };
    let child = match spawn_api(&entry, port) {
        Ok(c) => c,
        Err(err) => {
            eprintln!(
                "[bridge-desktop] api sidecar: failed to spawn node on {entry:?}: {err} \
                 (is Node installed? override with BRIDGE_NODE_BIN)"
            );
            return None;
        }
    };
    // ~20s budget: cold Node + Fastify + in-memory wiring boots in well under
    // that; DATABASE_URL wiring may take a few seconds on first connect.
    if wait_healthy(port, 80, Duration::from_millis(250)) {
        println!("[bridge-desktop] api sidecar healthy at http://127.0.0.1:{port}");
        Some(SpawnedApi { port, child })
    } else {
        eprintln!(
            "[bridge-desktop] api sidecar: /health never answered on port {port}; \
             leaving process running and letting the UI surface connection errors"
        );
        Some(SpawnedApi { port, child })
    }
}

/// Kill the child (called from the RunEvent::Exit handler in lib.rs).
pub fn shutdown(state: &ApiSidecarState) {
    if let Ok(mut guard) = state.0.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
