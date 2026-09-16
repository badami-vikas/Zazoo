//! teaching — per-app guidance packs for walkthroughs and hands mode.
//!
//! Hey Clicky carries "teaching skills" for the apps it sees; Bridge encodes
//! the same knowledge as DATA (ADR-247): `teaching/app-guides.json`, one
//! entry per app with a match rule (bundle id, app name, or a site name
//! found in a browser window title) and a few plain sentences about where
//! the controls live and which shortcuts do what. The matching pack is
//! injected into the planner prompt, nothing else changes. Unknown app →
//! no pack, and the planner works from the screenshot alone.
//!
//! A site match beats an app match so that "Gmail in Chrome" teaches Gmail,
//! not Chrome. Names are compared case-insensitively as substrings.

use serde::Deserialize;

const GUIDES_JSON: &str = include_str!("../teaching/app-guides.json");

#[derive(Deserialize, Clone, Debug)]
pub struct Guide {
    #[cfg_attr(not(test), allow(dead_code))]
    pub id: String,
    pub name: String,
    #[serde(default)]
    r#match: MatchRule,
    pub notes: String,
}

#[derive(Deserialize, Clone, Debug, Default)]
struct MatchRule {
    #[serde(default)]
    bundle: Vec<String>,
    #[serde(default)]
    app: Vec<String>,
    #[serde(default)]
    site: Vec<String>,
}

fn guides() -> &'static [Guide] {
    static GUIDES: std::sync::OnceLock<Vec<Guide>> = std::sync::OnceLock::new();
    GUIDES.get_or_init(|| serde_json::from_str(GUIDES_JSON).expect("teaching/app-guides.json is valid"))
}

fn contains_ci(haystack: &str, needle: &str) -> bool {
    !needle.is_empty() && haystack.to_lowercase().contains(&needle.to_lowercase())
}

/// The pack for what is in front: `window_title` first (a site inside a
/// browser), then the bundle id, then the app name.
pub fn guide_for(app_name: &str, bundle_id: &str, window_title: Option<&str>) -> Option<&'static Guide> {
    let all = guides();
    if let Some(title) = window_title {
        if let Some(site) = all.iter().find(|g| g.r#match.site.iter().any(|s| contains_ci(title, s))) {
            return Some(site);
        }
    }
    all.iter()
        .find(|g| g.r#match.bundle.iter().any(|b| bundle_id.eq_ignore_ascii_case(b)))
        .or_else(|| all.iter().find(|g| g.r#match.app.iter().any(|a| contains_ci(app_name, a))))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packs_load_and_have_notes() {
        assert!(guides().len() >= 80, "expected the shipped pack set, got {}", guides().len());
        assert!(guides().iter().all(|g| !g.notes.trim().is_empty() && !g.id.is_empty()));
    }

    #[test]
    fn site_in_browser_title_beats_the_browser() {
        let g = guide_for("Google Chrome", "com.google.Chrome", Some("Inbox (3) - me@example.com - Gmail")).unwrap();
        assert_eq!(g.id, "gmail");
        let g = guide_for("Google Chrome", "com.google.Chrome", Some("New Tab")).unwrap();
        assert_eq!(g.id, "chrome");
    }

    #[test]
    fn bundle_then_name_then_nothing() {
        assert_eq!(guide_for("Notes", "com.apple.Notes", None).unwrap().id, "notes");
        assert_eq!(guide_for("iTerm2", "com.googlecode.iterm2", None).unwrap().id, "terminal");
        assert!(guide_for("Some Unknown App", "org.example.unknown", Some("Untitled")).is_none());
    }
}
