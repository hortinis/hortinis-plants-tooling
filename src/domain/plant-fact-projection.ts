import type {
  DatasetRecord,
  ValidationDataset,
} from "../curation/validation-dataset.js";
import { validate } from "../schema/validation-api.js";
import { assertionProjectionEligibility } from "./assertion-projection-eligibility.js";

export function projectPlantFacts(
  dataset: ValidationDataset,
  profile: "authoring" | "commercial",
  predicates: ReadonlySet<string>,
): DatasetRecord[] {
  const eligible = assertionProjectionEligibility(dataset, profile);
  return dataset.assertions
    .filter((row) => predicates.has(String(row.predicate)) && eligible(row))
    .map((row) => {
      const {
        id,
        subject,
        predicate,
        value,
        contextId,
        evidenceReferenceIds,
        reviewId,
      } = row;
      const fact = {
        id,
        subject,
        predicate,
        value,
        contextId,
        evidenceReferenceIds,
        reviewId,
        status: "active",
      };
      const result = validate("urn:hortinis:plants:schema:v1:plant-fact", fact);
      if (!result.valid)
        throw new Error(
          `Invalid plant fact ${String(id)}: ${JSON.stringify(result.errors)}`,
        );
      return fact;
    });
}
