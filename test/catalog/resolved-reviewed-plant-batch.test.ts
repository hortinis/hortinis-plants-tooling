import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  digest,
  field,
  object,
  records,
} from "../../src/curation/curation-artifacts.js";
import {
  catalogPath,
  integrationPath,
  validateAuthoring,
} from "../../src/curation/reviewed-licensing-acceptance.js";
import { auditCurationDecisionLineage } from "../../src/curation/curation-validation.js";
import { validateValidationDataset } from "../../src/curation/validation-dataset.js";
import { dataRoot } from "../../src/repository-paths.js";
import { validate } from "../../src/schema/validation-api.js";

const root = dataRoot();

it("binds every frozen proposal and preserves approved observation conditions in consumer contexts", async () => {
  const read = (name: string) => {
    const bytes = readFileSync(
      join(root, integrationPath, `reviewed-plant-step-2-${name}.json`),
    );
    return {
      value: object(JSON.parse(bytes.toString("utf8"))),
      hash: digest(bytes),
    };
  };
  const frozen = read("frozen");
  const resolution = read("resolution");
  const approval = read("approval");
  expect(resolution.value.frozenSha256).toBe(frozen.hash);
  expect(approval.value.batchSha256).toBe(resolution.hash);
  const decisions = records(resolution.value.decisions);
  expect(decisions.map((row) => row.key)).toEqual(
    records(frozen.value.claims).map((row) => row.key),
  );

  const { dataset } = await validateAuthoring(root, join(root, catalogPath));
  const review = dataset.reviews.find((row) => row.id === approval.value.id)!;
  const receipt = object(review.reviewedPlantAdmission);
  expect(receipt.dispositions).toEqual(decisions);
  const mappings = records(receipt.mappings);
  expect(mappings.map((row) => row.id)).toEqual(
    approval.value.approvedMappingIds,
  );

  const admissions = records(receipt.claims);
  const scoped = admissions.find(
    (row) =>
      row.assertionId &&
      object(row.decision).resolvedMappingId &&
      object(object(row.claim).implementation).predicate ===
        "germination_profile",
  )!;
  const assertion = dataset.assertions.find(
    (row) => row.id === scoped.assertionId,
  )!;
  const mapping = mappings.find(
    (row) => row.id === object(scoped.decision).resolvedMappingId,
  )!;
  expect(assertion.subject).toEqual(mapping.subject);
  expect(assertion.subject).not.toEqual(records(scoped.targets)[0]!.subject);

  const context = dataset.contexts.find(
    (row) => row.id === assertion.contextId,
  )!;
  expect(context).toMatchObject({
    lifeStage: "seed",
    growingSystem: "unknown",
    observation: {
      eventAnchor: "sowing",
      qualifications: expect.any(Array) as unknown,
    },
  });
  expect(
    validate("urn:hortinis:plants:schema:v1:cultivation-context", context)
      .valid,
  ).toBe(true);
  expect(
    dataset.evidence.find(
      (row) => row.id === (assertion.evidenceReferenceIds as string[])[0],
    )?.rights,
  ).toMatchObject({ decision: "pending-review" });

  const contexts = dataset.contexts.map((row) =>
    row.id === context.id
      ? {
          ...row,
          observation: { ...object(row.observation), qualifications: [] },
        }
      : row,
  );
  expect(validateValidationDataset({ ...dataset, contexts })).toContainEqual(
    expect.objectContaining({
      code: "INVALID_SOURCE_DECISION",
      recordId: field(review, "id"),
    }),
  );
}, 30_000);

it("checks the pinned GROW scientific field for a scoped crop usage and its mapping", async () => {
  const { dataset } = await validateAuthoring(root, join(root, catalogPath));
  const name = dataset.sourceNameDecisions!.find(
    (row) =>
      row.decision === "scoped-crop-usage" &&
      object(row.sourceRecordKey).recordId === "3",
  )!;
  const mapping = dataset.sourceSubjectMappings!.find(
    (row) => row.sourceLocator === name.sourceLocator,
  )!;
  const record = {
    sourceLocator: "plant1.accdb#table=Edible%20plants&record.ID=3",
    fields: { "Full taxonomic name": "Phaseolus vulgari" },
  };
  const packet = {
    sourceRecordKey: name.sourceRecordKey,
    sourceRecord: record,
    cultivationCandidates: [],
    taxonomyOutcomes: [],
  };
  const draft = {
    manifest: {},
    manifestSha256: "",
    scope: {},
    queue: [],
    comparisons: [],
    packets: [packet],
  };
  const focused = {
    ...dataset,
    sourceNameDecisions: [name],
    sourceSubjectMappings: [mapping],
    sourceAssertionDecisions: [],
    assertionComparisonDecisions: [],
  };
  expect(() => auditCurationDecisionLineage(focused, draft)).not.toThrow();
  const altered = {
    ...draft,
    packets: [
      {
        ...packet,
        sourceRecord: {
          ...record,
          fields: { "Full taxonomic name": "Phaseolus vulgaris" },
        },
      },
    ],
  };
  expect(() => auditCurationDecisionLineage(focused, altered)).toThrow(
    "Decision source locator differs",
  );
}, 30_000);
