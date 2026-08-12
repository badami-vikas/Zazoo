//! api_sidecar — the managed @bridge/api child process (R-001 offline desktop).
//!
//! The desktop shell is self-contained offline by spawning the Fastify API
//! build as a child Node process on a
//! parent-reserved loopback listener, health-checking `/health`, and injecting
//! the resolved URL into both webviews as `window.__BRIDGE_API_URL__` (an
//! initialization script, so it exists before the tRPC client module evaluates).
//!
//! Decisions (ADR-024 and ADR-144 in docs/raw/decisions-log.md):
//!  - `std::process::Command` owns the child lifecycle. Release bundles carry
//!    the portable API tree as a resource and the target Node runtime as a
//!    signed Tauri external binary. System Node is a debug-only convenience;
//!    BRIDGE_NODE_BIN remains an explicit power-user/test override.
//!  - Rust binds 127.0.0.1:0, retains that listener for the webview lifetime,
//!    and passes the same descriptor to Node. The child reports the inherited
//!    port over stdout; a crashed child therefore cannot hand it to an attacker.
//!  - Debug and release use the same managed sidecar identity boundary. Only
//!    the frontend host changes in debug.
//!
//! The Local Plane is always file-backed under Tauri's app-data directory.
//! Cloud/control-plane persistence remains independently configured through
//! DATABASE_URL.

use std::io::{BufRead as _, BufReader, Read as _, Write as _};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Mutex};
use std::time::{Duration, Instant};

/// Managed API process and authenticated loopback shutdown material. `None` in
/// dev mode / when the spawn failed.
///
/// `stopping` lets a long-running restart abandon itself the moment the app
/// starts quitting: `restart` holds the mutex while it waits on a fresh child,
/// and app exit must not block behind that wait.
#[derive(Default)]
pub struct ApiSidecarState {
    pub inner: Mutex<Option<SpawnedApi>>,
    pub stopping: AtomicBool,
}

/// Everything needed to put an identical child back on the retained socket.
/// Held so a crashed sidecar can be replaced without re-resolving anything and,
/// critically, without minting a new port or token — the webviews were handed
/// those at creation and cannot be re-scripted afterwards.
#[derive(Clone)]
struct RespawnPlan {
    node: PathBuf,
    entry: PathBuf,
    local_dir: PathBuf,
    native_keyring: Option<PathBuf>,
}

pub struct SpawnedApi {
    pub port: u16,
    pub child: Child,
    pub token: String,
    listener_reservation: Option<TcpListener>,
    respawn: RespawnPlan,
}

/// Resolve the built API entrypoint. Order:
///  1. BRIDGE_API_SERVER_JS env override (power users / tests)
///  2. Debug only: the monorepo build, which `prepare-dev.mjs` just rebuilt
///  3. Tauri resource dir (`<resources>/api/dist/src/server.js`)
///  4. Monorepo-relative path (debug fallback, same path as 2)
///
/// Step 2 is the one that looks out of place and is load-bearing. The staged
/// copy under the resource dir is produced by `prepare:bundle`, which is wired
/// as `beforeBuildCommand` — production only. `beforeDevCommand` rebuilds the
/// monorepo tree and stages nothing, while Tauri keeps copying the *existing*
/// `generated/api/` into `target/debug/api/` and never prunes it. Preferring
/// the resource copy in debug therefore pins the dev app to whatever the API
/// looked like the last time someone ran a production bundle: after a `git
/// pull` it fails with `ERR_MODULE_NOT_FOUND`, the sidecar never reports a
/// port, and the app shows "Local Plane unavailable" with a perfectly good
/// build sitting on disk. Release builds are unaffected — `debug_assertions`
/// is false there, so the signed resource tree stays authoritative.
pub fn resolve_api_entry(resource_dir: Option<PathBuf>) -> Option<PathBuf> {
    resolve_api_entry_from(
        std::env::var_os("BRIDGE_API_SERVER_JS").map(PathBuf::from),
        resource_dir,
    )
}

/// Resolution logic with the env override passed explicitly, so tests can
/// exercise the ordering without mutating process env (which is shared across
/// parallel test threads).
fn resolve_api_entry_from(
    override_entry: Option<PathBuf>,
    resource_dir: Option<PathBuf>,
) -> Option<PathBuf> {
    if let Some(p) = override_entry {
        if p.is_file() {
            return Some(p);
        }
    }
    // apps/desktop/src-tauri → apps/api/dist/src/server.js
    let repo_relative =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../api/dist/src/server.js");
    if cfg!(debug_assertions) && repo_relative.is_file() {
        return Some(repo_relative);
    }
    if let Some(dir) = resource_dir {
        let p = dir.join("api").join("dist/src/server.js");
        if p.is_file() {
            return Some(p);
        }
    }
    if cfg!(debug_assertions) && repo_relative.is_file() {
        return Some(repo_relative);
    }
    None
}

fn packaged_node_at(desktop_executable: &Path) -> Option<PathBuf> {
    let binary_name = if cfg!(windows) {
        "bridge-node.exe"
    } else {
        "bridge-node"
    };
    desktop_executable
        .parent()
        .map(|parent| parent.join(binary_name))
}

#[cfg(target_os = "macos")]
fn packaged_keyring_at(desktop_executable: &Path) -> Option<PathBuf> {
    desktop_executable
        .parent()?
        .parent()
        .map(|contents| contents.join("Frameworks/bridge-keyring.dylib"))
}

/// Resolve the Node runtime. Release builds accept only an explicit override
/// or the Tauri-packaged external binary beside the desktop executable.
fn resolve_node_binary() -> Option<PathBuf> {
    if let Ok(path) = std::env::var("BRIDGE_NODE_BIN") {
        let path = PathBuf::from(path);
        if path.is_file() {
            return Some(path);
        }
    }
    if cfg!(debug_assertions) {
        return Some(PathBuf::from("node"));
    }
    let packaged = packaged_node_at(&std::env::current_exe().ok()?)?;
    packaged.is_file().then_some(packaged)
}

fn resolve_native_keyring() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        if cfg!(debug_assertions) {
            return None;
        }
        let packaged = packaged_keyring_at(&std::env::current_exe().ok()?)?;
        packaged.is_file().then_some(packaged)
    }
    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}

pub fn dev_web_port() -> u16 {
    std::env::var("BRIDGE_WEB_DEV_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .filter(|port| *port > 0)
        .unwrap_or(5173)
}

fn generate_sidecar_token() -> std::io::Result<String> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes).map_err(|error| std::io::Error::other(error.to_string()))?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn api_command(
    node: &std::path::Path,
    entry: &PathBuf,
    local_dir: &PathBuf,
    token: &str,
    native_keyring: Option<&Path>,
    inherited_listener: Option<&TcpListener>,
) -> Command {
    let mut command = Command::new(node);
    let mut allowed_origins =
        "tauri://localhost,http://tauri.localhost,https://tauri.localhost".to_string();
    if cfg!(debug_assertions) {
        let port = dev_web_port();
        allowed_origins.push_str(&format!(",http://localhost:{port},http://127.0.0.1:{port}"));
    }
    command
        .arg(entry)
        .env_remove("NODE_ENV")
        .env("BRIDGE_ENV", "production")
        .env("PORT", "0")
        // Bind loopback only — never expose the kernel API on the LAN.
        .env("API_HOST", "127.0.0.1")
        .env("BRIDGE_LOCAL_DIR", local_dir)
        .env(
            "BRIDGE_MODEL_RUNTIME_DIR",
            crate::model_supervisor::runtime_dir_for_local_plane(local_dir),
        )
        .env(
            "BRIDGE_LLAMA_CAPABILITY_FILE",
            crate::model_supervisor::runtime_dir_for_local_plane(local_dir).join("endpoint.json"),
        )
        .env("BRIDGE_LOCAL_RESIDENCY", "desktop-local")
        // AI Harness K0 (ADR-210/AP-131, TASK-044): the three learning flights
        // run live for the pilot. Desktop is the full Local-Plane loop —
        // observation digest, retrieval fusion + embedding indexer, Commons
        // archetypes. Hosted pilot gets the same flags via render.yaml.
        .env("BRIDGE_LEARNING_OBSERVATION", "1")
        .env("BRIDGE_RETRIEVAL_FUSION", "1")
        .env("BRIDGE_COMMONS_ARCHETYPES", "1")
        // AI Harness K3 (ADR-215, TASK-047): claim substrate — entities +
        // claims live on the desktop's durable Local Plane.
        .env("BRIDGE_CLAIM_SUBSTRATE", "1")
        .env("BRIDGE_DEALPILOT_CREDENTIAL_VAULT", "os-keyring")
        .env("BRIDGE_SIDECAR_TOKEN", token)
        .env("BRIDGE_OAUTH_DESKTOP", "1")
        .env("API_ALLOWED_ORIGINS", allowed_origins)
        .env("BRIDGE_PARENT_PID", std::process::id().to_string())
        .env("BRIDGE_PARENT_LIVENESS", "stdin")
        .env_remove("NAPI_RS_NATIVE_LIBRARY_PATH")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped());
    if let Some(native_keyring) = native_keyring {
        command.env("BRIDGE_KEYRING_NATIVE_LIBRARY", native_keyring);
    }
    #[cfg(unix)]
    if let Some(listener) = inherited_listener {
        use std::os::fd::AsRawFd as _;
        use std::os::unix::process::CommandExt as _;

        let listener_fd = listener.as_raw_fd();
        command.env("BRIDGE_LISTEN_FD", listener_fd.to_string());
        // SAFETY: this pre-exec closure makes one fcntl syscall and allocates
        // nothing. It clears CLOEXEC only in the forked child, avoiding a
        // process-wide inheritance race in the multi-threaded desktop shell.
        unsafe {
            command.pre_exec(move || {
                let flags = libc::fcntl(listener_fd, libc::F_GETFD);
                if flags == -1 {
                    return Err(std::io::Error::last_os_error());
                }
                if libc::fcntl(listener_fd, libc::F_SETFD, flags & !libc::FD_CLOEXEC) == -1 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
    }
    #[cfg(not(unix))]
    let _ = inherited_listener;
    command
}

fn reserve_sidecar_listener() -> std::io::Result<TcpListener> {
    #[cfg(unix)]
    {
        TcpListener::bind("127.0.0.1:0")
    }
    #[cfg(not(unix))]
    {
        Err(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "secure inherited-listener sidecars are not implemented on this operating system",
        ))
    }
}

/// Spawn `node server.js` with a durable Local Plane directory.
pub fn spawn_api(
    node: &std::path::Path,
    entry: &PathBuf,
    local_dir: &PathBuf,
    token: &str,
    native_keyring: Option<&Path>,
    inherited_listener: Option<&TcpListener>,
) -> std::io::Result<Child> {
    api_command(
        node,
        entry,
        local_dir,
        token,
        native_keyring,
        inherited_listener,
    )
    .spawn()
}

const LISTENING_PREFIX: &str = "bridge-api listening at http://127.0.0.1:";

fn reported_port(line: &str) -> Option<u16> {
    line.trim()
        .strip_prefix(LISTENING_PREFIX)?
        .parse::<u16>()
        .ok()
        .filter(|port| *port > 0)
}

fn await_reported_port(child: &mut Child, timeout: Duration) -> std::io::Result<u16> {
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| std::io::Error::other("sidecar stdout pipe is unavailable"))?;
    let (sender, receiver) = mpsc::sync_channel(1);
    std::thread::Builder::new()
        .name("bridge-api-stdout".to_string())
        .spawn(move || {
            let mut sent = false;
            for line in BufReader::new(stdout).lines() {
                match line {
                    Ok(line) => {
                        if !sent {
                            if let Some(port) = reported_port(&line) {
                                let _ = sender.send(port);
                                sent = true;
                            }
                        }
                        println!("{line}");
                    }
                    Err(error) => {
                        eprintln!("[bridge-desktop] api sidecar stdout failed: {error}");
                        break;
                    }
                }
            }
        })
        .map_err(|error| std::io::Error::other(error.to_string()))?;
    let deadline = Instant::now() + timeout;
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                "sidecar did not report its bound port before the startup deadline",
            ));
        }
        match receiver.recv_timeout(remaining.min(Duration::from_millis(250))) {
            Ok(port) => return Ok(port),
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if let Some(status) = child.try_wait()? {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::BrokenPipe,
                        format!("sidecar exited before reporting its port with status {status}"),
                    ));
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::BrokenPipe,
                    "sidecar stdout closed before reporting its port",
                ));
            }
        }
    }
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

/// Retry `/health` within one overall deadline while confirming that the exact
/// child is still alive. The retained listener makes connect succeed even after
/// child exit, so liveness must be checked between bounded reads.
fn wait_child_healthy(
    child: &mut Child,
    port: u16,
    token: &str,
    timeout: Duration,
) -> std::io::Result<bool> {
    let deadline = Instant::now() + timeout;
    loop {
        if let Some(status) = child.try_wait()? {
            return Err(std::io::Error::new(
                std::io::ErrorKind::BrokenPipe,
                format!("sidecar exited during readiness with status {status}"),
            ));
        }
        if health_ok(port, token, Duration::from_millis(250)) {
            return Ok(true);
        }
        if Instant::now() >= deadline {
            return Ok(false);
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

/// Spawn the API and return URL material only after its authenticated health
/// route answers and the child is still alive. An unavailable sidecar leaves
/// the release webview transport unconfigured instead of exposing credentials
/// to an arbitrary localhost listener.
pub fn start(resource_dir: Option<PathBuf>, local_dir: PathBuf) -> Option<SpawnedApi> {
    let Some(entry) = resolve_api_entry(resource_dir) else {
        eprintln!(
            "[bridge-desktop] api sidecar: no API build found \
             (set BRIDGE_API_SERVER_JS in debug, or rebuild the desktop bundle). \
             Running shell without embedded API."
        );
        return None;
    };
    let Some(node) = resolve_node_binary() else {
        eprintln!(
            "[bridge-desktop] api sidecar: no Node runtime found \
             (set BRIDGE_NODE_BIN in debug, or rebuild the desktop bundle). \
             Running shell without embedded API."
        );
        return None;
    };
    let native_keyring = resolve_native_keyring();
    #[cfg(all(target_os = "macos", not(debug_assertions)))]
    if native_keyring.is_none() {
        eprintln!(
            "[bridge-desktop] api sidecar: the signed macOS keyring framework is missing. \
             Refusing a release API that cannot load the credential vault."
        );
        return None;
    }
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
    let listener_reservation = match reserve_sidecar_listener() {
        Ok(listener) => listener,
        Err(error) => {
            eprintln!(
                "[bridge-desktop] api sidecar: secure loopback socket activation is unavailable: \
                 {error}. Refusing a rebindable credential-bearing transport."
            );
            return None;
        }
    };
    let reserved_port = match listener_reservation.local_addr() {
        Ok(address) => address.port(),
        Err(error) => {
            eprintln!(
                "[bridge-desktop] api sidecar: could not inspect the reserved loopback socket: \
                 {error}"
            );
            return None;
        }
    };
    let mut child = match spawn_api(
        &node,
        &entry,
        &local_dir,
        &token,
        native_keyring.as_deref(),
        Some(&listener_reservation),
    ) {
        Ok(c) => c,
        Err(err) => {
            eprintln!("[bridge-desktop] api sidecar: failed to spawn {node:?} on {entry:?}: {err}");
            return None;
        }
    };
    if !verify_child_on_reserved_port(&mut child, reserved_port, &token, Duration::from_secs(60)) {
        return None;
    }
    println!("[bridge-desktop] api sidecar healthy at http://127.0.0.1:{reserved_port}");
    Some(SpawnedApi {
        port: reserved_port,
        child,
        token,
        listener_reservation: Some(listener_reservation),
        respawn: RespawnPlan {
            node,
            entry,
            local_dir,
            native_keyring,
        },
    })
}

/// Drive a freshly spawned child to "authenticated /health answers on the port
/// we reserved". Kills the child and returns false on every failure, so a
/// half-started sidecar never becomes a configured transport.
fn verify_child_on_reserved_port(
    child: &mut Child,
    reserved_port: u16,
    token: &str,
    port_timeout: Duration,
) -> bool {
    match await_reported_port(child, port_timeout) {
        Ok(port) if port == reserved_port => {}
        Ok(port) => {
            eprintln!(
                "[bridge-desktop] api sidecar: child reported port {port}, but the retained \
                 loopback reservation is {reserved_port}; refusing the transport"
            );
            let _ = child.kill();
            let _ = child.wait();
            return false;
        }
        Err(error) => {
            eprintln!(
                "[bridge-desktop] api sidecar: could not obtain the child-bound port: {error}; \
                 refusing to configure the webview transport"
            );
            let _ = child.kill();
            let _ = child.wait();
            return false;
        }
    }
    match wait_child_healthy(child, reserved_port, token, Duration::from_secs(10)) {
        Ok(true) => {}
        Ok(false) => {
            eprintln!(
                "[bridge-desktop] api sidecar: authenticated /health never answered on port \
                 {reserved_port} within the readiness deadline; refusing the webview transport"
            );
            let _ = child.kill();
            let _ = child.wait();
            return false;
        }
        Err(error) => {
            eprintln!(
                "[bridge-desktop] api sidecar: child failed during authenticated readiness: \
                 {error}; refusing the webview transport"
            );
            let _ = child.kill();
            let _ = child.wait();
            return false;
        }
    }
    match child.try_wait() {
        Ok(None) => true,
        Ok(Some(status)) => {
            eprintln!(
                "[bridge-desktop] api sidecar exited during readiness with status {status}; \
                 refusing to configure the webview transport"
            );
            false
        }
        Err(error) => {
            eprintln!(
                "[bridge-desktop] api sidecar readiness could not verify the child: {error}; \
                 refusing to configure the webview transport"
            );
            let _ = child.kill();
            let _ = child.wait();
            false
        }
    }
}

/// Replace a dead sidecar child in place, reusing the retained loopback
/// listener and the original launch token.
///
/// This is what keeps a sidecar crash recoverable. The webviews were handed
/// `window.__BRIDGE_API_URL__` and their capability token by an initialization
/// script at window-creation time and there is no way to re-script a live
/// webview, so a replacement that minted a fresh port or token would be
/// unreachable — which is exactly why sidecar loss used to be terminal.
///
/// The ADR-144 boundary is preserved rather than bent: the parent never
/// released the reserved socket, so nothing else could have bound that port in
/// the gap, and the new child inherits the very same descriptor.
pub fn restart(state: &ApiSidecarState) -> bool {
    if state.stopping.load(Ordering::SeqCst) {
        return false;
    }
    let Ok(mut guard) = state.inner.lock() else {
        eprintln!("[bridge-desktop] api sidecar: lifecycle state is poisoned; cannot restart");
        return false;
    };
    let Some(previous) = guard.take() else {
        return false;
    };
    let SpawnedApi {
        port,
        mut child,
        token,
        listener_reservation,
        respawn,
    } = previous;
    // Reap whatever is left of the old child before rebinding, so the inherited
    // descriptor is not shared with a process that is still exiting.
    match child.try_wait() {
        Ok(Some(_)) => {}
        _ => {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    if state.stopping.load(Ordering::SeqCst) {
        return false;
    }
    let Some(listener) = listener_reservation else {
        eprintln!(
            "[bridge-desktop] api sidecar: the loopback reservation was released; refusing to \
             rebind a credential-bearing port"
        );
        return false;
    };
    let mut replacement = match spawn_api(
        &respawn.node,
        &respawn.entry,
        &respawn.local_dir,
        &token,
        respawn.native_keyring.as_deref(),
        Some(&listener),
    ) {
        Ok(child) => child,
        Err(error) => {
            eprintln!("[bridge-desktop] api sidecar: respawn failed: {error}");
            return false;
        }
    };
    if !verify_child_on_reserved_port(&mut replacement, port, &token, Duration::from_secs(30)) {
        return false;
    }
    println!("[bridge-desktop] api sidecar recovered on http://127.0.0.1:{port}");
    *guard = Some(SpawnedApi {
        port,
        child: replacement,
        token,
        listener_reservation: Some(listener),
        respawn,
    });
    true
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
        listener_reservation: _listener_reservation,
        respawn: _respawn,
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
    // The HTTP endpoint first stops new work; closing the inherited liveness
    // pipe then drives the shared process-exit path instead of leaving resumed
    // stdin to keep Node alive until the force-kill deadline.
    let liveness_pipe_closed = child.stdin.take().is_some();
    if graceful_stop_result.is_err() && liveness_pipe_closed {
        graceful_stop_result = Ok(());
    }
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
    // Latch first: a restart in flight is holding the mutex while it waits on a
    // fresh child, and app exit must not sit behind that. The flag tells it to
    // abandon the replacement instead.
    state.stopping.store(true, Ordering::SeqCst);
    if let Ok(mut guard) = state.inner.lock() {
        if let Some(api) = guard.take() {
            stop_child(api);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsStr;
    use std::net::TcpListener;

    #[test]
    fn dev_prefers_the_live_monorepo_build_over_a_staged_copy() {
        // A stale `target/debug/api` used to win over the API that
        // `beforeDevCommand` had just rebuilt, so a `git pull` surfaced as
        // "Local Plane unavailable" until someone manually re-staged.
        let staged = std::env::temp_dir().join("bridge-stale-resource-dir");
        let staged_entry = staged.join("api").join("dist/src/server.js");
        std::fs::create_dir_all(staged_entry.parent().expect("staged parent"))
            .expect("staged resource tree");
        std::fs::write(&staged_entry, "// stale").expect("staged entry");

        let live = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../api/dist/src/server.js");
        let resolved = resolve_api_entry_from(None, Some(staged.clone()));
        let _ = std::fs::remove_dir_all(&staged);

        if live.is_file() {
            assert_eq!(
                resolved.as_deref(),
                Some(live.as_path()),
                "debug builds must run the freshly built API, not a staged copy"
            );
        } else {
            // No monorepo build present (a bare checkout): the staged copy is
            // still the correct answer rather than nothing at all.
            assert_eq!(resolved.as_deref(), Some(staged_entry.as_path()));
        }
    }

    #[test]
    fn an_explicit_override_still_wins_over_everything() {
        let dir = std::env::temp_dir().join("bridge-override-entry");
        std::fs::create_dir_all(&dir).expect("override dir");
        let entry = dir.join("server.js");
        std::fs::write(&entry, "// override").expect("override entry");
        let resolved = resolve_api_entry_from(Some(entry.clone()), None);
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(resolved.as_deref(), Some(entry.as_path()));
    }

    #[test]
    fn sidecar_command_sets_durable_local_plane_directory() {
        let node = PathBuf::from("node");
        let entry = PathBuf::from("server.js");
        let local_dir = PathBuf::from("/test/bridge/local-plane");
        let command = api_command(&node, &entry, &local_dir, "test-sidecar-token", None, None);
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
            envs.get(OsStr::new("BRIDGE_MODEL_RUNTIME_DIR"))
                .and_then(|value| value.as_deref()),
            Some(OsStr::new("/test/bridge/local-plane.model-runtime"))
        );
        assert_eq!(envs.get(OsStr::new("NODE_ENV")), Some(&None));
        assert_eq!(
            envs.get(OsStr::new("BRIDGE_ENV"))
                .and_then(|value| value.as_deref()),
            Some(OsStr::new("production"))
        );
        assert_eq!(
            envs.get(OsStr::new("BRIDGE_LOCAL_RESIDENCY"))
                .and_then(|value| value.as_deref()),
            Some(OsStr::new("desktop-local"))
        );
        assert_eq!(
            envs.get(OsStr::new("PORT"))
                .and_then(|value| value.as_deref()),
            Some(OsStr::new("0"))
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
        assert!(!envs.contains_key(OsStr::new("GOOGLE_REDIRECT_URI")));
        assert_eq!(
            envs.get(OsStr::new("API_ALLOWED_ORIGINS"))
                .and_then(|value| value.as_deref()),
            Some(OsStr::new(if cfg!(debug_assertions) {
                "tauri://localhost,http://tauri.localhost,https://tauri.localhost,http://localhost:5173,http://127.0.0.1:5173"
            } else {
                "tauri://localhost,http://tauri.localhost,https://tauri.localhost"
            }))
        );
        assert_eq!(command.get_program(), OsStr::new("node"));
        assert_eq!(
            envs.get(OsStr::new("BRIDGE_PARENT_PID"))
                .and_then(|value| value.as_deref()),
            Some(OsStr::new(&std::process::id().to_string()))
        );
        assert_eq!(
            envs.get(OsStr::new("BRIDGE_PARENT_LIVENESS"))
                .and_then(|value| value.as_deref()),
            Some(OsStr::new("stdin"))
        );
    }

    #[cfg(unix)]
    #[test]
    fn sidecar_command_inherits_the_retained_loopback_listener() {
        use std::os::fd::AsRawFd as _;

        let node = PathBuf::from("node");
        let entry = PathBuf::from("server.js");
        let local_dir = PathBuf::from("/test/bridge/local-plane");
        let listener = reserve_sidecar_listener().expect("loopback listener should bind");
        let command = api_command(
            &node,
            &entry,
            &local_dir,
            "test-sidecar-token",
            None,
            Some(&listener),
        );
        let envs = command
            .get_envs()
            .map(|(key, value)| (key.to_owned(), value.map(OsStr::to_owned)))
            .collect::<std::collections::HashMap<_, _>>();

        assert_eq!(
            envs.get(OsStr::new("BRIDGE_LISTEN_FD"))
                .and_then(|value| value.as_deref()),
            Some(OsStr::new(&listener.as_raw_fd().to_string()))
        );
    }

    #[test]
    fn sidecar_command_turns_the_learning_flights_on() {
        // AI Harness K0 (ADR-210, TASK-044): the desktop pilot runs the full
        // Local-Plane learning loop. A flag silently dropped here would turn
        // the harness off for every desktop user with no error anywhere —
        // the API fails closed per procedure, so nothing would ever look broken.
        let command = api_command(
            Path::new("node"),
            &PathBuf::from("server.js"),
            &PathBuf::from("/test/bridge/local-plane"),
            "test-sidecar-token",
            None,
            None,
        );
        let envs = command
            .get_envs()
            .map(|(key, value)| (key.to_owned(), value.map(OsStr::to_owned)))
            .collect::<std::collections::HashMap<_, _>>();

        for flight in [
            "BRIDGE_LEARNING_OBSERVATION",
            "BRIDGE_RETRIEVAL_FUSION",
            "BRIDGE_COMMONS_ARCHETYPES",
            "BRIDGE_CLAIM_SUBSTRATE",
        ] {
            assert_eq!(
                envs.get(OsStr::new(flight)).and_then(|value| value.as_deref()),
                Some(OsStr::new("1")),
                "{flight} must be ON for the desktop pilot (AI Harness K0)"
            );
        }
    }

    #[test]
    fn packaged_node_is_resolved_beside_the_desktop_executable() {
        let executable = PathBuf::from("/Applications/Bridge.app/Contents/MacOS/bridge");
        assert_eq!(
            packaged_node_at(&executable),
            Some(executable.parent().unwrap().join(if cfg!(windows) {
                "bridge-node.exe"
            } else {
                "bridge-node"
            }))
        );
    }

    #[test]
    fn sidecar_command_uses_the_reviewed_signed_keyring_loader() {
        let native_keyring =
            PathBuf::from("/Applications/Bridge.app/Contents/Frameworks/bridge-keyring.dylib");
        let command = api_command(
            Path::new("node"),
            &PathBuf::from("server.js"),
            &PathBuf::from("/test/bridge/local-plane"),
            "test-sidecar-token",
            Some(&native_keyring),
            None,
        );
        let envs = command
            .get_envs()
            .map(|(key, value)| (key.to_owned(), value.map(OsStr::to_owned)))
            .collect::<std::collections::HashMap<_, _>>();

        assert!(
            matches!(
                envs.get(OsStr::new("NAPI_RS_NATIVE_LIBRARY_PATH")),
                Some(None)
            ),
            "the broken @napi-rs environment override must stay removed"
        );
        assert_eq!(
            envs.get(OsStr::new("BRIDGE_KEYRING_NATIVE_LIBRARY"))
                .and_then(|value| value.as_deref()),
            Some(native_keyring.as_os_str())
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn packaged_keyring_is_resolved_from_the_signed_frameworks_directory() {
        let executable = PathBuf::from("/Applications/Bridge.app/Contents/MacOS/bridge-desktop");
        assert_eq!(
            packaged_keyring_at(&executable),
            Some(PathBuf::from(
                "/Applications/Bridge.app/Contents/Frameworks/bridge-keyring.dylib"
            ))
        );
    }

    #[test]
    fn retained_listener_prevents_port_rebinding_after_the_server_copy_closes() {
        let reservation = TcpListener::bind("127.0.0.1:0").expect("reservation should bind");
        let port = reservation
            .local_addr()
            .expect("reservation should expose its address")
            .port();
        let server_copy = reservation
            .try_clone()
            .expect("listener should be clonable");

        drop(server_copy);
        assert!(
            TcpListener::bind(("127.0.0.1", port)).is_err(),
            "the parent reservation must keep the credential-bearing port unavailable"
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
    fn child_reported_port_parser_accepts_only_the_exact_loopback_marker() {
        assert_eq!(
            reported_port("bridge-api listening at http://127.0.0.1:4123"),
            Some(4123)
        );
        assert_eq!(
            reported_port("bridge-api listening at http://0.0.0.0:4123"),
            None
        );
        assert_eq!(
            reported_port("bridge-api listening at http://127.0.0.1:0"),
            None
        );
        assert_eq!(reported_port("untrusted prefix 4123"), None);
    }

    #[test]
    fn port_report_wait_stops_when_the_child_exits() {
        #[cfg(windows)]
        let mut command = {
            let mut command = Command::new("cmd");
            command.args(["/C", "exit 0"]);
            command
        };
        #[cfg(not(windows))]
        let mut command = {
            let mut command = Command::new("sh");
            command.args(["-c", "exit 0"]);
            command
        };
        let mut child = command
            .stdout(Stdio::piped())
            .spawn()
            .expect("exiting child should spawn");

        let started = Instant::now();
        assert!(await_reported_port(&mut child, Duration::from_secs(5)).is_err());
        assert!(
            started.elapsed() < Duration::from_secs(1),
            "port-report wait must observe child exit before its startup deadline"
        );
    }

    #[test]
    fn inherited_parent_liveness_pipe_closes_the_child() {
        #[cfg(windows)]
        let mut command = {
            let mut command = Command::new("cmd");
            command.args(["/C", "more > NUL"]);
            command
        };
        #[cfg(not(windows))]
        let mut command = {
            let mut command = Command::new("sh");
            command.args(["-c", "cat >/dev/null"]);
            command
        };
        let mut child = command
            .stdin(Stdio::piped())
            .spawn()
            .expect("liveness probe child should spawn");
        assert!(child
            .try_wait()
            .expect("liveness probe status should be readable")
            .is_none());
        drop(child.stdin.take());
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            if child
                .try_wait()
                .expect("liveness probe status should be readable")
                .is_some()
            {
                break;
            }
            assert!(
                Instant::now() < deadline,
                "child must exit when the owning parent closes the liveness pipe"
            );
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    #[test]
    fn readiness_stops_immediately_when_the_child_exits() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("test listener should bind");
        let port = listener
            .local_addr()
            .expect("test listener should expose its address")
            .port();
        #[cfg(windows)]
        let mut child = Command::new("cmd")
            .args(["/C", "exit 0"])
            .spawn()
            .expect("exiting child should spawn");
        #[cfg(not(windows))]
        let mut child = Command::new("sh")
            .args(["-c", "exit 0"])
            .spawn()
            .expect("exiting child should spawn");

        let started = Instant::now();
        assert!(wait_child_healthy(
            &mut child,
            port,
            "test-sidecar-token",
            Duration::from_secs(5),
        )
        .is_err());
        assert!(
            started.elapsed() < Duration::from_secs(1),
            "readiness must observe child exit instead of waiting on the retained listener"
        );
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

    #[test]
    fn successful_http_shutdown_also_closes_the_liveness_pipe() {
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
            stream
                .write_all(
                    b"HTTP/1.0 202 Accepted\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                )
                .expect("response should be writable");
        });
        #[cfg(windows)]
        let mut command = {
            let mut command = Command::new("cmd");
            command.args(["/C", "more > NUL"]);
            command
        };
        #[cfg(not(windows))]
        let mut command = {
            let mut command = Command::new("sh");
            command.args(["-c", "cat >/dev/null"]);
            command
        };
        let child = command
            .stdin(Stdio::piped())
            .spawn()
            .expect("liveness probe child should spawn");

        let started = Instant::now();
        stop_child(SpawnedApi {
            port,
            child,
            token: "test-sidecar-token".to_string(),
            listener_reservation: None,
            respawn: RespawnPlan {
                node: PathBuf::from("node"),
                entry: PathBuf::from("server.js"),
                local_dir: PathBuf::from("/test/bridge/local-plane"),
                native_keyring: None,
            },
        });

        assert!(
            started.elapsed() < Duration::from_secs(2),
            "successful HTTP shutdown must not wait for the force-kill deadline"
        );
        server.join().expect("test server should finish");
    }
}
