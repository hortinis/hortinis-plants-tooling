import { resolve } from "node:path";
import { cacheRoot, dataRoot } from "../../repository-paths.js";
import { TaxrefPinError, verifyTaxrefPin } from "./verify-pin.js";

const repositoryRoot = dataRoot(process.cwd());
const archivePath = resolve(
  process.argv[2] ??
    resolve(
      cacheRoot(repositoryRoot),
      "source-inputs/taxref/18.0/TAXREF_v18_2025.zip",
    ),
);

try {
  const result = await verifyTaxrefPin({
    archivePath,
    sourceManifestPath: resolve(
      repositoryRoot,
      "data/sources/taxref/source-manifest.json",
    ),
    archiveIndexPath: resolve(
      repositoryRoot,
      "data/sources/taxref/archive-index.json",
    ),
  });
  console.log(
    `TAXREF ${result.release} pin verified: ${result.memberCount} archive members.`,
  );
} catch (error) {
  const message =
    error instanceof TaxrefPinError ? error.message : String(error);
  console.error(`TAXREF pin verification failed: ${message}`);
  process.exitCode = 1;
}
