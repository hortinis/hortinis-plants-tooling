import { dataRoot } from "../../src/repository-paths.js";
import { catalogFile } from "../support/catalog-file.js";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import {
  contentDigest,
  digest,
  object,
  records,
} from "../../src/curation/curation-artifacts.js";
import {
  catalogPath,
  integrationPath,
  validateAuthoring,
} from "../../src/curation/reviewed-licensing-acceptance.js";
import {
  validateValidationDataset,
  type ValidationDataset,
} from "../../src/curation/validation-dataset.js";
import { projectCultivationRules } from "../../src/domain/cultivation-rule-projection.js";
import { projectEstablishmentGuidance } from "../../src/domain/establishment-guidance-projection.js";
import { validate } from "../../src/schema/validation-api.js";

const schema = "urn:hortinis:plants:schema:v1:establishment-guidance";
function artifact(name: string) {
  const bytes = readFileSync(
    catalogFile(`${integrationPath}/reviewed-plant-establishment-${name}.json`),
  );
  return {
    value: object(JSON.parse(bytes.toString("utf8"))),
    hash: digest(bytes),
  };
}

describe("planting and establishment admission", () => {
  const frozen = artifact("frozen");
  const resolution = artifact("resolution");
  const approval = artifact("approval");
  const claims = records(frozen.value.claims);
  const decisions = records(resolution.value.decisions);
  let dataset: ValidationDataset;
  let projected: ReturnType<typeof projectEstablishmentGuidance>;

  beforeAll(async () => {
    ({ dataset } = await validateAuthoring(
      dataRoot(),
      catalogFile(catalogPath),
    ));
    projected = projectEstablishmentGuidance(dataset, "authoring");
  });

  function fact(topic: string) {
    const claim = claims.find((row) => object(row.claim).topic === topic);
    expect(claim).toBeDefined();
    const decision = decisions.find((row) => row.key === claim?.key);
    const link = records(decision?.records).find(
      (row) => row.collection === "assertions",
    );
    const record = projected.find((row) => row.id === link?.id);
    expect(record).toBeDefined();
    return record!;
  }

  function series(value: unknown) {
    return records(object(value).series).map((row) => records(row.steps));
  }

  it("accounts for exact frozen keys and projects every accepted fact with its evidence and context", () => {
    expect(resolution.value.frozenSha256).toBe(frozen.hash);
    expect(approval.value.batchSha256).toBe(resolution.hash);
    expect(claims).toHaveLength(100);
    expect(decisions.map((row) => row.key)).toEqual(
      claims.map((row) => row.key),
    );
    const admissions = decisions.filter(
      (row) => row.outcome === "newly-admitted",
    );
    expect(approval.value.approvedClaimKeys).toEqual(
      admissions.map((row) => row.key),
    );
    expect(
      projected.filter((row) => row.reviewId === approval.value.id),
    ).toHaveLength(admissions.length);
    expect(projectEstablishmentGuidance(dataset, "commercial")).toEqual([]);
    const review = dataset.reviews.find((row) => row.id === approval.value.id);
    expect(object(review?.reviewedPlantAdmission).dispositions).toEqual(
      decisions,
    );
    for (const decision of admissions) {
      const links = records(decision.records);
      const claim = claims.find((row) => row.key === decision.key)!;
      const link = links.find((row) => row.collection === "assertions")!;
      const consumer = projected.find((row) => row.id === link.id)!;
      const { status, ...authored } = consumer;
      expect(status).toBe("active");
      expect(contentDigest(authored)).toBe(link.sha256);
      const [pin] = records(claim.evidence);
      const evidence = dataset.evidence.find(
        (row) => row.id === pin!.evidenceReferenceId,
      );
      expect(evidence).toMatchObject({
        locator: pin!.locator,
        sourceRecordKey: pin!.sourceRecordKey,
        normalization: { originalValue: pin!.originalValue },
        rights: { decision: "pending-review", licenceId: pin!.licenceId },
      });
      expect(consumer.evidenceReferenceIds).toEqual([evidence?.id]);
      const context = dataset.contexts.find(
        (row) => row.id === consumer.contextId,
      );
      expect(contentDigest(context)).toBe(
        links.find((row) => row.collection === "cultivation-contexts")?.sha256,
      );
    }
  });

  it("keeps propagation alternatives and preparation sequences distinct", () => {
    expect(series(fact("Seed or sets").value)).toMatchObject([
      [{ action: "sow", material: "seed" }],
      [{ action: "plant-set", material: "set" }],
    ]);
    expect(series(fact("Module transplant/hardening").value)[0]).toMatchObject([
      {
        action: "harden",
        material: "rooted-plug",
        timing: { kind: "before", anchor: "Outdoor transplanting" },
      },
      {
        action: "transplant",
        material: "rooted-plug",
        setting: "outdoor",
        allOfConditions: ["Plants are well rooted"],
      },
      { action: "water-in", material: "rooted-plug" },
    ]);
    expect(
      series(fact("Pre-sprouting for early potatoes").value)[0],
    ).toMatchObject([
      {
        action: "pre-sprout",
        material: "tuber",
        setting: "indoor",
        timing: {
          kind: "before",
          anchor: "Planting",
          interval: { amount: 20, unit: "d", approximate: true },
        },
      },
    ]);
  });

  it("preserves spacing axes, thinning and the depth reference", () => {
    const [sow, thin] = series(fact("Garden sowing/thinning").value)[0]!;
    expect(sow).toMatchObject({
      action: "direct-sow",
      dimensions: [
        { role: "sowing-depth", reference: "Drill depth" },
        { role: "between-row", quantity: { amount: 30, unit: "cm" } },
      ],
    });
    expect(thin).toMatchObject({
      action: "thin",
      dimensions: [
        { role: "thinning-distance", quantity: { amount: 15, unit: "cm" } },
      ],
    });
    expect(series(fact("Clove cover depth").value)[0]?.[0]).toMatchObject({
      action: "plant-clove",
      dimensions: [
        { role: "planting-depth", reference: "Soil surface to top of clove" },
        { role: "planting-depth", quantity: { unit: "in" } },
      ],
    });
    expect(
      series(fact("Planting / In the ground").value)[0]?.[0],
    ).toMatchObject({
      action: "plant-bulb",
      dimensions: [
        {
          role: "planting-depth",
          quantity: { minimum: 2, maximum: 3, unit: "bulb-height" },
        },
      ],
    });
  });

  it("pairs duration with temperature and retains action-specific conditions", () => {
    const pair = projected.find((row) =>
      series(row.value).some((steps) =>
        steps.some((step) => step.germinationDuration !== undefined),
      ),
    )!;
    const [observation] = series(pair.value)[0]!;
    expect(observation).toMatchObject({
      action: "germinate",
      temperature: {
        medium: "soil",
        role: "reported-germination",
        quantity: { amount: 20, unit: "Cel" },
      },
      germinationDuration: { minimum: 6, maximum: 10, unit: "d" },
      timing: { kind: "after", anchor: "Sowing" },
    });
    const { temperature, ...unpaired } = observation!;
    expect(
      validate(schema, {
        ...object(pair.value),
        series: [{ steps: [unpaired] }],
      }).valid,
    ).toBe(false);
    expect(
      validate(schema, {
        ...object(pair.value),
        series: [
          {
            steps: [
              {
                ...observation,
                temperature: {
                  ...object(temperature),
                  quantity: { amount: 20, unit: "cm" },
                },
              },
            ],
          },
        ],
      }).valid,
    ).toBe(false);

    const slip = projected.find(
      (row) =>
        series(row.value)[0]?.[0]?.temperature &&
        object(series(row.value)[0]?.[0]?.temperature).measurementDepth !==
          undefined,
    )!;
    expect(series(slip.value)[0]?.[0]).toMatchObject({
      action: "plant-slip",
      timing: { kind: "after", anchor: "End of frost risk" },
      temperature: {
        medium: "soil",
        role: "minimum",
        quantity: { amount: 65, unit: "[degF]" },
        measurementDepth: { amount: 4, unit: "in" },
      },
    });
    expect(object(slip.value).evaluation).toBe("observation-dependent");
    expect(
      series(
        fact("Transplant after last spring frost and once soil warms").value,
      )[0]?.[0],
    ).toMatchObject({
      allOfConditions: ["Soil has warmed"],
    });
  });

  it("keeps source geography and growing-type qualifiers out of automatic local rules", () => {
    const winterRadish = fact("Winter sowing");
    expect(object(winterRadish.value).applicabilityPath).toEqual([
      "Winter root radish",
    ]);
    expect(series(winterRadish.value)[0]?.[0]).toMatchObject({
      action: "direct-sow",
      timing: { kind: "calendar-months", months: [7, 8] },
    });
    const context = dataset.contexts.find(
      (row) => row.id === winterRadish.contextId,
    );
    const [geography] = object(context?.geographicScope)
      .geographicContextIds as string[];
    expect(
      dataset.geographicContexts?.find((row) => row.id === geography)?.name,
    ).toBe("United Kingdom");
    const establishmentIds = new Set(projected.map((row) => row.id));
    expect(
      projectCultivationRules(dataset, "authoring").some((rule) =>
        establishmentIds.has(rule.id),
      ),
    ).toBe(false);
  });

  it("rejects reversed numeric ranges in authoring validation", () => {
    const record = fact("Garden sowing/thinning");
    const context = dataset.assertions.find((row) => row.id === record.id)!;
    const [sow, thin] = series(context.value)[0]!;
    const [depth, rowSpacing] = records(sow?.dimensions);
    const mutated = {
      ...context,
      value: {
        ...object(context.value),
        series: [
          {
            steps: [
              {
                ...sow,
                dimensions: [
                  {
                    ...depth,
                    quantity: { minimum: 5, maximum: 1, unit: "cm" },
                  },
                  rowSpacing,
                ],
              },
              thin,
            ],
          },
        ],
      },
    };
    const issues = validateValidationDataset({
      ...dataset,
      assertions: dataset.assertions.map((row) =>
        row.id === record.id ? mutated : row,
      ),
    });
    expect(JSON.stringify(issues)).toContain(
      "An establishment guidance quantity has reversed bounds.",
    );
  });
});
