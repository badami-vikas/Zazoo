// Minimal surface of js-yaml 4 used by module-register.ts; the package ships
// no types of its own and @types/js-yaml is not a dependency here.
declare module "js-yaml" {
  export function load(input: string, options?: { filename?: string }): unknown;
  export class YAMLException extends Error {}
}
