import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  field,
  digest,
  strings,
  object,
  readObject,
  records,
} from "../../src/curation/curation-artifacts.js";
import { authoringFingerprint } from "../../src/curation/decision-transaction.js";
import {
  catalogPath,
  integrationPath,
  validateAuthoring,
} from "../../src/curation/reviewed-licensing-acceptance.js";
import { serializeCanonicalJson } from "../../src/serialization/canonical-json.js";
import { readReviewedDispositions } from "../../src/curation/resolved-reviewed-plant-batch.js";
import { projectPlantFacts } from "../../src/domain/plant-fact-projection.js";
import { projectCultivationRules } from "../../src/domain/cultivation-rule-projection.js";
import { dataRoot } from "../../src/repository-paths.js";

const root = dataRoot();

it("reconciles every frozen entry and preserves the exact pre-existing authoring catalog", async () => {
  const base = await readObject(
    join(root, integrationPath, "reviewed-remainder-frozen.json"),
  );
  const latest = await readObject(
    join(root, integrationPath, "reviewed-plant-batch.json"),
  );
  const { dataset, manifest } = await validateAuthoring(
    root,
    join(root, catalogPath),
  );
  const recorded = new Map(
    records(latest.claims).map((row) => [
      field(row, "packetId") + ":" + field(object(row.claim), "id"),
      row,
    ]),
  );
  const baselinePacketIds = new Set(
    records(base.reviewedPackets).map((row) => row.packetId),
  );
  expect(
    [...recorded.values()].filter((row) => baselinePacketIds.has(row.packetId)),
  ).toHaveLength(1227);
  expect(
    records(latest.reviewedPackets).filter((row) =>
      baselinePacketIds.has(row.packetId),
    ),
  ).toEqual(records(base.reviewedPackets));
  const remainderReviews = dataset.reviews.filter(
    (row) =>
      typeof row.resolutionPath === "string" &&
      row.resolutionPath.startsWith(integrationPath + "/reviewed-remainder-"),
  );
  const finalReviews = dataset.reviews.filter(
    (row) =>
      typeof row.resolutionPath === "string" &&
      row.resolutionPath.startsWith(integrationPath + "/final-exceptions-"),
  );
  const prior = await readReviewedDispositions(root, remainderReviews);
  for (const row of records(base.claims)) {
    const key = field(row, "key");
    expect(recorded.get(key)?.packetSha256).toBe(row.packetSha256);
    expect(prior.get(String(row.packetSha256) + ":" + key)?.batch).toBe(
      "reviewed-remainder",
    );
  }

  const final = await readObject(
    join(root, integrationPath, "final-exceptions-frozen.json"),
  );
  const exceptions = records(final.claims);
  expect(exceptions).toHaveLength(58);
  const replacementClaims = records(latest.claims).filter((row) =>
    Array.isArray(object(row.claim).replaces),
  );
  const originalKeys = new Map(exceptions.map((row) => [row.key, row]));
  const refinements = dataset.reviews.filter(
    (row) => row.assertionSupersessions,
  );
  const admitted = new Set(
    records(latest.claims)
      .filter((row) => row.outcome === "admitted")
      .map(
        (row) => field(row, "packetId") + ":" + field(object(row.claim), "id"),
      ),
  );
  for (const replacement of replacementClaims) {
    const key =
      field(replacement, "packetId") +
      ":" +
      field(object(replacement.claim), "id");
    expect(admitted.has(key)).toBe(true);
    for (const pin of records(object(replacement.claim).replaces)) {
      const row = recorded.get(field(pin, "key"))!;
      if (originalKeys.has(pin.key)) {
        expect(originalKeys.get(pin.key)?.packetSha256).toBe(pin.packetSha256);
        expect(strings(object(row.disposition).replacementKeys)).toContain(key);
      } else {
        expect(row.packetSha256).toBe(pin.packetSha256);
        const predecessor = records(object(row.disposition).records).find(
          (link) => link.collection === "assertions",
        )!;
        const successor = records(object(replacement.disposition).records).find(
          (link) => link.collection === "assertions",
        )!;
        expect(
          refinements
            .flatMap((review) => records(review.assertionSupersessions))
            .some(
              (link) =>
                link.predecessorId === predecessor.id &&
                link.predecessorSha256 === predecessor.sha256 &&
                link.successorId === successor.id &&
                link.successorSha256 === successor.sha256,
            ),
        ).toBe(true);
      }
    }
  }
  for (const index of [7, 8, 9, 22, 25, 26]) {
    const key = field(exceptions[index]!, "key");
    expect(recorded.get(key)?.outcome).toBe("unresolved");
  }
  const replacementAssertions = finalReviews.flatMap((review) =>
    records(object(review.reviewedPlantAdmission).records)
      .filter((row) => row.collection === "assertions")
      .map((row) => object(row.value)),
  );
  const predicates = new Set(
    replacementAssertions.map((row) => field(row, "predicate")),
  );
  const commercial = new Set(
    projectPlantFacts(dataset, "commercial", predicates).map((row) => row.id),
  );
  for (const row of replacementAssertions)
    expect(commercial.has(row.id)).toBe(false);
  const raspberry = replacementAssertions.filter(
    (row) => row.predicate === "care_guidance",
  );
  expect(raspberry).toHaveLength(3);
  expect(new Set(raspberry.map((row) => row.contextId)).size).toBe(3);
  const originalManitoba = exceptions[46]!;
  const raspberrySources = raspberry.flatMap((row) =>
    strings(row.evidenceReferenceIds),
  );
  expect(raspberrySources).not.toContain(
    object(records(originalManitoba.evidence)[0]).evidenceReferenceId,
  );
  for (const pin of records(final.packets))
    expect(digest(await readFile(join(root, field(pin, "path"))))).toBe(
      pin.sha256,
    );

  const removed = new Map<string, Set<string>>();
  const add = (role: string, id: string) => {
    const ids = removed.get(role) ?? new Set<string>();
    ids.add(id);
    removed.set(role, ids);
  };
  const newPacketPaths = new Set(
    records(latest.reviewedPackets)
      .filter((row) => !baselinePacketIds.has(row.packetId))
      .map((row) => row.path),
  );
  const finalSourceDirectories = new Set<string>();
  for (const dep of manifest.dependencies) {
    if (
      dep.role !== "source" ||
      !dep.path.startsWith("data/sources/supplemental/c4-source-admissions-")
    )
      continue;
    const directory = dep.path.slice(0, dep.path.lastIndexOf("/"));
    const metadata = await readObject(join(root, directory, "provenance.json"));
    if (newPacketPaths.has(object(metadata.provenance).packetPath))
      finalSourceDirectories.add(directory);
  }
  for (const review of [...remainderReviews, ...finalReviews, ...refinements]) {
    add("reviews", field(review, "id"));
    const receipt = object(review.reviewedPlantAdmission);
    for (const record of records(receipt.records))
      add(field(record, "collection"), field(object(record.value), "id"));
  }
  const isolated = await mkdtemp(join(tmpdir(), "hortinis-remainder-lineage-"));
  try {
    await writeFile(
      join(isolated, "dataset-manifest.json"),
      Buffer.concat([
        serializeCanonicalJson({
          ...object(
            JSON.parse(
              await readFile(
                join(root, catalogPath, "dataset-manifest.json"),
                "utf8",
              ),
            ),
          ),
          dependencies: manifest.dependencies.filter(
            (dep) =>
              !finalSourceDirectories.has(
                dep.path.slice(0, dep.path.lastIndexOf("/")),
              ),
          ),
        }),
        Buffer.from("\n"),
      ]),
    );
    await Promise.all(
      manifest.collections.map(async (descriptor) => {
        const ids = removed.get(descriptor.role);
        const lines = await readFile(
          join(root, catalogPath, descriptor.path),
          "utf8",
        );
        const filtered = lines
          .split("\n")
          .filter(
            (line) => !line || !ids?.has(field(object(JSON.parse(line)), "id")),
          )
          .join("\n");
        await writeFile(join(isolated, descriptor.path), filtered);
      }),
    );
    expect(await authoringFingerprint(isolated, manifest.collections)).toBe(
      base.baseDatasetSha256,
    );
  } finally {
    await rm(isolated, { recursive: true, force: true });
  }

  const rules = projectCultivationRules(dataset, "authoring");
  expect(
    rules.filter((row) => object(row.timing).type === "conditional-season"),
  ).toHaveLength(8);
  const protectedSowing = rules.filter(
    (row) => row.action === "sow_indoors_or_undercover",
  );
  expect(protectedSowing).toHaveLength(27);
  const contexts = new Map(dataset.contexts.map((row) => [row.id, row]));
  for (const row of protectedSowing)
    expect(contexts.get(row.contextId)?.growingSystem).toBe(
      "indoor_or_undercover",
    );
  expect(
    projectCultivationRules(dataset, "commercial").some(
      (row) => row.action === "sow_indoors_or_undercover",
    ),
  ).toBe(false);
});

it("keeps production designations, independent source conflicts and replacement scope exact", async () => {
  const { dataset } = await validateAuthoring(root, join(root, catalogPath));
  const outcomes = await readObject(
    join(root, integrationPath, "final-exceptions-outcomes.json"),
  );
  expect(outcomes.originalExceptionDenominator).toBe(58);
  const originals = records(outcomes.originals);
  const replacements = records(outcomes.replacements);
  expect(originals).toHaveLength(58);
  expect(replacements).toHaveLength(48);
  expect(
    originals.filter((row) => row.outcome === "still-deferred"),
  ).toHaveLength(19);

  const regulatory = dataset.contexts.filter(
    (row) => object(row.regulatorySpecification ?? {}).scheme === "EU-PGI",
  );
  expect(regulatory).toHaveLength(1);
  const specification = object(regulatory[0]!.regulatorySpecification);
  expect(specification.designation).toBe("Mirabelles de Lorraine");
  expect(specification.publicationDate).toBe("2025-02-20");
  const production = dataset.assertions.find(
    (row) => row.contextId === regulatory[0]!.id,
  )!;
  expect(production.predicate).toBe("establishment_guidance");
  expect(
    dataset.plantConcepts.find(
      (row) => row.id === object(production.subject).id,
    )?.kind,
  ).toBe("production-scope");
  expect(
    dataset.cultivars.filter(
      (row) => row.denomination === "Mirabelle de Nancy",
    ),
  ).toHaveLength(1);

  const cabbage = originals.find(
    (row) => row.plant === "Heading cabbage" && row.originalValue === "Legume",
  )!;
  expect(cabbage.outcome).toBe("still-deferred");
  const cabbageReplacement = replacements.find((row) =>
    strings(cabbage.replacementKeys).includes(field(row, "key")),
  )!;
  expect(object(cabbageReplacement.value).sourceLabel).toBe("Brassicas");
  expect(object(object(cabbageReplacement.value).scheme).sourceId).not.toBe(
    "source_grow_edible_plant_database",
  );

  const byId = new Map(dataset.assertions.map((row) => [row.id, row]));
  for (const row of originals.filter(
    (row) =>
      row.plant === "Garden blackberry" &&
      typeof row.originalValue === "object",
  )) {
    expect(row.outcome).toBe("still-deferred");
    const replacement = replacements.find((candidate) =>
      strings(row.replacementKeys).includes(field(candidate, "key")),
    )!;
    expect(replacement.value).toEqual({ minimum: 5.6, maximum: 6.5 });
    expect(object(replacement.conditions).geography).toBe(
      "Oregon, United States",
    );
    const link = records(replacement.records).find(
      (entry) => entry.collection === "assertions",
    )!;
    expect(byId.get(link.id)?.value).toEqual(replacement.value);
  }
});
