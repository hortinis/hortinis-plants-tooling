import type { ValidationDataset } from "../curation/validation-dataset.js";
import { projectPlantFacts } from "./plant-fact-projection.js";

const predicates = new Set(["rotation_classification"]);

/** Returns source classifications with exact subjects and applicability context links. */
export function projectRotationClassifications(
  dataset: ValidationDataset,
  profile: "authoring" | "commercial",
) {
  return projectPlantFacts(dataset, profile, predicates);
}
