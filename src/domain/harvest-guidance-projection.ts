import type { ValidationDataset } from "../curation/validation-dataset.js";
import { projectPlantFacts } from "./plant-fact-projection.js";

const predicates = new Set(["harvest_guidance"]);

/** Projects source-specific guidance for the exact subject and recorded context. */
export function projectHarvestGuidance(
  dataset: ValidationDataset,
  profile: "authoring" | "commercial",
) {
  return projectPlantFacts(dataset, profile, predicates);
}
