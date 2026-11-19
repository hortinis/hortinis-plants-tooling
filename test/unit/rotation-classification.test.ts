import { describe, expect, it } from "vitest";
import {
  validateValidationDataset,
  type ValidationDataset,
} from "../../src/curation/validation-dataset.js";
import { projectRotationClassifications } from "../../src/domain/rotation-classification-projection.js";
import { validate } from "../../src/schema/validation-api.js";

const scheme = {
  sourceId: "grow-epd",
  field: "Cultivation group (Rotational information)",
};
const assertion = {
  id: "rotation-1",
  subject: { type: "plant-concept", id: "onion" },
  predicate: "rotation_classification",
  value: { scheme, status: "classified", sourceLabel: "Allium" },
  contextId: "autumn-planting",
  evidenceReferenceIds: ["grow-onion-58"],
  reviewId: "agent-content-review",
};
const dataset: ValidationDataset = {
  taxa: [{ id: "onion-taxon", family: "Amaryllidaceae" }],
  plantConcepts: [
    { id: "onion", taxonId: "onion-taxon", status: "active" },
    {
      id: "red-onion",
      kind: "growing-type",
      parentPlantConceptId: "onion",
      taxonId: "onion-taxon",
      status: "active",
    },
  ],
  cultivars: [{ id: "example-cultivar", plantConceptId: "onion" }],
  contexts: [
    {
      id: "autumn-planting",
      geographicScope: { type: "unknown" },
      growingSystem: "unknown",
      propagation: "unknown",
      plantingSeason: "autumn",
    },
  ],
  rules: [],
  assertions: [assertion],
  sources: [{ id: scheme.sourceId }],
  licences: [{ id: "cc-by", commercialUse: "allowed" }],
  reviews: [
    { id: assertion.reviewId, purpose: "content", status: "accepted" },
    { id: "rights-review", purpose: "rights", status: "accepted" },
  ],
  evidence: [
    {
      id: "grow-onion-58",
      sourceRecordKey: {
        recordId: "58",
        source: {
          sourceId: scheme.sourceId,
          sourceReleaseId: "doi:10.15132/10000157",
          sourceManifestId: "grow-2020",
        },
      },
      locator:
        "plant1.accdb#table=Edible%20plants&record.ID=58&field=Cultivation%20group%20%28Rotational%20information%29",
      normalization: { originalValue: "Allium" },
      rights: {
        licenceId: "cc-by",
        reviewId: "rights-review",
        decision: "pending-review",
      },
    },
  ],
};

describe("rotation classification", () => {
  it("projects exact source labels, subjects and conditions without inferring facts for descendants", () => {
    const projected = projectRotationClassifications(dataset, "authoring");
    expect(projected).toEqual([{ ...assertion, status: "active" }]);
    expect(dataset.taxa[0]?.family).toBe("Amaryllidaceae");
    expect(projected[0]?.value).toMatchObject({ sourceLabel: "Allium" });
    expect(
      dataset.contexts.find((row) => row.id === projected[0]?.contextId),
    ).toMatchObject({ plantingSeason: "autumn" });
    expect(
      dataset.evidence.filter((row) =>
        assertion.evidenceReferenceIds.includes(String(row.id)),
      ),
    ).toMatchObject([
      {
        sourceRecordKey: {
          recordId: "58",
          source: { sourceReleaseId: "doi:10.15132/10000157" },
        },
        locator: dataset.evidence[0]?.locator,
        rights: { decision: "pending-review" },
      },
    ]);
    expect(projectRotationClassifications(dataset, "commercial")).toEqual([]);
    expect(validateValidationDataset(dataset)).toEqual([]);
  });

  it("requires source-qualified evidence and keeps matching category strings from different schemes", () => {
    const alternateScheme = { ...scheme, sourceId: "other-source" };
    const alternate = {
      ...assertion,
      id: "rotation-2",
      value: { ...assertion.value, scheme: alternateScheme },
    };
    const mixed = { ...dataset, assertions: [assertion, alternate] };
    expect(validateValidationDataset(mixed)).toMatchObject([
      { code: "INVALID_SOURCE_DECISION", recordId: alternate.id },
    ]);
    const withBothSources = {
      ...mixed,
      assertions: [
        assertion,
        { ...alternate, evidenceReferenceIds: ["other-onion"] },
      ],
      sources: [...dataset.sources!, { id: alternateScheme.sourceId }],
      evidence: [
        ...dataset.evidence,
        {
          ...dataset.evidence[0],
          id: "other-onion",
          sourceRecordKey: {
            recordId: "other-1",
            source: {
              sourceId: alternateScheme.sourceId,
              sourceReleaseId: "other-release",
              sourceManifestId: "other-manifest",
            },
          },
        },
      ],
    };
    expect(validateValidationDataset(withBothSources)).toEqual([]);
    expect(
      projectRotationClassifications(withBothSources, "authoring").map(
        (row) => row.value,
      ),
    ).toEqual([assertion.value, alternate.value]);
  });

  it("preserves explicit unknown, not-applicable and catch-all tokens while leaving missing classifications absent", () => {
    const entries = [
      { status: "unknown", sourceLabel: "undetermined" },
      { status: "not-applicable", sourceLabel: "excluded by source" },
      { status: "classified", sourceLabel: "Miscellaneous" },
    ].map((entry, index) => ({
      ...assertion,
      id: "rotation-explicit-" + index,
      value: { scheme, ...entry },
    }));
    expect(
      projectRotationClassifications(
        { ...dataset, assertions: entries },
        "authoring",
      ),
    ).toEqual(entries.map((row) => ({ ...row, status: "active" })));
    expect(
      projectRotationClassifications(
        { ...dataset, assertions: [] },
        "authoring",
      ),
    ).toEqual([]);
    const schema = "urn:hortinis:plants:schema:authoring:v1:assertion";
    for (const entry of entries)
      expect(validate(schema, entry).valid).toBe(true);
    for (const value of [
      "Allium",
      { ...assertion.value, sourceLabel: "" },
      { ...assertion.value, scheme: undefined },
      { ...assertion.value, returnIntervalYears: 3 },
    ])
      expect(validate(schema, { ...assertion, value }).valid).toBe(false);
  });
});
