/**
 * Node's type-stripping runs `.ts` files directly, but it resolves specifiers
 * the ESM way — extensionless relative imports (which every module under
 * `src/app` uses, because Vite resolves them) do not exist as files. This hook
 * retries a failed relative resolution with `.ts` / `.tsx` / `/index.ts`, which
 * is the same order the bundler tries, so a test can import a real source
 * module instead of a copy of it.
 *
 * Registered for the whole `test` script: it only ever runs after resolution
 * has already failed, so it cannot change how any working import resolves.
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register(
  "data:text/javascript," +
    encodeURIComponent(`
      const CANDIDATES = [".ts", ".tsx", "/index.ts", "/index.tsx"];
      export async function resolve(specifier, context, next) {
        try {
          return await next(specifier, context);
        } catch (error) {
          if (!specifier.startsWith(".") && !specifier.startsWith("/")) throw error;
          for (const suffix of CANDIDATES) {
            try {
              return await next(specifier + suffix, context);
            } catch {
              // try the next shape
            }
          }
          throw error;
        }
      }
    `),
  pathToFileURL("./"),
);
