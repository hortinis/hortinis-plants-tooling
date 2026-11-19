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
import type { ValidationDataset } from "../../src/curation/validation-dataset.js";
import { projectTemperatureGuidance } from "../../src/domain/temperature-guidance-projection.js";
import { validate } from "../../src/schema/validation-api.js";

const schema = "urn:hortinis:plants:schema:v1:temperature-guidance";
function artifact(name: string) {
  const bytes = readFileSync(
    catalogFile(`${integrationPath}/reviewed-plant-temperature-${name}.json`),
  );
  return {
    value: object(JSON.parse(bytes.toString("utf8"))),
    hash: digest(bytes),
  };
}

describe("frost and growing-temperature guidance", () => {
  const frozen = artifact("frozen");
  const resolution = artifact("resolution");
  const approval = artifact("approval");
  const claims = records(frozen.value.claims);
  const decisions = records(resolution.value.decisions);
  let dataset: ValidationDataset;
  let projected: ReturnType<typeof projectTemperatureGuidance>;

  beforeAll(async () => {
    ({ dataset } = await validateAuthoring(
      dataRoot(),
      catalogFile(catalogPath),
    ));
    projected = projectTemperatureGuidance(dataset, "authoring");
  });

  function observations(topic: string) {
    const claim = claims.find((row) => object(row.claim).topic === topic);
    expect(claim).toBeDefined();
    const decision = decisions.find((row) => row.key === claim!.key);
    const link = records(decision?.records).find(
      (row) => row.collection === "assertions",
    );
    const fact = projected.find((row) => row.id === link?.id);
    expect(fact).toBeDefined();
    return records(object(fact!.value).observations);
  }

  it("accounts for every frozen entry and projects exact approved values and provenance", () => {
    expect(frozen.value.counts).toEqual({
      "frost-stage-and-exposure": 22,
      "growth-stage-and-temperature-role": 18,
    });
    expect(resolution.value.frozenSha256).toBe(frozen.hash);
    expect(approval.value.batchSha256).toBe(resolution.hash);
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
    expect(projectTemperatureGuidance(dataset, "commercial")).toEqual([]);
    for (const decision of admissions) {
      const links = records(decision.records);
      const claim = claims.find((row) => row.key === decision.key)!;
      const { id, sha256 } = links.find(
        (row) => row.collection === "assertions",
      )!;
      const fact = projected.find((row) => row.id === id)!;
      const { status, ...authored } = fact;
      expect(status).toBe("active");
      expect(contentDigest(authored)).toBe(sha256);
      const [pin] = records(claim.evidence);
      expect(fact.evidenceReferenceIds).toEqual([pin!.evidenceReferenceId]);
      expect(
        dataset.evidence.find((row) => row.id === pin!.evidenceReferenceId),
      ).toMatchObject({
        locator: pin!.locator,
        sourceRecordKey: pin!.sourceRecordKey,
        normalization: { originalValue: pin!.originalValue },
        rights: { licenceId: pin!.licenceId, decision: "pending-review" },
      });
      expect(
        contentDigest(
          dataset.contexts.find((row) => row.id === fact.contextId),
        ),
      ).toBe(
        links.find((row) => row.collection === "cultivation-contexts")?.sha256,
      );
    }
  });

  it("keeps classes qualitative and scheme-specific", () => {
    const classes = projected
      .flatMap((fact) => records(object(fact.value).observations))
      .filter((row) => row.role === "source-classification");
    expect(classes.map((row) => row.sourceClass)).toEqual(
      expect.arrayContaining([
        {
          scheme: "GROW Edible Plant Database 2020 / Temperature class",
          label: "Hardy",
        },
        {
          scheme: "GROW Edible Plant Database 2020 / Temperature class",
          label: "Half hardy",
        },
        { scheme: "RHS hardiness rating (UK)", label: "H3" },
      ]),
    );
    expect(classes.every((row) => row.quantity === undefined)).toBe(true);
    expect(
      validate(schema, {
        evaluation: "observation-dependent",
        observations: [
          {
            ...classes[0],
            quantity: { amount: -5, unit: "Cel" },
            comparison: "reported",
          },
        ],
      }).valid,
    ).toBe(false);
  });

  it("pairs flower survival with exposure duration and keeps protection separate", () => {
    const fact = projected.find((row) =>
      records(object(row.value).observations).some(
        (observation) =>
          observation.part === "open flowers and unopened flower buds",
      ),
    )!;
    expect(records(object(fact.value).observations)).toMatchObject([
      {
        role: "survival",
        stage: "budding and full bloom",
        medium: "unspecified",
        timeBasis: "sustained",
        quantity: { amount: -1, unit: "Cel" },
        duration: {
          kind: "exposure",
          comparison: "less-than",
          amount: 30,
          unit: "min",
        },
      },
      {
        role: "action",
        part: "open flowers and unopened flower buds",
        allOfConditions: ["Cold expected during spring flowering"],
      },
    ]);
    expect(
      projected.find(
        (row) =>
          object(row.value).applicabilityPath instanceof Array &&
          records(object(row.value).observations).some(
            (o) => o.stage === "hardened transplant",
          ),
      )?.value,
    ).toMatchObject({ applicabilityPath: ["Spanish-type onion"] });
  });

  it("retains air, soil and unknown media with exact roles and source units", () => {
    const all = projected.flatMap((fact) =>
      records(object(fact.value).observations),
    );
    expect(all).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "production-optimum",
          medium: "air",
          timeBasis: "daytime",
          quantity: { minimum: 65, maximum: 85, unit: "[degF]" },
        }),
        expect.objectContaining({
          role: "development-effect",
          medium: "soil",
          comparison: "above",
          quantity: { amount: 30, unit: "Cel" },
        }),
        expect.objectContaining({
          role: "germination-optimum",
          medium: "unspecified",
          quantity: { amount: 29, unit: "Cel" },
        }),
      ]),
    );
    const observation = {
      role: "action",
      medium: "substrate",
      timeBasis: "daily-minimum",
      guidance: "Maintain the specified minimum in the growing medium.",
      quantity: { amount: 10, unit: "Cel" },
      comparison: "at-least",
    };
    expect(
      validate(schema, {
        evaluation: "observation-dependent",
        observations: [observation],
      }).valid,
    ).toBe(true);
    expect(
      validate(schema, {
        evaluation: "observation-dependent",
        observations: [
          {
            ...observation,
            quantity: { minimum: 10, maximum: 20, unit: "Cel" },
          },
        ],
      }).valid,
    ).toBe(false);
    expect(
      observations("Early blossom susceptible to frost").map((row) => row.role),
    ).toEqual(["flower-damage", "yield-effect", "action"]);
  });
});
