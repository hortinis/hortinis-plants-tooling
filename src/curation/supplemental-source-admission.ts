import { readFile, mkdir, writeFile, lstat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { dataRoot } from "../repository-paths.js";
import { validate } from "../schema/validation-api.js";
import { serializeCanonicalJson } from "../serialization/canonical-json.js";
import {
  object,
  records,
  field,
  same,
  digest,
  containedPath,
  assertSchema,
  type RecordValue,
} from "./curation-artifacts.js";
import { preparePlantIntegration } from "./prepare-plant-integration.js";
import { validateGrowWfoDataset } from "./grow-wfo-validation.js";
import {
  acquireDatasetLock,
  authoringFingerprint,
  readCollections,
  runDecisionTransaction,
} from "./decision-transaction.js";

const datasetPath = "data/curation/grow-wfo-initial";

/** Admit pinned source metadata only. Never author claims or promote research rights. */
export async function admitSupplementalSources(
  root: string,
  preparationPath: string,
  expectedDatasetSha256: string,
) {
  const preparation = object(
    JSON.parse(
      await readFile(await containedPath(root, preparationPath), "utf8"),
    ),
  );
  const current = await preparePlantIntegration(root);
  if (!same(current, preparation))
    throw new Error("Stale or altered source preparation");
  const dataset = await containedPath(root, datasetPath);
  if ((await lstat(resolve(root, datasetPath))).isSymbolicLink())
    throw new Error("Symlinked dataset is not supported");
  const release = await acquireDatasetLock(dataset);
  try {
    const initial = await validateGrowWfoDataset({
      repositoryRoot: root,
      datasetDirectory: dataset,
    });
    if (!initial.valid || !initial.loaded)
      throw new Error("Current authoring dataset is invalid");
    const originalManifest = object(
      JSON.parse(
        await readFile(join(dataset, "dataset-manifest.json"), "utf8"),
      ),
    );
    const descriptors = initial.loaded.manifest.collections;
    if (
      (await authoringFingerprint(dataset, descriptors)) !==
      expectedDatasetSha256
    )
      throw new Error("Stale authoring fingerprint");
    const dependencies = [...records(originalManifest.dependencies)];
    const newDependencies: RecordValue[] = [];
    const canonical = (value: unknown) =>
      Buffer.concat([
        Buffer.from(serializeCanonicalJson(value)),
        Buffer.from("\n"),
      ]);
    for (const entry of records(preparation.sources)) {
      const admissionId = field(entry, "id");
      const directory = `data/sources/supplemental/${admissionId}`;
      const absoluteDirectory = resolve(root, directory);
      await mkdir(absoluteDirectory, { recursive: true });
      // Resolve after mkdir to reject a pre-existing symlink outside the repository.
      await containedPath(root, directory);
      for (const [role, property] of [
        ["source", "source"],
        ["licence", "licence"],
        ["source-manifest", "sourceManifest"],
      ] as const) {
        const value = object(entry[property]);
        const schemaId = `urn:hortinis:plants:schema:v1:${role}`;
        assertSchema({ validate }, schemaId, value);
        const id = field(value, "id");
        const path = `${directory}/${role}.json`;
        const dependency = {
          role,
          id,
          path,
          format: "json",
          schemaId,
          sha256: digest(canonical(value)),
          authority: "tracked-source-metadata",
        };
        const existing = dependencies.find((row) => row.id === id);
        if (existing && !same(existing, dependency))
          throw new Error(`Conflicting admitted source metadata: ${id}`);
        await immutableWrite(resolve(root, path), canonical(value));
        if (existing) continue;
        dependencies.push(dependency);
        newDependencies.push(dependency);
      }
      await immutableWrite(
        join(absoluteDirectory, "provenance.json"),
        canonical(entry),
      );
    }
    if (newDependencies.length === 0)
      throw new Error("No new source dependencies");
    const collections = await readCollections(dataset, descriptors);
    const next = { ...originalManifest, dependencies };
    const verifyInputs = async () => {
      if (
        (await authoringFingerprint(dataset, descriptors)) !==
        expectedDatasetSha256
      )
        throw new Error("Dataset changed during admission");
      if (!same(await preparePlantIntegration(root), preparation))
        throw new Error("Review inputs changed during admission");
      for (const dependency of newDependencies) {
        const bytes = await readFile(
          await containedPath(root, field(dependency, "path")),
        );
        if (digest(bytes) !== dependency.sha256)
          throw new Error("Source metadata changed during admission");
      }
    };
    return await runDecisionTransaction({
      directory: dataset,
      collections,
      original: collections,
      descriptors,
      manifest: next,
      fingerprint: (stage) => authoringFingerprint(stage, descriptors),
      validateStage: async (stage) => {
        const result = await validateGrowWfoDataset({
          repositoryRoot: root,
          datasetDirectory: stage,
        });
        if (!result.valid)
          throw new Error(
            `Invalid source admission: ${result.issues.map((row) => row.message).join("; ")}`,
          );
      },
      beforePublish: verifyInputs,
    });
  } finally {
    await release();
  }
}

async function immutableWrite(path: string, bytes: Buffer) {
  try {
    await writeFile(path, bytes, { flag: "wx" });
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "EEXIST"
    )
      throw error;
    if (
      (await lstat(path)).isSymbolicLink() ||
      !(await readFile(path)).equals(bytes)
    )
      throw new Error(`Conflicting immutable metadata: ${path}`, {
        cause: error,
      });
  }
}

if (process.argv[1] === import.meta.filename) {
  try {
    const args = process.argv.slice(2).filter((arg) => arg !== "--");
    if (args.length !== 2)
      throw new Error(
        "Usage: source-admission <preparation.json> <current-dataset-sha256>",
      );
    console.log(
      JSON.stringify(
        await admitSupplementalSources(
          dataRoot(process.cwd()),
          args[0]!,
          args[1]!,
        ),
      ),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
