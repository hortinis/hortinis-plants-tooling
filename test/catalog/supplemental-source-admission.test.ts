import { catalogFile } from "../support/catalog-file.js";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { removeCanonicalAdmissions } from "../support/pre-canonical-admission.js";
import {
  object,
  records,
  field,
} from "../../src/curation/curation-artifacts.js";
import { preparePlantIntegration } from "../../src/curation/prepare-plant-integration.js";
import { admitSupplementalSources } from "../../src/curation/supplemental-source-admission.js";
import { authoringFingerprint } from "../../src/curation/decision-transaction.js";

it("admits supplemental metadata while preserving every claim collection and rejecting stale bases and replay", async () => {
  const root = await mkdtemp(join(tmpdir(), "hortinis-admission-test-"));
  try {
    const inventory = object(
      JSON.parse(
        await readFile(
          catalogFile(
            "data/curation/plant-review-consolidation/inventory.json",
          ),
          "utf8",
        ),
      ),
    );
    for (const input of records(inventory.inputs)) {
      const path = field(input, "path");
      if (path.startsWith("schemas/")) continue;
      await mkdir(dirname(join(root, path)), { recursive: true });
      await cp(catalogFile(path), join(root, path));
    }
    const dataset = join(root, "data/curation/grow-wfo-initial");
    await removeCanonicalAdmissions(dataset);
    const manifestPath = join(dataset, "dataset-manifest.json");
    const manifest = {
      ...object(JSON.parse(await readFile(manifestPath, "utf8"))),
    };
    manifest.dependencies = records(manifest.dependencies).filter(
      (row) => !field(row, "path").startsWith("data/sources/supplemental/"),
    );
    await writeFile(manifestPath, JSON.stringify(manifest));
    const descriptors = records(manifest.collections).map((row) => ({
      path: field(row, "path"),
    }));
    const originalCollections = await Promise.all(
      descriptors.map(({ path }) => readFile(join(dataset, path))),
    );
    const before = await authoringFingerprint(dataset, descriptors);
    const preparation = await preparePlantIntegration(root);
    const path = "preparation.json";
    await writeFile(join(root, path), JSON.stringify(preparation));
    await expect(
      admitSupplementalSources(root, path, "0".repeat(64)),
    ).rejects.toThrow("Stale authoring fingerprint");
    const result = await admitSupplementalSources(root, path, before);
    expect(result.datasetSha256).not.toBe(before);
    const next = object(JSON.parse(await readFile(manifestPath, "utf8")));
    expect(records(next.dependencies)).toHaveLength(
      records(manifest.dependencies).length + preparation.sources.length * 3,
    );
    const admittedCollections = await Promise.all(
      descriptors.map(({ path }) => readFile(join(dataset, path))),
    );
    expect(admittedCollections).toEqual(originalCollections);
    await expect(admitSupplementalSources(root, path, before)).rejects.toThrow(
      "Stale or altered source preparation",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 120000);
