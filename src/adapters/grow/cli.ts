import { resolve } from "node:path";
import { cacheRoot, dataRoot } from "../../repository-paths.js";
import { importGrowSource } from "./adapter.js";

const root = dataRoot(process.cwd());
const inputDirectory = resolve(
  process.argv[2] ?? resolve(root, "data/sources/grow/releases/2020"),
);
const outputDirectory = resolve(
  process.argv[3] ?? resolve(cacheRoot(root), "import-runs/grow/latest"),
);

const result = await importGrowSource({ inputDirectory, outputDirectory });
console.log(
  JSON.stringify({
    outputDirectory,
    plants: result.extraction.plants.length,
    locations: result.extraction.locations.length,
    calendarWindows: result.extraction.calendarWindows.length,
    candidates: result.extraction.candidates.length,
    diagnostics: result.extraction.diagnostics.length,
    warnings: result.counts.warnings,
    rejectedRecords: result.counts.rejectedRecords,
    unresolvedMappings: result.counts.unresolvedMappings,
  }),
);
