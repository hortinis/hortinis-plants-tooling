import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { dataRoot } from "../repository-paths.js";
import {
  assertSchema,
  containedPath,
  digest,
  field,
  object,
  readObject,
  records,
  same,
  strings,
  uniqueBy,
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
  validateGrowWfoDataset,
  type LoadedCurationDataset,
} from "./grow-wfo-validation.js";
import {
  buildSubjectRegistry,
  checkSubjectRegistry,
} from "./subject-registry.js";
import { integrationDirectory } from "./subject-match-validation.js";
import { parseJsonStrict } from "../serialization/canonical-json.js";
import { validate } from "../schema/validation-api.js";

const proposalPath = integrationDirectory + "/canonical-subject-proposal.json";
const datasetPath = "data/curation/grow-wfo-initial";
const admissionScope = "canonical-subjects";
const subjectCollections = new Map([
  ["generic", "plant-concepts"],
  ["growing-type", "plant-concepts"],
  ["cultivar-group", "cultivar-groups"],
  ["cultivar", "cultivars"],
]);
type Registry = Awaited<ReturnType<typeof buildSubjectRegistry>>;

export async function prepareCanonicalSubjectAdmission(
  root: string,
  registry: Registry,
  loaded: LoadedCurationDataset,
) {
  const bytes = await readFile(await containedPath(root, proposalPath));
  const proposalSha256 = digest(bytes);
  const proposal = object(parseJsonStrict(bytes));
  if (
    proposal.scope !== admissionScope ||
    proposal.rightsDisposition !== "pending-or-ineligible" ||
    proposal.subjectApprovalSha256 !== registry.approvalSha256 ||
    proposal.subjectMatchesSha256 !== registry.proposalSha256
  )
    throw new Error("Canonical subject proposal has stale relationship pins");

  const preparation = await readObject(
    await containedPath(root, integrationDirectory + "/preparation.json"),
  );
  const prepared = uniqueBy(records(preparation.mappings), (row) =>
    field(row, "id"),
  );
  const currentPackets = new Map(
    [...prepared.values()].map((row) => [field(row, "packetId"), row]),
  );
  const dependencyById = new Map(
    loaded.manifest.dependencies.map((row) => [row.id, row]),
  );
  async function dependency(id: string, role: string) {
    const pin = dependencyById.get(id);
    if (!pin || pin.role !== role)
      throw new Error("Missing catalog " + role + " dependency: " + id);
    const bytes = await readFile(await containedPath(root, pin.path));
    if (digest(bytes) !== pin.sha256)
      throw new Error("Changed catalog dependency: " + pin.path);
    return object(parseJsonStrict(bytes));
  }

  const pins = uniqueBy(records(proposal.evidence), (row) => field(row, "id"));
  const rightsReviewId = mintStableId(
    "canonical-subject-admission",
    "reviews",
    proposalSha256,
  );
  const evidence = new Map<string, RecordValue>();
  const packets = new Map<string, RecordValue[]>();
  for (const [id, pin] of pins) {
    const packetId = field(pin, "packetId");
    const current = currentPackets.get(packetId);
    if (
      !current ||
      current.packetRevision !== pin.packetRevision ||
      current.packetSha256 !== pin.packetSha256
    )
      throw new Error("Stale canonical subject evidence packet: " + packetId);
    let packetEvidence = packets.get(packetId);
    if (!packetEvidence) {
      const path =
        "data/curation/plant-review-packets/" +
        packetId +
        "/r" +
        String(pin.packetRevision) +
        "/packet.json";
      const bytes = await readFile(await containedPath(root, path));
      if (digest(bytes) !== pin.packetSha256)
        throw new Error(
          "Changed canonical subject evidence packet: " + packetId,
        );
      packetEvidence = records(object(parseJsonStrict(bytes)).evidence);
      packets.set(packetId, packetEvidence);
    }
    const item = packetEvidence.find((row) => row.id === pin.evidenceId);
    if (!item) throw new Error("Missing pinned subject evidence: " + id);
    const capture = object(item.capture);
    if (capture.kind !== "reference-only") {
      const path = await containedPath(root, field(capture, "path"));
      if (digest(await readFile(path)) !== capture.sha256)
        throw new Error("Changed canonical subject evidence capture: " + path);
    }
    if (pin.use === "review-only") continue;
    if (pin.use !== "catalog")
      throw new Error("Unknown canonical subject evidence use: " + id);

    const manifestId = field(pin, "sourceManifestId");
    const licenceId = field(pin, "licenceId");
    const manifest = await dependency(manifestId, "source-manifest");
    const licence = await dependency(licenceId, "licence");
    const sourceReleaseId = field(object(manifest.release), "identifier");
    // Supplemental manifests identify the capture; the packet separately
    // retains the publisher's original release, licence and review state.
    const sourceId = field(pin, "sourceId");
    const source = await dependency(sourceId, "source");
    const sourceRecordKey = {
      recordId: field(item, "sourceRecord"),
      source: { sourceId, sourceManifestId: manifestId, sourceReleaseId },
    };
    if (sourceReleaseId !== item.release || sourceId !== item.sourceId) {
      const prefix =
        "data/sources/supplemental/" +
        mintStableId(
          "plant-integration-preparation",
          "source-admissions",
          packetId + ":" + field(pin, "evidenceId"),
        );
      const saved = await readObject(
        await containedPath(root, prefix + "/provenance.json"),
      );
      const provenance = object(saved.provenance);
      if (
        saved.packetId !== packetId ||
        saved.packetSha256 !== pin.packetSha256 ||
        saved.packetRevision !== pin.packetRevision ||
        saved.evidenceId !== item.id ||
        !same(saved.sourceRecordKey, sourceRecordKey) ||
        !same(saved.source, source) ||
        !same(saved.licence, licence) ||
        !same(saved.sourceManifest, manifest) ||
        provenance.originalRelease !== item.release ||
        provenance.originalSourceId !== item.sourceId ||
        ["sourceRecord", "locator", "originalValue", "rights", "capture"].some(
          (key) => !same(provenance[key], item[key]),
        )
      )
        throw new Error(
          "Supplemental identity evidence differs from packet: " + id,
        );
    } else {
      const sourcePin = dependencyById.get(sourceId)!;
      const manifestPin = dependencyById.get(manifestId)!;
      const licencePin = dependencyById.get(licenceId)!;
      if (
        manifestPin.path !==
          sourcePin.path.replace(/source\.json$/, "source-manifest.json") ||
        licencePin.path !==
          sourcePin.path.replace(/source\.json$/, "licence.json")
      )
        throw new Error(
          "Core identity evidence dependencies do not match: " + id,
        );
    }
    evidence.set(id, {
      id,
      sourceRecordKey,
      locator: field(item, "locator"),
      normalization: { originalValue: item.originalValue },
      rights: {
        licenceId,
        decision:
          licence.commercialUse === "forbidden" ||
          object(item.rights).commercialUseAllowed === false
            ? "ineligible"
            : "pending-review",
        reason: "Catalog subject admission does not clear commercial rights.",
        reviewId: rightsReviewId,
      },
    });
  }

  const subjects = records(proposal.subjects);
  const groups = new Map(
    registry.equivalenceGroups.map((row) => [row.id, row]),
  );
  const targets = uniqueBy(
    subjects.map((row) => object(row.record)),
    (row) => field(row, "id"),
  );
  const mappings: RecordValue[] = [];
  const entries = [];
  const seenGroups = new Set<string>();
  for (const subject of subjects) {
    const record = object(subject.record);
    const id = field(record, "id");
    const kind = field(subject, "kind");
    const collection = subjectCollections.get(kind);
    if (!collection || record.status !== "active")
      throw new Error("Invalid proposed subject kind or status: " + id);
    if (collection === "plant-concepts" && kind !== record.kind)
      throw new Error("Proposed plant concept kind differs: " + id);
    field(subject, "scientificName");
    field(subject, "rationale");
    if (
      strings(record.evidenceReferenceIds).some((key) => !evidence.has(key)) ||
      strings(subject.reviewEvidenceIds).some(
        (key) => pins.get(key)?.use !== "review-only",
      )
    )
      throw new Error(
        "Invalid evidence references for proposed subject: " + id,
      );

    const groupId = subject.reviewSubjectId;
    if (typeof groupId === "string") {
      const group = groups.get(groupId);
      if (!group || seenGroups.has(groupId) || group.existingCatalogSubjectId)
        throw new Error(
          "Unknown, duplicate, or already mapped group: " + groupId,
        );
      seenGroups.add(groupId);
      for (const mappingId of group.mappingIds) {
        const scope = prepared.get(mappingId)!;
        if ((scope.declaredKind === "cultivar") !== (kind === "cultivar"))
          throw new Error(
            "Cultivar scope kind differs from proposed identity: " + id,
          );
        mappings.push({
          mappingId,
          reviewSubjectId: groupId,
          packetId: scope.packetId,
          packetRevision: scope.packetRevision,
          packetSha256: scope.packetSha256,
          scopeId: scope.scopeId,
          subject: {
            type: collection === "plant-concepts" ? "plant-concept" : kind,
            id,
          },
        });
      }
    } else if (groupId !== null || kind !== "generic") {
      throw new Error(
        "Only an explicit supporting generic parent may lack a group: " + id,
      );
    }
    const parentId = record.parentPlantConceptId ?? record.plantConceptId;
    if (
      typeof parentId === "string" &&
      targets.get(parentId)?.kind !== "generic"
    )
      throw new Error(
        "Canonical proposal requires an explicit generic parent record: " + id,
      );
    entries.push({ collection, value: record });
    if (kind === "generic" || kind === "growing-type") {
      entries.push({
        collection: "localized-names",
        value: {
          id: mintStableId(
            "canonical-subject-admission",
            "localized-names",
            id + ":en",
          ),
          subject: { type: "plant-concept", id },
          languageTag: "en",
          value: field(subject, "label"),
          kind: "common",
          preferred: true,
          evidenceReferenceIds: record.evidenceReferenceIds,
        },
      });
    }
  }
  if (seenGroups.size !== groups.size)
    throw new Error(
      "Canonical proposal does not account for all resolved groups",
    );

  const snapshots = [
    ...entries,
    ...[...evidence.values()].map((value) => ({
      collection: "evidence-references",
      value,
    })),
  ];
  for (const { collection, value } of snapshots) {
    const descriptor = loaded.manifest.collections.find(
      (row) => row.role === collection,
    );
    if (!descriptor)
      throw new Error("Undeclared admission collection: " + collection);
    assertSchema({ validate }, descriptor.schemaId, value);
  }
  const review = loaded.dataset.reviews.find((row) => {
    const receipt = row.canonicalSubjectAdmission;
    return (
      row.status === "accepted" &&
      typeof receipt === "object" &&
      receipt !== null &&
      object(receipt).proposalSha256 === proposalSha256 &&
      same(object(receipt).mappings, mappings) &&
      same(
        records(object(receipt).records).filter(
          (entry) => entry.collection !== "reviews",
        ),
        snapshots,
      ) &&
      records(object(receipt).records).some(
        (entry) =>
          entry.collection === "reviews" &&
          object(entry.value).id === rightsReviewId,
      )
    );
  });
  return {
    proposalSha256,
    proposal,
    status: review ? "validated" : "in progress",
    admissionReviewId: review ? field(review, "id") : null,
    subjects,
    mappings,
    snapshots,
    rightsReviewId,
  };
}

export async function admitCanonicalSubjects(root: string, inputPath: string) {
  const input = await containedPath(root, inputPath);
  const bytes = await readFile(input);
  const approval = object(parseJsonStrict(bytes));
  assertSchema({ validate }, "urn:hortinis:plants:schema:v1:review", approval);
  if (
    approval.scope !== admissionScope ||
    approval.purpose !== "content" ||
    approval.status !== "accepted"
  )
    throw new Error(
      "A separate accepted canonical subject admission review is required",
    );
  field(approval, "quote");
  field(approval, "sourceChatId");
  const directory = await containedPath(root, datasetPath);
  const unlock = await acquireDatasetLock(directory);
  try {
    const registry = await buildSubjectRegistry(root);
    await checkSubjectRegistry(root, registry);
    const baseline = await validateGrowWfoDataset({
      repositoryRoot: root,
      datasetDirectory: directory,
    });
    if (!baseline.valid || !baseline.loaded)
      throw new Error("Invalid current catalog dataset");
    const loaded = baseline.loaded;
    const plan = await prepareCanonicalSubjectAdmission(root, registry, loaded);
    if (approval.proposalSha256 !== plan.proposalSha256)
      throw new Error(
        "Approval must pin the exact canonical subject proposal bytes",
      );
    if (plan.admissionReviewId)
      throw new Error("Canonical subject proposal is already admitted");
    const { collections: descriptors } = baseline.loaded.manifest;
    const before = field(approval, "baseDatasetSha256");
    if ((await authoringFingerprint(directory, descriptors)) !== before)
      throw new Error("Stale authoring fingerprint");
    const original = await readCollections(directory, descriptors);
    const collections = new Map(
      [...original].map(([role, rows]) => [role, [...rows]]),
    );
    // Evidence references require an accepted administrative rights record.
    // The exact proposal authorizes only retaining pending or ineligible rights.
    const snapshots = [
      ...plan.snapshots,
      {
        collection: "reviews",
        value: {
          id: plan.rightsReviewId,
          purpose: "rights",
          status: "accepted",
          reviewerId: field(approval, "reviewerId"),
          reviewedAt: field(approval, "reviewedAt"),
          notes:
            "Administrative decision to retain pending or ineligible rights; no commercial clearance.",
        },
      },
    ];
    for (const { collection, value } of [
      ...snapshots,
      {
        collection: "reviews",
        value: {
          ...approval,
          canonicalSubjectAdmission: {
            proposalSha256: plan.proposalSha256,
            proposal: plan.proposal,
            mappings: plan.mappings,
            records: snapshots,
          },
        },
      },
    ]) {
      const rows = collections.get(collection)!;
      if (rows.some((row) => row.id === value.id))
        throw new Error("Existing record or replay: " + field(value, "id"));
      rows.push(value);
    }
    return await runDecisionTransaction({
      directory,
      descriptors,
      original,
      collections,
      fingerprint: (path) => authoringFingerprint(path, descriptors),
      validateStage: async (path) => {
        const result = await validateGrowWfoDataset({
          repositoryRoot: root,
          datasetDirectory: path,
        });
        if (!result.valid)
          throw new Error(
            result.issues.map((issue) => issue.message).join("\n"),
          );
      },
      beforePublish: async () => {
        const currentRegistry = await buildSubjectRegistry(root);
        await checkSubjectRegistry(root, currentRegistry);
        const currentPlan = await prepareCanonicalSubjectAdmission(
          root,
          currentRegistry,
          loaded,
        );
        if (
          (await authoringFingerprint(directory, descriptors)) !== before ||
          digest(await readFile(input)) !== digest(bytes) ||
          !same(currentPlan, plan)
        )
          throw new Error("Inputs changed during canonical subject admission");
      },
    });
  } finally {
    await unlock();
  }
}

if (process.argv[1] === import.meta.filename) {
  try {
    const [arg, ...extra] = process.argv
      .slice(2)
      .filter((value) => value !== "--");
    if (arg === "--check" && extra.length === 0) {
      const root = dataRoot(process.cwd());
      const registry = await buildSubjectRegistry(root);
      await checkSubjectRegistry(root, registry);
      const baseline = await validateGrowWfoDataset({
        repositoryRoot: root,
        datasetDirectory: resolve(root, datasetPath),
      });
      if (!baseline.valid || !baseline.loaded)
        throw new Error("Invalid current catalog dataset");
      const plan = await prepareCanonicalSubjectAdmission(
        root,
        registry,
        baseline.loaded,
      );
      console.log(
        JSON.stringify({
          status: plan.status,
          proposalSha256: plan.proposalSha256,
          baseDatasetSha256: await authoringFingerprint(
            resolve(root, datasetPath),
            baseline.loaded.manifest.collections,
          ),
          resolvedSubjectCount: registry.equivalenceGroups.length,
          qualifiedScopeCount: plan.mappings.length,
        }),
      );
    } else if (arg && extra.length === 0) {
      console.log(
        JSON.stringify(
          await admitCanonicalSubjects(dataRoot(process.cwd()), arg),
        ),
      );
    } else {
      throw new Error(
        "Use --check or supply a separate canonical subject admission approval",
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
