import { describe, expect, it } from "vitest";
import {
  auditPacketDecision,
  packetDecisionEvidence,
} from "../../src/curation/integrated-decision-lineage.js";
import type { IntegratedReviewDraft } from "../../src/curation/integrated-review-reader.js";
import type { ValidationDataset } from "../../src/curation/validation-dataset.js";
import type { RecordValue } from "../../src/curation/curation-artifacts.js";

function assertionReview(
  predicate: string,
  rawValue: unknown,
  normalizedValue: unknown,
) {
  const sourceRecordKey = {
    source: {
      sourceId: "source_grow_edible_plant_database",
      sourceManifestId: "source_manifest_grow_epd_2020",
      sourceReleaseId: "doi:10.15132/10000157",
    },
    recordId: "88",
  };
  const candidate: RecordValue = {
    id: "candidate-reviewed",
    sourceRecordKey,
    predicate,
    rawValue,
    normalizedValue,
  };
  const packet: RecordValue = {
    id: "packet-reviewed",
    contentSha256: "packet-content",
    sourceRecordKey,
    sourceRecord: { sourceRecordKey },
    dependencies: [],
    rightsEvidence: [],
    identityCandidates: [],
    taxonomyOutcomes: [],
    cultivationCandidates: [candidate],
    queueMembership: ["assertion"],
  };
  const draft: IntegratedReviewDraft = {
    manifest: {},
    manifestSha256: "draft-content",
    scope: {},
    packets: [packet],
    queue: [{ packetId: packet.id, reviewKinds: ["assertion"] }],
    comparisons: [],
  };
  const source = {
    packetId: packet.id,
    packetSha256: packet.contentSha256,
    sourceRecordKey,
    candidateIds: [candidate.id],
  };
  const assertion: RecordValue = {
    id: "assertion-reviewed",
    predicate,
    value: normalizedValue,
    evidenceReferenceIds: ["evidence-reviewed"],
  };
  const evidence: RecordValue = {
    id: "evidence-reviewed",
    sourceRecordKey,
    normalization: { originalValue: rawValue },
  };
  const dataset: ValidationDataset = {
    taxa: [],
    plantConcepts: [],
    cultivars: [],
    contexts: [],
    rules: [],
    assertions: [assertion],
    evidence: [evidence],
    reviews: [],
  };
  const decision: RecordValue = {
    kind: "assertion",
    source,
    draftManifestSha256: draft.manifestSha256,
    reviewId: "review-content",
    disposition: "accept",
    ...packetDecisionEvidence(source, "assertion", packet, draft),
    records: [
      {
        collection: "assertions",
        value: assertion,
      },
      {
        collection: "source-assertion-decisions",
        value: {
          id: "decision-reviewed",
          sourceCandidateId: candidate.id,
          draftManifestSha256: draft.manifestSha256,
          decision: "accept",
          assertionId: assertion.id,
          reviewId: "review-content",
        },
      },
    ],
  };
  return { decision, dataset, draft, evidence, candidate };
}

describe("accepted assertion lineage", () => {
  it.each([
    {
      predicate: "sun_requirement",
      rawValue: "Full sun",
      normalizedValue: ["full_sun"],
    },
    {
      predicate: "water_requirement",
      rawValue: "Medium",
      normalizedValue: "medium",
    },
  ])("accepts a source-backed $predicate claim", (claim) => {
    const value = assertionReview(
      claim.predicate,
      claim.rawValue,
      claim.normalizedValue,
    );
    expect(() =>
      auditPacketDecision(value.decision, value.dataset, value.draft),
    ).not.toThrow();
  });

  it("still rejects a list-valued claim whose evidence loses the raw source value", () => {
    const value = assertionReview("sun_requirement", "Full sun", ["full_sun"]);
    const dataset = {
      ...value.dataset,
      evidence: [
        {
          ...value.evidence,
          normalization: { originalValue: "Partial shade" },
        },
      ],
    };
    expect(() =>
      auditPacketDecision(value.decision, dataset, value.draft),
    ).toThrow("retain candidate raw value");
  });

  it("still rejects acceptance of dynamic plant_now claims", () => {
    const value = assertionReview(
      "cultivation_window",
      { action: "plant_now" },
      { sourceAction: "plant_now" },
    );
    expect(() =>
      auditPacketDecision(value.decision, value.dataset, value.draft),
    ).toThrow("Dynamic plant_now");
  });
});
