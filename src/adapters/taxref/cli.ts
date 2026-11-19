import { resolve } from "node:path";
import { cacheRoot, dataRoot } from "../../repository-paths.js";
import { importTaxrefSource } from "./adapter.js";

const cache = cacheRoot(dataRoot(process.cwd()));
const archivePath = resolve(
  process.argv[2] ??
    resolve(cache, "source-inputs/taxref/18.0/TAXREF_v18_2025.zip"),
);
const outputDirectory = resolve(
  process.argv[3] ?? resolve(cache, "import-runs/taxref/latest"),
);
const result = await importTaxrefSource({ archivePath, outputDirectory });
console.log(
  JSON.stringify({
    outputDirectory: result.outputDirectory,
    manifestSha256: result.manifestSha256,
  }),
);
