/**
 * Zazoo Animation Director — translates intent into a continuous pose stream.
 * Renderer-agnostic: emits a plain numeric Frame each tick that any renderer
 * (SVG today, canvas/3D later) maps onto a rig. The LLM/agent plane talks to
 * this via `perform()`; it never drives individual features directly.
 *
 * TWO INDEPENDENT CHANNELS (they compose, they are not alternatives):
 *   emotion — how Zazoo FEELS  (face, brows, cheeks, breath rhythm)
 *   action  — what Zazoo is DOING (whole-body activity: meditate/sneak/hide)
 * Zazoo can be `happy` while `meditating`, or `concerned` while `hiding`.
 * Layering: CALM base ← emotion overrides ← action overrides (body wins).
 *
 * Acting model (Pixar canon, see docs/raw/zazoo-companion-avatar-roadmap):
 * no fixed clips — spring-blended pose targets + autonomous behaviors
 * (breath/blink/saccade/whisker-float/ear-twitch) + one-shot gestures with
 * anticipation and squash-and-stretch. Secondary motion (whiskers, ears,
 * spectacles) lags primary motion for follow-through.
 */

export type ZazooEmotion =
  | "calm"
  | "curious"
  | "thinking"
  | "listening"
  | "happy"
  | "proud"
  | "unsure"
  | "concerned"
  | "comforting"
  | "celebrating"
  | "sleepy";

/** Whole-body activity — orthogonal to emotion. */
export type ZazooAction = "idle" | "meditating" | "sneaking" | "hiding";

/** Contract the agent plane uses to request a performance. */
export interface ZazooPerformance {
  /** How Zazoo feels. Omit to leave the current emotion untouched. */
  emotion?: ZazooEmotion;
  /** What Zazoo is doing. Omit to leave the current action untouched. */
  action?: ZazooAction;
  /** 0..1 — scales smile/cheek warmth + cheek color temperature. */
  warmth?: number;
  /** 0..1 — posture openness; low confidence softens gaze + tilt. */
  confidence?: number;
  /** 0..1 — movement speed, breath rate, saccade frequency. */
  energy?: number;
  attention?: "user" | "cursor" | "away";
  intent?: string;
  /** Seconds before reverting whatever this call set back to its default. */
  duration?: number;
}

/** Springed pose parameters (targets set by emotion + action presets). */
interface Pose {
  eyeOpen: number; // 0 closed .. 1 normal .. 1.15 wide
  pupilScale: number;
  browRaise: number; // -1 lowered .. 1 raised (also lengthens the brow)
  browSorrow: number; // 0..1 inner-raise (worry)
  browFurrow: number; // 0..1 inner-lower (focus) — also shortens the brow
  mouthCurve: number; // -1 frown .. 1 broad smile
  mouthOpen: number; // 0..1 — opens the ONE mouth element, never adds a second
  earL: number; // deg, + = perked
  earR: number;
  earScale: number; // 1 = rest; listening exaggerates (mild)
  headTilt: number; // deg
  headDrop: number; // px face-group lowering
  cheek: number; // 0..1 blush opacity
  cheekWarm: number; // 0..1 blush color temperature (pale pink → warm coral)
  cheekPuff: number; // 0..1 cheek lift/puff scale
  whiskerDroop: number; // 0..1
  whiskerFloat: number; // 0..1 airy idle sway amplitude
  tailCurl: number; // 0..1 (oval tail rock bias)
  bodyLean: number; // deg, + = toward user
  posture: number; // 0 slouch .. 1 upright-proud
  pawChest: number; // 0..1 paw-over-chest (comforting)
  pawMeditate: number; // 0..1 both paws meet at front, palms up
  squash: number; // 0..1 body squash (sneak/anticipation)
  hide: number; // 0..1 roll-and-wrap into own suit → cloth egg
  levitate: number; // 0..1 meditation float
  gazeBiasX: number; // -1..1 emotion-driven gaze offset
  gazeBiasY: number;
}

/** Non-springed behavior settings. */
interface Behavior {
  breathRate: number; // Hz — varies with emotion; actions may override
  breathDepth: number; // 0..1.2
  blinkEvery: number; // mean seconds between blinks
  blinkSpeed: number; // 1 = normal, <1 slower (sleepy)
  saccadeAmp: number; // 0..1
  tailWag: number; // 0..1 oval-tail rock intensity
  nod: number; // 0..1 slow attentive nodding
  giggle: number; // 0..1 petting wiggle (Zazoo speaks/giggles — never purrs)
  creep: number; // 0..1 sneak tip-toe bob
}

/** What the renderer consumes every frame. */
export interface ZazooFrame extends Pose {
  blink: number;
  breath: number; // -1..1 oscillation at the current rhythm
  gazeX: number;
  gazeY: number;
  hopY: number; // px vertical offset (gestures + levitate + creep)
  wiggle: number; // deg root rotation (giggle)
  pawLift: number; // 0..1 right paw to spectacles
  armsUp: number; // 0..1 both paws celebration
  specJiggle: number;
  tailWagPhase: number;
  wagAmount: number;
  nodY: number;
  whiskerSway: number; // deg — whiskers floating in air
  sparkle: number;
  zzz: number;
}

const CALM: Pose = {
  eyeOpen: 0.9, pupilScale: 1, browRaise: 0, browSorrow: 0, browFurrow: 0,
  mouthCurve: 0.35, mouthOpen: 0, earL: 0, earR: 0, earScale: 1,
  headTilt: 0, headDrop: 0, cheek: 0.45, cheekWarm: 0.4, cheekPuff: 0.2,
  whiskerDroop: 0.1, whiskerFloat: 0.6, tailCurl: 0.3, bodyLean: 0,
  posture: 0.5, pawChest: 0, pawMeditate: 0, squash: 0, hide: 0,
  levitate: 0, gazeBiasX: 0, gazeBiasY: 0,
};
const CALM_B: Behavior = {
  breathRate: 0.22, breathDepth: 0.6, blinkEvery: 4.2, blinkSpeed: 1,
  saccadeAmp: 0.5, tailWag: 0.08, nod: 0, giggle: 0, creep: 0,
};

/** EMOTION layer — face, brows, cheeks, breath rhythm. */
const EMOTIONS: Record<ZazooEmotion, [Partial<Pose>, Partial<Behavior>]> = {
  calm: [{}, {}],
  curious: [
    { eyeOpen: 1.12, pupilScale: 1.18, browRaise: 0.75, headTilt: 9, earL: 8, earR: 8, earScale: 1.08, mouthCurve: 0.25, cheekPuff: 0.3, whiskerFloat: 0.9 },
    { blinkEvery: 7, saccadeAmp: 0.25, breathRate: 0.3, breathDepth: 0.5 },
  ],
  thinking: [
    { eyeOpen: 0.78, browRaise: 0.2, browFurrow: 0.6, headTilt: -6, mouthCurve: 0.12, gazeBiasY: -0.8, gazeBiasX: 0.35, earL: 3, earR: -2, cheekPuff: 0.1 },
    { blinkEvery: 5.5, saccadeAmp: 0.3, breathRate: 0.16, breathDepth: 0.8 },
  ],
  listening: [
    // Ears enlarge — mild Pixar exaggeration: the feature doing the work grows.
    { eyeOpen: 0.98, earL: 12, earR: 12, earScale: 1.28, mouthCurve: 0.3, headTilt: 3, posture: 0.65, whiskerFloat: 0.3, browRaise: 0.25 },
    { blinkEvery: 5, saccadeAmp: 0.15, nod: 0.6, breathRate: 0.2, breathDepth: 0.5 },
  ],
  happy: [
    { eyeOpen: 0.66, mouthCurve: 0.85, cheek: 0.9, cheekWarm: 0.85, cheekPuff: 0.8, earL: 4, earR: 4, tailCurl: 0.5, whiskerFloat: 1, browRaise: 0.4 },
    { tailWag: 0.45, breathRate: 0.28, breathDepth: 0.55, blinkEvery: 4.5 },
  ],
  proud: [
    { eyeOpen: 0.75, mouthCurve: 0.55, posture: 1, headTilt: -2, cheek: 0.55, cheekWarm: 0.6, cheekPuff: 0.5, earL: 6, earR: 6, browRaise: 0.3 },
    { breathRate: 0.18, breathDepth: 0.9, blinkEvery: 5 },
  ],
  unsure: [
    { eyeOpen: 0.8, browSorrow: 0.7, headTilt: -5, headDrop: 4, mouthCurve: 0.15, tailCurl: 0.85, earL: -6, earR: -8, gazeBiasX: -0.5, cheek: 0.5, cheekWarm: 0.3, cheekPuff: 0.15 },
    { blinkEvery: 2.6, saccadeAmp: 0.7, breathRate: 0.33, breathDepth: 0.45 },
  ],
  concerned: [
    { eyeOpen: 0.92, browSorrow: 1, mouthCurve: -0.2, bodyLean: 4, cheek: 0.15, cheekWarm: 0.1, earL: -4, earR: -4, whiskerDroop: 0.5, whiskerFloat: 0.2 },
    { blinkEvery: 4, breathRate: 0.27, breathDepth: 0.5, saccadeAmp: 0.2 },
  ],
  comforting: [
    { eyeOpen: 0.6, mouthCurve: 0.5, cheek: 0.6, cheekWarm: 0.55, cheekPuff: 0.5, pawChest: 1, headTilt: 4, earL: -2, earR: -2, browSorrow: 0.25 },
    { blinkEvery: 6, blinkSpeed: 0.45, breathRate: 0.13, breathDepth: 1.1, nod: 0.3 },
  ],
  celebrating: [
    { eyeOpen: 1.08, mouthCurve: 1, mouthOpen: 0.55, cheek: 1, cheekWarm: 1, cheekPuff: 1, earL: 12, earR: 12, earScale: 1.1, tailCurl: 0.6, whiskerFloat: 1, browRaise: 0.9 },
    { tailWag: 1, breathRate: 0.42, breathDepth: 0.4, blinkEvery: 5, saccadeAmp: 0.3 },
  ],
  sleepy: [
    { eyeOpen: 0.3, mouthCurve: 0.18, earL: -12, earR: -12, earScale: 0.94, headTilt: 5, headDrop: 5, whiskerDroop: 0.8, whiskerFloat: 0.15, tailCurl: 0.7, cheek: 0.35, cheekWarm: 0.3, browRaise: -0.3 },
    { blinkEvery: 3, blinkSpeed: 0.3, breathRate: 0.1, breathDepth: 1.2, saccadeAmp: 0.1 },
  ],
};

/** ACTION layer — whole-body activity; overrides the emotion's body params. */
const ACTIONS: Record<ZazooAction, [Partial<Pose>, Partial<Behavior>]> = {
  idle: [{}, {}],
  meditating: [
    { eyeOpen: 0.05, pawMeditate: 1, levitate: 1, posture: 0.8, earL: 2, earR: 2, whiskerFloat: 0.8, headTilt: 0, headDrop: 0 },
    { breathRate: 0.07, breathDepth: 1.2, blinkEvery: 999, saccadeAmp: 0, tailWag: 0 },
  ],
  sneaking: [
    { squash: 0.7, bodyLean: 7, earL: 14, earR: 14, earScale: 1.15, pupilScale: 1.1, whiskerFloat: 0.2, posture: 0.2 },
    { saccadeAmp: 1, breathRate: 0.35, breathDepth: 0.3, creep: 1, tailWag: 0 },
  ],
  hiding: [
    { hide: 1, squash: 0.4 },
    { breathRate: 0.3, breathDepth: 0.2, blinkEvery: 999, saccadeAmp: 0, tailWag: 0 },
  ],
};

type GestureName = "specAdjust" | "hop" | "nodOnce" | "yawn";
interface Gesture { name: GestureName; start: number; dur: number }

const POSE_KEYS = Object.keys(CALM) as (keyof Pose)[];

function spring(x: number, v: number, target: number, dt: number, hz: number): [number, number] {
  const w = 2 * Math.PI * hz;
  const a = w * w * (target - x) - 2 * w * v;
  v += a * dt;
  x += v * dt;
  return [x, v];
}

export class ZazooDirector {
  emotion: ZazooEmotion = "calm";
  action: ZazooAction = "idle";
  private warmth = 0.7;
  private confidence = 0.7;
  private energy = 0.5;
  private attention: "user" | "cursor" | "away" = "cursor";
  private revertAt: number | null = null;
  private revertEmotion = false;
  private revertAction = false;

  private pose: Pose = { ...CALM };
  private vel: Record<keyof Pose, number> = Object.fromEntries(POSE_KEYS.map((k) => [k, 0])) as Record<keyof Pose, number>;

  private petting = false;
  private cursor: { x: number; y: number } | null = null;

  private nextBlink = 1.5;
  private blinkT = -1;
  private doubleBlink = false;
  private nextSaccade = 0.8;
  private sacX = 0; private sacY = 0;
  private nextEarTwitch = 6;
  private earTwitchT = -1;
  private nextIdleGesture = 12;
  private breathPhase = 0;
  private wagPhase = 0;
  private gestures: Gesture[] = [];
  private specJiggleV = 0; private specJiggleX = 0;
  private last = -1;

  perform(p: ZazooPerformance, now = performance.now() / 1000) {
    if (p.emotion) this.emotion = p.emotion;
    if (p.action) this.action = p.action;
    if (p.warmth !== undefined) this.warmth = p.warmth;
    if (p.confidence !== undefined) this.confidence = p.confidence;
    if (p.energy !== undefined) this.energy = p.energy;
    if (p.attention) this.attention = p.attention;

    if (p.duration) {
      this.revertAt = now + p.duration;
      this.revertEmotion = !!p.emotion;
      this.revertAction = !!p.action;
    } else {
      this.revertAt = null;
    }

    this.specJiggleV += 14; // spectacles settle on every shift
    if (p.emotion === "thinking" || p.emotion === "unsure") this.trigger("specAdjust", now, 0.4);
    if (p.emotion === "celebrating") this.trigger("hop", now);
    if (p.emotion === "proud") this.trigger("nodOnce", now, 0.3);
    if (p.emotion === "unsure") this.doubleBlink = true;
  }

  setEmotion(e: ZazooEmotion) { this.perform({ emotion: e }); }
  setAction(a: ZazooAction) { this.perform({ action: a }); }
  setPetting(on: boolean) { this.petting = on; }
  setCursor(c: { x: number; y: number } | null) { this.cursor = c; }

  private trigger(name: GestureName, now: number, delay = 0) {
    const dur = { specAdjust: 1.6, hop: 1.3, nodOnce: 1.2, yawn: 2.2 }[name];
    this.gestures.push({ name, start: now + delay, dur });
  }

  tick(now: number): ZazooFrame {
    if (this.last < 0) this.last = now;
    const dt = Math.min(0.05, now - this.last);
    this.last = now;

    if (this.revertAt !== null && now >= this.revertAt) {
      this.revertAt = null;
      if (this.revertEmotion) this.emotion = "calm";
      if (this.revertAction) this.action = "idle";
    }

    // layer: base ← emotion ← action (body activity wins over felt state)
    const [ep, eb] = EMOTIONS[this.emotion];
    const [ap, ab] = ACTIONS[this.action];
    const target: Pose = { ...CALM, ...ep, ...ap };
    const beh: Behavior = { ...CALM_B, ...eb, ...ab };

    target.mouthCurve += (this.warmth - 0.5) * 0.35;
    target.cheek = Math.min(1, target.cheek + (this.warmth - 0.5) * 0.4);
    target.cheekWarm = Math.min(1, target.cheekWarm + (this.warmth - 0.5) * 0.3);
    target.posture += (this.confidence - 0.5) * 0.4;
    target.headDrop += (0.5 - this.confidence) * 3;
    beh.breathRate *= 0.75 + this.energy * 0.6;
    beh.saccadeAmp *= 0.6 + this.energy * 0.8;

    let giggle = beh.giggle;
    if (this.petting && this.action !== "hiding") {
      target.eyeOpen = 0.06;
      target.mouthCurve = 0.9;
      target.mouthOpen = 0.3;
      target.cheek = 1; target.cheekWarm = 0.95; target.cheekPuff = 1;
      target.earL = -4; target.earR = -4;
      giggle = 1; // Zazoo giggles — it speaks, it does not purr
    }

    const speed = 0.8 + this.energy * 0.8;
    for (const k of POSE_KEYS) {
      const hz = (k === "eyeOpen" ? 4 : k === "hide" ? 1.6 : k.startsWith("gaze") ? 2.5 : 1.4) * speed;
      const [x, v] = spring(this.pose[k], this.vel[k], target[k], dt, hz);
      this.pose[k] = x; this.vel[k] = v;
    }

    // breathing — frequency + depth are emotional signals in their own right
    this.breathPhase += dt * beh.breathRate * 2 * Math.PI;
    const breath = Math.sin(this.breathPhase) * beh.breathDepth;

    let blink = 0;
    if (this.blinkT >= 0) {
      this.blinkT += dt * 6.5 * beh.blinkSpeed;
      blink = Math.sin(Math.min(Math.PI, this.blinkT * Math.PI));
      if (this.blinkT >= 1) {
        this.blinkT = -1;
        if (this.doubleBlink) { this.doubleBlink = false; this.nextBlink = 0.18; }
      }
    } else {
      this.nextBlink -= dt;
      if (this.nextBlink <= 0) {
        this.blinkT = 0;
        this.nextBlink = beh.blinkEvery * (0.6 + Math.random() * 0.8);
      }
    }

    this.nextSaccade -= dt;
    if (this.nextSaccade <= 0) {
      this.sacX = (Math.random() - 0.5) * 0.5 * beh.saccadeAmp;
      this.sacY = (Math.random() - 0.5) * 0.35 * beh.saccadeAmp;
      this.nextSaccade = (beh.creep ? 0.25 : 0.4) + Math.random() * 1.8;
    }
    let gx = this.pose.gazeBiasX + this.sacX;
    let gy = this.pose.gazeBiasY + this.sacY;
    if (this.attention === "cursor" && this.cursor && !this.petting) {
      gx += this.cursor.x * 0.8;
      gy += this.cursor.y * 0.8;
    } else if (this.attention === "away") {
      gx += 0.7;
    }
    gx = Math.max(-1, Math.min(1, gx));
    gy = Math.max(-1, Math.min(1, gy));

    let earTwitch = 0;
    if (this.earTwitchT >= 0) {
      this.earTwitchT += dt * 8;
      earTwitch = Math.sin(Math.min(Math.PI, this.earTwitchT * Math.PI)) * 9;
      if (this.earTwitchT >= 1) this.earTwitchT = -1;
    } else {
      this.nextEarTwitch -= dt;
      if (this.nextEarTwitch <= 0) { this.earTwitchT = 0; this.nextEarTwitch = 5 + Math.random() * 14; }
    }

    this.nextIdleGesture -= dt;
    if (this.nextIdleGesture <= 0) {
      if (this.emotion === "sleepy" && this.action === "idle") this.trigger("yawn", now);
      this.nextIdleGesture = 10 + Math.random() * 15;
    }

    // gestures — hop carries anticipation (crouch) then squash-and-stretch
    let hopY = 0, pawLift = 0, armsUp = 0, nodOnceY = 0, yawnOpen = 0, hopSquash = 0;
    this.gestures = this.gestures.filter((g) => now < g.start + g.dur);
    for (const g of this.gestures) {
      if (now < g.start) continue;
      const p = (now - g.start) / g.dur;
      const env = Math.sin(Math.PI * Math.min(1, p));
      if (g.name === "hop") {
        if (p < 0.18) {
          hopSquash = Math.sin((p / 0.18) * Math.PI) * 0.5; // anticipation crouch
        } else {
          const q = (p - 0.18) / 0.82;
          hopY = -Math.abs(Math.sin(q * Math.PI * 2)) * 18 * Math.sin(Math.PI * q);
          hopSquash = -0.25 * Math.sin(q * Math.PI * 2); // stretch in air
          armsUp = Math.sin(Math.PI * q);
        }
      } else if (g.name === "specAdjust") {
        pawLift = env;
        if (p > 0.45 && p < 0.6) this.specJiggleV += dt * 220;
      } else if (g.name === "nodOnce") {
        nodOnceY = Math.sin(p * Math.PI * 2) * 3.5 * env;
      } else if (g.name === "yawn") {
        yawnOpen = env;
      }
    }

    const [jx, jv] = spring(this.specJiggleX, this.specJiggleV, 0, dt, 3.2);
    this.specJiggleX = jx; this.specJiggleV = jv;

    this.wagPhase += dt * (2 + beh.tailWag * 9);
    const nodY = beh.nod * Math.sin(now * 1.6) * 2.2 + nodOnceY;
    const creepY = beh.creep * Math.sin(now * 3.2) * 2;
    const levitateY = this.pose.levitate * (Math.sin(now * 0.9) * 3 - 5);
    const wiggle = giggle * Math.sin(now * 16) * 2.4;

    // whiskers floating in air — breath-coupled + their own slow sway
    const whiskerSway =
      this.pose.whiskerFloat * (Math.sin(now * 1.4) * 2.4 + Math.sin(now * 0.53 + 1.7) * 1.4) +
      breath * 0.8;

    return {
      ...this.pose,
      eyeOpen: Math.max(0.02, this.pose.eyeOpen * (1 - blink) - yawnOpen * 0.6),
      mouthOpen: Math.min(1, this.pose.mouthOpen + yawnOpen + giggle * 0.2),
      squash: Math.max(0, Math.min(1, this.pose.squash + hopSquash)),
      blink,
      breath,
      gazeX: gx,
      gazeY: gy,
      hopY: hopY + creepY + levitateY,
      wiggle,
      pawLift,
      armsUp,
      specJiggle: this.specJiggleX,
      tailWagPhase: this.wagPhase,
      wagAmount: beh.tailWag,
      nodY,
      whiskerSway,
      earL: this.pose.earL + earTwitch,
      sparkle: this.emotion === "celebrating" || this.emotion === "curious" ? 1 : 0,
      zzz: this.emotion === "sleepy" ? 1 : 0,
    };
  }
}

export const ZAZOO_EMOTIONS: ZazooEmotion[] = [
  "calm", "curious", "thinking", "listening", "happy", "proud",
  "unsure", "concerned", "comforting", "celebrating", "sleepy",
];
export const ZAZOO_ACTIONS: ZazooAction[] = ["idle", "meditating", "sneaking", "hiding"];
