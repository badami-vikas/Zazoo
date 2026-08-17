/**
 * AgentZazoo — the live companion rig, cast as a specific Agent.
 *
 * Casting is DERIVED, never stored: the same Agent id always hashes to the
 * same species, so an Agent looks like itself on every surface and across
 * reinstalls without the manifest having to carry a costume field. Nothing
 * here is a fact about the Agent — it is presentation, so it cannot go stale
 * and cannot be wrong.
 *
 * ponytail: one director + one rAF loop per mounted rig. Fine for a page of
 * Agent cards; if a surface ever renders dozens, share one director across
 * the idle ones or pause the off-screen rigs.
 */
import { useEffect, useMemo } from "react";
import { ZazooAvatar, DEFAULT_APPEARANCE } from "./ZazooAvatar";
import { ZazooDirector, type ZazooEmotion } from "./director";
import { SPECIES } from "./species";
import { ZazooRoom, type PoseKey } from "./ZazooWorld";

/** Stable string -> species. FNV-1a, because it has to agree across reloads. */
export function castSpecies(agentId: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < agentId.length; i++) {
    h ^= agentId.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return SPECIES[h % SPECIES.length];
}

export function AgentZazoo({
  agentId,
  size = 96,
  emotion = "calm",
  facing = "front",
}: {
  agentId: string;
  size?: number;
  emotion?: ZazooEmotion;
  facing?: "front" | "back";
}) {
  const species = useMemo(() => castSpecies(agentId), [agentId]);
  const director = useMemo(() => new ZazooDirector(), []);
  useEffect(() => {
    director.perform({ emotion, attention: facing === "back" ? "away" : "user" });
  }, [director, emotion, facing]);

  return (
    <ZazooAvatar
      director={director}
      width={size}
      species={species}
      facing={facing}
      appearance={{ ...DEFAULT_APPEARANCE, body: species.body }}
    />
  );
}

/**
 * The Agent seen in its own workspace — the 2.5D room, cast for this Agent.
 * `scale` is the only sizing knob: the scene is authored once and scaled as a
 * whole, so a card thumbnail and a detail-page panel are the same room.
 */
export function AgentRoom({
  agentId,
  pose = "working",
  scale = 0.34,
}: {
  agentId: string;
  pose?: PoseKey;
  scale?: number;
}) {
  const species = useMemo(() => castSpecies(agentId), [agentId]);
  return <ZazooRoom pose={pose} species={species} scale={scale} />;
}
