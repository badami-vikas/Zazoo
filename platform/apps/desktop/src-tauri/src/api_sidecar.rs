//! api_sidecar — the managed @bridge/api child process (R-001 offline desktop).
//!
//! The desktop shell is self-contained offline by spawning the Fastify API
//! build (`apps/api/dist/src/server.js`) as a child Node process on a free
//! localhost port, health-checking `/health` in the background, and injecting
//! the resolved URL into both webviews as `window.__BRIDGE_API_URL__` (an
//! initialization script, so it exists before the tRPC client module
//! evaluates).
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
//! The Local Plane is always file-backed under Tauri's app-data directory.
//! Cloud/control-plane persistence remains independently configured through
//! DATABASE_URL.

use std::io::{Read as _, Write as _};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Managed API process and authenticated loopback shutdown material. `None` in
/// dev mode / when the spawn failed.
#[derive(Default)]
pub struct ApiSidecarState(pub Mutex<Option<SpawnedApi>>);

pub struct SpawnedApi {
    pub port: u16,
    pub child: Child,
    pub token: String,
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
    let repo_relative =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../api/dist/src/server.js");
    if repo_relative.is_file() {
        return Some(repo_relative);
    }
    None
}

fn generate_sidecar_token() -> std::io::Result<String> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes).map_err(|error| std::io::Error::other(error.to_string()))?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn api_command(entry: &PathBuf, port: u16, local_dir: &PathBuf, token: &str) -> Command {
    let node = std::env::var("BRIDGE_NODE_BIN").unwrap_or_else(|_| "node".to_string());
    let mut command = Command::new(node);
    command
        .arg(entry)
        .env("PORT", port.to_string())
        // Bind loopback only — never expose the kernel API on the LAN.
        .env("API_HOST", "127.0.0.1")
        .env("BRIDGE_LOCAL_DIR", local_dir)
        .env("BRIDGE_DEALPILOT_CREDENTIAL_VAULT", "os-keyring")
        .env("BRIDGE_SIDECAR_TOKEN", token)
        .env(
            "GOOGLE_REDIRECT_URI",
            format!("http://127.0.0.1:{port}/integrations/google/callback"),
        )
        .env("BRIDGE_OAUTH_DESKTOP", "1")
        .env(
            "API_ALLOWED_ORIGINS",
            "tauri://localhost,http://tauri.localhost,https://tauri.localhost",
        )
        .env("BRIDGE_PARENT_PID", std::process::id().to_string());
    command
}

/// Spawn `node server.js` with a durable Local Plane directory.
pub fn spawn_api(
    entry: &PathBuf,
    port: u16,
    local_dir: &PathBuf,
    token: &str,
) -> std::io::Result<Child> {
    api_command(entry, port, local_dir, token).spawn()
}

/// Minimal HTTP/1.0 GET against the API's `/health` route (apps/api
/// src/server.js registers it). std-only on purpose: pulling reqwest+tokio
/// into the shell for one localhost probe is not worth the dependency tree.
pub fn health_ok(port: u16, token: &str, timeout: Duration) -> bool {
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
        "GET /health HTTP/1.0\r\nHost: 127.0.0.1:{port}\r\n\
         X-Bridge-Sidecar-Token: {token}\r\nConnection: close\r\n\r\n"
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
pub fn wait_healthy(port: u16, token: &str, attempts: u32, interval: Duration) -> bool {
    for _ in 0..attempts {
        if health_ok(port, token, Duration::from_millis(750)) {
            return true;
        }
        std::thread::sleep(interval);
    }
    false
}

fn monitor_health(port: u16, token: String) {
    let monitor = std::thread::Builder::new()
        .name("bridge-api-health".to_string())
        .spawn(move || {
            // ~20s budget: cold Node + Fastify + in-memory wiring boots in well
            // under that; DATABASE_URL wiring may take a few seconds on first
            // connect. This must never block Tauri's setup/event-loop thread.
            if wait_healthy(port, &token, 80, Duration::from_millis(250)) {
                println!("[bridge-desktop] api sidecar healthy at http://127.0.0.1:{port}");
            } else {
                eprintln!(
                    "[bridge-desktop] api sidecar: /health never answered on port {port}; \
                     leaving process running and letting the UI surface connection errors"
                );
            }
        });
    if let Err(error) = monitor {
        eprintln!("[bridge-desktop] api sidecar: could not start health monitor: {error}");
    }
}

/// Spawn the API and return its URL material immediately. Readiness probing is
/// detached so Tauri can create a window and start its event loop without a
/// 20-second launch stall. Returns None (with a logged reason) when the API
/// build or Node itself is missing; the shell still opens and surfaces the
/// connection error.
pub fn start(resource_dir: Option<PathBuf>, local_dir: PathBuf) -> Option<SpawnedApi> {
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
    if let Err(err) = std::fs::create_dir_all(&local_dir) {
        eprintln!(
            "[bridge-desktop] api sidecar: could not create Local Plane directory \
             {local_dir:?}: {err}. Refusing an ephemeral API."
        );
        return None;
    }
    let token = match generate_sidecar_token() {
        Ok(token) => token,
        Err(err) => {
            eprintln!(
                "[bridge-desktop] api sidecar: could not generate a launch capability: {err}"
            );
            return None;
        }
    };
    let child = match spawn_api(&entry, port, &local_dir, &token) {
        Ok(c) => c,
        Err(err) => {
            eprintln!(
                "[bridge-desktop] api sidecar: failed to spawn node on {entry:?}: {err} \
                 (is Node installed? override with BRIDGE_NODE_BIN)"
            );
            return None;
        }
    };
    monitor_health(port, token.clone());
    Some(SpawnedApi { port, child, token })
}

fn request_http_stop(port: u16, token: &str, timeout: Duration) -> std::io::Result<()> {
    let addr = format!("127.0.0.1:{port}");
    let mut stream = TcpStream::connect_timeout(
        &addr
            .parse()
            .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidInput, error))?,
        timeout,
    )?;
    stream.set_read_timeout(Some(timeout))?;
    stream.set_write_timeout(Some(timeout))?;
    let request = format!(
        "POST /internal/sidecar/shutdown HTTP/1.0\r\nHost: 127.0.0.1:{port}\r\n\
         X-Bridge-Sidecar-Token: {token}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
    );
    stream.write_all(request.as_bytes())?;
    let mut response = String::new();
    stream.read_to_string(&mut response)?;
    if response.starts_with("HTTP/1.1 202") || response.starts_with("HTTP/1.0 202") {
        Ok(())
    } else {
        Err(std::io::Error::other(
            "sidecar rejected the authenticated shutdown request",
        ))
    }
}

#[cfg(unix)]
fn request_signal_stop(child: &Child) -> std::io::Result<()> {
    let result = unsafe { libc::kill(child.id() as libc::pid_t, libc::SIGTERM) };
    if result == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

fn stop_child(api: SpawnedApi) {
    let SpawnedApi {
        port,
        mut child,
        token,
    } = api;
    match child.try_wait() {
        Ok(Some(_)) => return,
        Ok(None) => {}
        Err(error) => {
            eprintln!(
                "[bridge-desktop] api sidecar: could not inspect child before shutdown: {error}"
            );
        }
    }

    let mut graceful_stop_result = request_http_stop(port, &token, Duration::from_secs(1));
    #[cfg(unix)]
    if graceful_stop_result.is_err() {
        graceful_stop_result = request_signal_stop(&child);
    }

    if let Err(error) = graceful_stop_result {
        eprintln!(
            "[bridge-desktop] api sidecar: graceful shutdown signal failed: {error}; forcing exit"
        );
        let _ = child.kill();
    }

    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(50));
            }
            Ok(None) => {
                eprintln!(
                    "[bridge-desktop] api sidecar: graceful shutdown timed out; forcing exit"
                );
                let _ = child.kill();
                let _ = child.wait();
                return;
            }
            Err(error) => {
                eprintln!("[bridge-desktop] api sidecar: shutdown wait failed: {error}");
                let _ = child.kill();
                let _ = child.wait();
                return;
            }
        }
    }
}

/// Gracefully stop the child, with a bounded force-kill fallback.
pub fn shutdown(state: &ApiSidecarState) {
    if let Ok(mut guard) = state.0.lock() {
        if let Some(api) = guard.take() {
            stop_child(api);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsStr;
    use std::time::Instant;

    #[test]
    fn health_monitor_never_blocks_the_setup_caller() {
        let port = pick_free_port().expect("test should obtain an unused loopback port");
        let started = Instant::now();

        monitor_health(port, "test-sidecar-token".to_string());

        assert!(
            started.elapsed() < Duration::from_secs(1),
            "health monitoring must stay detached from the caller"
        );
    }

    #[test]
    fn sidecar_command_sets_durable_local_plane_directory() {
        let entry = PathBuf::from("server.js");
        let local_dir = PathBuf::from("/test/bridge/local-plane");
        let command = api_command(&entry, 4123, &local_dir, "test-sidecar-token");
        let envs = command
            .get_envs()
            .map(|(key, value)| (key.to_owned(), value.map(OsStr::to_owned)))
            .collect::<std::collections::HashMap<_, _>>();

        assert_eq!(
            envs.get(OsStr::new("BRIDGE_LOCAL_DIR"))
                .and_then(|value| value.as_deref()),
            Some(local_dir.as_os_str())
        );
        assert_eq!(
            envs.get(OsStr::new("PORT"))
                .and_then(|value| value.as_deref()),
            Some(OsStr::new("4123"))
        );
        assert_eq!(
            envs.get(OsStr::new("API_HOST"))
                .and_then(|value| value.as_deref()),
            Some(OsStr::new("127.0.0.1"))
        );
        assert_eq!(
            envs.get(OsStr::new("BRIDGE_DEALPILOT_CREDENTIAL_VAULT"))
                .and_then(|value| value.as_deref()),
            Some(OsStr::new("os-keyring"))
        );
        assert_eq!(
            envs.get(OsStr::new("BRIDGE_SIDECAR_TOKEN"))
                .and_then(|value| value.as_deref()),
            Some(OsStr::new("test-sidecar-token"))
        );
        assert_eq!(
            envs.get(OsStr::new("GOOGLE_REDIRECT_URI"))
                .and_then(|value| value.as_deref()),
            Some(OsStr::new(
                "http://127.0.0.1:4123/integrations/google/callback"
            ))
        );
        assert_eq!(
            envs.get(OsStr::new("API_ALLOWED_ORIGINS"))
                .and_then(|value| value.as_deref()),
            Some(OsStr::new(
                "tauri://localhost,http://tauri.localhost,https://tauri.localhost"
            ))
        );
        assert_eq!(
            envs.get(OsStr::new("BRIDGE_PARENT_PID"))
                .and_then(|value| value.as_deref()),
            Some(OsStr::new(&std::process::id().to_string()))
        );
    }

    #[test]
    fn launch_capabilities_are_random_and_256_bit() {
        let first = generate_sidecar_token().expect("token generation should succeed");
        let second = generate_sidecar_token().expect("token generation should succeed");
        assert_eq!(first.len(), 64);
        assert!(first.chars().all(|character| character.is_ascii_hexdigit()));
        assert_ne!(first, second);
    }

    #[test]
    fn graceful_shutdown_uses_the_authenticated_loopback_route() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("test listener should bind");
        let port = listener
            .local_addr()
            .expect("test listener should expose its address")
            .port();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("request should connect");
            let mut request = [0_u8; 1024];
            let read = stream
                .read(&mut request)
                .expect("request should be readable");
            let request = String::from_utf8_lossy(&request[..read]);
            assert!(request.starts_with("POST /internal/sidecar/shutdown"));
            assert!(request.contains("X-Bridge-Sidecar-Token: test-sidecar-token"));
            stream
                .write_all(
                    b"HTTP/1.0 202 Accepted\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                )
                .expect("response should be writable");
        });

        request_http_stop(port, "test-sidecar-token", Duration::from_secs(1))
            .expect("authenticated shutdown should succeed");
        server.join().expect("test server should finish");
    }
}
