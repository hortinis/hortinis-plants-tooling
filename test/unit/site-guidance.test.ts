import { describe, expect, it } from "vitest";
import { mapGrowSiteClass } from "../../src/domain/grow-site-vocabulary.js";
import { projectSiteFacts } from "../../src/domain/site-fact-projection.js";
import { validate } from "../../src/schema/validation-api.js";
import {
  validateValidationDataset,
  type ValidationDataset,
} from "../../src/curation/validation-dataset.js";

const compound = {
  options: [
    {
      role: "preferred",
      light: "full_sun",
      moisture: "moist",
      drainage: "well_drained",
    },
    {
      role: "suitable",
      light: "partial_shade",
      moisture: "moist",
      drainage: "well_drained",
      appliesWhen: "Outdoors after establishment",
      qualification: "Flowering is reduced.",
    },
    {
      role: "suitable",
      setting: "container",
      substrate: "ericaceous_potting_mix",
    },
  ],
};

const assertion = {
  id: "assertion-test",
  subject: { type: "plant-concept", id: "plant-test" },
  predicate: "site_guidance",
  value: compound,
  contextId: "context-test",
  evidenceReferenceIds: ["evidence-test"],
  reviewId: "review-content-test",
};

const dataset: ValidationDataset = {
  taxa: [],
  taxonomicNames: [],
  plantConcepts: [],
  cultivarGroups: [],
  cultivars: [],
  localizedNames: [],
  facts: [],
  rules: [],
  contexts: [
    {
      id: "context-test",
      geographicScope: {
        type: "specified",
        geographicContextIds: ["area-test"],
      },
      growingSystem: "outdoor",
      propagation: "unknown",
      lifeStage: "growing_plant",
      productionSetting: "home-garden",
    },
  ],
  geographicContexts: [
    {
      id: "area-test",
      status: "active",
      kind: "source-location",
      name: "Test source geography",
      evidenceReferenceIds: ["evidence-test"],
    },
  ],
  assertions: [assertion],
  reviews: [
    { id: "review-content-test", purpose: "content", status: "accepted" },
    { id: "review-rights-test", purpose: "rights", status: "accepted" },
  ],
  evidence: [
    {
      id: "evidence-test",
      sourceRecordKey: {
        recordId: "plant",
        source: {
          sourceId: "source-test",
          sourceReleaseId: "release-test",
          sourceManifestId: "manifest-test",
        },
      },
      locator: "Growing conditions / Outdoor planting",
      rights: {
        licenceId: "licence-test",
        reviewId: "review-rights-test",
        decision: "pending-review",
      },
    },
  ],
  licences: [{ id: "licence-test", commercialUse: "allowed" }],
};

describe("site guidance", () => {
  it("maps only verified GROW class labels and separates texture, material and substrate", () => {
    expect(mapGrowSiteClass("Soil", "Sandy, clay and peat-rich soil")).toEqual({
      options: [
        { role: "listed", texture: "sandy" },
        { role: "listed", texture: "clay" },
        { role: "listed", material: "peat_rich" },
      ],
    });
    expect(mapGrowSiteClass("Soil", "Loamy and potting mix")).toEqual({
      options: [
        { role: "listed", texture: "loamy" },
        { role: "listed", substrate: "potting_mix" },
      ],
    });
    expect(mapGrowSiteClass("Soil", "Sand/loam/clay")?.options).toEqual([
      { role: "listed", texture: "sand" },
      { role: "listed", texture: "loam" },
      { role: "listed", texture: "clay" },
    ]);
    expect(mapGrowSiteClass("Soil", "Any well-drained and fertile")).toEqual({
      options: [
        { role: "listed", drainage: "well_drained", fertility: "fertile" },
      ],
    });
    expect(mapGrowSiteClass("Soil", "clay/moist")).toBeUndefined();
  });

  it("keeps source light alternatives unranked and unquantified", () => {
    expect(
      mapGrowSiteClass(
        "Sunlight requirements",
        "Full sun/partial shade/full shade",
      ),
    ).toEqual({
      options: [
        { role: "listed", light: "full_sun" },
        { role: "listed", light: "partial_shade" },
        { role: "listed", light: "full_shade" },
      ],
    });
  });

  it("validates and projects the compound observation intact, with exact context and source lineage", () => {
    expect(
      validate("urn:hortinis:plants:schema:authoring:v1:assertion", assertion)
        .valid,
    ).toBe(true);
    const facts = projectSiteFacts(dataset, "authoring");
    expect(facts).toEqual([{ ...assertion, status: "active" }]);
    expect(
      dataset.contexts.find((record) => record.id === facts[0]?.contextId),
    ).toMatchObject({
      geographicScope: { geographicContextIds: ["area-test"] },
      growingSystem: "outdoor",
    });
    expect(
      dataset.evidence.find(
        (record) => record.id === assertion.evidenceReferenceIds[0],
      ),
    ).toMatchObject({
      sourceRecordKey: {
        recordId: "plant",
        source: { sourceReleaseId: "release-test" },
      },
      locator: "Growing conditions / Outdoor planting",
    });
    expect(projectSiteFacts(dataset, "commercial")).toEqual([]);
  });

  it("rejects malformed guidance and preserves legacy scalar facts", () => {
    const schema = "urn:hortinis:plants:schema:v1:plant-fact";
    for (const option of [
      { role: "preferred" },
      { role: "preferred", appliesWhen: "In a container" },
      { role: "suitable", light: ["full_sun", "partial_shade"] },
      { role: "listed", light: "partial_shade", minimumSunHoursPerDay: 8 },
      { role: "listed", drainage: "moist" },
    ]) {
      expect(
        validate(schema, {
          ...assertion,
          status: "active",
          value: { options: [option] },
        }).valid,
      ).toBe(false);
    }
    expect(
      validate(schema, {
        ...assertion,
        status: "active",
        predicate: "drainage_requirement",
        value: "well_drained",
      }).valid,
    ).toBe(true);
  });

  it("checks the ordering of pH bounds inside an authored site option", () => {
    const issues = validateValidationDataset({
      ...dataset,
      assertions: [
        {
          ...assertion,
          value: {
            options: [
              { role: "preferred", phRange: { minimum: 7, maximum: 5 } },
            ],
          },
        },
      ],
    });
    expect(issues).toContainEqual(
      expect.objectContaining({
        code: "INVALID_VALUE_RANGE",
        recordId: assertion.id,
      }),
    );
  });
});
