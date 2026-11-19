import { dataRoot } from "../../src/repository-paths.js";
import { catalogFile } from "../support/catalog-file.js";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import {
  contentDigest,
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
import {
  validateValidationDataset,
  type ValidationDataset,
} from "../../src/curation/validation-dataset.js";
import { projectWateringGuidance } from "../../src/domain/watering-guidance-projection.js";
import { validate } from "../../src/schema/validation-api.js";

function readArtifact(name: string) {
  const bytes = readFileSync(
    catalogFile(`${integrationPath}/reviewed-plant-watering-${name}.json`),
  );
  return {
    value: object(JSON.parse(bytes.toString("utf8"))),
    hash: digest(bytes),
  };
}

const schema = "urn:hortinis:plants:schema:v1:watering-guidance";

describe("watering guidance admission", () => {
  let dataset: ValidationDataset;
  let projected: ReturnType<typeof projectWateringGuidance>;

  beforeAll(async () => {
    ({ dataset } = await validateAuthoring(
      dataRoot(),
      catalogFile(catalogPath),
    ));
    projected = projectWateringGuidance(dataset, "authoring");
  });

  function guidance(phrase: string) {
    const fact = projected.find((row) =>
      records(object(row.value).steps).some((step) =>
        field(step, "guidance").includes(phrase),
      ),
    );
    expect(fact).toBeDefined();
    return { fact: fact!, value: object(fact!.value) };
  }

  it("links all frozen proposals to one outcome and preserves approved values and provenance in the projection", () => {
    const frozen = readArtifact("frozen");
    const resolution = readArtifact("resolution");
    const approval = readArtifact("approval");
    expect(resolution.value.frozenSha256).toBe(frozen.hash);
    expect(approval.value.batchSha256).toBe(resolution.hash);

    const decisions = records(resolution.value.decisions);
    const frozenClaims = records(frozen.value.claims);
    expect(frozenClaims).toHaveLength(48);
    expect(decisions.map((row) => row.key)).toEqual(
      frozenClaims.map((row) => row.key),
    );
    const byId = new Map(projected.map((row) => [row.id, row]));
    const review = dataset.reviews.find((row) => row.id === approval.value.id);
    expect(object(review?.reviewedPlantAdmission).dispositions).toEqual(
      decisions,
    );
    const admissions = decisions.filter(
      (entry) => entry.outcome === "newly-admitted",
    );
    expect(approval.value.approvedClaimKeys).toEqual(
      admissions.map((entry) => entry.key),
    );
    expect(admissions).toHaveLength(48);
    expect(byId.size).toBe(admissions.length);
    for (const entry of admissions) {
      const links = records(entry.records);
      const approved = links.find((link) => link.collection === "assertions")!;
      const fact = byId.get(approved.id)!;
      const { status, ...rest } = fact;
      expect(status).toBe("active");
      expect(contentDigest(rest)).toBe(approved.sha256);
      expect(fact.evidenceReferenceIds).toEqual(
        links
          .filter((link) => link.collection === "evidence-references")
          .map((link) => link.id),
      );
      for (const link of links.filter(
        (link) => link.collection === "evidence-references",
      )) {
        const evidence = dataset.evidence.find((row) => row.id === link.id)!;
        expect(contentDigest(evidence)).toBe(link.sha256);
        const proposal = frozenClaims.find((row) => row.key === entry.key)!;
        const pinned = records(proposal.evidence).find(
          (row) => row.evidenceReferenceId === evidence.id,
        )!;
        expect(evidence).toMatchObject({
          sourceRecordKey: pinned.sourceRecordKey,
          locator: pinned.locator,
          normalization: { originalValue: pinned.originalValue },
          rights: { decision: "pending-review", licenceId: pinned.licenceId },
        });
      }
    }
    expect(projectWateringGuidance(dataset, "commercial")).toEqual([]);
  });

  it("separates depth at establishment from a weekly rainfall-inclusive benchmark", () => {
    const application = records(
      guidance("Apply the reported water depth").value.steps,
    );
    expect(application).toMatchObject([
      {
        role: "irrigation",
        stage: "Establishment",
        waterAccounting: "irrigation-only",
        sourceAmounts: [
          { dimension: "depth-over-area", unit: "[in_i]", value: 1 },
          { dimension: "depth-over-area", unit: "cm", value: 2.5 },
        ],
        amountTiming: {
          kind: "per-application",
          event: "After sowing or transplanting",
        },
      },
      { role: "moisture-target", stage: "Flowering and fruit development" },
      { role: "irrigation", allOfConditions: ["During pollination"] },
    ]);
    expect(application[1]).not.toHaveProperty("sourceAmounts");

    const { value } = guidance(
      "from rainfall or irrigation through bulb formation",
    );
    expect(records(value.steps)[0]).toMatchObject({
      role: "water-supply",
      stage: "Through bulb formation",
      waterAccounting: "includes-rainfall",
      amountTiming: { kind: "period-total", period: { unit: "wk", value: 1 } },
    });
    expect(records(value.steps)[0]).not.toHaveProperty("interval");
    expect(
      records(guidance("heavier-soil regime").value.steps)[0],
    ).toMatchObject({
      waterAccounting: "unspecified",
      amountTiming: {
        kind: "per-reported-interval",
        period: { unit: "d", minimum: 10, maximum: 14 },
      },
      allOfConditions: ["Heavier-textured soil"],
    });
  });

  it("preserves interval-only alternatives, observation triggers and qualified container scope", () => {
    const { value } = guidance("Water every 10–14 days");
    expect(records(value.steps)[0]).toMatchObject({
      anyOfConditions: ["Dry spell", "Very free-draining soil"],
      interval: { kind: "every", unit: "d", minimum: 10, maximum: 14 },
    });
    expect(records(value.steps)[0]).not.toHaveProperty("sourceAmounts");

    const container = guidance("Water regularly throughout growth");
    expect(container.value.applicabilityPath).toEqual([
      "Container-grown round beetroot",
      "Round-root beetroot",
    ]);
    const observation = records(container.value.steps)[0];
    expect(observation).toMatchObject({
      observationTrigger: "Check the limited compost for drying",
    });
    expect(observation).not.toHaveProperty("interval");
    expect(observation).not.toHaveProperty("sourceAmounts");
    const context = dataset.contexts.find(
      (row) => row.id === container.fact.contextId,
    );
    expect(context?.soilOrContainer).toBe("container");
    const [geographyId] = object(context?.geographicScope)
      .geographicContextIds as string[];
    expect(
      dataset.geographicContexts?.find((row) => row.id === geographyId)?.name,
    ).toBe("United Kingdom");
  });

  it("rejects dimension mismatches, absent period or accounting, and reversed ranges", () => {
    const { fact, value } = guidance("Apply the reported water depth");
    const [step] = records(value.steps);
    const [originalAmount] = records(step!.sourceAmounts);
    const validWithAmount = (amount: Record<string, unknown>) =>
      validate(schema, { steps: [{ ...step, sourceAmounts: [amount] }] }).valid;
    expect(validWithAmount({ ...originalAmount, unit: "L" })).toBe(false);
    expect(
      validWithAmount({ ...originalAmount, dimension: "volume-per-plant" }),
    ).toBe(false);
    expect(
      validWithAmount({
        ...originalAmount,
        dimension: "volume-per-container",
        unit: "L",
      }),
    ).toBe(true);
    const { amountTiming, waterAccounting, ...withoutTimingAndAccounting } =
      step!;
    expect(
      validate(schema, {
        steps: [{ ...withoutTimingAndAccounting, amountTiming }],
      }).valid,
    ).toBe(false);
    expect(
      validate(schema, {
        steps: [{ ...withoutTimingAndAccounting, waterAccounting }],
      }).valid,
    ).toBe(false);
    expect(
      validate(schema, {
        steps: [{ ...step, waterAccounting: "includes-rainfall" }],
      }).valid,
    ).toBe(false);
    expect(
      validate(schema, {
        steps: [
          {
            role: "irrigation",
            guidance: "Water three times weekly",
            interval: { kind: "times-per-period", unit: "wk", value: 3 },
          },
        ],
      }).valid,
    ).toBe(true);

    const { status, ...assertion } = fact;
    expect(status).toBe("active");
    const changed = {
      ...assertion,
      value: {
        steps: [
          {
            ...step,
            sourceAmounts: [
              {
                dimension: "depth-over-area",
                unit: "mm",
                qualifier: "stated",
                minimum: 40,
                maximum: 20,
              },
            ],
          },
        ],
      },
    };
    expect(
      validateValidationDataset({ ...dataset, assertions: [changed] }),
    ).toContainEqual(
      expect.objectContaining({
        code: "INVALID_VALUE_RANGE",
        recordId: fact.id,
      }),
    );
  });
});
