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
import { type ValidationDataset } from "../../src/curation/validation-dataset.js";
import { projectNutritionGuidance } from "../../src/domain/nutrition-guidance-projection.js";
import { validate } from "../../src/schema/validation-api.js";

function readArtifact(name: string) {
  const bytes = readFileSync(
    catalogFile(`${integrationPath}/reviewed-plant-nutrition-${name}.json`),
  );
  return {
    value: object(JSON.parse(bytes.toString("utf8"))),
    hash: digest(bytes),
  };
}

const schema = "urn:hortinis:plants:schema:v1:nutrition-guidance";

describe("plant nutrition admission", () => {
  let dataset: ValidationDataset;
  let projected: ReturnType<typeof projectNutritionGuidance>;

  beforeAll(async () => {
    ({ dataset } = await validateAuthoring(
      dataRoot(),
      catalogFile(catalogPath),
    ));
    projected = projectNutritionGuidance(dataset, "authoring");
  });

  function valueFor(topic: string, unresolvedTarget = false) {
    const claim = records(readArtifact("frozen").value.claims).find(
      (row) =>
        object(row.claim).topic === topic &&
        (!unresolvedTarget ||
          records(row.targets).some(
            (target) => target.outcome === "unresolved",
          )),
    );
    expect(claim).toBeDefined();
    const decision = records(readArtifact("resolution").value.decisions).find(
      (row) => row.key === claim!.key,
    )!;
    const link = records(decision.records).find(
      (row) => row.collection === "assertions",
    )!;
    return object(projected.find((row) => row.id === link.id)!.value);
  }

  it("links all frozen proposals to one outcome and preserves approved values and provenance in the projection", () => {
    const frozen = readArtifact("frozen");
    const resolution = readArtifact("resolution");
    const approval = readArtifact("approval");
    expect(resolution.value.frozenSha256).toBe(frozen.hash);
    expect(approval.value.batchSha256).toBe(resolution.hash);

    const decisions = records(resolution.value.decisions);
    const frozenClaims = records(frozen.value.claims);
    expect(frozenClaims).toHaveLength(22);
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
    expect(admissions).toHaveLength(22);
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
    expect(projectNutritionGuidance(dataset, "commercial")).toEqual([]);
  });

  function actionFor(topic: string, index = 0) {
    return records(valueFor(topic).actions)[index]!;
  }

  function validAction(action: unknown, evaluation = "source-guidance-only") {
    return validate(schema, {
      evaluation,
      relationship: "independent",
      actions: [action],
    }).valid;
  }

  it("keeps the garlic program total in elemental nitrogen and preserves its split sequence", () => {
    const nitrogen = actionFor("Mineral-soil nitrogen field schedule");
    expect(
      valueFor("Mineral-soil nitrogen field schedule").applicabilityPath,
    ).toEqual(["Autumn-planted garlic"]);
    expect(nitrogen).toMatchObject({
      soil: "mineral",
      total: {
        basis: "nutrient-mass",
        nutrient: "N",
        original: [{ value: 98, unit: "lb" }],
        per: "acre",
        period: "program-total",
      },
      prerequisites: ["product-nutrient-concentration"],
      preferredSources: ["calcium-nitrate", "ammonium-nitrate"],
      first: {
        fractionOfTotal: 0.5,
        timing: { kind: "season", cue: "At the start of spring growth" },
      },
      remainder: {
        method: "side-dress",
        applicationOptions: [2, 3],
        repeatInterval: { value: 3, unit: "wk" },
      },
    });
    const total = object(nitrogen.total);
    for (const invalid of [
      { ...total, basis: "product-mass" },
      { ...total, per: "seed-piece" },
      { ...total, per: "L" },
      { ...total, period: "per-application" },
      { ...total, nutrient: undefined },
    ]) {
      expect(validAction({ ...nitrogen, total: invalid })).toBe(false);
    }
    expect(validAction({ ...nitrogen, prerequisites: ["product-label"] })).toBe(
      false,
    );
    expect(validAction(nitrogen, "site-recommendation")).toBe(false);
  });

  it("keeps potato product mass, grade conditions and planting placement together", () => {
    const potato = actionFor("Source fertilizer placement benchmark");
    expect(potato).toMatchObject({
      prerequisites: ["soil-texture", "product-label"],
      formulationExamples: [
        { soilTexture: "heavier", sourceGrade: "16-20-0" },
        { soilTexture: "lighter", sourceGrade: "10-30-10" },
      ],
      amount: {
        basis: "product-mass",
        original: [
          { value: 7, unit: "g" },
          { value: 0.25, unit: "oz" },
        ],
        per: "seed-piece",
        approximate: true,
        period: "per-application",
      },
      placement: {
        locations: ["planting-row", "planting-hole"],
        soilBetweenProductAndSeedPiece: [
          { value: 2.5, unit: "cm" },
          { value: 1, unit: "in" },
        ],
      },
    });
    expect(
      records(potato.unresolvedSourceRates).map((rate) => rate.issue),
    ).toEqual([
      "ambiguous-area-unit",
      "ambiguous-volume-unit-and-product-density",
    ]);
    expect(validAction({ ...potato, prerequisites: ["soil-texture"] })).toBe(
      false,
    );
    expect(
      validAction({
        ...potato,
        amount: {
          ...object(potato.amount),
          original: [{ value: 6, unit: "mL" }],
        },
      }),
    ).toBe(false);
  });

  it("requires soil-test results, keeps seasonal changes and preserves amendment conditions", () => {
    const garlic = valueFor("Soil-tested phosphorus and potassium");
    const [assessment, correction] = records(garlic.actions);
    expect(garlic.relationship).toBe("sequence");
    expect(assessment).toMatchObject({ tests: ["pH", "P", "K"] });
    expect(correction).toMatchObject({
      nutrients: ["P", "K"],
      when: "soil-test-indicates-need",
      timing: { kind: "before", anchor: "autumn planting" },
    });
    expect(validAction({ ...correction, when: undefined })).toBe(false);
    expect(validAction({ ...correction, prerequisites: [] })).toBe(false);
    expect(validAction({ ...assessment, prerequisites: undefined })).toBe(
      false,
    );
    const feeding = actionFor("Use citrus-specific feed during active growth");
    expect(feeding).toMatchObject({
      prerequisites: ["product-label"],
      phases: [
        {
          formulation: "high-nitrogen-summer-citrus-feed",
          from: { month: 3, part: "late" },
        },
        {
          formulation: "balanced-winter-citrus-feed",
          through: { month: 3, part: "mid" },
        },
      ],
    });
    expect(validAction({ ...feeding, prerequisites: undefined })).toBe(false);
    const border = actionFor("Ongoing care / Feeding / Borders");
    expect(border.when).toBe("growing-in-border");
    expect(validAction({ ...border, when: undefined })).toBe(false);
    const manure = actionFor(
      "If using manure, add well before planting to allow decomposition",
    );
    expect(manure).toMatchObject({
      when: "using-animal-manure",
      timing: {
        kind: "before",
        anchor: "planting",
        cue: "Well before planting",
      },
    });
    expect(validAction({ ...manure, when: undefined })).toBe(false);
    const boron = actionFor(
      "Boron deficiency is uncommon; diagnosis is conditional",
    );
    expect(
      validAction({ ...boron, prerequisites: ["symptom-assessment"] }),
    ).toBe(false);
  });

  it("preserves exact growing forms, use and source context", () => {
    const lemon = projected.find(
      (fact) => object(fact.value).sourceSetting === "Container citrus culture",
    )!;
    const context = dataset.contexts.find((row) => row.id === lemon.contextId)!;
    expect(context.soilOrContainer).toBe("container");
    const geography = dataset.geographicContexts?.find((row) =>
      (
        object(context.geographicScope).geographicContextIds as string[]
      ).includes(String(row.id)),
    );
    expect(geography?.name).toBe("United Kingdom");
    expect(valueFor("Site-specific fertility", true).applicabilityPath).toEqual(
      ["Salad / spring radish"],
    );
  });
});
