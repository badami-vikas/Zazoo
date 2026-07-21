import { z } from "zod";

export type DatabaseUuid = string & { readonly __databaseUuid: unique symbol };

export const databaseUuidSchema = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase() as DatabaseUuid);

export class InvalidDatabaseIdentifierError extends TypeError {
  constructor(
    readonly field: string,
    readonly value: unknown,
  ) {
    super(`${field} must be a valid UUID`);
    this.name = "InvalidDatabaseIdentifierError";
  }
}

export function isDatabaseUuid(value: unknown): value is DatabaseUuid {
  return databaseUuidSchema.safeParse(value).success;
}

export function parseDatabaseUuid(value: unknown, field: string): DatabaseUuid {
  const parsed = databaseUuidSchema.safeParse(value);
  if (!parsed.success) throw new InvalidDatabaseIdentifierError(field, value);
  return parsed.data;
}
