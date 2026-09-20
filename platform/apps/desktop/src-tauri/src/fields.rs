//! fields — the Avatar's clipboard for forms. "Copy all fields" reads every
//! labelled control in the app in front through the macOS Accessibility
//! tree (no screenshot, no cloud call, nothing leaves the machine) and keeps
//! the record in a Local file. "Fill" puts a reviewed list of label→value
//! pairs into the form in front with the Avatar's own hands (`actuator.rs`),
//! so the user sees every field being filled and can stop it by moving the
//! mouse.
//!
//! Govern before executing — what this file owns:
//! - Reading needs the Accessibility grant (fail closed) and runs the same
//!   privacy guard as the hands: a credential-looking window is never read.
//! - Secure text fields (passwords) are skipped at the tree, never stored.
//! - Filling needs `allow_control` (the panel's explicit switch), the grant,
//!   the guard, and the per-app allowlist — the same gates as `act.rs`.
//! - The panel decides WHAT is filled: this file only executes the entries it
//!   is handed and matches them to live controls by exact label.
//! - The record lives in `{app_data_dir}/bridge/clipboard.json` (Local Plane;
//!   inspectable; never synced).

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::actuator::{self, ActuatorError, Key, MouseButton};
use crate::companion::{guarded_frontmost_app, CompanionError};

const MAX_RECORDS: usize = 20;
/// Same cap as one typed step in `act.rs`.
const MAX_VALUE_CHARS: usize = 500;
const SETTLE: Duration = Duration::from_millis(150);

fn err(code: &'static str, message: impl Into<String>) -> CompanionError {
    CompanionError { code, message: message.into() }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Field {
    pub label: String,
    pub value: String,
    /// `text` | `checkbox` | `radio` | `popup`
    pub kind: String,
    /// Global top-left-origin logical points, meaningful only for a live read.
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
    #[serde(default)]
    pub width: f64,
    #[serde(default)]
    pub height: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FieldRecord {
    pub id: u64,
    pub app: String,
    pub title: String,
    /// Unix ms.
    pub at: u64,
    pub fields: Vec<Field>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldSnapshot {
    pub app: String,
    pub title: String,
    pub fields: Vec<Field>,
}

#[derive(Serialize, Deserialize, Default)]
struct Store {
    records: Vec<FieldRecord>,
}

fn store_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|dir| dir.join("bridge").join("clipboard.json"))
}

fn load_from(path: &Path) -> Store {
    std::fs::read(path).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_default()
}

fn save_to(path: &Path, store: &Store) -> Result<(), CompanionError> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| err("FIELDS_STORE", e.to_string()))?;
    }
    let bytes = serde_json::to_vec_pretty(store).map_err(|e| err("FIELDS_STORE", e.to_string()))?;
    std::fs::write(path, bytes).map_err(|e| err("FIELDS_STORE", e.to_string()))
}

/// Append and keep the newest `MAX_RECORDS`.
fn push_record(store: &mut Store, record: FieldRecord) {
    store.records.push(record);
    let excess = store.records.len().saturating_sub(MAX_RECORDS);
    store.records.drain(..excess);
}

pub fn norm(label: &str) -> String {
    let mut out = String::new();
    for c in label.to_lowercase().chars() {
        if c.is_alphanumeric() {
            out.push(c);
        } else if !out.ends_with(' ') {
            out.push(' ');
        }
    }
    out.trim().to_string()
}

/// Collapse whitespace and drop a trailing `:` or `*` — labels as a human
/// reads them, not as the toolkit stores them.
pub fn clean_label(raw: &str) -> String {
    let joined = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    joined.trim_end_matches([':', '*', ' ']).to_string()
}

fn wants_yes(value: &str) -> bool {
    matches!(norm(value).as_str(), "yes" | "true" | "on" | "1" | "checked")
}

#[derive(Debug, PartialEq)]
enum Plan {
    /// Click the control, select all, type the value.
    Type,
    /// Click once (toggle / select).
    Click,
    /// Already in the wanted state.
    Already,
    /// Cannot be filled by hands: a popup needs a choice the user makes.
    Skip,
}

/// What the hands should do for one live control and one wanted value.
fn plan(kind: &str, current: &str, wanted: &str) -> Plan {
    match kind {
        "text" => Plan::Type,
        "checkbox" => {
            if wants_yes(wanted) == (current == "yes") { Plan::Already } else { Plan::Click }
        }
        // A radio can only be turned on by a click; "no" means leave it.
        "radio" => {
            if !wants_yes(wanted) || current == "yes" { Plan::Already } else { Plan::Click }
        }
        _ => Plan::Skip,
    }
}

fn snapshot() -> Result<(String, String, Vec<Field>), CompanionError> {
    if let Some(guarded) = guarded_frontmost_app() {
        return Err(err("FIELDS_PRIVACY_GUARD", format!("{guarded} looks like a password or credential window, so I won't read it.")));
    }
    #[cfg(target_os = "macos")]
    {
        if !crate::providers::accessibility::ax_permission_status() {
            let _ = crate::providers::accessibility::ax_request_permission();
            return Err(err(
                "FIELDS_NO_ACCESSIBILITY",
                "macOS Accessibility permission is needed to read the fields in front. Grant Bridge in System Settings → Privacy & Security → Accessibility, then try again.",
            ));
        }
        let (name, _bundle, pid) = crate::providers::apps::frontmost_app()
            .ok_or_else(|| err("FIELDS_NO_APP", "no app is in front"))?;
        let title = crate::providers::accessibility::focused_window_title(pid).unwrap_or_default();
        let fields = ax::read_fields(pid).ok_or_else(|| err("FIELDS_READ_FAILED", format!("couldn't read the controls of {name}")))?;
        Ok((name, title, fields))
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err(err("FIELDS_UNSUPPORTED", "reading fields is macOS-only in this slice"))
    }
}

/// Read the labelled controls of the app in front and keep them.
#[tauri::command]
pub fn fields_copy(app: AppHandle) -> Result<FieldRecord, CompanionError> {
    let (name, title, fields) = snapshot()?;
    if fields.is_empty() {
        return Err(err("FIELDS_NONE", format!("I found no labelled fields in {name}.")));
    }
    let at = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64);
    let record = FieldRecord { id: at, app: name, title, at, fields };
    let path = store_path(&app).ok_or_else(|| err("FIELDS_STORE", "no app data directory"))?;
    let mut store = load_from(&path);
    push_record(&mut store, record.clone());
    save_to(&path, &store)?;
    Ok(record)
}

/// The most recent record, if any.
#[tauri::command]
pub fn fields_recall(app: AppHandle) -> Option<FieldRecord> {
    store_path(&app).and_then(|path| load_from(&path).records.pop())
}

#[tauri::command]
pub fn fields_forget(app: AppHandle) -> Result<(), CompanionError> {
    let path = store_path(&app).ok_or_else(|| err("FIELDS_STORE", "no app data directory"))?;
    save_to(&path, &Store::default())
}

/// The live controls of the app in front, for the panel to map against.
/// Nothing is stored.
#[tauri::command]
pub fn fields_read_target() -> Result<FieldSnapshot, CompanionError> {
    let (app, title, fields) = snapshot()?;
    Ok(FieldSnapshot { app, title, fields })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FillEntry {
    /// The TARGET control's label, exactly as `fields_read_target` returned it.
    pub label: String,
    pub value: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FillRequest {
    pub entries: Vec<FillEntry>,
    #[serde(default)]
    pub allow_control: bool,
    #[serde(default)]
    pub allowed_apps: Vec<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FillResult {
    pub label: String,
    /// `filled` | `already` | `skipped` | `not_found` | `stopped`
    pub status: &'static str,
    pub note: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FillReport {
    pub app: String,
    pub results: Vec<FillResult>,
}

fn fill_one(field: &Field, wanted: &str) -> Result<(&'static str, String), ActuatorError> {
    let center = (field.x + field.width / 2.0, field.y + field.height / 2.0);
    match plan(&field.kind, &field.value, wanted) {
        Plan::Already => Ok(("already", "was already set".into())),
        Plan::Skip => Ok(("skipped", "a drop-down — choose it by hand".into())),
        Plan::Click => {
            actuator::glide_to(center, |_| {})?;
            actuator::click(center, MouseButton::Left, 1)?;
            Ok(("filled", String::new()))
        }
        Plan::Type => {
            let text: String = wanted.chars().take(MAX_VALUE_CHARS).collect();
            actuator::glide_to(center, |_| {})?;
            actuator::click(center, MouseButton::Left, 1)?;
            std::thread::sleep(SETTLE);
            actuator::press(Key::Command('a'))?;
            if text.is_empty() {
                actuator::press(Key::Backspace)?;
            } else {
                actuator::type_text(&text)?;
            }
            Ok(("filled", String::new()))
        }
    }
}

/// Fill the reviewed entries into the app in front, one control at a time,
/// with the real mouse and keyboard. Stops at the first takeover.
#[tauri::command]
pub fn fields_fill(request: FillRequest) -> Result<FillReport, CompanionError> {
    if !request.allow_control {
        return Err(err("ACT_CONTROL_NOT_ALLOWED", "turn on \"use my mouse and keyboard\" first — Bridge never fills a form without that explicit permission"));
    }
    if request.entries.is_empty() {
        return Err(err("FIELDS_EMPTY", "nothing to fill — tick at least one field"));
    }
    let (app, _title, live) = snapshot()?;
    if !crate::act::app_allowed(&request.allowed_apps, &app) {
        return Err(err("FIELDS_APP_NOT_ALLOWED", format!("{app} is in front and is not in your allowed apps, so I stopped before touching it.")));
    }
    let mut results = Vec::with_capacity(request.entries.len());
    let mut stopped: Option<&'static str> = None;
    for entry in &request.entries {
        if let Some(reason) = stopped {
            results.push(FillResult { label: entry.label.clone(), status: "stopped", note: reason.into() });
            continue;
        }
        let wanted = norm(&entry.label);
        let Some(field) = live.iter().find(|f| norm(&f.label) == wanted) else {
            results.push(FillResult { label: entry.label.clone(), status: "not_found", note: "not on this form any more".into() });
            continue;
        };
        match fill_one(field, &entry.value) {
            Ok((status, note)) => results.push(FillResult { label: entry.label.clone(), status, note }),
            Err(ActuatorError::Takeover) => {
                stopped = Some("you moved the mouse, so I stopped");
                results.push(FillResult { label: entry.label.clone(), status: "stopped", note: "you moved the mouse, so I stopped".into() });
            }
            Err(ActuatorError::NotTrusted) => return Err(err("FIELDS_NO_ACCESSIBILITY", "Accessibility permission was revoked mid-fill.")),
            Err(ActuatorError::Unsupported) => return Err(err("FIELDS_UNSUPPORTED", "filling is macOS-only in this slice")),
        }
        std::thread::sleep(SETTLE);
    }
    Ok(FillReport { app, results })
}

// ---------------------------------------------------------------------------
// macOS Accessibility tree read
// ---------------------------------------------------------------------------

/// Hand-bound AX/CoreFoundation surface for one job: walk the focused
/// window's tree and pick out labelled controls. Every +1 CFType is wrapped
/// in `Cf`, which releases on drop; values borrowed out of a CFArray are
/// used only while the array is alive.
#[cfg(target_os = "macos")]
mod ax {
    use super::{clean_label, Field, MAX_VALUE_CHARS};
    use std::ffi::c_void;

    type CFTypeRef = *const c_void;
    type CFIndex = isize;

    #[repr(C)]
    #[derive(Default, Clone, Copy)]
    struct CGPoint { x: f64, y: f64 }
    #[repr(C)]
    #[derive(Default, Clone, Copy)]
    struct CGSize { width: f64, height: f64 }

    const K_AX_VALUE_CGPOINT: u32 = 1;
    const K_AX_VALUE_CGSIZE: u32 = 2;
    const K_CF_NUMBER_SINT64: isize = 4;
    const K_CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;
    /// Enough for any real form; a runaway tree stops here instead of hanging.
    const MAX_NODES: usize = 6000;
    const MAX_DEPTH: usize = 60;

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> bool;
        fn AXUIElementCreateApplication(pid: i32) -> CFTypeRef;
        fn AXUIElementCopyAttributeValue(element: CFTypeRef, attribute: CFTypeRef, value: *mut CFTypeRef) -> i32;
        fn AXUIElementSetAttributeValue(element: CFTypeRef, attribute: CFTypeRef, value: CFTypeRef) -> i32;
        fn AXValueGetValue(value: CFTypeRef, value_type: u32, out: *mut c_void) -> bool;
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        static kCFBooleanTrue: CFTypeRef;
        fn CFRelease(cf: CFTypeRef);
        fn CFGetTypeID(cf: CFTypeRef) -> usize;
        fn CFStringGetTypeID() -> usize;
        fn CFArrayGetTypeID() -> usize;
        fn CFBooleanGetTypeID() -> usize;
        fn CFNumberGetTypeID() -> usize;
        fn CFArrayGetCount(array: CFTypeRef) -> CFIndex;
        fn CFArrayGetValueAtIndex(array: CFTypeRef, index: CFIndex) -> CFTypeRef;
        fn CFBooleanGetValue(boolean: CFTypeRef) -> bool;
        fn CFNumberGetValue(number: CFTypeRef, number_type: isize, out: *mut c_void) -> bool;
        fn CFStringCreateWithBytes(allocator: CFTypeRef, bytes: *const u8, num_bytes: CFIndex, encoding: u32, external: bool) -> CFTypeRef;
        fn CFStringGetLength(string: CFTypeRef) -> CFIndex;
        fn CFStringGetMaximumSizeForEncoding(length: CFIndex, encoding: u32) -> CFIndex;
        fn CFStringGetCString(string: CFTypeRef, buffer: *mut u8, size: CFIndex, encoding: u32) -> bool;
    }

    /// An owned (+1) CFType, released on drop.
    struct Cf(CFTypeRef);
    impl Drop for Cf {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe { CFRelease(self.0) }
            }
        }
    }

    unsafe fn key(name: &str) -> Option<Cf> {
        let s = CFStringCreateWithBytes(std::ptr::null(), name.as_ptr(), name.len() as CFIndex, K_CF_STRING_ENCODING_UTF8, false);
        if s.is_null() { None } else { Some(Cf(s)) }
    }

    unsafe fn attr(el: CFTypeRef, name: &str) -> Option<Cf> {
        let k = key(name)?;
        let mut out: CFTypeRef = std::ptr::null();
        if AXUIElementCopyAttributeValue(el, k.0, &mut out) == 0 && !out.is_null() { Some(Cf(out)) } else { None }
    }

    unsafe fn string_of(cf: CFTypeRef) -> Option<String> {
        if cf.is_null() || CFGetTypeID(cf) != CFStringGetTypeID() {
            return None;
        }
        let len = CFStringGetLength(cf);
        let cap = CFStringGetMaximumSizeForEncoding(len, K_CF_STRING_ENCODING_UTF8) + 1;
        let mut buf = vec![0u8; cap.max(1) as usize];
        if !CFStringGetCString(cf, buf.as_mut_ptr(), cap, K_CF_STRING_ENCODING_UTF8) {
            return None;
        }
        let end = buf.iter().position(|b| *b == 0).unwrap_or(0);
        String::from_utf8(buf[..end].to_vec()).ok()
    }

    unsafe fn attr_string(el: CFTypeRef, name: &str) -> Option<String> {
        let v = attr(el, name)?;
        string_of(v.0).map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
    }

    /// AXValue of a checkbox/radio: CFNumber or CFBoolean, as the toolkit likes.
    unsafe fn attr_on(el: CFTypeRef) -> Option<bool> {
        let v = attr(el, "AXValue")?;
        let id = CFGetTypeID(v.0);
        if id == CFBooleanGetTypeID() {
            Some(CFBooleanGetValue(v.0))
        } else if id == CFNumberGetTypeID() {
            let mut n: i64 = 0;
            CFNumberGetValue(v.0, K_CF_NUMBER_SINT64, &mut n as *mut i64 as *mut c_void).then_some(n != 0)
        } else {
            None
        }
    }

    unsafe fn frame(el: CFTypeRef) -> Option<(f64, f64, f64, f64)> {
        let p = attr(el, "AXPosition")?;
        let s = attr(el, "AXSize")?;
        let mut point = CGPoint::default();
        let mut size = CGSize::default();
        if !AXValueGetValue(p.0, K_AX_VALUE_CGPOINT, &mut point as *mut CGPoint as *mut c_void) { return None; }
        if !AXValueGetValue(s.0, K_AX_VALUE_CGSIZE, &mut size as *mut CGSize as *mut c_void) { return None; }
        Some((point.x, point.y, size.width, size.height))
    }

    fn kind_of(role: &str) -> Option<&'static str> {
        Some(match role {
            "AXTextField" | "AXTextArea" | "AXComboBox" => "text",
            "AXCheckBox" => "checkbox",
            "AXRadioButton" => "radio",
            "AXPopUpButton" | "AXMenuButton" => "popup",
            _ => return None,
        })
    }

    /// The label a person would read for this control, in the order toolkits
    /// tend to supply it; the preceding static text in the same container is
    /// the fallback for "label to the left / above" layouts.
    unsafe fn label_of(el: CFTypeRef, kind: &str, last_text: Option<&str>) -> Option<String> {
        let by_title_node = || attr(el, "AXTitleUIElement").and_then(|t| attr_string(t.0, "AXValue").or_else(|| attr_string(t.0, "AXTitle")));
        let title = || attr_string(el, "AXTitle");
        let raw = if kind == "popup" {
            // A popup's AXTitle is usually its SELECTED item, not its name.
            attr_string(el, "AXDescription").or_else(by_title_node).or_else(|| last_text.map(str::to_string))
        } else {
            title().or_else(|| attr_string(el, "AXDescription")).or_else(by_title_node)
                .or_else(|| attr_string(el, "AXPlaceholderValue"))
                .or_else(|| last_text.map(str::to_string))
                .or_else(|| attr_string(el, "AXIdentifier"))
        }?;
        let label = clean_label(&raw);
        (!label.is_empty()).then_some(label)
    }

    unsafe fn field_of(el: CFTypeRef, role: &str, last_text: Option<&str>) -> Option<Field> {
        let kind = kind_of(role)?;
        // Passwords never enter the clipboard.
        if attr_string(el, "AXSubrole").as_deref() == Some("AXSecureTextField") {
            return None;
        }
        let (x, y, width, height) = frame(el)?;
        if width <= 0.0 || height <= 0.0 {
            return None;
        }
        let label = label_of(el, kind, last_text)?;
        let value = match kind {
            "checkbox" | "radio" => if attr_on(el)? { "yes".into() } else { "no".into() },
            _ => attr_string(el, "AXValue").unwrap_or_default().chars().take(MAX_VALUE_CHARS).collect(),
        };
        Some(Field { label, value, kind: kind.into(), x, y, width, height })
    }

    unsafe fn walk(el: CFTypeRef, depth: usize, in_page: bool, out: &mut Vec<(Field, bool)>, seen: &mut usize) {
        if depth > MAX_DEPTH || *seen > MAX_NODES {
            return;
        }
        let Some(kids) = attr(el, "AXChildren") else { return };
        if CFGetTypeID(kids.0) != CFArrayGetTypeID() {
            return;
        }
        let mut last_text: Option<String> = None;
        for i in 0..CFArrayGetCount(kids.0) {
            *seen += 1;
            if *seen > MAX_NODES {
                return;
            }
            let kid = CFArrayGetValueAtIndex(kids.0, i); // borrowed from `kids`
            if kid.is_null() {
                continue;
            }
            let role = attr_string(kid, "AXRole").unwrap_or_default();
            if role == "AXStaticText" {
                last_text = attr_string(kid, "AXValue").or_else(|| attr_string(kid, "AXTitle")).map(|t| clean_label(&t));
                continue;
            }
            if kind_of(&role).is_some() {
                if let Some(field) = field_of(kid, &role, last_text.as_deref()) {
                    out.push((field, in_page));
                }
                continue;
            }
            walk(kid, depth + 1, in_page || role == "AXWebArea", out, seen);
        }
    }

    /// Test aid: the role tree to `max_depth`, one line per node.
    #[cfg(test)]
    pub fn debug_tree(pid: i32, max_depth: usize) -> Vec<String> {
        unsafe fn go(el: CFTypeRef, depth: usize, max_depth: usize, out: &mut Vec<String>) {
            let role = attr_string(el, "AXRole").unwrap_or_default();
            let kids = attr(el, "AXChildren");
            let n = kids.as_ref().map_or(-1, |k| if CFGetTypeID(k.0) == CFArrayGetTypeID() { CFArrayGetCount(k.0) } else { -2 });
            out.push(format!("{}{role} children={n} title={:?}", "  ".repeat(depth), attr_string(el, "AXTitle").unwrap_or_default()));
            if depth >= max_depth || out.len() > 400 { return; }
            if let Some(k) = kids { if n > 0 { for i in 0..n { go(CFArrayGetValueAtIndex(k.0, i), depth + 1, max_depth, out); } } }
        }
        unsafe {
            let app = Cf(AXUIElementCreateApplication(pid));
            for flag in ["AXEnhancedUserInterface", "AXManualAccessibility"] {
                if let Some(k) = key(flag) { let _ = AXUIElementSetAttributeValue(app.0, k.0, kCFBooleanTrue); }
            }
            let root = attr(app.0, "AXFocusedWindow");
            let mut out = Vec::new();
            go(root.as_ref().map_or(app.0, |w| w.0), 0, max_depth, &mut out);
            out
        }
    }

    /// Every labelled control in `pid`'s focused window (or the whole app
    /// when no window is focused). None without the Accessibility grant.
    pub fn read_fields(pid: i32) -> Option<Vec<Field>> {
        unsafe {
            if !AXIsProcessTrusted() {
                return None;
            }
            let app = Cf(AXUIElementCreateApplication(pid));
            if app.0.is_null() {
                return None;
            }
            // Chromium and Electron only expose web content to assistive
            // clients that ask for it; the write is best-effort.
            for flag in ["AXEnhancedUserInterface", "AXManualAccessibility"] {
                if let Some(k) = key(flag) {
                    let _ = AXUIElementSetAttributeValue(app.0, k.0, kCFBooleanTrue);
                }
            }
            let root = attr(app.0, "AXFocusedWindow");
            let mut out = Vec::new();
            let mut seen = 0usize;
            walk(root.as_ref().map_or(app.0, |w| w.0), 0, false, &mut out, &mut seen);
            // A browser window: the page's fields are the form, the address
            // bar and tab picker are not.
            let in_page = out.iter().any(|(_, page)| *page);
            Some(out.into_iter().filter(|(_, page)| !in_page || *page).map(|(f, _)| f).collect())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_are_normalised_and_cleaned() {
        assert_eq!(norm("E-mail Address:"), "e mail address");
        assert_eq!(clean_label("  First   Name *"), "First Name");
        assert_eq!(clean_label("ZIP:"), "ZIP");
    }

    #[test]
    fn the_plan_never_types_into_a_toggle_and_never_unchecks_a_radio() {
        assert_eq!(plan("text", "", "Jane"), Plan::Type);
        assert_eq!(plan("checkbox", "no", "yes"), Plan::Click);
        assert_eq!(plan("checkbox", "yes", "yes"), Plan::Already);
        assert_eq!(plan("checkbox", "yes", "no"), Plan::Click);
        assert_eq!(plan("radio", "no", "yes"), Plan::Click);
        assert_eq!(plan("radio", "yes", "no"), Plan::Already, "a radio cannot be clicked off");
        assert_eq!(plan("popup", "CA", "Nevada"), Plan::Skip);
    }

    /// `cargo test --lib fields -- --ignored --nocapture`: reads the app in
    /// front through the real tree. Needs the test binary's parent (the
    /// terminal) to hold the Accessibility grant; prints labels only.
    #[test]
    #[ignore]
    #[cfg(target_os = "macos")]
    fn live_read_of_the_app_in_front() {
        // BRIDGE_FIELDS_APP=Safari targets a named app instead of whatever is in front.
        let (name, pid) = match std::env::var("BRIDGE_FIELDS_APP") {
            Ok(app) => {
                let out = std::process::Command::new("pgrep").args(["-x", &app]).output().expect("pgrep");
                let pid: i32 = String::from_utf8_lossy(&out.stdout).lines().next().and_then(|l| l.trim().parse().ok()).expect("app is running");
                (app, pid)
            }
            Err(_) => { let Some((name, _, pid)) = crate::providers::apps::frontmost_app() else { eprintln!("no frontmost app"); return }; (name, pid) }
        };
        eprintln!("trusted={} app={name}", crate::providers::accessibility::ax_permission_status());
        for line in ax::debug_tree(pid, 12) { eprintln!("{line}"); }
        match ax::read_fields(pid) {
            None => eprintln!("read_fields returned None (no grant)"),
            Some(fields) => {
                eprintln!("{} fields", fields.len());
                for f in fields.iter().take(40) {
                    eprintln!("  [{}] {:?} value_len={} at ({:.0},{:.0}) {:.0}x{:.0}", f.kind, f.label, f.value.chars().count(), f.x, f.y, f.width, f.height);
                }
            }
        }
    }

    #[test]
    fn the_store_keeps_the_newest_records_and_round_trips() {
        let dir = std::env::temp_dir().join(format!("bridge-fields-{}", std::process::id()));
        let path = dir.join("clipboard.json");
        let mut store = Store::default();
        for i in 0..(MAX_RECORDS as u64 + 5) {
            push_record(&mut store, FieldRecord { id: i, app: "A".into(), title: String::new(), at: i, fields: vec![Field { label: "Name".into(), value: format!("v{i}"), kind: "text".into(), x: 0.0, y: 0.0, width: 0.0, height: 0.0 }] });
        }
        assert_eq!(store.records.len(), MAX_RECORDS);
        assert_eq!(store.records.first().map(|r| r.id), Some(5));
        assert!(save_to(&path, &store).is_ok(), "save");
        let back = load_from(&path);
        assert_eq!(back.records.last().map(|r| r.id), Some(MAX_RECORDS as u64 + 4));
        assert_eq!(back.records.last().and_then(|r| r.fields.first()).map(|f| f.value.as_str()), Some("v24"));
        let _ = std::fs::remove_dir_all(dir);
    }
}
