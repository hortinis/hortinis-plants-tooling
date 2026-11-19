import { resolve } from "node:path";
import { dataRoot } from "../../src/repository-paths.js";

export function catalogFile(...path: string[]): string {
  return resolve(dataRoot(), ...path);
}
