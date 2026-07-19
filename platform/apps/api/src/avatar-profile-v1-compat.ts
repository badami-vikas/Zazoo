import { z } from "zod";

/** One-version API reader for clients that still send the pre-VOCAB1 field. */
export const onboardingAvatarStyleInput = z
  .object({
    avatarStyle: z.string().min(1).optional(),
    animal: z.string().min(1).optional(),
  })
  .refine((input) => input.avatarStyle !== undefined || input.animal !== undefined, {
    message: "avatarStyle is required",
  });

export function resolveOnboardingAvatarStyle(input: {
  avatarStyle?: string | undefined;
  animal?: string | undefined;
}): string {
  const style = input.avatarStyle ?? input.animal;
  if (!style) throw new Error("avatarStyle is required");
  return style;
}

export function normalizeOnboardingAnswers(
  answers: Record<string, string | string[]>,
  avatarStyle: string,
): Record<string, string | string[]> {
  const { spirit_animal: _legacyAvatarStyle, ...canonicalAnswers } = answers;
  return {
    ...canonicalAnswers,
    avatar_style: avatarStyle,
  };
}
