import { resolve } from "node:path";

export const toolingRoot = resolve(import.meta.dirname, "..");

export function dataRoot(defaultRoot = toolingRoot): string {
  return resolve(process.env.HORTINIS_DATA_ROOT ?? defaultRoot);
}

export function outputRoot(defaultRoot: string): string {
  return resolve(process.env.HORTINIS_OUTPUT_ROOT ?? defaultRoot);
}

export function cacheRoot(defaultRoot: string): string {
  return resolve(
    process.env.HORTINIS_CACHE_ROOT ??
      resolve(outputRoot(defaultRoot), ".cache"),
  );
}
