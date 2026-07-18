import { z } from "zod";

const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(
  (value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return (
      !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  },
  { message: "Invalid calendar date" },
);

const rfc3339Schema = z.string().datetime({ offset: true });

export const relationshipDateTimeSchema = z
  .union([rfc3339Schema, dateOnlySchema])
  .transform((value) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? `${value}T00:00:00.000Z`
      : new Date(value).toISOString(),
  );
