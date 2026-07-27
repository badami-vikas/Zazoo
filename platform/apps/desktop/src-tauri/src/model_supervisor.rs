use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    ffi::{OsStr, OsString},
    fs::{self, File, OpenOptions},
    io::{BufRead, BufReader, Read, Write},
    net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager};

#[cfg(windows)]
use std::os::windows::fs::OpenOptionsExt;
#[cfg(unix)]
use std::os::{fd::AsRawFd, unix::process::CommandExt};

const MODEL_ID: &str = "qwen3-4b-instruct-2507-q4_k_m";
const MAX_RESTARTS: u32 = 3;
const PORT_PREFIX: &str = "listening on http://127.0.0.1:";
const MODEL_GUARD_ARG: &str = "--bridge-model-guard";

#[derive(Default)]
pub struct ModelSupervisorState {
    child: Mutex<Option<Child>>,
    runtime_dir: Mutex<Option<PathBuf>>,
    runtime_lease: Mutex<Option<RuntimeLease>>,
    shutdown: AtomicBool,
}

pub fn runtime_dir_for_local_plane(local_dir: &Path) -> PathBuf {
    match local_dir.file_name() {
        Some(file_name) => {
            let mut runtime_name = file_name.to_os_string();
            runtime_name.push(".model-runtime");
            local_dir.with_file_name(runtime_name)
        }
        None => local_dir.join("model-runtime"),
    }
}

struct RuntimeLease {
    file: File,
}

impl Drop for RuntimeLease {
    fn drop(&mut self) {
        #[cfg(unix)]
        unsafe {
            libc::flock(self.file.as_raw_fd(), libc::LOCK_UN);
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EndpointCapability<'a> {
    version: u8,
    base_url: String,
    api_key: &'a str,
    model: &'a str,
    runtime_revision: &'a str,
    pid: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeFailure<'a> {
    version: u8,
    error_code: &'a str,
    failed_at: String,
}

fn target_triple() -> Option<&'static str> {
    match (std::env::consts::ARCH, std::env::consts::OS) {
        ("aarch64", "macos") => Some("aarch64-apple-darwin"),
        ("x86_64", "macos") => Some("x86_64-apple-darwin"),
        ("aarch64", "linux") => Some("aarch64-unknown-linux-gnu"),
        ("x86_64", "linux") => Some("x86_64-unknown-linux-gnu"),
        ("aarch64", "windows") => Some("aarch64-pc-windows-msvc"),
        ("x86_64", "windows") => Some("x86_64-pc-windows-msvc"),
        _ => None,
    }
}

fn generated_token() -> std::io::Result<String> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes).map_err(|error| std::io::Error::other(error.to_string()))?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn read_json(path: &Path) -> std::io::Result<Value> {
    let content = fs::read_to_string(path)?;
    serde_json::from_str(&content)
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))
}

fn sha256_file(path: &Path) -> std::io::Result<String> {
    let mut file = fs::File::open(path)?;
    let mut hash = Sha256::new();
    let mut buffer = [0_u8; 1024 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hash.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

fn required_string<'a>(value: &'a Value, pointer: &str, label: &str) -> std::io::Result<&'a str> {
    value
        .pointer(pointer)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("{label} is missing or invalid"),
            )
        })
}

fn required_u64(value: &Value, pointer: &str, label: &str) -> std::io::Result<u64> {
    value
        .pointer(pointer)
        .and_then(Value::as_u64)
        .filter(|value| *value > 0)
        .ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("{label} is missing or invalid"),
            )
        })
}

fn atomic_json<T: Serialize>(path: &Path, value: &T) -> std::io::Result<()> {
    let parent = path.parent().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "missing parent directory")
    })?;
    fs::create_dir_all(parent)?;
    let temporary = parent.join(format!(
        ".{}.{}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("endpoint"),
        std::process::id()
    ));
    let mut options = OpenOptions::new();
    options.create(true).truncate(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temporary)?;
    serde_json::to_writer(&mut file, value)?;
    file.write_all(b"\n")?;
    file.sync_all()?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&temporary, fs::Permissions::from_mode(0o600))?;
    }
    fs::rename(temporary, path)?;
    Ok(())
}

fn atomic_secret(path: &Path, value: &[u8]) -> std::io::Result<()> {
    let parent = path.parent().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "missing parent directory")
    })?;
    fs::create_dir_all(parent)?;
    let temporary = parent.join(format!(".model-secret.{}.tmp", std::process::id()));
    let mut options = OpenOptions::new();
    options.create(true).truncate(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temporary)?;
    file.write_all(value)?;
    file.sync_all()?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&temporary, fs::Permissions::from_mode(0o600))?;
    }
    fs::rename(temporary, path)?;
    Ok(())
}

fn remove_if_present(path: &Path) -> std::io::Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

fn clear_runtime_capability(runtime_dir: &Path) -> std::io::Result<()> {
    remove_if_present(&runtime_dir.join("endpoint.json"))?;
    remove_if_present(&runtime_dir.join("llama-api-key"))
}

fn verify_runtime_inventory(runtime_dir: &Path, metadata: &Value) -> std::io::Result<()> {
    let files = metadata
        .pointer("/files")
        .and_then(Value::as_object)
        .filter(|files| !files.is_empty())
        .ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "llama runtime file inventory is missing",
            )
        })?;
    let mut has_server = false;
    for (name, digest) in files {
        if Path::new(name).file_name() != Some(OsStr::new(name)) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "llama runtime inventory contains an unsafe path",
            ));
        }
        let expected = digest.as_str().filter(|value| {
            value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
        });
        let Some(expected) = expected else {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "llama runtime inventory contains an invalid digest",
            ));
        };
        let path = runtime_dir.join(name);
        if sha256_file(&path)? != expected.to_ascii_lowercase() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("bundled llama runtime file {name} failed integrity verification"),
            ));
        }
        if name
            == if cfg!(windows) {
                "llama-server.exe"
            } else {
                "llama-server"
            }
        {
            has_server = true;
        }
    }
    if !has_server {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "llama runtime inventory does not contain llama-server",
        ));
    }
    Ok(())
}

fn runtime_server_path(
    resource_dir: &Path,
    expected_revision: &str,
) -> std::io::Result<(PathBuf, PathBuf)> {
    #[cfg(debug_assertions)]
    if let Some(explicit) = std::env::var_os("BRIDGE_LLAMA_SERVER_BIN") {
        let server = PathBuf::from(explicit);
        if server.is_file() {
            let parent = server.parent().unwrap_or(Path::new(".")).to_path_buf();
            return Ok((server, parent));
        }
    }
    let runtime_dir = resource_dir.join("llama");
    let server = runtime_dir.join(if cfg!(windows) {
        "llama-server.exe"
    } else {
        "llama-server"
    });
    if !server.is_file() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "bundled llama-server is missing",
        ));
    }
    let runtime_metadata = read_json(&runtime_dir.join("bridge-llama-runtime.json"))?;
    if required_string(&runtime_metadata, "/target", "llama runtime target")?
        != target_triple().ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::Unsupported,
                "unsupported desktop target",
            )
        })?
    {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "bundled llama-server target does not match this desktop",
        ));
    }
    if required_string(
        &runtime_metadata,
        "/runtimeRevision",
        "llama runtime revision",
    )? != expected_revision
    {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "bundled llama-server revision does not match the release manifest",
        ));
    }
    verify_runtime_inventory(&runtime_dir, &runtime_metadata)?;
    Ok((server, runtime_dir))
}

fn parse_reported_port(line: &str) -> Option<u16> {
    let position = line.find(PORT_PREFIX)?;
    line[position + PORT_PREFIX.len()..]
        .split(|character: char| !character.is_ascii_digit())
        .next()?
        .parse::<u16>()
        .ok()
        .filter(|port| *port > 0)
}

fn pipe_lines<R: Read + Send + 'static>(reader: R, sender: mpsc::Sender<u16>) {
    std::thread::spawn(move || {
        for line in BufReader::new(reader).lines().map_while(Result::ok) {
            if let Some(port) = parse_reported_port(&line) {
                let _ = sender.send(port);
            }
        }
    });
}

fn run_guard(server: OsString, arguments: Vec<OsString>) -> std::io::Result<i32> {
    let mut child = Command::new(server)
        .args(arguments)
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()?;
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        let mut input = std::io::stdin();
        let mut byte = [0_u8; 1];
        let _ = input.read(&mut byte);
        let _ = sender.send(());
    });
    loop {
        if let Some(status) = child.try_wait()? {
            return Ok(status.code().unwrap_or(1));
        }
        match receiver.recv_timeout(Duration::from_millis(250)) {
            Ok(()) | Err(mpsc::RecvTimeoutError::Disconnected) => {
                let _ = child.kill();
                let _ = child.wait();
                return Ok(0);
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
    }
}

pub fn run_guard_if_requested() -> bool {
    let mut arguments = std::env::args_os();
    let _executable = arguments.next();
    if arguments.next().as_deref() != Some(OsStr::new(MODEL_GUARD_ARG)) {
        return false;
    }
    let Some(server) = arguments.next() else {
        eprintln!("[bridge-model] model guard is missing the llama-server path");
        std::process::exit(2);
    };
    match run_guard(server, arguments.collect()) {
        Ok(code) => std::process::exit(code),
        Err(error) => {
            eprintln!("[bridge-model] model guard failed: {error}");
            std::process::exit(1);
        }
    }
}

#[cfg(unix)]
fn signal_guard_process_group(child: &Child, signal: i32) {
    let process_group = -(child.id() as i32);
    // SAFETY: the guard is spawned into a dedicated process group whose id is
    // its pid; signaling that negative id cannot target the Bridge process.
    unsafe {
        libc::kill(process_group, signal);
    }
}

#[cfg(not(unix))]
fn signal_guard_process_group(_child: &Child, _signal: i32) {}

fn stop_guard(child: &mut Child) {
    if let Some(mut input) = child.stdin.take() {
        let _ = input.write_all(b"\n");
        drop(input);
    }
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => {
                #[cfg(unix)]
                signal_guard_process_group(child, libc::SIGTERM);
                return;
            }
            Ok(None) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(50));
            }
            Ok(None) | Err(_) => {
                #[cfg(unix)]
                signal_guard_process_group(child, libc::SIGKILL);
                let _ = child.kill();
                let _ = child.wait();
                return;
            }
        }
    }
}

fn await_port(
    child: &mut Child,
    receiver: &mpsc::Receiver<u16>,
    state: &ModelSupervisorState,
    start_request: &Path,
    deadline: Instant,
) -> std::io::Result<u16> {
    loop {
        if state.shutdown.load(Ordering::SeqCst) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::Interrupted,
                "desktop is shutting down",
            ));
        }
        if !start_request.is_file() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::Interrupted,
                "managed model start was cancelled",
            ));
        }
        if let Some(status) = child.try_wait()? {
            return Err(std::io::Error::new(
                std::io::ErrorKind::BrokenPipe,
                format!("llama-server exited during startup with {status}"),
            ));
        }
        match receiver.recv_timeout(Duration::from_millis(200)) {
            Ok(port) => return Ok(port),
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::BrokenPipe,
                    "llama-server closed its output before reporting a port",
                ))
            }
            Err(mpsc::RecvTimeoutError::Timeout) if Instant::now() >= deadline => {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::TimedOut,
                    "llama-server did not report its port",
                ))
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
    }
}

fn health_ok(port: u16, token: &str) -> bool {
    let address = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port);
    let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(500)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
    let request = format!(
        "GET /health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {token}\r\nConnection: close\r\n\r\n"
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let mut response = [0_u8; 64];
    let Ok(read) = stream.read(&mut response) else {
        return false;
    };
    String::from_utf8_lossy(&response[..read]).starts_with("HTTP/1.1 200")
}

fn await_health(
    child: &mut Child,
    port: u16,
    token: &str,
    state: &ModelSupervisorState,
    start_request: &Path,
    deadline: Instant,
) -> std::io::Result<()> {
    loop {
        if state.shutdown.load(Ordering::SeqCst) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::Interrupted,
                "desktop is shutting down",
            ));
        }
        if !start_request.is_file() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::Interrupted,
                "managed model start was cancelled",
            ));
        }
        if let Some(status) = child.try_wait()? {
            return Err(std::io::Error::new(
                std::io::ErrorKind::BrokenPipe,
                format!("llama-server exited during model load with {status}"),
            ));
        }
        if health_ok(port, token) {
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                "llama-server model load timed out",
            ));
        }
        std::thread::sleep(Duration::from_millis(250));
    }
}

fn server_arguments(model_path: &Path, api_key_file: &Path) -> Vec<OsString> {
    vec![
        OsString::from("--model"),
        model_path.as_os_str().to_owned(),
        OsString::from("--alias"),
        OsString::from(MODEL_ID),
        OsString::from("--host"),
        OsString::from("127.0.0.1"),
        OsString::from("--port"),
        OsString::from("0"),
        OsString::from("--api-key-file"),
        api_key_file.as_os_str().to_owned(),
        OsString::from("--ctx-size"),
        OsString::from("8192"),
        OsString::from("--n-predict"),
        OsString::from("1024"),
        OsString::from("--parallel"),
        OsString::from("1"),
        OsString::from("--offline"),
        OsString::from("--no-webui"),
    ]
}

fn launch(
    resource_dir: &Path,
    model_runtime_dir: &Path,
    state: &ModelSupervisorState,
) -> std::io::Result<Child> {
    let manifest = read_json(&resource_dir.join("model-runtime-manifest.json"))?;
    let model = manifest.pointer("/model").ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidData, "model manifest is missing")
    })?;
    if required_string(model, "/providerModelId", "model id")? != MODEL_ID {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "model manifest identity does not match the managed provider",
        ));
    }
    let runtime_revision = required_string(&manifest, "/runtime/revision", "runtime revision")?;
    let model_file = required_string(model, "/file", "model file")?;
    let expected_bytes = required_u64(model, "/bytes", "model bytes")?;
    let expected_hash = required_string(model, "/sha256", "model hash")?;
    let installation = read_json(&model_runtime_dir.join("installation.json"))?;
    if required_string(&installation, "/model", "installed model id")? != MODEL_ID
        || required_string(&installation, "/file", "installed model file")? != model_file
        || required_string(&installation, "/sha256", "installed model hash")? != expected_hash
        || required_u64(&installation, "/bytes", "installed model bytes")? != expected_bytes
    {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "installed model provenance does not match the pinned manifest",
        ));
    }
    let model_path = model_runtime_dir.join("models").join(model_file);
    if fs::metadata(&model_path)?.len() != expected_bytes {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "installed model size does not match the pinned manifest",
        ));
    }
    if sha256_file(&model_path)? != expected_hash.to_ascii_lowercase() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "installed model SHA-256 does not match the pinned manifest",
        ));
    }
    let (server, runtime_dir) = runtime_server_path(resource_dir, runtime_revision)?;
    let token = generated_token()?;
    let api_key_file = model_runtime_dir.join("llama-api-key");
    atomic_secret(&api_key_file, format!("{token}\n").as_bytes())?;
    let server_arguments = server_arguments(&model_path, &api_key_file);
    let mut command = Command::new(std::env::current_exe()?);
    command
        .current_dir(&runtime_dir)
        .arg(MODEL_GUARD_ARG)
        .arg(server)
        .args(server_arguments)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    command.process_group(0);
    if cfg!(target_os = "linux") {
        command.env("LD_LIBRARY_PATH", &runtime_dir);
    }
    if cfg!(target_os = "macos") {
        command.env("DYLD_LIBRARY_PATH", &runtime_dir);
    }
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            let _ = fs::remove_file(&api_key_file);
            return Err(error);
        }
    };
    let (sender, receiver) = mpsc::channel();
    if let Some(stdout) = child.stdout.take() {
        pipe_lines(stdout, sender.clone());
    }
    if let Some(stderr) = child.stderr.take() {
        pipe_lines(stderr, sender);
    }
    let startup_deadline = Instant::now() + Duration::from_secs(180);
    let start_request = model_runtime_dir.join("start.request");
    let port = match await_port(
        &mut child,
        &receiver,
        state,
        &start_request,
        startup_deadline,
    )
    .and_then(|port| {
        await_health(
            &mut child,
            port,
            &token,
            state,
            &start_request,
            startup_deadline,
        )?;
        Ok(port)
    }) {
        Ok(port) => port,
        Err(error) => {
            stop_guard(&mut child);
            let _ = fs::remove_file(&api_key_file);
            return Err(error);
        }
    };
    let _ = fs::remove_file(&api_key_file);
    if !start_request.is_file() || state.shutdown.load(Ordering::SeqCst) {
        stop_guard(&mut child);
        return Err(std::io::Error::new(
            std::io::ErrorKind::Interrupted,
            "managed model start was cancelled before publication",
        ));
    }
    if let Err(error) = atomic_json(
        &model_runtime_dir.join("endpoint.json"),
        &EndpointCapability {
            version: 1,
            base_url: format!("http://127.0.0.1:{port}"),
            api_key: &token,
            model: MODEL_ID,
            runtime_revision,
            pid: child.id(),
        },
    ) {
        stop_guard(&mut child);
        return Err(error);
    }
    Ok(child)
}

fn acquire_runtime_lease(runtime_dir: &Path) -> std::io::Result<RuntimeLease> {
    fs::create_dir_all(runtime_dir)?;
    let path = runtime_dir.join("supervisor.lock");
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true);
    #[cfg(windows)]
    options.share_mode(0);
    let file = options.open(path)?;
    #[cfg(unix)]
    {
        let result = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
        if result != 0 {
            return Err(std::io::Error::last_os_error());
        }
    }
    Ok(RuntimeLease { file })
}

fn stop_child(state: &ModelSupervisorState) {
    if let Ok(mut guard) = state.child.lock() {
        if let Some(mut child) = guard.take() {
            stop_guard(&mut child);
        }
    }
    let owns_runtime = state
        .runtime_lease
        .lock()
        .map(|lease| lease.is_some())
        .unwrap_or(false);
    if !owns_runtime {
        return;
    }
    if let Ok(guard) = state.runtime_dir.lock() {
        if let Some(runtime_dir) = guard.as_ref() {
            if let Err(error) = clear_runtime_capability(runtime_dir) {
                eprintln!("[bridge-model] failed to clear runtime capability: {error}");
            }
        }
    }
}

fn record_runtime_failure(path: &Path, error_code: &str) {
    let failed_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "unknown".to_string());
    if let Err(error) = atomic_json(
        path,
        &RuntimeFailure {
            version: 1,
            error_code,
            failed_at,
        },
    ) {
        eprintln!("[bridge-model] failed to persist runtime failure state: {error}");
    }
}

pub fn start(app: AppHandle, resource_dir: Option<PathBuf>, local_dir: PathBuf) {
    let runtime_dir = runtime_dir_for_local_plane(&local_dir);
    std::thread::spawn(move || {
        let Some(resource_dir) = resource_dir else {
            eprintln!("[bridge-model] resource directory unavailable; managed model disabled");
            return;
        };
        let runtime_lease = match acquire_runtime_lease(&runtime_dir) {
            Ok(lease) => lease,
            Err(error) => {
                eprintln!(
                    "[bridge-model] another desktop instance owns the managed model runtime: {error}"
                );
                return;
            }
        };
        if let Err(error) = clear_runtime_capability(&runtime_dir) {
            eprintln!("[bridge-model] could not clear stale runtime capability: {error}");
            return;
        }
        {
            let state = app.state::<ModelSupervisorState>();
            let Ok(mut lease) = state.runtime_lease.lock() else {
                eprintln!("[bridge-model] model runtime lease state is unavailable");
                return;
            };
            let Ok(mut owned_runtime_dir) = state.runtime_dir.lock() else {
                eprintln!("[bridge-model] model runtime directory state is unavailable");
                return;
            };
            *owned_runtime_dir = Some(runtime_dir.clone());
            *lease = Some(runtime_lease);
        }
        let start_request = runtime_dir.join("start.request");
        let endpoint = runtime_dir.join("endpoint.json");
        let runtime_failure = runtime_dir.join("runtime-failure.json");
        let mut failures = 0_u32;
        let mut next_attempt = Instant::now();
        let mut request_fingerprint: Option<Vec<u8>> = None;
        let mut started_at: Option<Instant> = None;
        loop {
            let state = app.state::<ModelSupervisorState>();
            if state.shutdown.load(Ordering::SeqCst) {
                stop_child(&state);
                break;
            }
            if !start_request.is_file() {
                stop_child(&state);
                failures = 0;
                request_fingerprint = None;
                started_at = None;
                let _ = fs::remove_file(&runtime_failure);
                std::thread::sleep(Duration::from_millis(500));
                continue;
            }
            let current_request_fingerprint = fs::read(&start_request).ok();
            if current_request_fingerprint != request_fingerprint {
                request_fingerprint = current_request_fingerprint;
                failures = 0;
                next_attempt = Instant::now();
                let _ = fs::remove_file(&runtime_failure);
            }
            let mut child_exited = false;
            if let Ok(mut guard) = state.child.lock() {
                if let Some(child) = guard.as_mut() {
                    match child.try_wait() {
                        Ok(Some(status)) => {
                            eprintln!("[bridge-model] llama-server exited with {status}");
                            child_exited = true;
                        }
                        Ok(None) => {}
                        Err(error) => {
                            eprintln!("[bridge-model] failed to inspect llama-server: {error}");
                            child_exited = true;
                        }
                    }
                }
                if child_exited {
                    if let Some(mut child) = guard.take() {
                        stop_guard(&mut child);
                    }
                    let _ = fs::remove_file(&endpoint);
                    failures += 1;
                    let backoff = 1_u64 << failures.min(5);
                    next_attempt = Instant::now() + Duration::from_secs(backoff);
                    started_at = None;
                    if failures >= MAX_RESTARTS {
                        record_runtime_failure(&runtime_failure, "runtime_exited");
                    }
                }
            }
            if started_at.is_some_and(|started| started.elapsed() >= Duration::from_secs(60)) {
                failures = 0;
                started_at = None;
                let _ = fs::remove_file(&runtime_failure);
            }
            let child_missing = state
                .child
                .lock()
                .map(|guard| guard.is_none())
                .unwrap_or(false);
            if child_missing && failures < MAX_RESTARTS && Instant::now() >= next_attempt {
                match launch(&resource_dir, &runtime_dir, &state) {
                    Ok(mut child) => {
                        if state.shutdown.load(Ordering::SeqCst) || !start_request.is_file() {
                            stop_guard(&mut child);
                            continue;
                        }
                        match state.child.lock() {
                            Ok(mut guard) => {
                                *guard = Some(child);
                            }
                            Err(_) => {
                                stop_guard(&mut child);
                                record_runtime_failure(
                                    &runtime_failure,
                                    "runtime_supervisor_unavailable",
                                );
                                continue;
                            }
                        }
                        started_at = Some(Instant::now());
                        let _ = fs::remove_file(&runtime_failure);
                    }
                    Err(error) => {
                        eprintln!("[bridge-model] managed llama-server start failed: {error}");
                        failures += 1;
                        let backoff = 1_u64 << failures.min(5);
                        next_attempt = Instant::now() + Duration::from_secs(backoff);
                        if failures >= MAX_RESTARTS {
                            record_runtime_failure(&runtime_failure, "runtime_start_failed");
                        }
                    }
                }
            }
            std::thread::sleep(Duration::from_millis(500));
        }
        if let Ok(mut lease) = app.state::<ModelSupervisorState>().runtime_lease.lock() {
            lease.take();
        }
    });
}

pub fn shutdown(state: &ModelSupervisorState) {
    state.shutdown.store(true, Ordering::SeqCst);
    stop_child(state);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    #[test]
    fn parses_only_loopback_listening_lines() {
        assert_eq!(
            parse_reported_port("srv  load_model: listening on http://127.0.0.1:49152"),
            Some(49152)
        );
        assert_eq!(
            parse_reported_port("listening on http://0.0.0.0:49152"),
            None
        );
        assert_eq!(parse_reported_port("listening on http://127.0.0.1:0"), None);
    }

    #[test]
    fn target_mapping_matches_release_manifest_keys() {
        assert!(target_triple().is_some());
    }

    #[test]
    fn managed_model_state_stays_outside_the_database_directory() {
        assert_eq!(
            runtime_dir_for_local_plane(Path::new("/test/bridge/local-plane")),
            PathBuf::from("/test/bridge/local-plane.model-runtime"),
        );
    }

    #[test]
    fn runtime_lease_allows_only_one_supervisor_owner() {
        let root = std::env::temp_dir().join(format!(
            "bridge-model-lease-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let first = acquire_runtime_lease(&root).unwrap();
        assert!(acquire_runtime_lease(&root).is_err());
        drop(first);
        assert!(acquire_runtime_lease(&root).is_ok());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn losing_supervisor_cannot_clear_the_runtime_owners_capability() {
        let root = std::env::temp_dir().join(format!(
            "bridge-model-lease-cleanup-{}",
            generated_token().expect("test token should generate")
        ));
        fs::create_dir_all(&root).expect("test runtime directory should exist");
        fs::write(root.join("endpoint.json"), b"owner endpoint")
            .expect("owner endpoint should be writable");
        fs::write(root.join("llama-api-key"), b"owner key").expect("owner key should be writable");

        let owner = ModelSupervisorState::default();
        *owner.runtime_dir.lock().unwrap() = Some(root.clone());
        *owner.runtime_lease.lock().unwrap() =
            Some(acquire_runtime_lease(&root).expect("owner should acquire lease"));
        let loser = ModelSupervisorState::default();
        *loser.runtime_dir.lock().unwrap() = Some(root.clone());

        stop_child(&loser);
        assert!(root.join("endpoint.json").is_file());
        assert!(root.join("llama-api-key").is_file());

        stop_child(&owner);
        assert!(!root.join("endpoint.json").exists());
        assert!(!root.join("llama-api-key").exists());
        fs::remove_dir_all(root).expect("test runtime directory should be removed");
    }

    #[test]
    fn server_uses_an_api_key_file_instead_of_a_process_argument_secret() {
        let arguments = server_arguments(
            Path::new("/private/model.gguf"),
            Path::new("/private/llama-api-key"),
        );
        assert!(arguments
            .iter()
            .any(|argument| argument == "--api-key-file"));
        assert!(!arguments.iter().any(|argument| argument == "--api-key"));
    }

    #[test]
    fn startup_clears_stale_runtime_capabilities() {
        let root = std::env::temp_dir().join(format!(
            "bridge-model-stale-capability-{}",
            generated_token().expect("test token should generate")
        ));
        fs::create_dir_all(&root).expect("test runtime directory should exist");
        fs::write(root.join("endpoint.json"), b"stale").expect("stale endpoint should be writable");
        fs::write(root.join("llama-api-key"), b"stale").expect("stale key should be writable");

        clear_runtime_capability(&root).expect("stale capability should be removable");

        assert!(!root.join("endpoint.json").exists());
        assert!(!root.join("llama-api-key").exists());
        fs::remove_dir_all(root).expect("test runtime directory should be removed");
    }

    #[test]
    fn health_probe_authenticates_with_the_runtime_capability() {
        let listener =
            TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).expect("test health listener should bind");
        let port = listener
            .local_addr()
            .expect("test health listener should expose its address")
            .port();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("health probe should connect");
            let mut request = [0_u8; 1024];
            let read = stream
                .read(&mut request)
                .expect("health request should be readable");
            let request = String::from_utf8_lossy(&request[..read]);
            assert!(request.contains("Authorization: Bearer test-runtime-token\r\n"));
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n")
                .expect("health response should be writable");
        });

        assert!(health_ok(port, "test-runtime-token"));
        server.join().expect("health listener should finish");
    }

    #[test]
    fn runtime_inventory_detects_file_tampering() {
        let root = std::env::temp_dir().join(format!(
            "bridge-llama-runtime-test-{}",
            generated_token().expect("test token should generate")
        ));
        fs::create_dir_all(&root).expect("test runtime directory should exist");
        let server_name = if cfg!(windows) {
            "llama-server.exe"
        } else {
            "llama-server"
        };
        let server = root.join(server_name);
        fs::write(&server, b"pinned runtime").expect("test runtime should be writable");
        let metadata = serde_json::json!({
            "files": {
                (server_name): sha256_file(&server).expect("test runtime should hash")
            }
        });

        verify_runtime_inventory(&root, &metadata)
            .expect("matching runtime inventory should verify");
        fs::write(&server, b"changed runtime").expect("test runtime should be mutable");
        assert!(verify_runtime_inventory(&root, &metadata).is_err());
        fs::remove_dir_all(root).expect("test runtime directory should be removed");
    }
}
