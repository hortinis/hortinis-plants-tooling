import { describe, expect, it } from "vitest";
import { projectPlantFacts } from "../../src/domain/plant-fact-projection.js";
import { validate } from "../../src/schema/validation-api.js";

const bilingual = {
  en: "Lift the tubers once the skin has set.",
  fr: "Arrachez les tubercules une fois la peau bien formée.",
};
const harvestGuidance = {
  operation: "harvest",
  part: "tuber",
  guidance: bilingual,
  preparation: ["Remove tops first.", bilingual],
};
const harvestSchema = "urn:hortinis:plants:schema:v1:harvest-guidance";

describe("English and French catalog text", () => {
  it("accepts bilingual and legacy prose in the same record", () => {
    expect(validate(harvestSchema, harvestGuidance)).toEqual({ valid: true });
    expect(
      validate(harvestSchema, { ...harvestGuidance, guidance: bilingual.fr }),
    ).toEqual({ valid: true });
  });

  it.each([
    { en: bilingual.en },
    { fr: bilingual.fr },
    { ...bilingual, fr: " " },
    { ...bilingual, en: 123 },
    { ...bilingual, de: "Zusatz" },
  ])("rejects malformed translation pairs (%j)", (guidance) => {
    expect(
      validate(harvestSchema, { ...harvestGuidance, guidance }).valid,
    ).toBe(false);
  });

  it("keeps controlled values scalar", () => {
    expect(
      validate(harvestSchema, { ...harvestGuidance, operation: bilingual })
        .valid,
    ).toBe(false);
  });

  it("validates a bilingual authoring assertion and preserves both texts during projection", () => {
    const assertion = {
      id: "assertion_tomato_form",
      subject: { type: "plant-concept", id: "plant_tomato" },
      predicate: "plant_form_description",
      value: {
        plantPart: "fruit",
        description: { en: "Round fruit.", fr: "Fruit rond." },
      },
      contextId: "context_tomato",
      evidenceReferenceIds: ["evidence_tomato"],
      reviewId: "review_tomato",
    };
    expect(
      validate("urn:hortinis:plants:schema:authoring:v1:assertion", assertion),
    ).toEqual({ valid: true });
    const facts = projectPlantFacts(
      {
        assertions: [assertion],
        reviews: [
          { id: assertion.reviewId, purpose: "content", status: "accepted" },
        ],
        taxa: [],
        plantConcepts: [],
        cultivars: [],
        contexts: [],
        rules: [],
        evidence: [],
      },
      "authoring",
      new Set([assertion.predicate]),
    );
    expect(facts).toEqual([{ ...assertion, status: "active" }]);
  });
});
