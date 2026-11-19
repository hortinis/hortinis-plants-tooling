import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { dataRoot } from "../repository-paths.js";
import { parseJsonStrict } from "../serialization/canonical-json.js";
import { projectCultivationRules } from "../domain/cultivation-rule-projection.js";
import {
  digest,
  field,
  object,
  readObject,
  records,
  same,
  type RecordValue,
} from "./curation-artifacts.js";
import {
  acquireDatasetLock,
  authoringFingerprint,
  readCollections,
  runDecisionTransaction,
} from "./decision-transaction.js";
import { mintStableId } from "./grow-wfo-apply.js";
import {
  catalogPath,
  integrationPath,
  licensingAcceptancePath,
  readLicensingAcceptance,
  validateAuthoring,
} from "./reviewed-licensing-acceptance.js";
import {
  prepareSaintEtienneCalendar,
  saintEtienneSourcePrefix,
} from "./saint-etienne-calendar.js";

const schema = "urn:hortinis:plants:schema:v1:";
const mint = (role: string, key: string) =>
  mintStableId("saint-etienne-home-garden-calendar", role, key);

const approvalPath = integrationPath + "/saint-etienne/approval.json";
const stepOnePath = integrationPath + "/reviewed-plant-step-1-approval.json";
const batchPath = integrationPath + "/saint-etienne/batch.json";

async function pinnedRecord(root: string, path: string) {
  const bytes = await readFile(resolve(root, path));
  return { value: object(parseJsonStrict(bytes)), path, sha256: digest(bytes) };
}

async function prepareAdmission(
  root: string,
  reviews: readonly RecordValue[],
  subjects: readonly RecordValue[],
) {
  const plan = await prepareSaintEtienneCalendar(root);
  const approval = await pinnedRecord(root, approvalPath);
  const licensing = await pinnedRecord(root, licensingAcceptancePath);
  const stepOne = await pinnedRecord(root, stepOnePath);
  const content = approval.value;
  assert.equal(content.purpose, "content");
  assert.equal(content.status, "accepted");
  assert.equal(content.scope, "saint-etienne-calendar-proposal");
  assert.equal(content.batchSha256, plan.batchSha256);
  assert.equal(content.revision, plan.revision);
  assert.equal(content.approvedGeographicContextId, plan.geography.record.id);
  assert.deepEqual(
    content.approvedCultivationContextIds,
    plan.contexts.map((row) => object(row).id),
  );
  assert.deepEqual(
    content.approvedWindowIds,
    plan.windows.map((row) => row.id),
  );
  assert.deepEqual(
    content.approvedSubjects,
    plan.identities.map(({ record }) => ({
      id: record.id,
      ...(record.parentPlantConceptId
        ? { parent: record.parentPlantConceptId }
        : {}),
    })),
  );
  assert.deepEqual(
    content.approvedScopeMappingIds,
    [
      ...plan.identities.map((row) => row.mapping),
      ...plan.proposedBindings,
    ].map((row) => row.mappingId),
  );
  const recordedLicensing = reviews.find(
    (row) => row.id === licensing.value.id,
  );
  assert.ok(recordedLicensing && same(recordedLicensing, licensing.value));
  assert.ok(same(await readLicensingAcceptance(root), licensing.value));

  const stepOneReview = reviews.find((row) => row.id === stepOne.value.id);
  assert.ok(stepOneReview, "Missing step 1 admission");
  const { reviewedPlantAdmission, ...stepOneDecision } = stepOneReview;
  assert.ok(same(stepOneDecision, stepOne.value), "Changed step 1 approval");
  const stepOneMappings = records(object(reviewedPlantAdmission).mappings);
  const canonicalApprovals = reviews.filter(
    (row) => row.status === "accepted" && row.scope === "canonical-subjects",
  );
  const canonicalMappings = canonicalApprovals.flatMap((review) =>
    records(object(review.canonicalSubjectAdmission).mappings).map(
      (mapping) => ({ mapping, reviewId: review.id }),
    ),
  );
  const snapshots: { collection: string; value: RecordValue }[] = [];
  const add = (collection: string, value: RecordValue) =>
    snapshots.push({ collection, value });
  const dependencies = new Map<string, RecordValue>();
  const metadata = async (role: string, key: string) => {
    const pin = await pinnedRecord(
      root,
      `${saintEtienneSourcePrefix}${role}-${key}.json`,
    );
    const id = field(pin.value, "id");
    assert.equal(
      id,
      mint(role === "source-manifest" ? "source-manifests" : role + "s", key),
    );
    dependencies.set(id, {
      role,
      id,
      path: pin.path,
      sha256: pin.sha256,
      schemaId: schema + role,
      format: "json",
      authority: "tracked-source-metadata",
    });
    return pin.value;
  };

  for (const [key, { id, source }] of Object.entries(plan.evidence)) {
    const entry = object(source);
    const climate = key === "la-puriniere" || key === "boutheon";
    const provider = climate
      ? "meteo-france"
      : key === "commune"
        ? "insee"
        : "rhs";
    const licenceKey = climate
      ? "meteo-climate-sheet"
      : key === "commune"
        ? "insee-cog"
        : "rhs";
    const releaseKey = provider === "rhs" ? "rhs" : key;
    const [publisher, licence, manifest] = await Promise.all([
      metadata("source", provider),
      metadata("licence", licenceKey),
      metadata("source-manifest", releaseKey),
    ]);
    assert.equal(publisher.name, entry.source);
    assert.deepEqual(manifest.provider, publisher);
    assert.equal(object(manifest.release).identifier, entry.release);
    const resource = records(manifest.resources)[0]!;
    assert.equal(resource.locator, batchPath);
    assert.equal(object(resource.checksum).value, plan.batchSha256);
    assert.equal(licence.commercialUse, "unknown");
    assert.equal(
      records(manifest.profileEligibility).find(
        (row) => row.profile === "commercial",
      )?.decision,
      "pending-review",
    );
    add("evidence-references", {
      id,
      sourceId: publisher.id,
      sourceManifestId: manifest.id,
      sourceReleaseId: entry.release,
      sourceRecordId: entry.record,
      locator: `${field(entry, "url")} · ${field(entry, "locator")}`,
      normalization: {
        originalValue: entry,
        method:
          "Batch-pinned review observations; publisher source is reference-only.",
      },
      rights: {
        licenceId: licence.id,
        reviewId: licensing.value.id,
        decision: "pending-review",
        reason: field(object(entry.rights), "notes"),
      },
    });
  }

  add("geographic-contexts", {
    ...plan.geography.record,
    administrativeCode: {
      scheme: "INSEE-COG-commune",
      code: plan.geography.communeCode,
    },
    coverage: plan.geography.coverage,
    limitations: plan.geography.limitations,
  });
  for (const context of plan.contexts)
    add("cultivation-contexts", object(context));

  const lineage = plan.windows.map((window) => {
    const subject = subjects.find(
      (row) => row.id === window.preview.subject.id,
    );
    assert.ok(subject?.status === "active", "Missing approved active subject");
    const mappings = window.mappings.map((mapping) => {
      const matches = (row: RecordValue) =>
        row.packetId === mapping.packetId &&
        row.packetRevision === mapping.packetRevision &&
        row.packetSha256 === mapping.packetSha256 &&
        row.scopeId === mapping.scopeId &&
        same(row.subject, mapping.subject);
      const canonical = canonicalMappings.filter(
        ({ mapping: row }) =>
          matches(row) && row.mappingId === mapping.mappingId,
      );
      const general = stepOneMappings.filter((row) => {
        if (!matches(row) || !row.priorApproval) return false;
        const prior = object(row.priorApproval);
        return (
          prior.mappingId === mapping.mappingId &&
          prior.reviewId === content.id &&
          prior.batchSha256 === plan.batchSha256 &&
          same(prior.subject, mapping.subject)
        );
      });
      assert.equal(
        canonical.length + general.length,
        1,
        `Missing or ambiguous admitted mapping ${mapping.mappingId}`,
      );
      const live = canonical[0];
      return {
        approvedMappingId: mapping.mappingId,
        admittedMappingId: live ? live.mapping.mappingId : general[0]!.id,
        admissionReviewId: live?.reviewId ?? stepOne.value.id,
        packetId: mapping.packetId,
        packetRevision: mapping.packetRevision,
        packetSha256: mapping.packetSha256,
        scopeId: mapping.scopeId,
        subject: mapping.subject,
      };
    });
    const id = mint("assertions", window.id);
    add("assertions", {
      id,
      subject: window.preview.subject,
      predicate: "cultivation_window",
      contextId: window.preview.contextId,
      evidenceReferenceIds: window.evidence.map(
        (key) => plan.evidence[key]!.id,
      ),
      reviewId: content.id,
      value: {
        action: window.action,
        mappingMethod: "local-inference",
        proposalId: window.id,
        method: window.method,
        timing: window.timing,
      },
    });
    return {
      proposalId: window.id,
      assertionId: id,
      mappings,
      comparisonOnly: window.originals.map((original) => ({
        packetPath: original.packetPath,
        claimId: original.claimId,
        geography: original.conditions.geography,
        sourceAction: original.conversion.sourceAction,
        originalWindow: original.value,
        evidence: original.evidence,
      })),
    };
  });
  const reference = ({ path, sha256 }: { path: string; sha256: string }) => ({
    path,
    sha256,
  });
  const review = {
    ...content,
    id: field(content, "id"),
    reviewedAt: `${field(content, "reviewedAt")}T00:00:00Z`,
    calendarAdmission: {
      approval: reference(approval),
      licensingAcceptance: { id: licensing.value.id, ...reference(licensing) },
      identityApproval: reference(stepOne),
      batch: { path: batchPath, sha256: plan.batchSha256 },
      records: snapshots,
      lineage,
    },
  };
  return {
    review,
    snapshots,
    dependencies: [...dependencies.values()].sort((a, b) =>
      field(a, "id").localeCompare(field(b, "id")),
    ),
  };
}

export async function admitSaintEtienneCalendar(root: string) {
  const directory = resolve(root, catalogPath);
  const unlock = await acquireDatasetLock(directory);
  try {
    const { manifest, dataset } = await validateAuthoring(root, directory);
    const descriptors = manifest.collections;
    const before = await authoringFingerprint(directory, descriptors);
    const original = await readCollections(directory, descriptors);
    const plan = await prepareAdmission(
      root,
      dataset.reviews,
      dataset.plantConcepts,
    );
    const prior = dataset.reviews.find(
      (review) => review.id === plan.review.id,
    );
    const manifestRecord = await readObject(
      resolve(directory, "dataset-manifest.json"),
    );
    const dependencies = records(manifestRecord.dependencies);
    for (const dependency of plan.dependencies) {
      const match = dependencies.find(
        (row) => row.id === dependency.id || row.path === dependency.path,
      );
      if (match)
        assert.ok(same(match, dependency), "Conflicting source dependency");
      else dependencies.push(dependency);
    }
    if (prior) {
      assert.ok(
        same(prior, plan.review),
        "Conflicting Saint-Étienne admission",
      );
      assert.equal(dependencies.length, manifest.dependencies.length);
      return { datasetSha256: before, alreadyAdmitted: true };
    }
    const collections = new Map(
      [...original].map(([role, rows]) => [role, [...rows]]),
    );
    for (const { collection, value } of [
      ...plan.snapshots,
      { collection: "reviews", value: plan.review },
    ]) {
      const rows = collections.get(collection)!;
      assert.ok(
        !rows.some((row) => row.id === value.id),
        `Record already exists: ${String(value.id)}`,
      );
      rows.push(value);
    }
    const result = await runDecisionTransaction({
      directory,
      descriptors,
      original,
      collections,
      manifest: { ...manifestRecord, dependencies },
      fingerprint: (path) => authoringFingerprint(path, descriptors),
      validateStage: async (path) => {
        const staged = (await validateAuthoring(root, path)).dataset;
        const ids = new Set(
          plan.snapshots
            .filter((row) => row.collection === "assertions")
            .map((row) => row.value.id),
        );
        assert.equal(
          projectCultivationRules(staged, "authoring").filter((row) =>
            ids.has(row.id),
          ).length,
          ids.size,
        );
        assert.ok(
          !projectCultivationRules(staged, "commercial").some((row) =>
            ids.has(row.id),
          ),
        );
      },
      beforePublish: async () => {
        const current = await prepareAdmission(
          root,
          dataset.reviews,
          dataset.plantConcepts,
        );
        assert.ok(
          same(plan, current),
          "Saint-Étienne inputs changed during admission",
        );
        assert.equal(
          await authoringFingerprint(directory, descriptors),
          before,
          "Authoring catalog changed during admission",
        );
      },
    });
    return { ...result, alreadyAdmitted: false };
  } finally {
    await unlock();
  }
}

if (process.argv[1] === import.meta.filename) {
  try {
    const args = process.argv.slice(2).filter((arg) => arg !== "--");
    if (args.length !== 1 || args[0] !== "--apply")
      throw new Error(
        "Use --apply to admit the approved Saint-Étienne calendar",
      );
    console.log(await admitSaintEtienneCalendar(dataRoot(process.cwd())));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
