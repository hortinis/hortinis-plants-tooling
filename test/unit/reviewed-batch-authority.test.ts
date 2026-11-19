import { expect, it } from "vitest";
import { collectAuthoredDecisions } from "../../src/curation/integrated-review-packets.js";
import { contentDigest } from "../../src/curation/curation-artifacts.js";
import { validate } from "../../src/schema/validation-api.js";

it("records delegated content approval without a human approval quote", () => {
  const review = {
    id: "review-delegation-test",
    purpose: "content",
    status: "accepted",
    scope: "reviewed-plant-batch",
    reviewerId: "codex-agent",
    reviewedAt: "2026-11-15T12:00:00Z",
    sourceReference: "user instruction",
    approvedIdentityClaimKeys: ["packet-id:claim-id"],
    decisionAuthority: {
      kind: "delegated-agent",
      delegationReference: "user instruction",
      delegationText: "Delegation recorded for this test",
    },
  };
  const schema = "urn:hortinis:plants:schema:v1:review";
  expect(validate(schema, review).valid).toBe(true);
  expect(validate(schema, { ...review, quote: "I approve" }).valid).toBe(false);
  expect(validate(schema, { ...review, purpose: "rights" }).valid).toBe(false);
  expect(
    validate(schema, {
      ...review,
      decisionAuthority: { ...review.decisionAuthority, delegationText: "" },
    }).valid,
  ).toBe(false);
});

it("pins a shared batch review without repeating the full receipt in each source packet", () => {
  const review = {
    id: "review-batch",
    purpose: "content",
    status: "accepted",
    reviewerId: "codex-agent",
    reviewedAt: "2026-11-15T12:00:00Z",
    batchSha256: "a".repeat(64),
    reviewedPlantAdmission: { records: [{ id: "batch-record" }] },
  };
  const snapshot = (input: typeof review) =>
    collectAuthoredDecisions(
      { reviews: [input] },
      "example-source",
      [],
      [{ wfoReviewId: review.id }],
      [],
      [],
    ).reviews;
  expect(snapshot(review)).toEqual([
    {
      id: review.id,
      purpose: review.purpose,
      status: review.status,
      reviewerId: review.reviewerId,
      reviewedAt: review.reviewedAt,
      batchSha256: review.batchSha256,
      reviewSha256: contentDigest(review),
    },
  ]);
  expect(
    snapshot({ ...review, reviewedPlantAdmission: { records: [] } }),
  ).not.toEqual(snapshot(review));
});
