import { resolve } from "node:path";
import { dataRoot } from "../repository-paths.js";
import { validate } from "../schema/validation-api.js";
import { assertSchema, readObject, same } from "./curation-artifacts.js";
import {
  acquireDatasetLock,
  authoringFingerprint,
  readCollections,
  runDecisionTransaction,
} from "./decision-transaction.js";
import { validateGrowWfoDataset } from "./grow-wfo-validation.js";

export const integrationPath = "data/curation/plant-integration";
export const catalogPath = "data/curation/grow-wfo-initial";
export const licensingAcceptancePath =
  integrationPath + "/licensing-acceptance.json";

export async function readLicensingAcceptance(root: string) {
  const acceptance = await readObject(resolve(root, licensingAcceptancePath));
  assertSchema(
    { validate },
    "urn:hortinis:plants:schema:v1:review",
    acceptance,
  );
  if (
    acceptance.purpose !== "rights" ||
    acceptance.status !== "accepted" ||
    acceptance.scope !== "all-reviewed-plants-licensing" ||
    typeof acceptance.quote !== "string" ||
    !acceptance.provenance
  ) {
    throw new Error("Missing direct curator licensing acceptance");
  }
  return acceptance;
}

export async function validateAuthoring(root: string, directory: string) {
  const result = await validateGrowWfoDataset({
    repositoryRoot: root,
    datasetDirectory: directory,
  });
  if (!result.valid || !result.loaded) {
    throw new Error(result.issues.map((issue) => issue.message).join("\n"));
  }
  return result.loaded;
}

export async function recordReviewedLicensingAcceptance(root: string) {
  const directory = resolve(root, catalogPath);
  const unlock = await acquireDatasetLock(directory);
  try {
    const acceptance = await readLicensingAcceptance(root);
    const {
      manifest: { collections: descriptors },
    } = await validateAuthoring(root, directory);
    const before = await authoringFingerprint(directory, descriptors);
    const original = await readCollections(directory, descriptors);
    const reviews = original.get("reviews")!;
    const existing = reviews.find((review) => review.id === acceptance.id);
    if (existing) {
      if (!same(existing, acceptance))
        throw new Error(
          "Licensing acceptance ID already exists with different content",
        );
      return { datasetSha256: before };
    }
    const collections = new Map(original);
    collections.set("reviews", [...reviews, acceptance]);
    return await runDecisionTransaction({
      directory,
      descriptors,
      original,
      collections,
      fingerprint: (path) => authoringFingerprint(path, descriptors),
      validateStage: async (path) => {
        await validateAuthoring(root, path);
      },
      beforePublish: async () => {
        if (
          (await authoringFingerprint(directory, descriptors)) !== before ||
          !same(await readLicensingAcceptance(root), acceptance)
        )
          throw new Error(
            "Licensing acceptance inputs changed during the transaction",
          );
      },
    });
  } finally {
    await unlock();
  }
}

if (process.argv[1] === import.meta.filename) {
  try {
    console.log(
      await recordReviewedLicensingAcceptance(dataRoot(process.cwd())),
    );
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
