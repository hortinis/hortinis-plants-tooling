import type {
  DatasetRecord,
  ValidationDataset,
} from "../curation/validation-dataset.js";

const obj = (value: unknown): DatasetRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as DatasetRecord)
    : {};
const ids = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** Evaluate the complete dependency closure; administrative acceptance never grants rights. */
export function recordProjectionEligibility(
  dataset: ValidationDataset,
  profile: "authoring" | "commercial",
) {
  const all = new Map<unknown, DatasetRecord>();
  for (const rows of [
    dataset.taxa,
    dataset.taxonomicNames,
    dataset.plantConcepts,
    dataset.cultivarGroups,
    dataset.cultivars,
    dataset.localizedNames,
    dataset.contexts,
    dataset.geographicContexts,
    dataset.evidence,
    dataset.sources,
    dataset.licences,
    dataset.reviews,
  ])
    for (const row of rows ?? []) all.set(row.id, row);
  const evidenceEligible = (id: unknown): boolean => {
    const evidence = all.get(id),
      rights = obj(evidence?.rights),
      review = all.get(rights.reviewId);
    const key = obj(evidence?.sourceRecordKey ?? { source: evidence }),
      source = obj(key.source);
    return (
      rights.decision === "eligible" &&
      review?.purpose === "rights" &&
      review.status === "accepted" &&
      all.get(rights.licenceId)?.commercialUse === "allowed" &&
      all.has(source.sourceId) &&
      !!source.sourceReleaseId &&
      !!source.sourceManifestId
    );
  };
  const memo = new Map<unknown, boolean>();
  const visiting = new Set<unknown>();
  const eligible = (record: DatasetRecord | undefined): boolean => {
    if (!record || (record.status !== undefined && record.status !== "active"))
      return false;
    if (memo.has(record.id)) return memo.get(record.id)!;
    if (visiting.has(record.id)) return false;
    visiting.add(record.id);
    const review =
      record.reviewId === undefined ? undefined : all.get(record.reviewId);
    let result =
      record.reviewId === undefined ||
      (review?.purpose === "content" && review.status === "accepted");
    if (profile === "commercial") {
      const evidence = ids(record.evidenceReferenceIds);
      // Contexts derive provenance from the assertion, but their own evidence must also clear.
      result &&=
        (record.geographicScope !== undefined || evidence.length > 0) &&
        evidence.every(evidenceEligible);
    }
    const dependencies = [
      record.taxonId,
      record.parentPlantConceptId,
      record.plantConceptId,
      record.cultivarGroupId,
      obj(record.subject).id,
      record.parentGeographicContextId,
      record.parentTaxonId,
      record.acceptedTaxonomicNameId,
      ...ids(record.parentGeographicContextIds),
      ...ids(record.cultivarGroupIds),
      ...ids(obj(record.geographicScope).geographicContextIds),
    ].filter((id) => id !== undefined);
    result &&= dependencies.every((id) => eligible(all.get(id)));
    visiting.delete(record.id);
    memo.set(record.id, result);
    return result;
  };
  return { eligible, evidenceEligible, byId: all };
}
