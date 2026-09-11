import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { LocalGeocodingProviderError } from "../geocoding-provider.js";
import { t, procedure } from "../router-shared.js";

export const viewRouter = t.router({
  geocoderStatus: procedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const provider = ctx.wiring.geocodingProvider;
      return {
        available: provider !== null,
        providerId: provider?.id ?? null,
        plane: provider?.plane ?? null,
        attribution: provider?.attribution ?? null,
      };
    }),

  resolveLocations: procedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        labels: z
          .array(z.string().trim().min(1).max(500))
          .min(1)
          .max(20),
        confirmedLocalProvider: z.literal(true),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const provider = ctx.wiring.geocodingProvider;
      if (!provider) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "No private Local Plane geocoder is configured. Enter coordinates directly or configure BRIDGE_LOCAL_GEOCODER_URL.",
        });
      }

      const labels = new Map<string, string>();
      for (const label of input.labels) {
        const trimmed = label.trim();
        const key = trimmed.toLocaleLowerCase("en-US");
        if (!labels.has(key)) labels.set(key, trimmed);
      }

      const results: Array<{
        query: string;
        coordinate: Awaited<ReturnType<typeof provider.geocode>>;
      }> = [];
      for (const query of labels.values()) {
        try {
          results.push({
            query,
            coordinate: await provider.geocode({ query }),
          });
        } catch (error) {
          if (error instanceof LocalGeocodingProviderError) {
            throw new TRPCError({
              code: "BAD_GATEWAY",
              message: error.message,
              cause: error,
            });
          }
          throw error;
        }
      }
      return {
        providerId: provider.id,
        attribution: provider.attribution ?? null,
        results,
      };
    }),
});
