// Prevents an additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if bridge_desktop_lib::run_model_guard_if_requested() {
        return;
    }
    bridge_desktop_lib::run()
}
