import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, expect, it } from "vitest";
import { projectCatalog } from "../../src/index.js";
import { assertionSupersession } from "../../src/domain/assertion-supersession.js";
import {
  contentDigest,
  records,
  object,
} from "../../src/curation/curation-artifacts.js";
import {
  validateAuthoring,
  catalogPath,
} from "../../src/curation/reviewed-licensing-acceptance.js";
import type { ValidationDataset } from "../../src/curation/validation-dataset.js";
import {
  buildCatalogCandidate,
  ingestCatalogCandidate,
} from "../../src/artifact/catalog-candidate.js";
import { recordProjectionEligibility } from "../../src/domain/record-projection-eligibility.js";
import { dataRoot } from "../../src/repository-paths.js";
let dataset: ValidationDataset;
beforeAll(async () => {
  const root = dataRoot();
  ({ dataset } = await validateAuthoring(root, join(root, catalogPath)));
});

it("preserves every active source-qualified value, all eight local calendars and unknown information", () => {
  const result = projectCatalog(dataset, "authoring");
  const projected = new Map(
    [...result["plant-fact"]!, ...result["cultivation-rule"]!].map((row) => [
      row.id,
      row,
    ]),
  );
  const retired = assertionSupersession(dataset);
  for (const assertion of dataset.assertions) {
    if (retired.has(assertion.id)) {
      expect(projected.has(assertion.id)).toBe(false);
      continue;
    }
    const actual = projected.get(assertion.id)!;
    expect(actual).toBeDefined();
    expect(actual.subject).toEqual(assertion.subject);
    expect(actual.contextId).toBe(assertion.contextId);
    expect(actual.evidenceReferenceIds).toEqual(assertion.evidenceReferenceIds);
    expect(actual.reviewId).toBe(assertion.reviewId);
    if (assertion.predicate !== "cultivation_window")
      expect(actual.value).toEqual(assertion.value);
    else {
      expect(actual.action).toEqual(object(assertion.value).action);
      expect(actual.timing).toEqual(object(assertion.value).timing);
    }
  }
  expect(
    result["cultivation-rule"]!.filter(
      (row) => object(row.timing).type === "conditional-season",
    ),
  ).toHaveLength(8);
  const harvest = result["plant-fact"]!.find(
    (row) => row.id === "c4-assertions-f47136a523936105c27b312489fc0aad",
  )!;
  expect(object(object(harvest.value).sourceValue).anchor).toBe("unknown");
  expect(object(harvest.value).anchorInterpretation).toBeDefined();
});

it("retains Manitoba age, source-local timing, cut, disposal and healthy-cane action independently of Minnesota", async () => {
  const approval = object(
    JSON.parse(
      await readFile(
        join(
          dataRoot(),
          "data/curation/plant-integration/final-catalog-audit/pruning-approval.json",
        ),
        "utf8",
      ),
    ),
  );
  const { predecessorId, successorId } = records(
    approval.assertionSupersessions,
  )[0]!;
  const facts = projectCatalog(dataset, "authoring")["plant-fact"]!;
  expect(facts.some((row) => row.id === predecessorId)).toBe(false);
  const value = object(facts.find((row) => row.id === successorId)!.value);
  expect(JSON.stringify(value)).toContain("second and following years");
  expect(JSON.stringify(value)).toContain("April or early May");
  expect(JSON.stringify(value)).toContain("ground level");
  expect(JSON.stringify(value)).toContain(
    "Dispose of removed canes completely",
  );
  expect(JSON.stringify(value)).toContain("retain-growth");
  expect(value.sourceSetting).toBe("home-garden");
  const old = dataset.assertions.find((row) => row.id === predecessorId)!;
  const retired = records(approval.assertionSupersessions)[0]!;
  expect(contentDigest(old)).toBe(retired.predecessorSha256);
  expect(
    facts.filter(
      (row) =>
        row.subject &&
        object(row.subject).id === object(old.subject).id &&
        row.predicate === "care_guidance",
    ),
  ).toHaveLength(3);
});

it("rejects supersession mutation, unrelated records, duplicate successors and unaccepted decisions", () => {
  const review = dataset.reviews.find((row) => row.assertionSupersessions)!;
  const links = review.assertionSupersessions as Record<string, unknown>[];
  const altered = (change: Record<string, unknown>) => ({
    ...dataset,
    reviews: dataset.reviews.map((row) =>
      row === review ? { ...review, ...change } : row,
    ),
  });
  expect(() =>
    assertionSupersession(altered({ status: "rejected" })),
  ).toThrow();
  expect(() =>
    assertionSupersession(
      altered({
        assertionSupersessions: [
          { ...links[0], predecessorSha256: "0".repeat(64) },
        ],
      }),
    ),
  ).toThrow();
  expect(() =>
    assertionSupersession(
      altered({ assertionSupersessions: [links[0], links[0]] }),
    ),
  ).toThrow();
  expect(() =>
    assertionSupersession(
      altered({
        assertionSupersessions: [{ ...links[0], successorId: "missing" }],
      }),
    ),
  ).toThrow();
});

it("blocks names and facts through pending or noncommercial identity dependencies", () => {
  const base = {
    ...dataset,
    plantConcepts: [
      { id: "plant", status: "active", evidenceReferenceIds: ["pending"] },
    ],
    localizedNames: [
      {
        id: "name",
        subject: { type: "plant-concept", id: "plant" },
        evidenceReferenceIds: ["open"],
      },
    ],
    evidence: [
      {
        id: "open",
        sourceRecordKey: {
          source: {
            sourceId: "source",
            sourceManifestId: "manifest",
            sourceReleaseId: "release",
          },
        },
        rights: {
          decision: "eligible",
          reviewId: "rights",
          licenceId: "licence",
        },
      },
      { id: "pending", rights: { decision: "pending-review" } },
    ],
    sources: [{ id: "source" }],
    licences: [{ id: "licence", commercialUse: "allowed" }],
    reviews: [{ id: "rights", purpose: "rights", status: "accepted" }],
  };
  const eligibility = recordProjectionEligibility(base, "commercial");
  expect(eligibility.eligible(base.localizedNames[0])).toBe(false);
  const cleared = {
    ...base,
    plantConcepts: [
      { ...base.plantConcepts[0], evidenceReferenceIds: ["open"] },
    ],
  };
  expect(
    recordProjectionEligibility(cleared, "commercial").eligible(
      cleared.localizedNames[0],
    ),
  ).toBe(true);
  expect(
    recordProjectionEligibility(
      {
        ...cleared,
        licences: [{ id: "licence", commercialUse: "prohibited" }],
      },
      "commercial",
    ).eligible(cleared.localizedNames[0]),
  ).toBe(false);
});

it("builds deterministic bounded chunks, round-trips exact records and rejects corrupted bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hortinis-candidate-"));
  try {
    const families = projectCatalog(dataset, "authoring");
    const metadata = {
      "audit.json": { profile: "authoring", publishable: false },
    };
    const a = await buildCatalogCandidate(
      join(directory, "a"),
      families,
      metadata,
      { targetBytes: 12000, maximumBytes: 2 * 1024 * 1024 },
    );
    const b = await buildCatalogCandidate(
      join(directory, "b"),
      families,
      metadata,
      { targetBytes: 12000, maximumBytes: 2 * 1024 * 1024 },
    );
    expect(a).toEqual(b);
    const ingested = await ingestCatalogCandidate(join(directory, "a"));
    for (const [kind, rows] of Object.entries(families))
      expect(
        new Map(ingested.families[kind]?.map((row) => [row.id, row])),
      ).toEqual(new Map(rows.map((row) => [row.id, row])));
    await expect(
      buildCatalogCandidate(join(directory, "oversized"), families, metadata, {
        targetBytes: 32,
        maximumBytes: 64,
      }),
    ).rejects.toThrow(/Single record/);
    const path = String(a.requiredArtifacts[0]!.path);
    await writeFile(join(directory, "a", path), "corrupt");
    await expect(ingestCatalogCandidate(join(directory, "a"))).rejects.toThrow(
      /checksum|size/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 60000);

it("rejects replay of the exact pruning admission after its approved base changes", async () => {
  const { resolveReviewedPlantBatch } =
    await import("../../src/curation/resolved-reviewed-plant-batch.js");
  await expect(
    resolveReviewedPlantBatch(
      dataRoot(),
      "data/curation/plant-integration/final-catalog-audit/pruning-approval.json",
      false,
    ),
  ).rejects.toThrow(/Stale/);
}, 30000);
