import type { ValidationDataset } from "../curation/validation-dataset.js";
import { projectPlantFacts } from "./plant-fact-projection.js";

const sitePredicates = new Set([
  "site_guidance",
  "soil_ph_range",
  "drainage_requirement",
]);

/** Project site facts with their source-specific value and exact context links. */
export function projectSiteFacts(
  dataset: ValidationDataset,
  profile: "authoring" | "commercial",
) {
  return projectPlantFacts(dataset, profile, sitePredicates);
}
