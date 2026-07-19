/**
 * One-version compatibility reader for browser preferences written before
 * VOCAB1. New code must never write this shape or storage key.
 */
export const LEGACY_AVATAR_STORAGE_KEY = "bridge.avatar.v1";

export interface LegacyAvatarPreferences {
  style: unknown;
  avatarReady: boolean;
  avatarName?: string;
}

export function readLegacyAvatarPreferences(
  storage: Pick<Storage, "getItem">,
): LegacyAvatarPreferences | null {
  const raw = storage.getItem(LEGACY_AVATAR_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.eggHatched !== "boolean"
    ) return null;
    const avatarName = typeof parsed.avatarName === "string" && parsed.avatarName
      ? parsed.avatarName
      : undefined;
    return {
      style: parsed.animal,
      avatarReady: parsed.eggHatched,
      ...(avatarName ? { avatarName } : {}),
    };
  } catch {
    return null;
  }
}
