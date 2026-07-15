---
title: Requirement — Zazoo Desktop Companion Master Product & Design Specification (verbatim)
type: raw
doc_kind: requirement
status: recorded
companions: [zazoo-companion-avatar-roadmap-2026-07.md]
related_wiki: ../wiki/desktop-companion.md
updated: 2026-07-15
tags: [requirement, avatar, zazoo, companion]
---

User-supplied spec (authored by an agent with no platform context; treat as raw input — the
context-aware adaptation lives in `zazoo-companion-avatar-roadmap-2026-07.md`). Verbatim below.

---

Zazoo Desktop Companion — Master Product & Design Specification

Product Vision: Build Zazoo, a desktop AI companion that lives naturally within the user's workspace. It feels like a trusted Chief of Staff—observant, thoughtful, emotionally intelligent, and quietly supportive. The first companion is an original plush cat wearing round spectacles. The experience is driven by emotional performance rather than scripted animation. The companion communicates through subtle facial expressions, body language, timing, and presence, creating the feeling of sharing a workspace with a warm, attentive colleague. The objective is to create a companion that users naturally become attached to because it consistently feels present, considerate, and emotionally expressive.

Design Philosophy: The companion exists to improve the user's day through presence and thoughtful interaction. Every visible action should communicate intent. Every expression should reflect an emotional state. Every movement should reinforce personality. Animation is treated as acting rather than mechanics. The companion should convey: Warmth, Trust, Competence, Curiosity, Calmness, Encouragement, Thoughtfulness.

Visual Identity: premium original character, timeless aesthetic. Species: original plush cat. Style: soft plush toy, egg-shaped body, rounded silhouette, premium fabric textures, large expressive eyes, round spectacles, small embroidered smile, rounded paws, tiny feet, small tail, soft ears, business casual clothing, warm neutral colors, soft lighting, premium handcrafted appearance. The silhouette alone should communicate comfort and trust. Every design element should follow a rounded visual language.

Character Role: trusted Chief of Staff. Responsibilities: organizing information, helping prioritize work, summarizing meetings, suggesting next actions, remembering important context, celebrating achievements, encouraging healthy work habits, offering thoughtful insights. Personality: professionalism, empathy, humility, curiosity, quiet confidence, emotional intelligence.

Emotional Performance System: performs emotions instead of playing fixed animations. Emotional performance engine where each emotion continuously influences: eye behavior, facial expression, posture, breathing, gestures, timing, movement speed, voice characteristics, attention direction. Each emotional state blends naturally into the next.

Core Emotional States: Calm (relaxed breathing, soft eye contact, gentle posture, balanced movements, comfortable stillness) · Curious (eyes widen slightly, head tilts, focused gaze, reduced blink frequency, forward attention, careful observation) · Thinking (eyes briefly look upward, small pause, gentle chin touch, spectacle adjustment, focused expression, measured breathing) · Listening (direct eye contact, attentive posture, occasional nods, subtle facial acknowledgment, responsive gaze) · Happy (relaxed eyelids, warm smile, soft cheeks, gentle breathing, comfortable posture, bright eyes) · Proud (straighter posture, gentle confident smile, relaxed eyes, warm nod, quiet confidence) · Unsure (slight shoulder contraction, gentle head lowering, eyes glance sideways before returning, two thoughtful blinks, tiny spectacle adjustment, tail curls slightly, small hesitant smile, measured pause before speaking; communicates thoughtful consideration rather than uncertainty) · Concerned (softened eyes, gentle brow movement, slight forward lean, reduced smile, supportive posture, warm attention) · Comforting (half smile, slow blink, hand over chest, small nod, kind eye contact, warm breathing rhythm, relaxed shoulders) · Celebrating (bright smile, small clap, tiny joyful hop, tail movement, eyes sparkle, natural return to calm afterward) · Sleepy (slower blinking, relaxed posture, small yawn, reduced movement, gentle breathing).

Facial Expression System: face is the primary communication channel. Independent procedural controls for Eyes (pupil direction/size, focus, contact, blink speed/frequency, eyelid positions, squint, wide eyes, micro saccades), Eyebrows (raise, lower, inner/outer raise, independent L/R), Mouth (neutral, soft smile, broad smile, thoughtful, gentle concern), Cheeks (lift, relax, soft puff), Ears (relax, attend, lower, rotate, independent), Whiskers (relax, forward, soft downward), Spectacles (tiny adjustments, gentle settling, natural movement during expressions). Every facial feature blends continuously.

Eye Performance: dedicated eye behavior system — observe, notice, track, wonder, reflect, focus, reconnect, micro-saccades, natural blink timing, comfortable eye contact, smooth attention shifts. User should frequently feel the companion is genuinely paying attention.

Idle Presence: peaceful presence — breathing, blinking, tiny eye movements, weight shifting, ear adjustments, spectacle settling, gentle posture adjustments. Long Idle Activities: meditation (cross-legged, closed eyes, steady breathing), reading (tiny notebook, turning pages, occasional smile), tea break, stretch (gentle cat stretch, relaxed yawn), nap (curled, tail wrapped, slow breathing, ear twitch).

Interaction System: cursor awareness; mouse search (locate, look around, find, run toward, point proudly, return); petting (eyes close, soft smile, quiet purring, relaxed posture); dragging (body compresses, legs relax, eyes surprised, smooth return); notifications (notice, brief glance, return attention); task completion (celebrate softly, small clap, notebook checkmark, warm smile).

Chief of Staff Behaviors: Morning (review priorities, wait attentively, offer overview) · Meetings (prepare, listen quietly, summaries afterward, action items) · Long Focus Sessions (observe duration, recommend breaks, encouragement) · Project Completion (celebrate milestone, reflect, record achievement) · Evening (recognize end of workday, wrap-up suggestions, encourage rest).

Personality Memory: remember projects, goals, habits, work style, communication style, frequent applications, achievements, previous conversations; previous emotional context gently influences future interactions.

Animation Philosophy: anticipation, follow-through, secondary motion, ease-in/out, weight, timing, rhythm, subtle exaggeration, natural asymmetry. Every movement begins with thought and ends with intention.

Performance Architecture: LLM determines intent, emotion, confidence, energy, warmth, attention target, conversation. Animation system determines facial expression, eye performance, body language, gesture selection, timing, breathing, posture, procedural blending, movement transitions.

Animation Director: translates emotional intent into expressive performance. Input example: {"emotion":"unsure","warmth":0.95,"confidence":0.45,"energy":0.30,"attention":"user","intent":"offer_suggestion","duration":4.0}. Selects and blends eye behavior, head movement, breathing, facial expression, posture, gestures, secondary motion, movement timing. Each performance unique while emotionally consistent.

Technical Architecture (proposed): Tauri, React, TypeScript, Three.js, React Three Fiber, Zustand, OpenAI Realtime API, glTF (.glb) models. Modules: Emotion Engine, Conversation Engine, Memory Engine, Animation Director, Performance Engine, Desktop Awareness, Voice Engine, Rendering Engine, Input Manager.

Product Success: user feels seen, supported, encouraged throughout the workday; companion develops recognizable personality through expressive eyes, subtle facial acting, thoughtful body language, emotionally intelligent timing; interactions become familiar rituals strengthening trust and companionship.

Additional user directives in the same message: simplify so it is light/real/smooth on all desktops; challenge whether 3D is needed vs 2D ("I'm inclined toward 3D though, push back if you feel otherwise"); customize/personalize with platform context and own the avatar; avatar live in-session; detailed roadmap for future sessions; use low-end sub-agents to reduce token usage; PS — "I want to rename Bridge to Zazoo. Let me know your thoughts."
