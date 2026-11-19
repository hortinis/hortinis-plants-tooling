import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, expect, it } from "vitest";
import {
  findAdmissionOmissions,
  prepareReviewedCatalog,
  releaseReferences,
  selectReviewedCatalog,
} from "../../src/artifact/reviewed-catalog.js";
import { object, records } from "../../src/curation/curation-artifacts.js";
import type { ValidationDataset } from "../../src/curation/validation-dataset.js";
import { dataRoot } from "../../src/repository-paths.js";
let prepared: Awaited<ReturnType<typeof prepareReviewedCatalog>>;
beforeAll(async () => {
  prepared = await prepareReviewedCatalog(dataRoot());
});

it("covers the full deduplicated cohort and every latest packet scope", () => {
  expect(prepared.inventory.counts).toMatchObject({
    packets: 154,
    scopes: 542,
    plants: 96,
    growingTypes: 28,
    cultivars: 39,
    includedSubjects: 163,
    approvedOmissions: 0,
  });
  expect(new Set(prepared.inventory.subjects.map((row) => row.id)).size).toBe(
    163,
  );
  for (const packet of prepared.inventory.packets) {
    const scopes = prepared.inventory.scopes.filter(
      (row) => row.packetId === packet.id,
    );
    expect(scopes.map((row) => row.id)).toEqual(packet.scopeMappingIds);
    expect(scopes.every((row) => row.disposition && row.reason)).toBe(true);
  }
});

it("detects approved supported records missing or changed in live collections", () => {
  const id = prepared.dataset.assertions[0]!.id;
  const missing = {
    ...prepared.dataset,
    assertions: prepared.dataset.assertions.filter((row) => row.id !== id),
  };
  expect(findAdmissionOmissions(missing).some((row) => row.id === id)).toBe(
    true,
  );
  const changed = {
    ...prepared.dataset,
    assertions: prepared.dataset.assertions.map((row) =>
      row.id === id ? { ...row, value: "changed" } : row,
    ),
  };
  expect(findAdmissionOmissions(changed).some((row) => row.id === id)).toBe(
    true,
  );
});

it("keeps all original exceptions and exact claim exclusions separate from plant inclusion", () => {
  expect(prepared.inventory.counts.originalExceptionDenominator).toBe(58);
  expect(prepared.inventory.deferredOriginals).toHaveLength(19);
  expect(
    prepared.inventory.claims.filter((row) => row.outcome === "excluded"),
  ).toHaveLength(20);
  expect(
    prepared.inventory.subjects.every((row) => row.disposition === "included"),
  ).toBe(true);
  expect(
    prepared.inventory.scopes.filter((row) => row.disposition === "excluded"),
  ).toHaveLength(266);
});

it("removes the superseded assertion and retains its immutable history", async () => {
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
  const link = records(approval.assertionSupersessions)[0]!;
  const facts = prepared.authoring["plant-fact"]!;
  expect(facts.some((row) => row.id === link.predecessorId)).toBe(false);
  expect(facts.some((row) => row.id === link.successorId)).toBe(true);
  expect(
    prepared.dataset.assertions.some((row) => row.id === link.predecessorId),
  ).toBe(true);
});

it("preserves exact subject, context, conditions, value, evidence and review without inheritance", () => {
  const projected = new Map(
    [
      ...prepared.authoring["plant-fact"]!,
      ...prepared.authoring["cultivation-rule"]!,
    ].map((row) => [row.id, row]),
  );
  for (const original of prepared.dataset.assertions) {
    const row = projected.get(original.id);
    if (!row) continue;
    for (const key of [
      "subject",
      "contextId",
      "evidenceReferenceIds",
      "reviewId",
    ])
      expect(row[key]).toEqual(original[key]);
    if (original.predicate !== "cultivation_window")
      expect(row.value).toEqual(original.value);
    expect(
      prepared.authoring["cultivation-context"]!.find(
        (context) => context.id === row.contextId,
      ),
    ).toEqual(
      prepared.dataset.contexts.find(
        (context) => context.id === original.contextId,
      ),
    );
  }
  const cultivar = prepared.dataset.cultivars[0]!;
  const selected = selectReviewedCatalog(
    prepared.dataset,
    [String(cultivar.id)],
    "authoring",
  );
  expect(
    [...selected["plant-fact"]!, ...selected["cultivation-rule"]!].every(
      (row) => object(row.subject).id === cultivar.id,
    ),
  ).toBe(true);
});

it("preserves dependency closure and enforces existing rights filters independently of selection", () => {
  for (const families of [prepared.authoring, prepared.commercial]) {
    const ids = new Set(
      Object.values(families).flatMap((rows) => rows.map((row) => row.id)),
    );
    for (const rows of Object.values(families))
      for (const row of rows)
        expect(releaseReferences(row).every((id) => ids.has(id))).toBe(true);
  }
  expect(prepared.commercial["plant-fact"]).toHaveLength(0);
  expect(
    prepared.inventory.subjects.filter(
      (row) => row.commercialDisposition === "blocked",
    ),
  ).toHaveLength(162);
  for (const subject of prepared.inventory.subjects.filter(
    (row) => row.commercialDisposition === "blocked",
  ))
    expect(subject.commercialBlockers.length).toBeGreaterThan(0);
  const dataset: ValidationDataset = {
    ...prepared.dataset,
    plantConcepts: prepared.dataset.plantConcepts.filter(
      (row) => row.id !== prepared.dataset.cultivars[0]!.plantConceptId,
    ),
  };
  expect(() =>
    selectReviewedCatalog(
      dataset,
      [String(dataset.cultivars[0]!.id)],
      "authoring",
    ),
  ).toThrow("Missing eligible release dependency");
});
