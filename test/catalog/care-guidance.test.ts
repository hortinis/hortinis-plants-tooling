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
import { projectCareGuidance } from "../../src/domain/care-guidance-projection.js";
import { validate } from "../../src/schema/validation-api.js";

function readArtifact(name: string) {
  const bytes = readFileSync(
    catalogFile(`${integrationPath}/reviewed-plant-care-${name}.json`),
  );
  return {
    value: object(JSON.parse(bytes.toString("utf8"))),
    hash: digest(bytes),
  };
}

const schema = "urn:hortinis:plants:schema:v1:care-guidance";

describe("plant care admission", () => {
  let dataset: ValidationDataset;
  let projected: ReturnType<typeof projectCareGuidance>;

  beforeAll(async () => {
    ({ dataset } = await validateAuthoring(
      dataRoot(),
      catalogFile(catalogPath),
    ));
    projected = projectCareGuidance(dataset, "authoring");
  });

  function valueFor(topic: string) {
    const claim = records(readArtifact("frozen").value.claims).find(
      (row) => object(row.claim).topic === topic,
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
    expect(frozenClaims).toHaveLength(66);
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
    expect(admissions).toHaveLength(61);
    const finalCare = dataset.reviews.flatMap((review) =>
      typeof review.resolutionPath === "string" &&
      review.resolutionPath.includes("/final-exceptions-")
        ? records(object(review.reviewedPlantAdmission).records).filter(
            (row) =>
              row.collection === "assertions" &&
              object(row.value).predicate === "care_guidance",
          )
        : [],
    );
    expect(finalCare).toHaveLength(3);
    expect(byId.size).toBe(admissions.length + finalCare.length);
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
    expect(projectCareGuidance(dataset, "commercial")).toEqual([]);
  });

  it("keeps the ordered cuts on the same shoots and preserves different kinds of timing", () => {
    expect(valueFor("How to prune wisteria")).toMatchObject({
      applicabilityPath: ["Established wall or pergola plant"],
      groups: [
        {
          relationship: "sequence",
          actions: [
            {
              action: "maintenance-prune",
              target: "whippy green current-season shoots",
              allOfTiming: [
                { kind: "after", anchor: "flowering ends" },
                { kind: "calendar-months", months: [7, 8] },
              ],
            },
            {
              action: "maintenance-prune",
              target: "those same summer-pruned shoots",
              allOfConditions: ["Plant is dormant and leafless"],
              allOfTiming: [{ kind: "calendar-months", months: [1, 2] }],
            },
          ],
        },
      ],
    });
    expect(valueFor("Pruning / H. macrophylla and H. serrata")).toMatchObject({
      groups: [
        { actions: [{ action: "maintenance-prune", strength: "recommended" }] },
        { actions: [{ action: "renewal-prune", cutPosition: "At the base" }] },
        {
          actions: [
            { strength: "prohibited", target: "previous-year framework stems" },
          ],
        },
      ],
    });
  });

  it("keeps weed-control constraints and support alternatives in consumer values", () => {
    expect(valueFor("Shallow follow-up weeding")).toMatchObject({
      groups: [
        {
          actions: [
            {
              action: "cultivate",
              methodKind: "shallow-cultivation",
              allOfTiming: [{ kind: "after", anchor: "first cultivation" }],
              dimensions: [
                { measure: "depth", unit: "cm", value: 5, relation: "maximum" },
              ],
            },
          ],
        },
      ],
    });
    expect(valueFor("Planting / Supports")).toMatchObject({
      groups: [
        {
          relationship: "alternatives",
          actions: [
            {
              action: "install-support",
              strength: "required",
              methodKind: "pergola-or-arch",
            },
            {
              action: "install-support",
              strength: "required",
              methodKind: "anchored-wires",
            },
          ],
        },
      ],
    });
    const climbing = projected.find((row) =>
      records(object(row.value).groups).some((group) =>
        records(group.actions).some(
          (action) => action.target === "climbing shoots",
        ),
      ),
    );
    expect(climbing?.value).toMatchObject({
      applicabilityPath: ["Trailing or climbing nasturtium"],
      groups: [
        {
          relationship: "alternatives",
          actions: [
            { action: "retain-growth", strength: "optional" },
            { action: "train", strength: "optional" },
          ],
        },
      ],
    });
  });

  it("rejects a sequence with one action and event timing without an anchor", () => {
    const action = {
      action: "install-support",
      strength: "required",
      target: "vines",
    };
    const guidance = (relationship: string, actions: unknown[]) => ({
      evaluation: "observation-dependent",
      groups: [{ relationship, actions }],
    });
    expect(validate(schema, guidance("sequence", [action])).valid).toBe(false);
    expect(
      validate(
        schema,
        guidance("independent", [
          { ...action, allOfTiming: [{ kind: "before" }] },
        ]),
      ).valid,
    ).toBe(false);
    expect(
      validate(
        schema,
        guidance("independent", [
          { ...action, allOfTiming: [{ kind: "before", anchor: "planting" }] },
        ]),
      ).valid,
    ).toBe(true);
  });
});
