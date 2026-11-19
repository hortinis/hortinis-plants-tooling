import type {
  DatasetRecord,
  ValidationDataset,
} from "../curation/validation-dataset.js";
import { projectPlantFacts } from "./plant-fact-projection.js";
import { projectCultivationRules } from "./cultivation-rule-projection.js";
import { recordProjectionEligibility } from "./record-projection-eligibility.js";

/** Whole-catalog consumer entry point; exact subject scopes, no inherited or invented facts. */
export function projectCatalog(
  dataset: ValidationDataset,
  profile: "authoring" | "commercial",
) {
  const { eligible } = recordProjectionEligibility(dataset, profile);
  const predicates = new Set(
    dataset.assertions
      .map((row) => String(row.predicate))
      .filter((p) => p !== "cultivation_window"),
  );
  const families: Record<string, readonly DatasetRecord[]> = {
    taxon: dataset.taxa.filter(eligible),
    "taxonomic-name": (dataset.taxonomicNames ?? []).filter(eligible),
    "plant-concept": dataset.plantConcepts.filter(eligible),
    "cultivar-group": (dataset.cultivarGroups ?? []).filter(eligible),
    cultivar: dataset.cultivars.filter(eligible),
    "localized-name": (dataset.localizedNames ?? []).filter(eligible),
    "cultivation-context": dataset.contexts.filter(eligible),
    "geographic-context": (dataset.geographicContexts ?? []).filter(eligible),
    "plant-fact": projectPlantFacts(dataset, profile, predicates),
    "cultivation-rule": projectCultivationRules(dataset, profile),
  };
  // Include only evidence and governance required by projected records. Preserve rights verbatim.
  const evidenceIds = new Set(
    Object.values(families).flatMap((rows) =>
      rows.flatMap((row) =>
        Array.isArray(row.evidenceReferenceIds)
          ? (row.evidenceReferenceIds as unknown[])
          : [],
      ),
    ),
  );
  const evidence = dataset.evidence.filter((row) => evidenceIds.has(row.id));
  families["evidence-reference"] = evidence;
  const reviewIds = new Set(
    Object.values(families)
      .flatMap((rows) => rows.map((row) => row.reviewId))
      .filter(Boolean),
  );
  const sourceIds = new Set<unknown>(),
    licenceIds = new Set<unknown>();
  for (const row of evidence) {
    const key = (row.sourceRecordKey ?? { source: row }) as DatasetRecord,
      source = key.source as DatasetRecord,
      rights = row.rights as DatasetRecord;
    sourceIds.add(source.sourceId);
    licenceIds.add(rights.licenceId);
    reviewIds.add(rights.reviewId);
  }
  families.source = (dataset.sources ?? []).filter((row) =>
    sourceIds.has(row.id),
  );
  families.licence = (dataset.licences ?? []).filter((row) =>
    licenceIds.has(row.id),
  );
  families.review = dataset.reviews.filter((row) => reviewIds.has(row.id));
  return families;
}
