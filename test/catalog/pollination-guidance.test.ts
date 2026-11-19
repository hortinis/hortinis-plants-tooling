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
import { projectPollinationGuidance } from "../../src/domain/pollination-guidance-projection.js";
import { validate } from "../../src/schema/validation-api.js";

function artifact(name: string) {
  const bytes = readFileSync(
    catalogFile(`${integrationPath}/reviewed-plant-pollination-${name}.json`),
  );
  return {
    value: object(JSON.parse(bytes.toString("utf8"))),
    sha256: digest(bytes),
  };
}

const schema = "urn:hortinis:plants:schema:v1:pollination-guidance";

describe("approved pollination guidance", () => {
  let dataset: ValidationDataset;
  let facts: ReturnType<typeof projectPollinationGuidance>;

  beforeAll(async () => {
    ({ dataset } = await validateAuthoring(
      dataRoot(),
      catalogFile(catalogPath),
    ));
    facts = projectPollinationGuidance(dataset, "authoring");
  });

  function factFor(topic: string) {
    return facts.find((fact) =>
      records(object(fact.value).rules).some((rule) =>
        String(rule.recipientQualifier).includes(topic),
      ),
    )!;
  }

  it("preserves the frozen proposal list, provenance, rights and exact authoring values", () => {
    const frozen = artifact("frozen");
    const resolution = artifact("resolution");
    const approval = artifact("approval");
    const claims = records(frozen.value.claims);
    const decisions = records(resolution.value.decisions);
    expect(claims).toHaveLength(14);
    expect(facts).toHaveLength(14);
    expect(resolution.value.frozenSha256).toBe(frozen.sha256);
    expect(approval.value.batchSha256).toBe(resolution.sha256);
    expect(decisions.map((row) => row.key)).toEqual(
      claims.map((row) => row.key),
    );
    expect(approval.value.approvedClaimKeys).toEqual(
      claims.map((row) => row.key),
    );
    const review = dataset.reviews.find((row) => row.id === approval.value.id);
    expect(object(review?.reviewedPlantAdmission).dispositions).toEqual(
      decisions,
    );
    for (const decision of decisions) {
      expect(decision.outcome).toBe("newly-admitted");
      const links = records(decision.records);
      const factLink = links.find((link) => link.collection === "assertions")!;
      const { status, ...fact } = facts.find((row) => row.id === factLink.id)!;
      expect(status).toBe("active");
      expect(contentDigest(fact)).toBe(factLink.sha256);
      const claim = claims.find((row) => row.key === decision.key)!;
      const [original] = records(claim.evidence);
      const evidence = dataset.evidence.find(
        (row) => row.id === original!.evidenceReferenceId,
      );
      expect(fact.evidenceReferenceIds).toEqual([evidence?.id]);
      const value = object(fact.value);
      expect(value.evidenceBasis).toBe("horticultural-advice");
      expect(value.limitations).toBeInstanceOf(Array);
      expect(value.limitations).not.toHaveLength(0);
      expect(evidence).toMatchObject({
        sourceRecordKey: original!.sourceRecordKey,
        locator: original!.locator,
        normalization: { originalValue: original!.originalValue },
        rights: {
          decision: "pending-review",
          licenceId: original!.licenceId,
          reviewId: original!.acceptanceId,
        },
      });
    }
    expect(projectPollinationGuidance(dataset, "commercial")).toEqual([]);
  });

  it("preserves donor-to-recipient direction and sweetcorn type applicability", () => {
    const corn = factFor("Supersweet sweetcorn");
    const [rule] = records(object(corn.value).rules);
    expect(rule).toMatchObject({
      effect: "risk-to-quality",
      outcome: "kernel-sweetness",
      pollenCarrier: "wind",
      recipientQualifier: "Supersweet sweetcorn grown for mature kernels",
      pollenDonor: {
        subject: corn.subject,
        qualifier: "Standard sweetcorn cultivar",
      },
    });
    expect(rule!.when).toContain("Pollen shed and receptive silks overlap");
    expect(records(object(corn.value).rules)).toHaveLength(1);
    expect(
      validate(schema, {
        ...object(corn.value),
        rules: [{ ...rule, pollenDonor: undefined }],
      }).valid,
    ).toBe(false);
    expect(
      validate(schema, {
        ...object(corn.value),
        rules: [{ ...rule, when: [] }],
      }).valid,
    ).toBe(false);
  });

  it("distinguishes a requirement, a cropping benefit and insect access", () => {
    const cherry = object(factFor("sweet cherry cultivar").value);
    expect(cherry.rules).toMatchObject([
      {
        effect: "required-for-set",
        recipientQualifier: "Non-self-fertile sweet cherry cultivar",
      },
      {
        effect: "improves-production",
        recipientQualifier: "Self-fertile sweet cherry cultivar",
      },
    ]);
    const kiwi = object(factFor("Female green kiwifruit").value);
    expect(kiwi.applicabilityPath).toEqual(["Dioecious green kiwi"]);
    expect(kiwi.rules).toMatchObject([
      {
        pollenDonor: {
          subject: factFor("Female green kiwifruit").subject,
          qualifier: "Compatible pollen-producing male green kiwifruit vine",
        },
      },
    ]);
    const [access] = records(
      object(factFor("Field-grown courgette").value).rules,
    );
    expect(access).toMatchObject({
      effect: "allow-pollen-transfer",
      pollenCarrier: "insects",
    });
    expect(access).not.toHaveProperty("pollenDonor");
    expect(
      validate(schema, {
        ...object(factFor("Field-grown courgette").value),
        rules: [{ ...access, effect: "required-for-set" }],
      }).valid,
    ).toBe(false);
  });

  it("rejects missing catalog donor IDs", () => {
    const [corn] = dataset.assertions.filter(
      (row) => row.id === factFor("Supersweet sweetcorn").id,
    );
    const value = object(corn!.value);
    const [rule] = records(value.rules);
    const donor = {
      ...object(rule!.pollenDonor),
      subject: { type: "plant-concept", id: "missing-donor-id" },
    };
    const issues = validateValidationDataset({
      ...dataset,
      assertions: dataset.assertions.map((row) =>
        row.id === corn!.id
          ? {
              ...row,
              value: { ...value, rules: [{ ...rule, pollenDonor: donor }] },
            }
          : row,
      ),
    });
    expect(issues).toContainEqual({
      code: "MISSING_REFERENCE",
      recordId: corn!.id,
      message: "References missing plantConcepts record missing-donor-id",
    });
  });
});
