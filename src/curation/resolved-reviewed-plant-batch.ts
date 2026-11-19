import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { parseJsonStrict } from "../serialization/canonical-json.js";
import { consolidatePlantReviews } from "./plant-review-consolidation.js";
import { projectCultivationRules } from "../domain/cultivation-rule-projection.js";
import { projectPlantFacts } from "../domain/plant-fact-projection.js";
import {
  resolveBordeauxWindow,
  bordeauxWorkbook,
} from "./reviewed-bordeaux-window.js";
import { readCalendar } from "../adapters/grow/read-calendar.js";
import { readPlantCsv } from "../adapters/grow/read-plant-csv.js";
import { projectRotationClassifications } from "../domain/rotation-classification-projection.js";
import { projectPollinationGuidance } from "../domain/pollination-guidance-projection.js";
import { projectNutritionGuidance } from "../domain/nutrition-guidance-projection.js";
import { projectCareGuidance } from "../domain/care-guidance-projection.js";
import { projectHarvestGuidance } from "../domain/harvest-guidance-projection.js";
import { projectWateringGuidance } from "../domain/watering-guidance-projection.js";
import { projectEstablishmentGuidance } from "../domain/establishment-guidance-projection.js";
import { projectTemperatureGuidance } from "../domain/temperature-guidance-projection.js";
import { projectSiteFacts } from "../domain/site-fact-projection.js";
import { validate } from "../schema/validation-api.js";
import {
  assertSchema,
  containedPath,
  contentDigest,
  digest,
  field,
  object,
  records,
  same,
  strings,
  type RecordValue,
} from "./curation-artifacts.js";
import {
  acquireDatasetLock,
  authoringFingerprint,
  readCollections,
  runDecisionTransaction,
  stageDataset,
} from "./decision-transaction.js";
import {
  catalogPath,
  integrationPath,
  readLicensingAcceptance,
  validateAuthoring,
} from "./reviewed-licensing-acceptance.js";

const siteGroups = [
  "site-soil-and-light-bundles",
  "unmapped-soil-classes",
  "sun-alternatives",
  "plain-drainage",
  "ph-plus-site-guidance",
  "singleton-sun",
];

const harvestGroups = [
  "harvest-stage-and-method",
  "storage-and-curing",
  "harvest-anchors-and-intervals",
  "nested-sowing-harvest-duration",
];

export const wateringGroups = [
  "water-stage-and-conditions",
  "water-amount-and-period",
  "water-interval-without-amount",
];

export const establishmentGroups = [
  "planting-timing-and-preparation",
  "planting-dimensions-and-layout",
  "propagation-and-establishment",
  "planting-thermal-conditions",
  "germination-role-and-pairing",
  "action-specific-soil-threshold",
];

export const temperatureGroups = [
  "frost-stage-and-exposure",
  "growth-stage-and-temperature-role",
];

export const careGroups = [
  "other-care-practices",
  "pruning-and-training",
  "weed-management",
  "physical-support",
];

export const nutritionGroups = [
  "nutrition-requires-local-input",
  "conditional-feeding",
  "nutrient-product-and-dose",
];

const rotationField = "Cultivation group (Rotational information)";
const growSource = "source_grow_edible_plant_database";
const growDirectory = "data/sources/grow/releases/2020/";
const growCsv = growDirectory + "export/edible-plants.csv";

async function pinnedArtifact(root: string, path: string, expected: unknown) {
  const bytes = await readFile(await containedPath(root, path));
  if (digest(bytes) !== expected)
    throw new Error("Reviewed artifact changed: " + path);
  return object(parseJsonStrict(bytes));
}

export async function readReviewedDispositions(
  root: string,
  reviews: readonly RecordValue[],
) {
  const dispositions = new Map<string, RecordValue>();
  for (const review of [...reviews].sort((a, b) =>
    String(a.reviewedAt).localeCompare(String(b.reviewedAt)),
  )) {
    if (
      review.purpose !== "content" ||
      review.status !== "accepted" ||
      review.reviewedPlantAdmission === undefined
    )
      continue;
    const receipt = object(review.reviewedPlantAdmission);
    if (receipt.dispositions === undefined) continue;
    const resolution = await pinnedArtifact(
      root,
      field(review, "resolutionPath"),
      review.batchSha256,
    );
    const frozen = await pinnedArtifact(
      root,
      field(resolution, "frozenPath"),
      receipt.frozenSha256,
    );
    if (
      resolution.frozenSha256 !== receipt.frozenSha256 ||
      (receipt.scopeDispositions !== undefined &&
        (!same(resolution.scopeDispositions, receipt.scopeDispositions) ||
          !same(resolution.mappings, receipt.mappings) ||
          !same(resolution.records, receipt.records))) ||
      !same(resolution.decisions, receipt.dispositions)
    )
      throw new Error(
        "Reviewed dispositions differ from their pinned resolution",
      );
    const pins = new Map(
      records(frozen.claims).map((row) => [
        field(row, "key"),
        field(row, "packetSha256"),
      ]),
    );
    for (const row of records(receipt.dispositions)) {
      const key = field(row, "key");
      const pin = pins.get(key);
      const previous = dispositions.get(pin + ":" + key);
      if (!pin || (previous && previous.outcome !== "deferred"))
        throw new Error("Missing packet pin or duplicate disposition " + key);
      dispositions.set(pin + ":" + key, { ...row, reviewId: review.id });
    }
  }
  return dispositions;
}

function qualifiedGuidanceSubject(
  scopes: readonly RecordValue[],
  applicabilityScope: RecordValue,
) {
  const chain: RecordValue[] = [];
  let scope: RecordValue | undefined = applicabilityScope;
  while (scope && !chain.includes(scope)) {
    if (scope.outcome === "admitted") return { scope, chain };
    if (
      scope.declaredKind !== "growing-type" ||
      !["applicability", "unresolved", "unused"].includes(String(scope.outcome))
    )
      return;
    chain.push(scope);
    const parentScopeId: unknown = scope.parentScopeId;
    scope = scopes.find(
      (candidate) =>
        candidate.packetId === applicabilityScope.packetId &&
        candidate.packetSha256 === applicabilityScope.packetSha256 &&
        candidate.scopeId === parentScopeId,
    );
  }
}

export async function resolveReviewedPlantBatch(
  root: string,
  input: string,
  apply: boolean,
) {
  const directory = resolve(root, catalogPath);
  const approvalPath = await containedPath(root, input);
  const unlock = await acquireDatasetLock(directory);
  try {
    const read = async (path: string) => {
      const bytes = await readFile(path);
      return {
        sha256: digest(bytes),
        value: object(parseJsonStrict(bytes)),
      };
    };
    const { value: approval, sha256: approvalSha256 } =
      await read(approvalPath);
    assertSchema(
      { validate },
      "urn:hortinis:plants:schema:v1:review",
      approval,
    );
    if (
      approval.scope !== "reviewed-plant-batch" ||
      approval.purpose !== "content" ||
      approval.status !== "accepted" ||
      object(approval.decisionAuthority).kind !== "delegated-agent"
    )
      throw new Error("Exact delegated content approval required");
    const batchPath = await containedPath(
      root,
      field(approval, "resolutionPath"),
    );
    const { value: resolution, sha256: batchSha256 } = await read(batchPath);
    const frozenPath = await containedPath(
      root,
      field(resolution, "frozenPath"),
    );
    const frozen = await read(frozenPath);
    const currentPath = resolve(
      root,
      integrationPath,
      "reviewed-plant-batch.json",
    );
    const current = await read(currentPath);
    const { manifest } = await validateAuthoring(root, directory);
    const descriptors = manifest.collections;
    const fingerprint = (path: string) =>
      authoringFingerprint(path, descriptors);
    const baseDatasetSha256 = await fingerprint(directory);
    const remainder = frozen.value.batchKind === "reviewed-remainder";
    const calendarBatch = remainder && resolution.kind === "bordeaux-calendar";
    const harvestBatch = frozen.value.batchKind === "harvest-and-storage";
    const wateringBatch = frozen.value.batchKind === "watering-guidance";
    const establishmentBatch =
      frozen.value.batchKind === "planting-and-establishment";
    const temperatureBatch = frozen.value.batchKind === "temperature-guidance";
    const nutritionBatch = frozen.value.batchKind === "plant-nutrition";
    const pollinationBatch =
      frozen.value.batchKind === "pollination-and-companions";
    const careBatch = frozen.value.batchKind === "plant-care";
    const scopedGuidance =
      wateringBatch ||
      establishmentBatch ||
      temperatureBatch ||
      careBatch ||
      nutritionBatch ||
      pollinationBatch;
    const reviewedGuidance = harvestBatch || scopedGuidance;
    const requiresGrowPins =
      reviewedGuidance && !nutritionBatch && !pollinationBatch;
    const currentBatchPin =
      reviewedGuidance || remainder
        ? field(resolution, "currentBatchSha256")
        : frozen.value.batchSha256;
    const inventoryPin =
      reviewedGuidance || remainder
        ? field(resolution, "currentInventoryFingerprint")
        : frozen.value.inventoryFingerprint;
    if (
      approval.batchSha256 !== batchSha256 ||
      resolution.frozenSha256 !== frozen.sha256 ||
      approval.baseDatasetSha256 !== baseDatasetSha256 ||
      frozen.value.baseDatasetSha256 !== baseDatasetSha256 ||
      current.sha256 !== currentBatchPin
    )
      throw new Error(
        "Stale catalog, frozen batch or exact resolution approval",
      );
    const key = (row: RecordValue) =>
      field(row, "packetId") + ":" + field(object(row.claim), "id");
    const siteBatch = frozen.value.batchKind === "site-guidance";
    const rotationBatch = frozen.value.batchKind === "rotation-classification";
    const groups = pollinationBatch
      ? ["pollination-and-companions"]
      : siteBatch
        ? siteGroups
        : rotationBatch
          ? ["rotation-classification"]
          : harvestBatch
            ? harvestGroups
            : wateringBatch
              ? wateringGroups
              : establishmentBatch
                ? establishmentGroups
                : temperatureBatch
                  ? temperatureGroups
                  : careBatch
                    ? careGroups
                    : nutritionBatch
                      ? nutritionGroups
                      : ["taxon-name-subject-records", "existing-fact-shape"];
    const selectedKeys =
      remainder && frozen.value.selectedKeys !== undefined
        ? new Set(strings(frozen.value.selectedKeys))
        : undefined;
    const selectedGroups = new Set(
      remainder ? strings(frozen.value.groups) : groups,
    );
    const currentClaims = records(current.value.claims).filter(
      (row) =>
        row.outcome === "unresolved" &&
        (!selectedKeys || selectedKeys.has(key(row))) &&
        selectedGroups.has(String(row.assessmentGroup)),
    );
    if (
      (selectedKeys && selectedKeys.size !== currentClaims.length) ||
      !same(
        currentClaims.map((row) => ({ key: key(row), ...row })),
        frozen.value.claims,
      )
    )
      throw new Error("Frozen batch must contain the exact unresolved groups");
    const sourcePins = records(resolution.sourcePins);
    if (
      (rotationBatch || requiresGrowPins || calendarBatch) &&
      ![
        growCsv,
        ...(calendarBatch ? [bordeauxWorkbook] : []),
        growDirectory + "plant1.accdb",
        "data/sources/grow/source-manifest.json",
      ].every((path) => sourcePins.some((pin) => pin.path === path))
    )
      throw new Error("Resolution requires the original GROW source pins");
    const verifyPins = async () => {
      const inventory = await consolidatePlantReviews(root);
      if (
        inventory.checks.status !== "validated" ||
        inventory.inputFingerprint !== inventoryPin
      )
        throw new Error(
          "Current review inventory differs from the frozen batch",
        );
      const packetIds = new Set(currentClaims.map((row) => row.packetId));
      for (const pin of records(current.value.reviewedPackets).filter((row) =>
        packetIds.has(row.packetId),
      )) {
        const path = await containedPath(root, field(pin, "path"));
        if (digest(await readFile(path)) !== pin.sha256)
          throw new Error("Changed review packet " + path);
      }
      const captures = new Map<string, string>();
      for (const row of currentClaims) {
        for (const evidence of records(row.evidence)) {
          const capture = object(evidence.capture);
          if (typeof capture.path === "string")
            captures.set(capture.path, field(capture, "sha256"));
        }
      }
      for (const [path, hash] of captures)
        if (digest(await readFile(await containedPath(root, path))) !== hash)
          throw new Error("Changed evidence capture " + path);
      for (const pin of sourcePins) {
        const path = await containedPath(root, field(pin, "path"));
        const hash = createHash("sha256");
        for await (const chunk of createReadStream(path))
          hash.update(chunk as Buffer);
        if (hash.digest("hex") !== pin.sha256)
          throw new Error("Changed reviewed source " + field(pin, "path"));
      }
    };
    await verifyPins();
    const growPlants =
      rotationBatch || requiresGrowPins || calendarBatch
        ? await readPlantCsv(await containedPath(root, growCsv))
        : undefined;
    if (growPlants?.diagnostics.length)
      throw new Error("Pinned GROW source has invalid records");
    const sourceRows = new Map(
      growPlants?.plants.map((plant) => [plant.sourceRecordId, plant]),
    );
    const calendar = calendarBatch
      ? await readCalendar(await containedPath(root, bordeauxWorkbook))
      : undefined;
    const original = await readCollections(directory, descriptors);
    const collections = new Map(
      [...original].map(([role, rows]) => [role, [...rows]]),
    );
    const acceptance = await readLicensingAcceptance(root);
    if (!original.get("reviews")!.some((row) => same(row, acceptance)))
      throw new Error("Recorded licensing acceptance differs from authoring");
    const actual = new Map(currentClaims.map((row) => [key(row), row]));
    const decisions = records(resolution.decisions);
    const selectedByKey = new Map(actual);
    const currentByKey = new Map(
      records(current.value.claims).map((row) => [key(row), row]),
    );
    const decisionByKey = new Map(decisions.map((row) => [row.key, row]));
    const snapshots = records(resolution.records);
    const added = new Map<string, RecordValue>();
    const schemaByCollection = new Map(
      descriptors.map((row) => [row.role, row.schemaId]),
    );
    for (const snapshot of snapshots) {
      const collection = field(snapshot, "collection");
      const value = object(snapshot.value);
      const id = field(value, "id");
      const rows = collections.get(collection);
      if (
        !rows ||
        rows.some((row) => row.id === id) ||
        added.has(id) ||
        collection === "reviews" ||
        (reviewedGuidance &&
          ![
            "assertions",
            "evidence-references",
            "cultivation-contexts",
            "geographic-contexts",
          ].includes(collection))
      )
        throw new Error("Duplicate or unsupported resolved record " + id);
      assertSchema({ validate }, schemaByCollection.get(collection)!, value);
      added.set(id, snapshot);
      rows.push(value);
    }
    const scopes = records(current.value.scopes);
    const scopeDispositions = remainder
      ? records(resolution.scopeDispositions)
      : [];
    const scopeIds = new Set<string>();
    const scopeById = new Map(scopes.map((scope) => [scope.id, scope]));
    if (
      remainder &&
      !same(
        records(frozen.value.scopes),
        scopes.filter((scope) =>
          scopeDispositions.some((entry) => entry.id === scope.id),
        ),
      )
    )
      throw new Error("Changed pinned remainder scopes");
    for (const entry of scopeDispositions) {
      const id = field(entry, "id");
      const scope = scopeById.get(id);
      const parent = scopes.find(
        (row) =>
          row.packetId === scope?.packetId &&
          row.scopeId === scope?.parentScopeId,
      );
      const correctedTarget = scopeById.get(entry.correctedTargetMappingId);
      const retiredPlaceholder =
        scope?.label === "Replace with generic scope" &&
        correctedTarget !== undefined &&
        correctedTarget.packetId === scope.packetId &&
        correctedTarget.outcome === "admitted" &&
        strings(scope.selectedClaimIds).every((claimId) =>
          records(current.value.claims).some(
            (row) =>
              row.packetId === scope.packetId &&
              object(row.claim).id === claimId &&
              row.outcome === "admitted" &&
              object(row.disposition).correctedTargetMappingId ===
                correctedTarget.id,
          ),
        );
      if (
        scopeIds.has(id) ||
        scope?.outcome !== "unresolved" ||
        !field(entry, "reason").trim() ||
        !(
          entry.outcome === "deferred" ||
          (entry.outcome === "comparison" &&
            scope.declaredKind === "generic") ||
          (entry.outcome === "unused" &&
            (!strings(scope.selectedClaimIds).length || retiredPlaceholder)) ||
          (entry.outcome === "applicability" &&
            scope.declaredKind === "growing-type" &&
            parent?.outcome === "admitted" &&
            same(entry.parentSubject, parent.subject))
        )
      )
        throw new Error("Invalid remainder scope disposition " + id);
      scopeIds.add(id);
    }
    const mappingIds = strings(approval.approvedMappingIds);
    const mappings = records(resolution.mappings);
    if (
      !same(
        mappingIds.slice().sort(),
        mappings.map((row) => field(row, "id")).sort(),
      ) ||
      new Set(mappingIds).size !== mappingIds.length
    )
      throw new Error("Resolved scope mappings differ from approval");
    if (reviewedGuidance && mappings.length)
      throw new Error("Guidance admission uses existing catalog subjects");
    const mappingById = new Map(mappings.map((row) => [field(row, "id"), row]));
    for (const mapping of mappings) {
      const scope = scopes.find((row) => row.id === mapping.id);
      const parent = scopes.find(
        (row) =>
          row.packetId === mapping.packetId &&
          row.scopeId === mapping.parentScopeId,
      );
      const subject = object(mapping.subject);
      const plant = added.get(field(subject, "id"));
      if (remainder) {
        const frozenScope = Object.fromEntries(
          Object.entries(mapping).filter(
            ([name]) =>
              !["subject", "bindingEvidenceReferenceIds"].includes(name),
          ),
        );
        const collection =
          subject.type === "cultivar" ? "cultivars" : "plant-concepts";
        const identity = collections
          .get(collection)!
          .find(
            (record) => record.id === subject.id && record.status === "active",
          );
        const entryIds = strings(mapping.bindingEvidenceReferenceIds);
        const selectedScopeEvidence = currentClaims
          .filter((row) =>
            records(row.targets).some(
              (target) => target.mappingId === mapping.id,
            ),
          )
          .flatMap((row) =>
            records(row.evidence).map((entry) => entry.evidenceReferenceId),
          );
        if (
          !scope ||
          !same(scope, frozenScope) ||
          !identity ||
          !["cultivar", "plant-concept"].includes(field(subject, "type")) ||
          !["unresolved", "applicability"].includes(field(scope, "outcome")) ||
          (scope.existingCatalogSubjectId !== null &&
            scope.existingCatalogSubjectId !== undefined &&
            scope.existingCatalogSubjectId !== subject.id) ||
          !entryIds.length ||
          entryIds.some((id) => !selectedScopeEvidence.includes(id)) ||
          (plant && !same(object(plant.value).evidenceReferenceIds, entryIds))
        )
          throw new Error(
            "Remainder binding must pin the exact scope, subject and evidence",
          );
        continue;
      }
      if (
        !scope ||
        scope.outcome !== "unused" ||
        scope.declaredKind !== "growing-type" ||
        !same(
          scope,
          Object.fromEntries(
            Object.entries(mapping).filter(([key]) => key !== "subject"),
          ),
        ) ||
        parent?.outcome !== "admitted" ||
        plant?.collection !== "plant-concepts" ||
        subject.type !== "plant-concept" ||
        object(plant.value).parentPlantConceptId !== object(parent.subject).id
      )
        throw new Error(
          "Resolved mapping needs an exact pinned growing type and its admitted parent",
        );
    }
    const claims = [];
    const approvedFacts = [];
    const approvedIdentities = [];
    const linked = new Set<string>();
    const usedMappings = new Set<string>();
    const admittedAssertionIds = new Set<string>();
    for (const decision of decisions) {
      const claimKey = field(decision, "key");
      const row = actual.get(claimKey);
      if (!row || field(decision, "reason").trim().length === 0)
        throw new Error("Invalid or repeated disposition " + claimKey);
      actual.delete(claimKey);
      const links = records(decision.records);
      const outcome = field(decision, "outcome");
      if (
        ![
          "newly-admitted",
          "already-represented",
          "deferred",
          "excluded",
          "superseded",
        ].includes(outcome) ||
        ["newly-admitted", "already-represented"].includes(outcome) !==
          links.length > 0
      )
        throw new Error("Invalid disposition and record links " + claimKey);
      const replacementKeys = strings(decision.replacementKeys ?? []);
      if (outcome === "superseded" && !replacementKeys.length)
        throw new Error("A superseded proposal requires admitted replacements");
      if (replacementKeys.length) {
        const backlinks = new Set(replacementKeys);
        if (
          !["deferred", "superseded"].includes(outcome) ||
          backlinks.size !== replacementKeys.length ||
          replacementKeys.some((replacementKey) => {
            const replacement = currentByKey.get(replacementKey);
            const alreadyLinked =
              replacement?.outcome === "admitted" &&
              strings(
                object(row.disposition ?? {}).replacementKeys ?? [],
              ).includes(replacementKey);
            return (
              replacementKey === claimKey ||
              !replacement ||
              (!alreadyLinked &&
                (!selectedByKey.has(replacementKey) ||
                  decisionByKey.get(replacementKey)?.outcome !==
                    "newly-admitted")) ||
              !records(object(replacement.claim).replaces ?? []).some(
                (pin) =>
                  pin.key === claimKey && pin.packetSha256 === row.packetSha256,
              )
            );
          })
        )
          throw new Error(
            "Replacement lineage differs from the exact admitted proposals " +
              claimKey,
          );
      }
      const replaces = records(object(row.claim).replaces ?? []);
      if (
        replaces.length &&
        (outcome !== "newly-admitted" ||
          replaces.some((pin) => {
            const admitted = currentByKey.get(field(pin, "key"));
            const predecessor = records(
              object(admitted?.disposition ?? {}).records,
            ).find((link) => link.collection === "assertions");
            const successor = records(decision.records).find(
              (link) => link.collection === "assertions",
            );
            if (
              admitted?.outcome === "admitted" &&
              admitted.packetSha256 === pin.packetSha256 &&
              predecessor &&
              successor &&
              records(approval.assertionSupersessions ?? []).some(
                (link) =>
                  link.predecessorId === predecessor.id &&
                  link.predecessorSha256 === predecessor.sha256 &&
                  link.successorId === successor.id &&
                  link.successorSha256 === successor.sha256,
              )
            )
              return false;
            const original = selectedByKey.get(field(pin, "key"));
            return (
              original?.packetSha256 !== pin.packetSha256 ||
              !strings(
                decisionByKey.get(pin.key)?.replacementKeys ?? [],
              ).includes(claimKey)
            );
          }))
      )
        throw new Error(
          "Replacement proposal requires its original disposition " + claimKey,
        );
      const resolved = links.map((link) => {
        const collection = field(link, "collection");
        const id = field(link, "id");
        const found = collections
          .get(collection)
          ?.find((value) => value.id === id);
        if (
          !found ||
          contentDigest(found) !== link.sha256 ||
          (outcome === "already-represented" && added.has(id))
        )
          throw new Error("Missing or changed disposition record " + id);
        linked.add(id);
        return found;
      });
      const packetEvidence = records(row.evidence);
      const rotationEvidence = rotationBatch ? packetEvidence[0] : undefined;
      const sourceRow = rotationEvidence
        ? sourceRows.get(field(rotationEvidence, "sourceRecord"))
        : undefined;
      if (
        rotationBatch &&
        (packetEvidence.length !== 1 ||
          !rotationEvidence ||
          rotationEvidence.sourceId !== growSource ||
          !sourceRow ||
          rotationEvidence.originalValue !== sourceRow.fields[rotationField] ||
          rotationEvidence.locator !==
            sourceRow.sourceLocator +
              "&field=" +
              encodeURIComponent(rotationField)
                .replaceAll("(", "%28")
                .replaceAll(")", "%29"))
      )
        throw new Error(
          "Rotation evidence differs from the pinned source " + claimKey,
        );
      if (
        remainder &&
        outcome === "already-represented" &&
        typeof decision.resolvedMappingId === "string"
      ) {
        const binding = mappingById.get(decision.resolvedMappingId);
        if (
          !binding ||
          !records(row.targets).some(
            (target) => target.mappingId === binding.id,
          ) ||
          !links.some((link) => link.id === object(binding.subject).id)
        )
          throw new Error(
            "Missing exact existing subject for reviewed binding " + claimKey,
          );
        usedMappings.add(field(binding, "id"));
      }
      if (outcome !== "newly-admitted") continue;
      const resolvedMapping =
        typeof decision.resolvedMappingId === "string"
          ? mappingById.get(decision.resolvedMappingId)
          : undefined;
      const targets = records(row.targets);
      if (decision.resolvedMappingId !== undefined) {
        if (
          !resolvedMapping ||
          resolvedMapping.packetId !== row.packetId ||
          !targets.some((target) =>
            remainder
              ? target.mappingId === resolvedMapping.id
              : target.scopeId === resolvedMapping.parentScopeId,
          )
        )
          throw new Error(
            "Resolved scope must narrow the exact packet proposal " + claimKey,
          );
        usedMappings.add(field(resolvedMapping, "id"));
      }
      if (!links.some((link) => added.has(field(link, "id"))))
        throw new Error("No new authored record for " + claimKey);
      if (remainder && decision.localizedNameId !== undefined) {
        const name = added.get(field(decision, "localizedNameId"));
        const claim = object(row.claim);
        const value = object(name?.value ?? {});
        const label = field(claim, "value").split(" · ")[0];
        if (
          name?.collection !== "localized-names" ||
          claim.domain !== "identity" ||
          value.value !== label ||
          !targets.some(
            (target) =>
              (target.outcome === "admitted" &&
                same(target.subject, value.subject)) ||
              (resolvedMapping?.id === target.mappingId &&
                same(resolvedMapping?.subject, value.subject)),
          ) ||
          !same(
            value.evidenceReferenceIds,
            packetEvidence.map((entry) => field(entry, "evidenceReferenceId")),
          ) ||
          !packetEvidence.every((entry) =>
            same(entry.originalValue, claim.value),
          ) ||
          links.length !== 1 ||
          links[0]?.id !== value.id
        )
          throw new Error(
            "Localized name differs from the exact pinned source label " +
              claimKey,
          );
        approvedIdentities.push(claimKey);
        claims.push({ ...row, decision });
        continue;
      }
      if (
        remainder ||
        siteBatch ||
        rotationBatch ||
        reviewedGuidance ||
        row.assessmentGroup === "existing-fact-shape"
      ) {
        const qualifyingScope = remainder
          ? scopeById.get(decision.applicabilityMappingId)
          : undefined;
        if (
          remainder &&
          decision.applicabilityMappingId !== undefined &&
          (qualifyingScope?.outcome !== "applicability" ||
            !targets.some((target) => target.mappingId === qualifyingScope.id))
        )
          throw new Error("Missing qualified packet scope " + claimKey);
        const priorScope = scopes.find(
          (scope) => scope.id === decision.priorChildMappingId,
        );
        if (
          decision.priorChildMappingId !== undefined &&
          (!(
            siteBatch ||
            rotationBatch ||
            temperatureBatch ||
            careBatch ||
            calendarBatch
          ) ||
            resolvedMapping ||
            priorScope?.packetId !== row.packetId ||
            priorScope?.packetSha256 !== row.packetSha256 ||
            priorScope?.outcome !== "admitted" ||
            priorScope?.declaredKind !== "growing-type" ||
            !targets.some(
              (target) => target.scopeId === priorScope?.parentScopeId,
            ) ||
            !links.some((link, index) => {
              const mapping = resolved[index]!;
              return (
                link.collection === "source-subject-mappings" &&
                mapping.decision === "map" &&
                !added.has(field(mapping, "id")) &&
                same(mapping.subject, priorScope?.subject) &&
                records(row.evidence).some((entry) =>
                  same(entry.sourceRecordKey, mapping.sourceRecordKey),
                )
              );
            }))
        )
          throw new Error(
            "Retargeting requires an existing exact source mapping " + claimKey,
          );

        const applicabilityTarget =
          rotationBatch || reviewedGuidance || remainder
            ? targets.find(
                (target) =>
                  target.mappingId === decision.applicabilityMappingId,
              )
            : undefined;
        const applicabilityScope = scopes.find(
          (scope) => scope.id === applicabilityTarget?.mappingId,
        );
        const qualifiedGuidance =
          scopedGuidance && applicabilityScope
            ? qualifiedGuidanceSubject(scopes, applicabilityScope)
            : undefined;
        if (
          scopedGuidance &&
          decision.applicabilityMappingId !== undefined &&
          (!qualifiedGuidance ||
            !same(
              decision.applicabilityScopeChain,
              qualifiedGuidance.chain.map((scope) => scope.id),
            ) ||
            decision.qualifiedSubjectMappingId !== qualifiedGuidance.scope.id)
        )
          throw new Error(
            "Guidance requires the exact qualified scope chain " + claimKey,
          );
        const packetParent =
          reviewedGuidance && applicabilityScope
            ? scopes.find(
                (scope) =>
                  scope.packetId === row.packetId &&
                  scope.packetSha256 === row.packetSha256 &&
                  scope.scopeId === applicabilityScope.parentScopeId &&
                  scope.outcome === "admitted",
              )
            : undefined;
        const correctedTarget = harvestBatch
          ? scopes.find(
              (scope) => scope.id === decision.correctedTargetMappingId,
            )
          : undefined;
        if (
          decision.correctedTargetMappingId !== undefined &&
          (!correctedTarget ||
            decision.applicabilityMappingId !== undefined ||
            correctedTarget.packetId !== row.packetId ||
            correctedTarget.packetSha256 !== row.packetSha256 ||
            correctedTarget.outcome !== "admitted" ||
            targets.length !== 1 ||
            targets[0]?.outcome !== "unresolved" ||
            scopes.find((scope) => scope.id === targets[0]?.mappingId)
              ?.label !== "Replace with generic scope")
        )
          throw new Error(
            "Scope correction requires the exact admitted target in the same packet " +
              claimKey,
          );
        const assertions = resolved.filter(
          (record, index) =>
            links[index]!.collection === "assertions" &&
            added.has(field(record, "id")),
        );
        if (
          assertions.length !== 1 ||
          assertions[0]!.reviewId !== approval.id ||
          admittedAssertionIds.has(field(assertions[0]!, "id")) ||
          !(resolvedMapping
            ? same(resolvedMapping.subject, assertions[0]!.subject)
            : priorScope
              ? same(priorScope.subject, assertions[0]!.subject)
              : correctedTarget
                ? same(correctedTarget.subject, assertions[0]!.subject)
                : applicabilityTarget?.outcome === "applicability" ||
                    (reviewedGuidance &&
                      applicabilityTarget?.outcome === "unresolved")
                  ? same(
                      applicabilityTarget.parentSubject ??
                        qualifiedGuidance?.scope.subject ??
                        packetParent?.subject,
                      assertions[0]!.subject,
                    )
                  : targets.some(
                      (target) =>
                        target.outcome === "admitted" &&
                        same(target.subject, assertions[0]!.subject),
                    ))
        )
          throw new Error(
            "Missing exact approved assertion subject for " + claimKey,
          );
        const assertion = assertions[0]!;
        if (replaces.length) {
          const claim = object(row.claim);
          const conditions = object(claim.conditions);
          const context = collections
            .get("cultivation-contexts")!
            .find((record) => record.id === assertion.contextId);
          const geography = object(context?.geographicScope ?? {});
          const geographyNames = strings(
            geography.geographicContextIds ?? [],
          ).map(
            (id) =>
              collections
                .get("geographic-contexts")!
                .find((record) => record.id === id)?.name,
          );
          if (
            !context ||
            assertion.predicate !== object(claim.implementation).predicate ||
            !same(assertion.value, claim.value) ||
            (conditions.geography !== null &&
              !same(geographyNames, [conditions.geography])) ||
            (conditions.growingSystem !== null &&
              context.growingSystem !== conditions.growingSystem) ||
            (conditions.lifeStage !== null &&
              context.lifeStage !== conditions.lifeStage) ||
            !same(
              object(context.observation ?? {}).qualifications ?? [],
              conditions.qualifications,
            )
          )
            throw new Error(
              "Replacement assertion differs from its exact value or conditions " +
                claimKey,
            );
        }
        if (rotationBatch) {
          const context = collections
            .get("cultivation-contexts")!
            .find((record) => record.id === assertion.contextId);
          const { id: contextId, ...conditions } = context ?? {};
          const autumnPlanted =
            sourceRow?.fields["Common name"] === "Onion (Autumn planted)";
          const exactMapping = links.some((link, index) => {
            const mapping = resolved[index]!;
            return (
              link.collection === "source-subject-mappings" &&
              !added.has(field(mapping, "id")) &&
              mapping.decision === "map" &&
              same(mapping.subject, assertion.subject) &&
              same(mapping.sourceRecordKey, rotationEvidence!.sourceRecordKey)
            );
          });
          if (
            resolvedMapping ||
            assertion.predicate !== "rotation_classification" ||
            !same(assertion.value, {
              scheme: { sourceId: growSource, field: rotationField },
              status: "classified",
              sourceLabel: rotationEvidence!.originalValue,
            }) ||
            !contextId ||
            !same(conditions, {
              geographicScope: { type: "unknown" },
              growingSystem: "unknown",
              propagation: "unknown",
              ...(autumnPlanted ? { plantingSeason: "autumn" } : {}),
            }) ||
            (autumnPlanted
              ? applicabilityTarget?.outcome !== "applicability" || !!priorScope
              : decision.applicabilityMappingId !== undefined || !exactMapping)
          )
            throw new Error(
              "Rotation assertion must preserve the source value and exact applicability " +
                claimKey,
            );
        }

        if (reviewedGuidance) {
          const value = object(assertion.value);
          const scope = applicabilityScope;
          if (
            assertion.predicate !==
              (pollinationBatch
                ? "pollination_guidance"
                : establishmentBatch
                  ? "establishment_guidance"
                  : wateringBatch
                    ? "watering_guidance"
                    : temperatureBatch
                      ? "temperature_guidance"
                      : careBatch
                        ? "care_guidance"
                        : nutritionBatch
                          ? "nutrition_guidance"
                          : "harvest_guidance") ||
            ((establishmentBatch ||
              temperatureBatch ||
              careBatch ||
              nutritionBatch ||
              pollinationBatch) &&
              decision.applicabilityMappingId === undefined &&
              value.applicabilityPath !== undefined) ||
            (decision.applicabilityMappingId !== undefined &&
              (!scope ||
                scope.declaredKind !== "growing-type" ||
                (!establishmentBatch &&
                  !temperatureBatch &&
                  !careBatch &&
                  !nutritionBatch &&
                  !pollinationBatch &&
                  value.applicability !== scope.label) ||
                (scopedGuidance &&
                  !same(
                    value.applicabilityPath,
                    qualifiedGuidance?.chain.map((scope) => scope.label),
                  ))))
          )
            throw new Error(
              "Guidance assertion must preserve exact applicability " +
                claimKey,
            );

          for (const entry of packetEvidence) {
            const mappings = original
              .get("source-subject-mappings")!
              .filter((mapping) =>
                same(mapping.sourceRecordKey, entry.sourceRecordKey),
              );
            if (
              mappings.length &&
              !mappings.some(
                (mapping) =>
                  mapping.decision === "map" &&
                  same(mapping.subject, assertion.subject) &&
                  links.some(
                    (link) =>
                      link.collection === "source-subject-mappings" &&
                      link.id === mapping.id,
                  ),
              )
            )
              throw new Error(
                "Guidance evidence disagrees with an existing source mapping " +
                  claimKey,
              );

            if (entry.sourceId !== growSource) continue;
            const source = sourceRows.get(field(entry, "sourceRecord"));
            const locator = field(entry, "locator");
            const fieldLocator = locator.split("&field=")[1]?.split(" / ")[0];
            const sourceField =
              fieldLocator && decodeURIComponent(fieldLocator);
            const growProfile =
              establishmentBatch && typeof entry.originalValue === "object"
                ? object(object(entry.originalValue).raw)
                : undefined;
            if (
              !source ||
              !sourceField ||
              !locator.startsWith(source.sourceLocator + "&field=") ||
              source.fields[sourceField] !==
                (growProfile ? growProfile.temperature : entry.originalValue) ||
              (growProfile &&
                source.fields["Days to germination at optimum temperature"] !==
                  growProfile.daysToGermination)
            )
              throw new Error(
                "Guidance evidence differs from the pinned GROW source " +
                  claimKey,
              );
          }
        }

        if (calendar) {
          const entry = packetEvidence[0]!;
          const source = calendar.windows.find(
            (window) => window.sourceLocator === entry.locator,
          );
          const access = sourceRows.get(field(entry, "sourceRecord"));
          const context = collections
            .get("cultivation-contexts")!
            .find((record) => record.id === assertion.contextId);
          const geo = collections
            .get("geographic-contexts")!
            .find(
              (record) =>
                context &&
                strings(
                  object(context.geographicScope).geographicContextIds ?? [],
                ).includes(field(record, "id")),
            );
          const expected =
            source &&
            access &&
            geo &&
            resolveBordeauxWindow(row, source, access, field(geo, "id"));
          if (
            !expected ||
            assertion.predicate !== "cultivation_window" ||
            geo.name !== "France (Bordeaux)" ||
            !same(assertion.value, expected.value) ||
            !same(context, { id: assertion.contextId, ...expected.context })
          )
            throw new Error(
              "Bordeaux assertion differs from the pinned workbook or scope " +
                claimKey,
            );
        }
        if (siteBatch || rotationBatch || reviewedGuidance || remainder) {
          const approvedEvidence = strings(assertion.evidenceReferenceIds);
          const activeEvidence = collections.get("evidence-references")!;
          if (
            (siteBatch &&
              ![
                "site_guidance",
                "soil_ph_range",
                "drainage_requirement",
              ].includes(field(assertion, "predicate"))) ||
            !same(
              approvedEvidence.slice().sort(),
              packetEvidence
                .map((entry) => field(entry, "evidenceReferenceId"))
                .sort(),
            ) ||
            packetEvidence.some((entry) => {
              const stored = activeEvidence.find(
                (record) => record.id === entry.evidenceReferenceId,
              );
              if (!stored) return true;
              const rights = object(stored.rights);
              return (
                !same(stored.sourceRecordKey, entry.sourceRecordKey) ||
                stored.locator !== entry.locator ||
                (remainder &&
                  (!stored.normalization ||
                    !same(
                      object(stored.normalization).originalValue,
                      entry.originalValue,
                    ))) ||
                ((rotationBatch || reviewedGuidance) &&
                  (!same(
                    object(stored.normalization).originalValue,
                    entry.originalValue,
                  ) ||
                    entry.rightsDecision !== "pending-review")) ||
                rights.licenceId !== entry.licenceId ||
                rights.decision !== entry.rightsDecision ||
                rights.reviewId !== acceptance.id
              );
            })
          )
            throw new Error(
              "Resolved assertion must preserve the exact packet evidence " +
                claimKey,
            );
        }

        admittedAssertionIds.add(field(assertion, "id"));
        const {
          id,
          subject,
          predicate,
          value,
          contextId,
          evidenceReferenceIds,
          reviewId,
        } = assertion;
        if (!calendarBatch)
          assertSchema(
            { validate },
            "urn:hortinis:plants:schema:v1:plant-fact",
            {
              id,
              subject,
              predicate,
              value,
              contextId,
              evidenceReferenceIds,
              reviewId,
              status: "active",
            },
          );
        approvedFacts.push(claimKey);
        claims.push({ ...row, decision, assertionId: assertions[0]!.id });
      } else {
        approvedIdentities.push(claimKey);
        claims.push({ ...row, decision });
      }
    }
    const unused = snapshots.filter(
      (snapshot) => !linked.has(field(object(snapshot.value), "id")),
    );
    const dependencyIds = new Set(
      snapshots.flatMap((snapshot) => {
        const value = object(snapshot.value);
        const geo =
          value.geographicScope === undefined
            ? undefined
            : object(value.geographicScope);
        return [
          ...strings(value.evidenceReferenceIds ?? []),
          ...strings(geo?.geographicContextIds ?? []),
          value.contextId,
        ];
      }),
    );
    if (
      actual.size ||
      unused.some((row) => !dependencyIds.has(object(row.value).id)) ||
      !same(
        approvedFacts.sort(),
        strings(approval.approvedClaimKeys).slice().sort(),
      ) ||
      !same(
        approvedIdentities.sort(),
        strings(approval.approvedIdentityClaimKeys).slice().sort(),
      ) ||
      usedMappings.size !== mappingIds.length
    )
      throw new Error(
        "Incomplete dispositions, orphan records or approval mismatch",
      );
    if (collections.get("reviews")!.some((row) => row.id === approval.id))
      throw new Error("Approval review ID is already in use");
    collections.get("reviews")!.push({
      ...approval,
      reviewedPlantAdmission: {
        batchSha256,
        frozenSha256: frozen.sha256,
        approvalSha256,
        records: snapshots,
        claims,
        mappings,
        ...(remainder ? { scopeDispositions } : {}),
        dispositions: decisions,
        licensingAcceptanceId: acceptance.id,
      },
    });
    const validateStage = async (path: string) => {
      const { dataset } = await validateAuthoring(root, path);
      if (calendarBatch) {
        const authoring = new Set(
          projectCultivationRules(dataset, "authoring").map((rule) => rule.id),
        );
        const commercial = new Set(
          projectCultivationRules(dataset, "commercial").map((rule) => rule.id),
        );
        for (const id of admittedAssertionIds)
          if (!authoring.has(id) || commercial.has(id))
            throw new Error("Unexpected Bordeaux projection eligibility " + id);
        return;
      }
      if (!siteBatch && !rotationBatch && !reviewedGuidance && !remainder)
        return;
      const predicates = new Set(
        snapshots
          .filter((row) => row.collection === "assertions")
          .map((row) => field(object(row.value), "predicate")),
      );
      const project = remainder
        ? (
            dataset: Parameters<typeof projectPlantFacts>[0],
            profile: "authoring" | "commercial",
          ) => projectPlantFacts(dataset, profile, predicates)
        : pollinationBatch
          ? projectPollinationGuidance
          : rotationBatch
            ? projectRotationClassifications
            : harvestBatch
              ? projectHarvestGuidance
              : wateringBatch
                ? projectWateringGuidance
                : establishmentBatch
                  ? projectEstablishmentGuidance
                  : temperatureBatch
                    ? projectTemperatureGuidance
                    : careBatch
                      ? projectCareGuidance
                      : nutritionBatch
                        ? projectNutritionGuidance
                        : projectSiteFacts;
      const facts = new Map(
        project(dataset, "authoring").map((fact) => [fact.id, fact]),
      );
      const commercial =
        rotationBatch || reviewedGuidance || remainder
          ? new Set(project(dataset, "commercial").map((fact) => fact.id))
          : new Set();

      for (const { collection, value } of snapshots) {
        if (collection !== "assertions") continue;
        const assertion = object(value);
        if (
          !facts.has(assertion.id) ||
          !same(facts.get(assertion.id), { ...assertion, status: "active" }) ||
          commercial.has(assertion.id)
        )
          throw new Error(
            "Consumer projection changed the approved assertion or its commercial eligibility " +
              field(assertion, "id"),
          );
      }
    };
    const beforePublish = async () => {
      await verifyPins();
      if (
        (await fingerprint(directory)) !== baseDatasetSha256 ||
        (await read(currentPath)).sha256 !== current.sha256 ||
        (await read(batchPath)).sha256 !== batchSha256 ||
        (await read(frozenPath)).sha256 !== frozen.sha256 ||
        (await read(approvalPath)).sha256 !== approvalSha256 ||
        !same(await readLicensingAcceptance(root), acceptance)
      )
        throw new Error("Reviewed input changed during transaction");
    };
    if (apply) {
      return await runDecisionTransaction({
        directory,
        descriptors,
        original,
        collections,
        validateStage,
        fingerprint,
        beforePublish,
      });
    }
    const stage = await stageDataset(
      directory,
      collections,
      descriptors,
      original,
    );
    try {
      await validateStage(stage);
      await beforePublish();
      return { datasetSha256: await fingerprint(stage) };
    } finally {
      await rm(stage, { recursive: true, force: true });
    }
  } finally {
    await unlock();
  }
}
