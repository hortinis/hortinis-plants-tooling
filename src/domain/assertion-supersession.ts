import type {
  DatasetRecord,
  ValidationDataset,
} from "../curation/validation-dataset.js";
import {
  contentDigest,
  object,
  records,
  same,
} from "../curation/curation-artifacts.js";

/** Immutable same-subject refinements, distinct from cultivar inheritance. Fail closed on invalid lineage. */
export function assertionSupersession(
  dataset: ValidationDataset,
): Set<unknown> {
  const assertions = new Map(dataset.assertions.map((row) => [row.id, row]));
  const retired = new Map<unknown, unknown>();
  for (const review of dataset.reviews) {
    if (review.assertionSupersessions === undefined) continue;
    if (
      review.purpose !== "content" ||
      review.status !== "accepted" ||
      object(review.decisionAuthority).kind !== "delegated-agent"
    )
      throw new Error(
        "Assertion supersession requires accepted delegated content review",
      );
    for (const link of records(review.assertionSupersessions)) {
      const prior = assertions.get(link.predecessorId);
      const next = assertions.get(link.successorId);
      const reason =
        link.reason !== null &&
        typeof link.reason === "object" &&
        !Array.isArray(link.reason)
          ? object(link.reason)
          : {};
      const hasReason =
        typeof link.reason === "string"
          ? link.reason.length > 0
          : Object.keys(reason).length === 2 &&
            typeof reason.en === "string" &&
            /\S/.test(reason.en) &&
            typeof reason.fr === "string" &&
            /\S/.test(reason.fr);
      if (
        !prior ||
        !next ||
        prior.id === next.id ||
        retired.has(prior.id) ||
        !same(prior.subject, next.subject) ||
        prior.predicate !== next.predicate ||
        contentDigest(prior) !== link.predecessorSha256 ||
        contentDigest(next) !== link.successorSha256 ||
        next.reviewId !== review.id ||
        !hasReason
      )
        throw new Error(
          "Invalid assertion supersession: missing, changed, duplicate or unrelated records",
        );
      retired.set(prior.id, next.id);
    }
  }
  for (const start of retired.keys()) {
    const seen = new Set<unknown>();
    let id: unknown = start;
    while (retired.has(id)) {
      if (seen.has(id)) throw new Error("Assertion supersession cycle");
      seen.add(id);
      id = retired.get(id);
    }
  }
  return new Set(retired.keys());
}

export function supersessionIssue(dataset: ValidationDataset): DatasetRecord[] {
  try {
    assertionSupersession(dataset);
    return [];
  } catch (error) {
    return [
      {
        code: "INVALID_SUPERSESSION",
        recordId: "assertion-supersessions",
        message: String(error),
      },
    ];
  }
}
