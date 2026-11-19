import { recordProjectionEligibility } from "./record-projection-eligibility.js";
import { assertionSupersession } from "./assertion-supersession.js";
import type {
  DatasetRecord,
  ValidationDataset,
} from "../curation/validation-dataset.js";

function asRecord(value: unknown): DatasetRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as DatasetRecord)
    : undefined;
}

export function assertionProjectionEligibility(
  dataset: ValidationDataset,
  profile: "authoring" | "commercial",
) {
  const dependencies = recordProjectionEligibility(dataset, profile);
  const superseded = assertionSupersession(dataset);
  const reviews = new Map(dataset.reviews.map((record) => [record.id, record]));
  const evidence = new Map(
    dataset.evidence.map((record) => [record.id, record]),
  );
  const licences = new Map(
    dataset.licences?.map((record) => [record.id, record]),
  );
  const contexts = new Map(
    dataset.contexts.map((record) => [record.id, record]),
  );
  const geography = new Map(
    dataset.geographicContexts?.map((record) => [record.id, record]),
  );

  const eligible = (id: unknown) => {
    const rights = asRecord(evidence.get(id)?.rights);
    const review = reviews.get(rights?.reviewId);
    return (
      rights?.decision === "eligible" &&
      review?.purpose === "rights" &&
      review.status === "accepted" &&
      licences.get(rights.licenceId)?.commercialUse === "allowed"
    );
  };

  return (assertion: DatasetRecord): boolean => {
    if (superseded.has(assertion.id)) return false;
    const review = reviews.get(assertion.reviewId);
    if (review?.purpose !== "content" || review.status !== "accepted")
      return false;
    if (profile === "authoring") return true;
    const context = contexts.get(assertion.contextId);
    const ids = assertion.evidenceReferenceIds as unknown[];
    const scope = asRecord(context?.geographicScope);
    const areaIds = (scope?.geographicContextIds ?? []) as unknown[];
    return (
      context !== undefined &&
      dependencies.eligible(
        dependencies.byId.get(asRecord(assertion.subject)?.id),
      ) &&
      dependencies.eligible(context) &&
      ids.length > 0 &&
      ids.every(eligible) &&
      areaIds.every((id) => {
        const area = geography.get(id);
        return (
          area?.status === "active" &&
          (area.evidenceReferenceIds as unknown[]).every(eligible)
        );
      })
    );
  };
}
