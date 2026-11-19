import { resolve } from "node:path";
import { cacheRoot, dataRoot } from "../repository-paths.js";
import { generateIntegratedReviewPackets } from "./integrated-review-packets.js";

const root = dataRoot(process.cwd());
const cache = cacheRoot(root);
const result = await generateIntegratedReviewPackets({
  growRunDirectory: resolve(
    process.argv[2] ?? resolve(cache, "import-runs/grow/latest"),
  ),
  cropGraphRunDirectory: resolve(
    process.argv[3] ?? resolve(cache, "import-runs/cropgraph/latest"),
  ),
  wfoRunDirectory: resolve(
    process.argv[4] ?? resolve(cache, "import-runs/wfo/latest"),
  ),
  taxrefWfoRunDirectory: resolve(
    process.argv[5] ?? resolve(cache, "import-runs/taxref-wfo/latest"),
  ),
  outputDirectory: resolve(
    process.argv[6] ?? resolve(cache, "curation-drafts/integrated/latest"),
  ),
});

console.log(JSON.stringify(result));
