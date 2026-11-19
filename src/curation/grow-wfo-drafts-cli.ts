import { resolve } from "node:path";
import { cacheRoot, dataRoot } from "../repository-paths.js";
import { generateGrowWfoDrafts } from "./grow-wfo-drafts.js";

const root = dataRoot(process.cwd());
const cache = cacheRoot(root);
const result = await generateGrowWfoDrafts({
  growRunDirectory: resolve(
    process.argv[2] ?? resolve(cache, "import-runs/grow/latest"),
  ),
  wfoRunDirectory: resolve(
    process.argv[3] ?? resolve(cache, "import-runs/wfo/latest"),
  ),
  outputDirectory: resolve(
    process.argv[4] ?? resolve(cache, "curation-drafts/grow-wfo/latest"),
  ),
});

console.log(JSON.stringify(result));
