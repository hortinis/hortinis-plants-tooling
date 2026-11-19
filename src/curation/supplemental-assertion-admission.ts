import { readFile } from "node:fs/promises";
import { dataRoot } from "../repository-paths.js";
import { validate } from "../schema/validation-api.js";
import {
  object,
  records,
  field,
  strings,
  same,
  digest,
  contentDigest,
  containedPath,
  assertSchema,
  type RecordValue,
} from "./curation-artifacts.js";
import { mintStableId } from "./grow-wfo-apply.js";
import { validateGrowWfoDataset } from "./grow-wfo-validation.js";
import {
  acquireDatasetLock,
  authoringFingerprint,
  readCollections,
  runDecisionTransaction,
} from "./decision-transaction.js";

/** Narrow first admission path: exact supported values, existing subjects/contexts, pending rights. */
export async function admitSupplementalAssertion(
  root: string,
  inputPath: string,
) {
  const inputBytes = await readFile(await containedPath(root, inputPath));
  const input = object(JSON.parse(inputBytes.toString("utf8")));
  const transactionId = field(input, "transactionId");
  const packetPath = field(input, "packetPath");
  const packetBytes = await readFile(await containedPath(root, packetPath));
  const packet = object(JSON.parse(packetBytes.toString("utf8")));
  assertSchema(
    { validate },
    "urn:hortinis:plants:schema:curation:v1:plant-review-proposal",
    packet,
  );
  if (digest(packetBytes) !== field(input, "packetSha256"))
    throw new Error("Stale packet approval");
  const claim = records(packet.claims).find((row) => row.id === input.claimId);
  if (!claim || claim.recommendation !== "select")
    throw new Error("Claim is not a selected proposal");
  const scopeId = field(input, "scopeId");
  if (!strings(claim.scopeIds).includes(scopeId))
    throw new Error("Unrelated approved scope");
  const predicate = field(object(claim.implementation), "predicate");
  const expectedApproval = {
    packetId: packet.id,
    packetRevision: packet.revision,
    packetSha256: input.packetSha256,
    claimId: claim.id,
    scopeId,
    subject: input.subject,
    contextId: input.contextId,
    predicate,
    valueSha256: contentDigest(claim.value),
    conditionsSha256: contentDigest(claim.conditions),
  };
  const contentReview = object(input.contentReview),
    rightsReview = object(input.rightsReview);
  for (const review of [contentReview, rightsReview])
    assertSchema({ validate }, "urn:hortinis:plants:schema:v1:review", review);
  if (
    contentReview.purpose !== "content" ||
    contentReview.status !== "accepted" ||
    !same(contentReview.approval, expectedApproval)
  )
    throw new Error("Exact curator content and scope approval is required");
  if (rightsReview.purpose !== "rights" || rightsReview.status !== "accepted")
    throw new Error(
      "An explicit administrative pending-rights review is required",
    );
  const dataset = await containedPath(root, "data/curation/grow-wfo-initial");
  const unlock = await acquireDatasetLock(dataset);
  try {
    const baseline = await validateGrowWfoDataset({
      repositoryRoot: root,
      datasetDirectory: dataset,
    });
    if (!baseline.valid || !baseline.loaded)
      throw new Error("Invalid current dataset");
    const descriptors = baseline.loaded.manifest.collections;
    const before = field(input, "baseDatasetSha256");
    if ((await authoringFingerprint(dataset, descriptors)) !== before)
      throw new Error("Stale authoring fingerprint");
    const original = await readCollections(dataset, descriptors);
    const collections = new Map(
      [...original].map(([key, rows]) => [key, [...rows]]),
    );
    const snapshots: RecordValue[] = [];
    const append = (collection: string, value: RecordValue) => {
      const descriptor = descriptors.find((row) => row.role === collection);
      if (!descriptor) throw new Error(`Undeclared collection: ${collection}`);
      assertSchema({ validate }, descriptor.schemaId, value);
      const rows = collections.get(collection)!;
      if (rows.some((row) => row.id === value.id))
        throw new Error(`Existing record or replay: ${String(value.id)}`);
      rows.push(value);
      snapshots.push({ collection, value });
    };
    const subject = object(input.subject);
    const subjectCollection = {
      "plant-concept": "plant-concepts",
      "cultivar-group": "cultivar-groups",
      cultivar: "cultivars",
    }[field(subject, "type")];
    if (
      !subjectCollection ||
      !collections
        .get(subjectCollection)
        ?.some((row) => row.id === subject.id && row.status === "active")
    )
      throw new Error("Approved subject is not active");
    if (
      !collections
        .get("cultivation-contexts")
        ?.some((row) => row.id === input.contextId)
    )
      throw new Error("Approved context must already exist");
    const evidenceIds: string[] = [];
    const pinnedPackages: { path: string; sha256: string }[] = [];
    for (const evidenceId of strings(claim.evidenceIds)) {
      const admissionId = mintStableId(
        "plant-integration-preparation",
        "source-admissions",
        `${String(packet.id)}:${evidenceId}`,
      );
      const path = `data/sources/supplemental/${admissionId}/provenance.json`;
      const bytes = await readFile(await containedPath(root, path));
      pinnedPackages.push({ path, sha256: digest(bytes) });
      const entry = object(JSON.parse(bytes.toString("utf8")));
      if (
        entry.packetId !== packet.id ||
        entry.packetRevision !== packet.revision ||
        entry.packetSha256 !== input.packetSha256 ||
        entry.evidenceId !== evidenceId
      )
        throw new Error("Source package does not match approved evidence");
      const source = object(entry.source),
        licence = object(entry.licence),
        manifest = object(entry.sourceManifest);
      for (const value of [source, licence, manifest]) {
        const dependency = baseline.loaded.manifest.dependencies.find(
          (row) => row.id === value.id,
        );
        if (!dependency) throw new Error("Source package is not admitted");
        const metadata = object(
          JSON.parse(
            await readFile(await containedPath(root, dependency.path), "utf8"),
          ),
        );
        if (!same(metadata, value))
          throw new Error("Package differs from admitted metadata");
      }
      const provenance = object(entry.provenance);
      const originalEvidence = records(packet.evidence).find(
        (row) => row.id === evidenceId,
      );
      if (!originalEvidence) throw new Error("Missing packet evidence");
      for (const key of [
        "locator",
        "originalValue",
        "sourceRecord",
        "rights",
        "capture",
      ]) {
        if (!same(provenance[key], originalEvidence[key]))
          throw new Error(`Altered source provenance: ${key}`);
      }
      if (
        provenance.originalRelease !== originalEvidence.release ||
        provenance.originalSourceId !== originalEvidence.sourceId
      )
        throw new Error("Altered original source identity");
      const expectedKey = {
        recordId: originalEvidence.sourceRecord,
        source: {
          sourceId: source.id,
          sourceManifestId: manifest.id,
          sourceReleaseId: object(manifest.release).identifier,
        },
      };
      if (!same(entry.sourceRecordKey, expectedKey))
        throw new Error("Altered source record key");
      const capture = object(provenance.capture);
      if (capture.kind !== "reference-only") {
        const captured = await readFile(
          await containedPath(root, field(capture, "path")),
        );
        if (digest(captured) !== capture.sha256)
          throw new Error("Changed source capture");
        pinnedPackages.push({
          path: field(capture, "path"),
          sha256: digest(captured),
        });
      }
      const id = mintStableId(transactionId, "evidence-references", evidenceId);
      evidenceIds.push(id);
      append("evidence-references", {
        id,
        sourceRecordKey: entry.sourceRecordKey,
        locator: provenance.locator,
        normalization: {
          originalValue: provenance.originalValue,
          method:
            "Exact approved proposal; original source release and conditions retained in the content review admission snapshot.",
        },
        rights: {
          licenceId: licence.id,
          decision:
            licence.commercialUse === "forbidden"
              ? "ineligible"
              : "pending-review",
          reason: "Content admission does not grant commercial rights.",
          reviewId: rightsReview.id,
        },
      });
    }
    const existingRightsReview = original
      .get("reviews")
      ?.find((review) => review.id === rightsReview.id);
    if (existingRightsReview) {
      if (!same(existingRightsReview, rightsReview))
        throw new Error(
          "Existing rights review differs from the supplied decision",
        );
    } else {
      append("reviews", rightsReview);
    }
    const assertion = {
      id: mintStableId(transactionId, "assertions", field(claim, "id")),
      subject,
      predicate,
      value: claim.value,
      contextId: field(input, "contextId"),
      evidenceReferenceIds: evidenceIds,
      reviewId: contentReview.id,
    };
    append("assertions", assertion);
    append("reviews", {
      ...contentReview,
      supplementalAdmission: {
        transactionId,
        records: [...snapshots],
        packetPath,
        packetSha256: input.packetSha256,
        claim,
        scope: records(packet.scopes).find((row) => row.id === scopeId),
        sourcePackages: pinnedPackages,
        assertion,
        rightsReview,
      },
    });
    return await runDecisionTransaction({
      directory: dataset,
      collections,
      original,
      descriptors,
      fingerprint: (stage) => authoringFingerprint(stage, descriptors),
      validateStage: async (stage) => {
        const result = await validateGrowWfoDataset({
          repositoryRoot: root,
          datasetDirectory: stage,
        });
        if (!result.valid)
          throw new Error(result.issues.map((row) => row.message).join("; "));
      },
      beforePublish: async () => {
        if (
          (await authoringFingerprint(dataset, descriptors)) !== before ||
          digest(await readFile(await containedPath(root, inputPath))) !==
            digest(inputBytes) ||
          digest(await readFile(await containedPath(root, packetPath))) !==
            input.packetSha256
        )
          throw new Error("Inputs changed during admission");
        for (const pin of pinnedPackages)
          if (
            digest(await readFile(await containedPath(root, pin.path))) !==
            pin.sha256
          )
            throw new Error("Source evidence changed during admission");
        const final = await validateGrowWfoDataset({
          repositoryRoot: root,
          datasetDirectory: dataset,
        });
        if (!final.valid)
          throw new Error("Source metadata changed during admission");
      },
    });
  } finally {
    await unlock();
  }
}

if (process.argv[1] === import.meta.filename) {
  try {
    const path = process.argv[2];
    if (!path) throw new Error("Supply an explicit reviewed admission input");
    console.log(
      JSON.stringify(
        await admitSupplementalAssertion(dataRoot(process.cwd()), path),
      ),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
