import { resolve } from "node:path";
import { cacheRoot, dataRoot } from "../repository-paths.js";
import { reconcileTaxrefToReviewedWfo } from "./taxref-wfo-localization.js";

const root = dataRoot(process.cwd());
const cache = cacheRoot(root);
const result = await reconcileTaxrefToReviewedWfo({
  datasetDirectory: resolve(
    process.argv[2] ?? resolve(root, "data/curation/grow-wfo-initial"),
  ),
  taxrefRunDirectory: resolve(
    process.argv[3] ?? resolve(cache, "import-runs/taxref/latest"),
  ),
  wfoRunDirectory: resolve(
    process.argv[4] ?? resolve(cache, "import-runs/wfo/latest"),
  ),
  taxrefArchivePath: resolve(
    process.argv[5] ??
      resolve(cache, "source-inputs/taxref/18.0/TAXREF_v18_2025.zip"),
  ),
  outputDirectory: resolve(
    process.argv[6] ?? resolve(cache, "import-runs/taxref-wfo/latest"),
  ),
});

console.log(JSON.stringify(result));
