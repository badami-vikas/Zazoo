//! whatsapp_message_ops — the READ scripts that populate the Local Plane
//! message store (TASK-030, ADR-158).
//!
//! This module exists as a separate file for a governance reason, not a
//! structural one: `whatsapp_webview.rs` is under concurrent change, and these
//! ops are additive. It is nonetheless part of the SAME security boundary and
//! obeys the same rule — the web app NAMES an operation and Rust owns the
//! script that name resolves to. Nothing here accepts JavaScript, a selector,
//! or any other expression from the caller.
//!
//! Two caller-supplied values reach a script, and both are shape-checked on
//! this, the trusted, side of the boundary before interpolation:
//!
//!   * a chat id, validated by `is_chat_id` — the same discipline
//!     `whatsapp_webview::is_group_id` applies to a group id;
//!   * a `since` watermark and a `limit`, both plain integers clamped here.
//!
//! WIRING (APPLIED 2026-08-02 at integration): `whatsapp_webview::script_for_op`
//! delegates its fallthrough arm to `script_for_message_op`, so `list_chats` and
//! `list_messages` are reachable. Both paths remain read-only.
//!
//! ```text
//! _ => crate::whatsapp_message_ops::script_for_message_op(op, arg),
//! ```
//!
//! Before that line landed the shell refused both ops with
//! `WHATSAPP_OP_REFUSED`, and the web surface reported it honestly rather than
//! presenting an empty store as a synced one.
//!
//! RESIDENCY: what these ops return is other people's message content. It is
//! Local Plane only. Nothing in this file writes, caches, or logs a body — the
//! payload passes through the existing outbound reporter untouched, exactly
//! like every other read op, and the log lines below name counts and ids only.

/// A WhatsApp thread id: `<user>@c.us`, `<user>@lid`, or `<user>@g.us`.
///
/// Broadcast and newsletter threads are deliberately NOT accepted. They are not
/// conversations with a person, and the identity mapping has no honest sender
/// to attribute their messages to.
pub fn is_chat_id(arg: &str) -> bool {
    let Some((user, suffix)) = arg.split_once('@') else {
        return false;
    };
    let suffix_ok = matches!(suffix, "c.us" | "lid" | "g.us");
    suffix_ok
        && !user.is_empty()
        && user.len() <= 64
        && user.chars().all(|c| c.is_ascii_digit() || c == '-')
}

/// Hard ceiling on one message read. A thread on a busy account holds far more
/// than a single op should move through a base64 URL in one go; the sync loop
/// walks forward with the watermark instead of asking for everything at once.
pub const MAX_MESSAGE_LIMIT: u32 = 500;

const DEFAULT_MESSAGE_LIMIT: u32 = 200;

/// The argument a `list_messages` call carries: `<chatId>|<sinceSeconds>|<limit>`.
///
/// A single packed string because the shell's op interface takes one optional
/// argument. Parsing is strict and total — anything unparseable yields `None`,
/// which the allowlist turns into a refusal rather than a default.
#[derive(Debug, PartialEq)]
pub struct MessageQuery {
    pub chat_id: String,
    /// Epoch SECONDS, exclusive. `0` means "everything the device holds".
    pub since: i64,
    pub limit: u32,
}

pub fn parse_message_query(arg: &str) -> Option<MessageQuery> {
    let mut parts = arg.split('|');
    let chat_id = parts.next()?;
    if !is_chat_id(chat_id) {
        return None;
    }
    let since = match parts.next() {
        Some("") | None => 0,
        Some(raw) => raw.parse::<i64>().ok()?,
    };
    if since < 0 {
        return None;
    }
    let limit = match parts.next() {
        Some("") | None => DEFAULT_MESSAGE_LIMIT,
        Some(raw) => raw.parse::<u32>().ok()?,
    };
    if parts.next().is_some() {
        // A trailing field means the caller and this parser disagree about the
        // shape. Refuse rather than ignore it.
        return None;
    }
    Some(MessageQuery {
        chat_id: chat_id.to_string(),
        since,
        limit: limit.clamp(1, MAX_MESSAGE_LIMIT),
    })
}

/// Wrap an expression so its resolved value is reported out.
///
/// Mirrors `whatsapp_webview::reported`, which is private to that module. Kept
/// as a local copy rather than widening that module's surface while it is under
/// concurrent change; the drift test asserts the two stay in step.
fn reported(op: &str, body: &str) -> String {
    format!(
        r#"(async function () {{
  try {{
    var value = await ({body});
    window.__bridgeReport({{ op: "{op}", json: JSON.stringify({{ ok: true, value: value }}) }});
  }} catch (e) {{
    window.__bridgeReport({{ op: "{op}", json: JSON.stringify({{ ok: false, error: String((e && e.message) || e) }}) }});
  }}
}})();"#
    )
}

/// Every `WPP` path these ops depend on, in the same `(path, typeof)` shape as
/// `whatsapp_webview::WPP_DEPENDENCIES`, so the health tripwire can cover them.
pub const MESSAGE_WPP_DEPENDENCIES: &[(&str, &str)] = &[
    ("WPP.whatsapp.ChatStore.getModelsArray", "function"),
    ("WPP.chat.getMessages", "function"),
];

/// Map an operation NAME to a fixed script, for the message-capture ops only.
/// Unknown names yield `None`, exactly like the primary allowlist.
pub fn script_for_message_op(op: &str, arg: Option<&str>) -> Option<String> {
    match op {
        // The thread inventory that drives sync scheduling. Ids, labels, and
        // last-activity times — NO message bodies. A chat list must not be a
        // back door that streams every conversation's newest text.
        "list_chats" => Some(reported(
            op,
            r#"Promise.resolve(WPP.whatsapp.ChatStore.getModelsArray()
                 .map(function (c) {
                   var id = (c.id && (c.id._serialized || String(c.id))) || "";
                   // `isGroup` is a PROPERTY on some builds and a METHOD on
                   // others. The previous form called it unconditionally, so on
                   // a property build the call threw and every chat came back
                   // as a direct chat.
                   var isGroup = false;
                   try {
                     var g = c.id && c.id.isGroup;
                     isGroup = (typeof g === "function") ? Boolean(g.call(c.id)) : Boolean(g);
                   } catch (e) {}
                   // Last-activity time, which is what the scheduler reads.
                   //
                   // TWO defects have lived in this expression, and the second
                   // is why the fix for the first did not work.
                   //
                   //  1. It was once a ternary whose two arms were the SAME
                   //     expression, so only `c.t` was ever consulted.
                   //  2. The replacement listed several sources but built the
                   //     ARRAY eagerly, inside ONE try/catch:
                   //
                   //       var newest = ... c.msgs.last().t ...;
                   //       var sources = [c.t, c.lastMsgTimestamp, newest];
                   //
                   //     `c.msgs.last()` is evaluated BEFORE the loop reads
                   //     `c.t`. `msgs` is a live collection that is only
                   //     populated once a chat's history has loaded, so on a
                   //     freshly linked device that call throws for most chats —
                   //     and the throw skipped the whole block, discarding a
                   //     perfectly good `c.t`. The LOWEST-priority source could
                   //     poison the HIGHEST-priority one. Every chat then came
                   //     back undated even though the field the scheduler wanted
                   //     was sitting right there.
                   //
                   // So each candidate is now evaluated LAZILY and in its OWN
                   // try/catch: a source that throws is skipped, never fatal to
                   // the ones after — or before — it.
                   //
                   // Order is evidence-led. `t` is the only last-activity field
                   // DECLARED on WhatsApp's ChatModel (wa-js v4.5.0,
                   // ChatModel.ts:27) and is the one to trust. The other two are
                   // unattested in the pinned bundle — `lastMsgTimestamp` and
                   // `msgs.last` both have ZERO occurrences in
                   // vendor/wppconnect-wa.js — and are kept only as cheap
                   // fallbacks against a future build, not because either is
                   // known to work. `activitySource` below records which one
                   // actually answered, so the next person does not have to
                   // guess the way we did.
                   //
                   // Only a NUMBER is ever read here. No message text is
                   // touched, so the no-bodies guarantee below still holds.
                   var t = null;
                   var activitySource = null;
                   var candidates = [
                     ["t", function () { return c.t; }],
                     ["lastMsgTimestamp", function () { return c.lastMsgTimestamp; }],
                     ["msgs.last", function () {
                       if (!c.msgs || typeof c.msgs.last !== "function") return undefined;
                       var last = c.msgs.last();
                       return last ? last.t : undefined;
                     }]
                   ];
                   for (var s = 0; s < candidates.length; s++) {
                     var v;
                     try { v = candidates[s][1](); } catch (e) { continue; }
                     if (typeof v !== "number" || !isFinite(v) || v <= 0) continue;
                     // Seconds is the documented unit and what the watermark
                     // arithmetic assumes. A build that switched to
                     // milliseconds would otherwise date every chat to the year
                     // 57000 and sort the list by nothing at all.
                     t = (v > 1e11) ? Math.floor(v / 1000) : v;
                     activitySource = candidates[s][0];
                     break;
                   }
                   return {
                     id: id,
                     name: c.formattedTitle ? String(c.formattedTitle)
                         : (c.name ? String(c.name) : undefined),
                     isGroup: isGroup,
                     lastMessageTimestamp: t,
                     // Which field answered, or null when none did. A count of
                     // these is the cheapest possible live evidence about a
                     // build we cannot otherwise inspect. It is a FIELD NAME,
                     // never a value, so it carries nothing personal.
                     activitySource: activitySource,
                     unreadCount: (typeof c.unreadCount === "number") ? c.unreadCount : undefined
                   };
                 })
                 .filter(function (c) { return c.id !== ""; }))"#,
        )),
        // One thread's messages, newer than a watermark.
        //
        // `author` is reported SEPARATELY from `from` and is never merged with
        // it here: in a group the writer is the author, and collapsing the two
        // in the page would hand the mapping layer a sender it cannot tell
        // apart from the group itself. No `@lid` id is ever split into digits —
        // that is the fabricated-number bug, and the only safe place to decide
        // identity is `@bridge/whatsapp`'s `senderOf`.
        "list_messages" => {
            let query = parse_message_query(arg?)?;
            let chat = query.chat_id;
            let since = query.since;
            let limit = query.limit;
            Some(reported(
                op,
                &format!(
                    r#"WPP.chat.getMessages("{chat}", {{ count: {limit} }}).then(function (ms) {{
                     var out = [];
                     for (var i = 0; i < ms.length; i++) {{
                       var m = ms[i];
                       var t = (typeof m.t === "number" && isFinite(m.t)) ? m.t : 0;
                       if (t <= {since}) continue;
                       var id = "";
                       try {{ id = String((m.id && (m.id._serialized || m.id)) || ""); }} catch (e) {{}}
                       if (!id) continue;
                       function ser(v) {{
                         if (!v) return undefined;
                         try {{ return String(v._serialized || v); }} catch (e) {{ return undefined; }}
                       }}
                       out.push({{
                         id: id,
                         chatId: "{chat}",
                         fromMe: Boolean(m.id && m.id.fromMe),
                         timestamp: t,
                         author: ser(m.author),
                         from: ser(m.from),
                         body: (typeof m.body === "string") ? m.body : undefined,
                         type: m.type ? String(m.type) : undefined,
                         ack: (typeof m.ack === "number") ? m.ack : undefined,
                         mimetype: m.mimetype ? String(m.mimetype) : undefined,
                         filename: m.filename ? String(m.filename) : undefined,
                         size: (typeof m.size === "number") ? m.size : undefined
                       }});
                     }}
                     return out;
                   }})"#
                ),
            ))
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_the_three_conversation_id_spaces() {
        assert!(is_chat_id("919876543210@c.us"));
        assert!(is_chat_id("123456789012345@lid"));
        assert!(is_chat_id("120363001234567890-1234@g.us"));
    }

    #[test]
    fn refuses_ids_that_are_not_conversations_or_are_shaped_wrong() {
        for id in [
            "status@broadcast",
            "120363001@newsletter",
            "@c.us",
            "919876543210",
            "919876543210@evil.com",
            "abc@c.us",
            // The injection shape this validator exists to stop.
            "1\"); alert(1); (\"@c.us",
        ] {
            assert!(!is_chat_id(id), "{id} should be refused");
        }
    }

    #[test]
    fn a_message_query_parses_and_clamps_its_limit() {
        let query = parse_message_query("919876543210@c.us|1785600000|900").unwrap();
        assert_eq!(query.chat_id, "919876543210@c.us");
        assert_eq!(query.since, 1_785_600_000);
        assert_eq!(query.limit, MAX_MESSAGE_LIMIT);
        assert_eq!(parse_message_query("919876543210@c.us|0|0").unwrap().limit, 1);
    }

    #[test]
    fn a_message_query_defaults_the_optional_fields() {
        let query = parse_message_query("919876543210@c.us").unwrap();
        assert_eq!(query.since, 0);
        assert_eq!(query.limit, DEFAULT_MESSAGE_LIMIT);
    }

    #[test]
    fn a_malformed_message_query_is_refused_rather_than_defaulted() {
        for arg in [
            "status@broadcast|0|10",
            "919876543210@c.us|-1|10",
            "919876543210@c.us|abc|10",
            "919876543210@c.us|0|10|extra",
            "|0|10",
        ] {
            assert!(parse_message_query(arg).is_none(), "{arg} should be refused");
        }
    }

    #[test]
    fn unknown_op_names_and_missing_arguments_yield_no_script() {
        assert!(script_for_message_op("delete_everything", None).is_none());
        assert!(script_for_message_op("list_messages", None).is_none());
        assert!(script_for_message_op("list_messages", Some("nope")).is_none());
    }

    #[test]
    fn the_chat_list_op_carries_no_message_body() {
        let script = script_for_message_op("list_chats", None).unwrap();
        // A chat inventory that reached for message text would turn one cheap
        // scheduling read into a bulk content read.
        assert!(!script.contains("body"));
        assert!(!script.contains("getMessages"));
    }

    #[test]
    fn the_message_op_interpolates_only_validated_values() {
        let script =
            script_for_message_op("list_messages", Some("919876543210@c.us|1785600000|50")).unwrap();
        assert!(script.contains("\"919876543210@c.us\""));
        assert!(script.contains("count: 50"));
        assert!(script.contains("t <= 1785600000"));
    }

    #[test]
    fn the_message_op_never_derives_a_phone_number_from_an_id() {
        let script =
            script_for_message_op("list_messages", Some("123456789012345@lid|0|10")).unwrap();
        // Identity is decided in `@bridge/whatsapp`, from the id as reported.
        // Any splitting in the page is the laundering path that fabricated
        // 4,203 phone numbers on 2026-08-01.
        assert!(!script.contains("split(\"@\")"));
        assert!(!script.contains("replace(/\\D/g"));
        assert!(!script.contains("phone"));
    }

    #[test]
    fn the_chat_list_reads_more_than_one_last_activity_source() {
        let script = script_for_message_op("list_chats", None).unwrap();
        // The defect this replaces: `c.lastReceivedKey ? c.t : c.t` — a ternary
        // whose arms are identical, so only `c.t` was ever read. On the live
        // 500-chat account every chat came back undated and the sync queue was
        // empty while the run reported success.
        assert!(
            !script.contains("c.lastReceivedKey ? c.t : c.t"),
            "the identical-arm ternary is back"
        );
        for source in ["c.t", "c.lastMsgTimestamp", "c.msgs.last"] {
            assert!(script.contains(source), "{source} is not consulted");
        }
        // Unknown must stay distinguishable from "never": null, not 0.
        assert!(script.contains("var t = null"));
    }

    /// RESCOPED 2026-08-03. The test above asserts only that three field NAMES
    /// appear in the script, which the defective version also satisfied — it
    /// listed all three and still returned nothing for every chat on the live
    /// account. Naming a source is not consulting it.
    ///
    /// The real defect was evaluation ORDER: the sources were collected into an
    /// array eagerly inside a single try/catch, so `c.msgs.last()` ran before
    /// `c.t` was read and its throw discarded the whole block. This test pins
    /// the property that actually matters — every candidate is behind its own
    /// function and its own catch, so no source can suppress another.
    /// The script carries long `//` commentary, including a quotation of the
    /// defective code it replaces. A negative assertion has to read the CODE,
    /// or it fails on the explanation of the very bug it guards against.
    fn code_only(script: &str) -> String {
        script
            .lines()
            .map(|line| match line.find("//") {
                Some(at) => &line[..at],
                None => line,
            })
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[test]
    fn one_unreadable_activity_source_cannot_suppress_the_others() {
        let script = script_for_message_op("list_chats", None).unwrap();
        let code = code_only(&script);
        // The eager array is the bug. `c.t` must not be evaluated into a list
        // alongside a call that can throw.
        assert!(
            !code.contains("var sources = [c.t"),
            "the eager source array is back: a throwing candidate will again discard c.t"
        );
        // Each candidate is a thunk, invoked inside the loop.
        assert!(
            script.contains("function () { return c.t; }"),
            "c.t must be evaluated lazily, not up front"
        );
        // A per-candidate catch that CONTINUES rather than abandoning the loop.
        assert!(
            script.contains("catch (e) { continue; }"),
            "a throwing candidate must be skipped, not fatal to the rest"
        );
    }

    /// Seconds is what every watermark comparison in `@bridge/whatsapp`
    /// assumes. A build reporting milliseconds would date every chat ~1700x
    /// into the future, which sorts and schedules as garbage.
    #[test]
    fn a_millisecond_timestamp_is_normalised_to_seconds() {
        let script = script_for_message_op("list_chats", None).unwrap();
        assert!(script.contains("1e11"), "no seconds-vs-milliseconds guard");
        assert!(script.contains("Math.floor(v / 1000)"));
    }

    /// Which field answered is the only cheap evidence we get about a wa-js
    /// build we cannot otherwise inspect, and it is a field NAME, never a value.
    #[test]
    fn the_chat_list_reports_which_activity_source_answered() {
        let script = script_for_message_op("list_chats", None).unwrap();
        assert!(script.contains("activitySource"));
        // Null when nothing answered — same unknown-is-not-zero discipline.
        assert!(script.contains("var activitySource = null"));
    }

    #[test]
    fn the_chat_list_handles_is_group_as_property_or_method() {
        let script = script_for_message_op("list_chats", None).unwrap();
        // Calling it unconditionally threw on builds where it is a plain
        // boolean, which silently made every group look like a direct chat.
        assert!(script.contains(r#"typeof g === "function""#));
        assert!(!script.contains("c.id.isGroup()"));
    }

    #[test]
    fn every_declared_dependency_is_actually_used_by_a_script() {
        let scripts = [
            script_for_message_op("list_chats", None).unwrap(),
            script_for_message_op("list_messages", Some("1@c.us|0|10")).unwrap(),
        ]
        .join("\n");
        for (path, _) in MESSAGE_WPP_DEPENDENCIES {
            let leaf = path.rsplit('.').next().unwrap();
            assert!(scripts.contains(leaf), "{path} is declared but never used");
        }
    }
}
