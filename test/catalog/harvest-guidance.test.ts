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
import { projectHarvestGuidance } from "../../src/domain/harvest-guidance-projection.js";
import { validate } from "../../src/schema/validation-api.js";

function readArtifact(name: string) {
  const bytes = readFileSync(
    catalogFile(`${integrationPath}/reviewed-plant-harvest-${name}.json`),
  );
  return {
    value: object(JSON.parse(bytes.toString("utf8"))),
    hash: digest(bytes),
  };
}

const schema = "urn:hortinis:plants:schema:v1:harvest-guidance";

describe("harvest and storage admission", () => {
  let dataset: ValidationDataset;
  let projected: ReturnType<typeof projectHarvestGuidance>;

  beforeAll(async () => {
    ({ dataset } = await validateAuthoring(
      dataRoot(),
      catalogFile(catalogPath),
    ));
    projected = projectHarvestGuidance(dataset, "authoring");
  });

  function guidance(phrase: string) {
    const fact = projected.find((row) =>
      field(object(row.value), "guidance").includes(phrase),
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
    expect(frozenClaims).toHaveLength(76);
    expect(decisions.map((row) => row.key)).toEqual(
      frozenClaims.map((row) => row.key),
    );
    const byId = new Map(
      projected
        .filter((row) => row.reviewId === approval.value.id)
        .map((row) => [row.id, row]),
    );
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
    expect(admissions).toHaveLength(72);
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
    expect(projectHarvestGuidance(dataset, "commercial")).toEqual([]);
  });

  it("keeps crop parts, readiness, use and exact cultivar scope distinct", () => {
    expect(guidance("before the seeds begin to harden").value).toMatchObject({
      part: "fruit",
      stage: "immature",
    });
    expect(guidance("Cut blooms").value).toMatchObject({
      part: "flower",
      stage: "fully-open",
    });
    expect(guidance("Lift some tubers").value).toMatchObject({
      part: "tuber",
      purpose: "Immediate use",
    });
    expect(guidance("remove tops to let the skin set").value).toMatchObject({
      part: "tuber",
      purpose: "Storage harvest",
    });
    const earlyCultivar = projected.find(
      (row) =>
        object(object(row.value).rating ?? {}).label ===
        "Très précoce à précoce",
    );
    expect(earlyCultivar?.subject).toMatchObject({ type: "cultivar" });
  });

  it("retains original units, event anchors and interval roles together with their conditions", () => {
    expect(guidance("Pull young salad radishes").value).toMatchObject({
      applicability: "Salad / spring radish",
      timing: [
        {
          start: "germination",
          end: "harvest",
          duration: { unit: "wk", minimum: 4 },
          qualifier: "as-little-as",
        },
        {
          start: "unknown",
          end: "harvest",
          duration: { unit: "wk", minimum: 6, maximum: 8 },
          condition: "Early sowings",
        },
      ],
    });
    expect(
      guidance("remove tops to let the skin set").value.timing,
    ).toMatchObject([
      {
        start: "top-removal",
        end: "harvest",
        duration: { unit: "wk", minimum: 2 },
        qualifier: "approximate",
      },
    ]);
    expect(
      guidance("Check plants for pickable fruit").value.timing,
    ).toMatchObject([
      {
        role: "check-interval",
        start: "unknown",
        end: "next-check",
        duration: { unit: "d", minimum: 1, maximum: 2 },
        condition: "During fruiting",
      },
    ]);
    expect(
      guidance("as best used within a month or two").value.timing,
    ).toMatchObject([
      {
        role: "best-quality-window",
        start: "harvest",
        duration: { unit: "mo", minimum: 1, maximum: 2 },
      },
    ]);
    const seeding = projected.flatMap((row) =>
      records(object(row.value).timing ?? []).filter(
        (entry) => entry.start === "seeding",
      ),
    );
    expect(seeding.map((entry) => entry.duration)).toEqual(
      expect.arrayContaining([
        { unit: "d", minimum: 50, maximum: 70 },
        { unit: "d", minimum: 120, maximum: 150 },
      ]),
    );
  });

  it("carries storage prerequisites, compound conditions and source context", () => {
    expect(guidance("after they are fully cured").value).toMatchObject({
      operation: "fresh-storage",
      preparation: ["Cure fully before storage"],
      allOfConditions: ["Keep bulbs dry", "Provide air circulation"],
    });
    const { fact, value } = guidance("stable air temperature");
    expect(value).toMatchObject({
      applicability: "Potimarron type",
      temperature: { unit: "Cel", minimum: 10, maximum: 18 },
      relativeHumidity: { unit: "%", minimum: 60, maximum: 75 },
      allOfConditions: expect.arrayContaining([
        "Dry fruit",
        "Ventilated room and air circulation around fruit",
      ]) as unknown,
    });
    const context = dataset.contexts.find((row) => row.id === fact.contextId);
    expect(context).toMatchObject({
      observation: { measurementMedium: "Storage air" },
    });
    const [geographyId] = object(context?.geographicScope)
      .geographicContextIds as string[];
    expect(
      dataset.geographicContexts?.find((row) => row.id === geographyId),
    ).toMatchObject({
      name: "Southeastern France",
    });
  });

  it("rejects malformed quantities and conflicting timing meanings", () => {
    const { fact, value } = guidance("Check plants for pickable fruit");
    const [timing] = records(value.timing);
    expect(validate(schema, { ...value, timing: undefined }).valid).toBe(false);
    expect(
      validate(schema, { ...value, timing: [{ ...timing, start: "sowing" }] })
        .valid,
    ).toBe(false);
    expect(
      validate(schema, {
        ...value,
        timing: [{ ...timing, duration: { unit: "d" } }],
      }).valid,
    ).toBe(false);
    const { status, ...assertion } = fact;
    expect(status).toBe("active");
    const changed = {
      ...assertion,
      value: {
        ...value,
        timing: [
          { ...timing, duration: { unit: "d", minimum: 2, maximum: 1 } },
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
