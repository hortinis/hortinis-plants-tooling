import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { dataRoot } from "../repository-paths.js";
import { format } from "prettier";
import { validate } from "../schema/validation-api.js";
import { consolidatePlantReviews } from "./plant-review-consolidation.js";
import { object, records, same } from "./curation-artifacts.js";
import { readReviewedDispositions } from "./resolved-reviewed-plant-batch.js";
import { mintStableId } from "./grow-wfo-apply.js";
import { validateGrowWfoDataset } from "./grow-wfo-validation.js";
import { prepareCanonicalSubjectAdmission } from "./canonical-subject-admission.js";
import {
  buildSubjectRegistry,
  checkSubjectRegistry,
} from "./subject-registry.js";

export async function plantIntegrationStatus(root: string) {
  const inventory = await consolidatePlantReviews(root);
  if (inventory.checks.status !== "validated")
    throw new Error("Invalid review inventory");
  const dataset = resolve(root, "data/curation/grow-wfo-initial");
  const structural = await validateGrowWfoDataset({
    repositoryRoot: root,
    datasetDirectory: dataset,
  });
  if (!structural.valid || !structural.loaded)
    throw new Error("Invalid catalog structure");
  const dependencies = structural.loaded.manifest.dependencies;
  const proposals = [];
  const reviews = structural.loaded.dataset.reviews;
  const reviewedClaims = new Map<
    string,
    { reviewId: unknown; assertion: boolean }
  >();
  const reviewedMappings = new Set<string>();
  const dispositions = await readReviewedDispositions(root, reviews);
  for (const review of reviews) {
    if (review.status !== "accepted" || !review.reviewedPlantAdmission)
      continue;
    const receipt = object(review.reviewedPlantAdmission);
    for (const scope of records(receipt.mappings))
      reviewedMappings.add(String(scope.id));
    for (const row of records(receipt.claims))
      reviewedClaims.set(
        String(row.packetSha256) + "/" + String(object(row.claim).id),
        {
          reviewId: review.id,
          assertion: typeof row.assertionId === "string",
        },
      );
  }
  for (const packet of inventory.packets) {
    const saved = object(
      JSON.parse(await readFile(resolve(root, packet.path), "utf8")),
    );
    for (const claim of records(saved.claims).filter(
      (row) => row.recommendation === "select",
    )) {
      const evidenceIds = claim.evidenceIds as string[];
      const supplementalEvidenceIds = [];
      for (const evidenceId of evidenceIds) {
        const alias = `${packet.id}:${evidenceId}`;
        const admissionId = mintStableId(
          "plant-integration-preparation",
          "source-admissions",
          alias,
        );
        const prefix = `data/sources/supplemental/${admissionId}/`;
        if (!dependencies.some((row) => row.path === `${prefix}source.json`))
          continue;
        const receipt = object(
          JSON.parse(
            await readFile(resolve(root, `${prefix}provenance.json`), "utf8"),
          ),
        );
        if (
          receipt.packetId !== packet.id ||
          receipt.packetSha256 !== packet.sha256 ||
          receipt.evidenceId !== evidenceId
        )
          throw new Error("Stale supplemental provenance");
        for (const [role, key] of [
          ["source", "source"],
          ["licence", "licence"],
          ["source-manifest", "sourceManifest"],
        ] as const) {
          const dep = dependencies.find(
            (row) => row.path === `${prefix}${role}.json`,
          );
          if (
            !dep ||
            !same(
              object(
                JSON.parse(await readFile(resolve(root, dep.path), "utf8")),
              ),
              receipt[key],
            )
          )
            throw new Error(
              "Supplemental provenance differs from admitted metadata",
            );
        }
        supplementalEvidenceIds.push(evidenceId);
      }
      const implementation = object(claim.implementation);
      const shape = validate(
        "urn:hortinis:plants:schema:authoring:v1:assertion",
        {
          id: "shape-check",
          subject: { type: "plant-concept", id: "shape-check-subject" },
          predicate: implementation.predicate,
          value: claim.value,
          contextId: "shape-check-context",
          evidenceReferenceIds: ["shape-check-evidence"],
          reviewId: "shape-check-review",
        },
      );
      const admitted = reviews.filter((review) => {
        if (
          review.status !== "accepted" ||
          review.supplementalAdmission === undefined
        )
          return false;
        const receipt = object(review.supplementalAdmission);
        return (
          receipt.packetSha256 === packet.sha256 &&
          object(receipt.claim).id === claim.id
        );
      });
      const reviewed = reviewedClaims.get(
        packet.sha256 + "/" + String(claim.id),
      );
      const disposition = dispositions.get(
        packet.sha256 + ":" + packet.id + ":" + String(claim.id),
      );
      proposals.push({
        ...(disposition ? { disposition } : {}),
        packetId: packet.id,
        packetRevision: packet.revision,
        packetSha256: packet.sha256,
        claimId: claim.id,
        plant: packet.plant.label,
        domain: claim.domain,
        scopeIds: claim.scopeIds,
        predicate: implementation.predicate,
        authoringSchemaShapeFits: shape.valid,
        registeredSupplementalEvidenceIds: supplementalEvidenceIds,
        allEvidenceHasSupplementalMetadata:
          supplementalEvidenceIds.length === evidenceIds.length,
        admissionReviewIds: admitted.map((row) => row.id),
        status:
          admitted.length ||
          reviewed ||
          disposition?.outcome === "already-represented" ||
          disposition?.outcome === "excluded" ||
          disposition?.outcome === "superseded"
            ? "validated"
            : "in progress",
        ...(reviewed
          ? {
              reviewedBatchAdmissionId: reviewed.reviewId,
              reviewedBatchAdmissionKind: reviewed.assertion
                ? "assertion"
                : "identity",
            }
          : {}),
      });
    }
  }
  const scopeCount = inventory.packets.reduce(
    (total, packet) => total + packet.scopes.length,
    0,
  );
  const registry = await buildSubjectRegistry(root);
  await checkSubjectRegistry(root, registry);
  const plan = await prepareCanonicalSubjectAdmission(
    root,
    registry,
    structural.loaded,
  );
  const canonicalSubjectAdmission = {
    proposalSha256: plan.proposalSha256,
    status: plan.status,
    admissionReviewId: plan.admissionReviewId,
    subjects: plan.subjects,
    mappings: plan.mappings,
  };
  const admissionApplied = canonicalSubjectAdmission.admissionReviewId !== null;
  const catalog = structural.loaded.dataset;
  const localCalendar = reviews.flatMap((review) =>
    review.calendarAdmission
      ? records(object(review.calendarAdmission).lineage).map((row) => ({
          proposalId: row.proposalId,
          assertionId: row.assertionId,
          approvalId: review.id,
          status: "validated",
          commercialRelease: "blocked",
        }))
      : [],
  );
  return {
    status: "in progress",
    inventoryFingerprint: inventory.inputFingerprint,
    subjectMatchesSha256: registry.proposalSha256,
    subjectApprovalSha256: registry.approvalSha256,
    totals: {
      packets: inventory.packets.length,
      selectedProposals: proposals.length,
      withRegisteredSupplementalEvidence: proposals.filter(
        (row) => row.registeredSupplementalEvidenceIds.length,
      ).length,
      allSupplementalEvidenceRegistered: proposals.filter(
        (row) => row.allEvidenceHasSupplementalMetadata,
      ).length,
      exactSchemaShapeAndSupplementalMetadata: proposals.filter(
        (row) =>
          row.authoringSchemaShapeFits &&
          row.allEvidenceHasSupplementalMetadata,
      ).length,
      supplementalClaimsAdmitted: proposals.filter(
        (row) => row.admissionReviewIds.length,
      ).length,
      reviewedBatchAssertionsAdmitted: [...reviewedClaims.values()].filter(
        (row) => row.assertion,
      ).length,
      reviewedBatchBotanicalProposalsAdmitted: [
        ...reviewedClaims.values(),
      ].filter((row) => !row.assertion).length,
      reviewedBatchScopeMappingsAdmitted: reviewedMappings.size,
      packetQualifiedScopeMappings: scopeCount,
      subjectMatchProposals: registry.proposalCount,
      subjectMatchesApprovedAndApplied: registry.relationships.length,
      sameSubjectRelationships: registry.relationships.filter(
        (row) => row.relation === "same-subject",
      ).length,
      comparisonRelationships: registry.relationships.filter(
        (row) => row.relation === "comparison-of",
      ).length,
      equivalentReviewSubjects: registry.equivalenceGroups.length,
      canonicalSubjectCandidates: registry.equivalenceGroups.length,
      canonicalRecordsProposed: admissionApplied ? 0 : plan.subjects.length,
      canonicalRecordsAdmitted: admissionApplied ? plan.subjects.length : 0,
      canonicalQualifiedScopesProposed: admissionApplied
        ? 0
        : canonicalSubjectAdmission.mappings.length,
      canonicalQualifiedScopesAdmitted: admissionApplied
        ? canonicalSubjectAdmission.mappings.length
        : 0,
      qualifiedScopesOutsideThisAdmission:
        scopeCount - canonicalSubjectAdmission.mappings.length,
      activePlantConcepts: catalog.plantConcepts.filter(
        (row) => row.status === "active" && row.kind !== "growing-type",
      ).length,
      activeGrowingTypes: catalog.plantConcepts.filter(
        (row) => row.status === "active" && row.kind === "growing-type",
      ).length,
      activeCultivarGroups: (catalog.cultivarGroups ?? []).filter(
        (row) => row.status === "active",
      ).length,
      activeCultivars: catalog.cultivars.filter(
        (row) => row.status === "active",
      ).length,
      catalogAssertions: catalog.assertions.length,
      saintEtienneRecommendationsAdmitted: localCalendar.length,
    },
    proposals,
    saintEtienneRecommendations: localCalendar,
    subjectRegistry: registry,
    canonicalSubjectAdmission,
  };
}

if (process.argv[1] === import.meta.filename) {
  try {
    const args = process.argv.slice(2).filter((arg) => arg !== "--");
    if (args.length !== 1 || !["--write", "--check"].includes(args[0]!))
      throw new Error("Use --write or --check");
    const root = dataRoot(process.cwd());
    const report = await plantIntegrationStatus(root);
    const path = resolve(root, "data/curation/plant-integration/status.json");
    const text = await format(JSON.stringify(report), { parser: "json" });
    if (args[0] === "--write") await writeFile(path, text);
    else if ((await readFile(path, "utf8")) !== text)
      throw new Error("Stale report: status.json");
    console.log(JSON.stringify(report.totals));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
