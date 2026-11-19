import {
  careGroups,
  nutritionGroups,
  establishmentGroups,
  temperatureGroups,
  readReviewedDispositions,
  resolveReviewedPlantBatch,
  wateringGroups,
} from "./resolved-reviewed-plant-batch.js";
import { saintEtienneBaselineInput } from "./saint-etienne-calendar.js";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { dataRoot } from "../repository-paths.js";
import { format } from "prettier";
import { validate } from "../schema/validation-api.js";
import {
  assertSchema,
  containedPath,
  contentDigest,
  digest,
  field,
  object,
  readObject,
  records,
  same,
  strings,
  type RecordValue,
} from "./curation-artifacts.js";
import {
  acquireDatasetLock,
  authoringFingerprint,
  runDecisionTransaction,
  readCollections,
  stageDataset,
} from "./decision-transaction.js";
import { mintStableId } from "./grow-wfo-apply.js";
import { consolidatePlantReviews } from "./plant-review-consolidation.js";
import {
  catalogPath,
  integrationPath,
  readLicensingAcceptance,
  validateAuthoring,
} from "./reviewed-licensing-acceptance.js";

const namespace = "reviewed-plants-integration-v1";
const mint = (collection: string, alias: string) =>
  mintStableId(namespace, collection, alias);
const subject = (id: string, type = "plant-concept") => ({ type, id });
const schema = "urn:hortinis:plants:schema:v1:";
const assessmentPath = "docs/investigations/schema-fit/assessment.jsonl";
const assessmentKey = (packetId: string, localId: string) =>
  packetId + ":" + localId;
const assessmentReasons: Record<string, string> = {
  "ambiguous-calendar-action":
    "The source combines indoor and under-cover actions. Choose or represent the combined action without assuming indoor sowing.",
  "conditional-feeding":
    "Represent source-specific feeding product, crop stage and frequency without deriving a numeric dose.",
  "cultivar-comparison-traits":
    "Use a cultivar trait record with the exact cultivar and separate the comparator.",
  "frost-stage-and-exposure":
    "Preserve the affected life stage, exposure, threshold role and any duration or protection.",
  "germination-role-and-pairing":
    "Represent measurement medium and response independently of minimum germination, paired run or survival.",
  "growth-stage-and-temperature-role":
    "Separate best production, seedling, stress and survival meanings, preserving measurement medium.",
  "harvest-anchors-and-intervals":
    "Resolve or represent the actual source anchor and whether this is maturity, first harvest or a harvest interval.",
  "harvest-stage-and-method":
    "Represent harvest stage, quality criteria and method.",
  "other-care-practices":
    "Represent the care action and preserve the source conditions and applicable stage.",
  "other-site-and-form":
    "Determine the exact target field for the site or form guidance.",
  "nutrient-product-and-dose":
    "Represent product or nutrient, dose, area basis, stage and source conditions together.",
  "nutrition-requires-local-input":
    "A source soil-test or local nutrient decision is required before defining any prescription.",
  "ph-plus-site-guidance":
    "Preserve pH and the additional site guidance as separate linked observations.",
  "physical-support":
    "Represent the support action and its qualifying form, system or establishment stage.",
  "planting-dimensions-and-layout":
    "Preserve independent spacing axes, depth and layout conditions.",
  "planting-thermal-conditions":
    "Represent planting action, soil or air measurement and threshold role.",
  "planting-timing-and-preparation":
    "Preserve event anchor and separate preparatory action, interval and succession guidance.",
  "pollination-and-companions":
    "Represent cultivar compatibility or pollination role with explicit companion identity.",
  "propagation-and-establishment":
    "Represent propagation method and its source-specific establishment conditions.",
  "pruning-and-training":
    "Represent action, target plant structure, timing and cultivar or training system.",
  "rotation-classification":
    "Resolve the rotation data model and distinguish rotation category from botanical family.",
  "site-soil-and-light-bundles":
    "Separate bundled site observations without losing their dependencies or applicability.",
  "storage-and-curing":
    "Represent postharvest stage, curing and storage conditions without converting this to harvest timing.",
  "subject-types-and-applicability":
    "Resolve the exact contextual scope or horticultural subdivision before creating records.",
  "sun-alternatives":
    "Preserve alternative or conditional exposure possibilities without selecting one value.",
  "taxon-name-subject-records":
    "Review a source-qualified taxon, name, crosswalk or plant subject operation for this exact claim.",
  "supplemental-identity-and-comparison":
    "Review exact horticultural name, group or comparison semantics before projecting identity facts.",
  "unmapped-soil-classes":
    "Source soil classes require a reviewed vocabulary mapping.",
  "unresolved-temperature-class":
    "The source leaves the temperature class unknown.",
  "water-amount-and-period":
    "Represent amount and period, including rainfall contribution and source conditions.",
  "water-interval-without-amount":
    "Represent irrigation frequency without inventing an amount.",
  "water-stage-and-conditions":
    "Represent watering action and its stage, soil and weather conditions.",
  "water-tension-trigger":
    "Represent soil water tension and measurement depth without converting it to volume.",
  "weed-management":
    "Represent weed management stage and method before projecting guidance.",
};
const growingTypes = new Set([
  "Golden-root beetroot",
  "Red-root table beetroot",
  "Mophead",
  "Lacecap",
  "Floricane-fruiting blackberry",
  "Single-flowered cosmos",
  "Bush nasturtium",
  "Trailing or climbing nasturtium",
  "Mangetout",
  "Golden garden purslane",
  "June-bearing",
  "Hardy pond waterlilies",
  "Tropical waterlilies",
  "Hardneck garlic",
  "Softneck garlic",
  "Dioecious green kiwi",
  "Spring cabbage",
  "Autumn red cabbage",
  "Autumn cabbage",
  "Spring red cabbage",
  "Summer red cabbage",
  "Summer cabbage",
  "Netted muskmelon",
  "Oriental muskmelon",
  "Spanish-type onion",
  "Short / bulbous-root parsnip",
  "Early potato",
  "Maincrop potato",
  "Salad / spring radish",
  "Winter root radish",
  "Asian / daikon root radish",
  "Korean / mu root radish",
  "Watermelon / shinrimei root radish",
  "Potimarron type",
  "Summer-bearing floricane",
  "Perpetual spinach / leaf beet",
  "Early root turnip",
  "Maincrop root turnip",
]);
const packetParent = new Map([
  ["Jack Be Little squash", "Miniature pumpkin"],
  ["Pickling cucumber", "Cucumber"],
  ["Yellow onion", "Generic bulb onion"],
  ["Mirabelle plum", "European plum"],
  ["Red kuri squash", "Potiron"],
]);
const reusedNames = new Map([
  ["French bean", "French bean"],
  ["Generic bulb onion", "Bulb onion"],
  ["Miniature pumpkin", "Miniature pumpkin"],
  ["Musky winter squash", "Musky winter squash"],
]);
const heldScopes = new Map([
  [
    "Replace with generic scope",
    "Starter scope label is unresolved. Review its original claims against the admitted musky winter squash parent.",
  ],
  [
    "Espelette pepper and Gorria",
    "Split the registered Gorria cultivar from PDO production and any conforming local accessions. The wrapper conflates these.",
  ],
  [
    "Jack Be Little squash",
    "Verify the dedicated wrapper and its taxon claims separately from the already admitted Jack Be Little cultivar.",
  ],
  [
    "Yellow bulb",
    "Decide whether this context is coextensive with Yellow onion. The separate scope does not establish equivalence.",
  ],
  [
    "Red bulb",
    "Confirm this scope against the admitted red onion mappings and preserve its individual applicability.",
  ],
  [
    "Pickling type",
    "Confirm this scope against the distinct Pickling cucumber review subject.",
  ],
]);
const explicitComparisonParents = new Map([
  ["Lettuce cultivar comparison", "Lettuce"],
  ["Tomato cultivar comparison", "Tomato"],
]);
const squashCultivarParents = new Map([
  ["Crown Prince", "Potiron"],
  ["Waltham Butternut", "Butternut squash"],
]);

type Subject = ReturnType<typeof subject>;
type Scope = {
  id: string;
  packetId: string;
  packetRevision: number;
  packetSha256: string;
  scopeId: string;
  label: string;
  declaredKind: string;
  parentScopeId: string | null;
  role: string;
  claimIds: string[];
  selectedClaimIds: string[];
};
type PriorBinding = {
  reviewId: string;
  batchSha256: string;
  mappingId: string;
  subject: Subject;
  parentSubject?: Subject;
  identityClaimIds: string[];
  rationale: string;
};

type ScopeOutcome = Scope & {
  priorApproval?: PriorBinding;
  outcome:
    | "admitted"
    | "identity-decision"
    | "mapping-decision"
    | "applicability"
    | "comparison"
    | "unused"
    | "unresolved";
  reason: string;
  parentSubject?: Subject | undefined;
  subject?: Subject;
  identityEvidenceClaimIds?: string[];
};
type Snapshot = { collection: string; value: RecordValue };

function readExceptions(value: unknown) {
  const result = new Map<string, string>();
  for (const row of records(value ?? [])) {
    const kind = field(row, "kind");
    const key = field(row, "key");
    if (
      !["mapping", "claim"].includes(kind) ||
      result.has(assessmentKey(kind, key))
    )
      throw new Error("Invalid or duplicate batch exception: " + key);
    result.set(assessmentKey(kind, key), field(row, "reason"));
  }
  return result;
}

async function readSaintEtienneBindings(
  root: string,
  papers: Map<string, RecordValue>,
  scopes: Scope[],
) {
  const directory = resolve(root, integrationPath, "saint-etienne");
  const bytes = await readFile(resolve(directory, "batch.json"));
  const batch = object(JSON.parse(bytes.toString("utf8")));
  const approval = await readObject(resolve(directory, "approval.json"));
  const batchSha256 = digest(bytes);
  if (
    approval.purpose !== "content" ||
    approval.status !== "accepted" ||
    approval.scope !== "saint-etienne-calendar-proposal" ||
    approval.revision !== batch.revision ||
    approval.batchSha256 !== batchSha256
  )
    throw new Error("Stale Saint-Étienne subject approval");
  for (const [path, hash] of Object.entries(object(batch.inputPins))) {
    if (
      digest(
        saintEtienneBaselineInput(
          path,
          await readFile(await containedPath(root, path)),
        ),
      ) !== hash
    )
      throw new Error("Stale Saint-Étienne input: " + path);
  }

  const basisScopes = new Map<string, Scope>();
  for (const scope of scopes)
    for (const claimId of scope.selectedClaimIds)
      if (!basisScopes.has(claimId)) basisScopes.set(claimId, scope);
  const bindings = new Map<string, PriorBinding>();
  const families = new Map<string, PriorBinding>();
  const localMint = (collection: string, scope: Scope) =>
    mintStableId(
      "saint-etienne-home-garden-calendar",
      collection,
      scope.packetId + "/" + scope.scopeId,
    );
  for (const row of [
    ...records(batch.identities),
    ...records(batch.existingSubjectMappings),
  ]) {
    const basis = field(row, "basis");
    const scope = basisScopes.get(basis);
    if (!scope) throw new Error("Missing Saint-Étienne scope: " + basis);
    const packet = papers.get(scope.packetId)!;
    const claims = records(packet.claims);
    const claim = claims.find((entry) => entry.id === basis);
    if (
      !claim ||
      !same(claim.scopeIds, [scope.scopeId]) ||
      object(claim.conditions).geography !== "France (Bordeaux)" ||
      (row.label && row.label !== scope.label)
    )
      throw new Error("Changed Saint-Étienne scope: " + basis);
    const parent = row.parentBasis
      ? families.get(field(row, "parentBasis"))
      : undefined;
    const existingId = row.subjectId;
    const identityClaimIds = existingId ? [] : strings(row.identityClaimIds);
    if (
      (row.kind === "growing-type") !== !!parent ||
      identityClaimIds.some(
        (id) =>
          !scope.selectedClaimIds.includes(id) ||
          claims.find((entry) => entry.id === id)?.domain !== "identity",
      ) ||
      bindings.has(scope.id)
    )
      throw new Error("Changed Saint-Étienne identity evidence: " + basis);
    const binding: PriorBinding = {
      reviewId: field(approval, "id"),
      batchSha256,
      mappingId: localMint("scope-mappings", scope),
      subject: subject(
        existingId
          ? field(row, "subjectId")
          : localMint("plant-concepts", scope),
      ),
      ...(parent ? { parentSubject: parent.subject } : {}),
      identityClaimIds,
      rationale: field(row, "rationale"),
    };
    bindings.set(scope.id, binding);
    if (!existingId) families.set(basis, binding);
  }
  if (
    !same(
      strings(approval.approvedScopeMappingIds),
      [...bindings.values()].map((row) => row.mappingId),
    ) ||
    !same(
      approval.approvedSubjects,
      [...families.values()].map((row) => ({
        id: row.subject.id,
        ...(row.parentSubject ? { parent: row.parentSubject.id } : {}),
      })),
    )
  )
    throw new Error(
      "Saint-Étienne subject approval differs from exact bindings",
    );
  return bindings;
}

async function prepareReviewedPlantBatch(root: string) {
  const directory = resolve(root, catalogPath);
  const { manifest, dataset } = await validateAuthoring(root, directory);
  const acceptance = await readLicensingAcceptance(root);
  if (
    !same(
      dataset.reviews.find((row) => row.id === acceptance.id),
      acceptance,
    )
  )
    throw new Error("Record licensing acceptance in the active catalog first");
  const inventory = await consolidatePlantReviews(root);
  if (inventory.checks.status !== "validated")
    throw new Error("Review inventory is invalid");
  const preparation = await readObject(
    resolve(root, integrationPath, "preparation.json"),
  );
  const existing = await readObject(
    resolve(root, integrationPath, "status.json"),
  );
  const registry = object(existing.subjectRegistry);
  const admitted = object(existing.canonicalSubjectAdmission);
  const mappings = records(preparation.mappings) as unknown as Scope[];
  const knownMappings = new Map(
    records(admitted.mappings).map((row) => [
      field(row, "mappingId"),
      object(row.subject) as unknown as Subject,
    ]),
  );
  const batchReceipts = dataset.reviews.filter(
    (review) =>
      review.status === "accepted" &&
      review.purpose === "content" &&
      review.reviewedPlantAdmission,
  );
  const scopeDispositions = new Map<string, RecordValue>();
  const exceptions = new Map<string, string>();
  const dispositions = await readReviewedDispositions(root, batchReceipts);
  for (const review of [...batchReceipts].sort((a, b) =>
    String(a.reviewedAt).localeCompare(String(b.reviewedAt)),
  )) {
    for (const entry of records(
      object(review.reviewedPlantAdmission).scopeDispositions ?? [],
    )) {
      const id = field(entry, "id");
      if (
        scopeDispositions.has(id) &&
        scopeDispositions.get(id)?.outcome !== "deferred"
      )
        throw new Error("Duplicate scope disposition " + id);
      scopeDispositions.set(id, entry);
    }
    for (const [key, reason] of readExceptions(review.exceptions))
      exceptions.set(key, reason);
    for (const mapping of records(
      object(review.reviewedPlantAdmission).mappings,
    )) {
      const id = field(mapping, "id");
      const activeSubject = object(mapping.subject) as unknown as Subject;
      if (knownMappings.has(id) && !same(knownMappings.get(id), activeSubject))
        throw new Error("Conflicting approved scope binding " + id);
      knownMappings.set(id, activeSubject);
    }
  }
  const comparisons = new Map(
    records(registry.relationships)
      .filter((row) => row.relation === "comparison-of")
      .map((row) => [field(row, "fromMappingId"), field(row, "toMappingId")]),
  );
  const byLocal = new Map(
    mappings.map((row) => [assessmentKey(row.packetId, row.scopeId), row]),
  );
  const byMappingId = new Map(mappings.map((row) => [row.id, row]));
  if (byMappingId.size !== mappings.length || byLocal.size !== mappings.length)
    throw new Error("Duplicate qualified scope mapping");

  const assessmentBytes = await readFile(resolve(root, assessmentPath));
  const assessment = assessmentBytes
    .toString("utf8")
    .trimEnd()
    .split("\n")
    .map((line) => object(JSON.parse(line)));
  const assessed = new Map(
    assessment.map((row) => [
      assessmentKey(field(row, "packetId"), field(row, "claimId")),
      row,
    ]),
  );
  if (assessment.length !== assessed.size)
    throw new Error("Duplicate assessment claim");
  const papers = new Map<string, RecordValue>();
  for (const pin of inventory.packets) {
    const bytes = await readFile(resolve(root, pin.path));
    if (digest(bytes) !== pin.sha256) throw new Error("Changed review packet");
    const packet = object(JSON.parse(bytes.toString("utf8")));
    const packetScopes = records(packet.scopes)
      .map((row) => field(row, "id"))
      .sort();
    const preparedScopes = mappings
      .filter((row) => row.packetId === pin.id)
      .map((row) => row.scopeId)
      .sort();
    if (!same(packetScopes, preparedScopes))
      throw new Error("Missing qualified packet scopes: " + pin.id);
    papers.set(pin.id, packet);
  }
  for (const row of mappings) {
    if (
      inventory.packets.find((pin) => pin.id === row.packetId)?.sha256 !==
      row.packetSha256
    )
      throw new Error("Stale preparation scope " + row.id);
  }
  const priorBindings = await readSaintEtienneBindings(root, papers, mappings);
  const localized = new Map(
    dataset.localizedNames!.map((row) => [
      field(row, "value"),
      object(row.subject) as unknown as Subject,
    ]),
  );
  localized.set(
    "Tomato",
    subject("c4-plant-concepts-9db246485c8aa7afd8c780b162ee13f5"),
  );
  const outcomes = new Map<string, ScopeOutcome>();
  const resolving = new Set<string>();
  const scope = (row: Scope): ScopeOutcome => {
    const previous = outcomes.get(row.id);
    if (previous) return previous;
    if (resolving.has(row.id)) throw new Error("Scope parent cycle: " + row.id);
    resolving.add(row.id);
    const materialize = (): ScopeOutcome => {
      const active = knownMappings.get(row.id);
      const prior = priorBindings.get(row.id);
      if (prior && active && !same(prior.subject, active))
        throw new Error(
          "Admitted subject conflicts with Saint-Étienne approval " + row.id,
        );
      if (active)
        return {
          ...row,
          subject: active,
          ...(prior ? { priorApproval: prior } : {}),
          outcome: "admitted",
          reason: "Exact canonical or reviewed plant admission receipt.",
        };
      const disposition = scopeDispositions.get(row.id);
      if (disposition)
        return {
          ...row,
          outcome: (disposition.outcome === "deferred"
            ? "unresolved"
            : disposition.outcome) as ScopeOutcome["outcome"],
          ...(disposition.parentSubject
            ? {
                parentSubject: object(
                  disposition.parentSubject,
                ) as unknown as Subject,
              }
            : {}),
          reason: field(disposition, "reason"),
        };
      if (row.role === "unused")
        return {
          ...row,
          outcome: "unused",
          reason: "No claim references this scope.",
        };
      if (row.role === "comparison")
        return {
          ...row,
          outcome: "comparison",
          reason:
            "Retain the packet comparison scope and approved direction where available. Never inherit claims.",
        };
      const held =
        exceptions.get(assessmentKey("mapping", row.id)) ??
        heldScopes.get(row.label);
      if (held) return { ...row, outcome: "unresolved", reason: held };
      const reuse = reusedNames.get(row.label);
      const reusable = reuse && localized.get(reuse);
      if (
        prior &&
        !prior.identityClaimIds.length &&
        !same(prior.subject, reusable)
      )
        throw new Error(
          "Saint-Étienne binding differs from existing catalog subject " +
            row.id,
        );
      if (reusable)
        return {
          ...row,
          subject: reusable,
          ...(prior ? { priorApproval: prior } : {}),
          outcome: "mapping-decision",
          reason:
            "Proposed binding to the matching admitted generic parent. Approve this exact packet scope without inheriting its children's claims.",
        };
      const packet = papers.get(row.packetId)!;
      if (
        row.selectedClaimIds.length &&
        records(packet.claims)
          .filter((claim) => row.selectedClaimIds.includes(field(claim, "id")))
          .every((claim) => Array.isArray(claim.replaces))
      )
        return {
          ...row,
          outcome: "unresolved",
          reason:
            "Approve the exact replacement scope and its proposed catalog subject.",
        };
      const localParent =
        row.parentScopeId &&
        byLocal.get(assessmentKey(row.packetId, row.parentScopeId));
      const sourceParent = localParent && comparisons.get(localParent.id);
      const targetParent = sourceParent
        ? byMappingId.get(sourceParent)
        : localParent || undefined;
      const targetParentLabel =
        (row.role === "cultivar" &&
          localParent &&
          explicitComparisonParents.get(localParent.label)) ||
        undefined;
      const crossPacketParentLabel =
        packetParent.get(row.label) || squashCultivarParents.get(row.label);
      const crossPacketParent =
        crossPacketParentLabel &&
        mappings.find(
          (candidate) =>
            candidate.label === crossPacketParentLabel &&
            ["plant-concept", "type-or-applicability"].includes(candidate.role),
        );
      const parentSubject = targetParentLabel
        ? localized.get(targetParentLabel)
        : crossPacketParent
          ? scope(crossPacketParent).subject
          : targetParent
            ? scope(targetParent).subject
            : undefined;
      if (
        row.role === "type-or-applicability" &&
        !growingTypes.has(row.label)
      ) {
        return {
          ...row,
          parentSubject,
          outcome: "applicability",
          reason:
            "Preserve as a packet-qualified growing system, management, stage or production condition. Any eventual assertion keeps this qualifier.",
        };
      }
      if (!row.selectedClaimIds.length)
        return {
          ...row,
          outcome: "unresolved",
          reason:
            "No selected claim supports admitting this subject. Review original alternatives if a subject is needed.",
        };
      const cultivar = row.role === "cultivar";
      const type =
        row.role === "type-or-applicability" ||
        (!!crossPacketParentLabel && !cultivar);
      if (
        (cultivar || type) &&
        (!parentSubject || parentSubject.type !== "plant-concept")
      ) {
        return {
          ...row,
          outcome: "unresolved",
          reason:
            cultivar && row.label === "Delicata JS"
              ? "Select a Cucurbita pepo horticultural parent for the Delicata accession. The genus-level wrapper and existing miniature-pumpkin concept do not establish that parent."
              : "Select the exact canonical generic parent indicated by the review scope before linking this child.",
        };
      }
      const identityEvidenceClaimIds = records(packet.claims)
        .filter(
          (claim) =>
            claim.domain === "identity" &&
            row.selectedClaimIds.includes(field(claim, "id")) &&
            object(claim.implementation).predicate !== "life_cycle",
        )
        .map((claim) => field(claim, "id"));
      if (!identityEvidenceClaimIds.length)
        return {
          ...row,
          parentSubject,
          outcome: "unresolved",
          reason:
            "No selected identity evidence names this scope as a canonical plant. Decide its exact identity or treat it as applicability.",
        };
      if (
        prior &&
        (cultivar ||
          !same(
            prior.parentSubject ?? null,
            (type ? parentSubject : null) ?? null,
          ) ||
          prior.identityClaimIds.some(
            (id) => !identityEvidenceClaimIds.includes(id),
          ))
      )
        throw new Error(
          "Saint-Étienne identity differs from reviewed scope " + row.id,
        );
      return {
        ...row,
        ...(prior ? { priorApproval: prior } : {}),
        outcome: "identity-decision",
        subject:
          prior?.subject ??
          subject(
            mint(cultivar ? "cultivars" : "plant-concepts", row.id),
            cultivar ? "cultivar" : "plant-concept",
          ),
        ...((type || cultivar) && parentSubject ? { parentSubject } : {}),
        identityEvidenceClaimIds,
        reason:
          "Confirm scoped identity, displayed name and proposed parent. Approval covers this identity only.",
      };
    };
    const result = materialize();
    outcomes.set(row.id, result);
    resolving.delete(row.id);
    return result;
  };
  const scopes = mappings.map(scope);
  const scopeSources = new Map(
    records(preparation.sources).map((row) => [
      assessmentKey(field(row, "packetId"), field(row, "evidenceId")),
      row,
    ]),
  );
  const sourceManifestByRelease = new Map<
    string,
    { id: string; licenceId: string }
  >();
  for (const name of ["grow", "cropgraph", "wfo", "taxref"]) {
    const sourceManifest = await readObject(
      resolve(root, "data/sources", name, "source-manifest.json"),
    );
    const licence = await readObject(
      resolve(root, "data/sources", name, "licence.json"),
    );
    const id = field(sourceManifest, "id");
    const licenceId = field(licence, "id");
    const source = await readObject(
      resolve(root, "data/sources", name, "source.json"),
    );
    const sourceId = field(source, "id");
    const release = field(object(sourceManifest.release), "identifier");
    if (
      manifest.dependencies.some((row) => row.id === id) &&
      manifest.dependencies.some((row) => row.id === licenceId) &&
      manifest.dependencies.some((row) => row.id === sourceId)
    )
      sourceManifestByRelease.set(assessmentKey(sourceId, release), {
        id,
        licenceId,
      });
  }
  const references = new Map<string, Snapshot>();
  const lineage = (packetId: string, evidence: RecordValue) => {
    const evidenceId = field(evidence, "id");
    const key = assessmentKey(packetId, evidenceId);
    const rights = object(evidence.rights);
    const supplemental = scopeSources.get(key);
    const licence = supplemental && object(supplemental.licence);
    const originalSourceId = evidence.sourceId;
    const sourceReleaseId = evidence.release;
    const pinned =
      typeof originalSourceId === "string" &&
      typeof sourceReleaseId === "string"
        ? sourceManifestByRelease.get(
            assessmentKey(originalSourceId, sourceReleaseId),
          )
        : undefined;
    const registered =
      supplemental &&
      licence &&
      [
        supplemental.source,
        supplemental.licence,
        supplemental.sourceManifest,
      ].every((record) =>
        manifest.dependencies.some((dep) => dep.id === object(record).id),
      );
    const rightsDecision =
      rights.commercialUseAllowed === false ||
      (licence && licence.commercialUse === "forbidden")
        ? "ineligible"
        : "pending-review";
    const sourceRecordKey =
      registered && supplemental
        ? supplemental.sourceRecordKey
        : pinned
          ? {
              recordId: evidence.sourceRecord,
              source: {
                sourceId: originalSourceId,
                sourceManifestId: pinned.id,
                sourceReleaseId,
              },
            }
          : undefined;
    const licenceId = registered && licence ? licence.id : pinned?.licenceId;
    const evidenceReferenceId =
      sourceRecordKey && licenceId
        ? mint("evidence-references", key)
        : undefined;
    if (evidenceReferenceId && !references.has(key)) {
      const value = {
        id: evidenceReferenceId,
        sourceRecordKey,
        locator: evidence.locator,
        normalization: {
          originalValue: evidence.originalValue,
          method:
            "Exact reviewed source snapshot. See the batch evidence for declared licence, capture and upstream-rights qualifications.",
        },
        rights: {
          licenceId,
          decision: rightsDecision,
          reviewId: acceptance.id,
          reason:
            rightsDecision === "ineligible"
              ? "Recorded restriction excludes commercial use."
              : "Recorded licensing acceptance. Commercial claim rights retain pending-review status.",
        },
      };
      assertSchema({ validate }, schema + "evidence-reference", value);
      references.set(key, { collection: "evidence-references", value });
    }
    return {
      ...evidence,
      rightsDecision,
      licenceId: licenceId ?? null,
      sourceRecordKey: sourceRecordKey ?? null,
      evidenceReferenceId: evidenceReferenceId ?? null,
      acceptanceId: acceptance.id,
    };
  };
  const rows: {
    packetId: string;
    packetRevision: number;
    packetSha256: string;
    claim: RecordValue;
    targets: unknown[];
    evidence: ReturnType<typeof lineage>[];
    prepared: unknown;
    assessmentGroup: string;
    outcome: string;
    reasons: string[];
    admissionReviewIds: string[];
    identityMappingId: string | null;
    disposition?: RecordValue;
  }[] = [];
  const contexts = new Map<string, Snapshot>();
  const geographies = new Map<string, Snapshot>();
  const activeContexts = new Set(dataset.contexts.map((row) => row.id));
  const activeGeographies = new Set(
    dataset.geographicContexts?.map((row) => row.id),
  );
  const existingAssertions = new Map(
    dataset.assertions.map((row) => [field(row, "id"), row]),
  );
  const admissionReviewIds = new Map<string, string[]>();
  for (const review of dataset.reviews) {
    if (!review.supplementalAdmission || review.status !== "accepted") continue;
    const receipt = object(review.supplementalAdmission);
    const key = assessmentKey(
      field(receipt, "packetSha256"),
      field(object(receipt.claim), "id"),
    );
    admissionReviewIds.set(key, [
      ...(admissionReviewIds.get(key) ?? []),
      field(review, "id"),
    ]);
  }
  for (const review of batchReceipts) {
    for (const receipt of records(
      object(review.reviewedPlantAdmission).claims,
    )) {
      const key = assessmentKey(
        field(receipt, "packetSha256"),
        field(object(receipt.claim), "id"),
      );
      admissionReviewIds.set(key, [
        ...(admissionReviewIds.get(key) ?? []),
        field(review, "id"),
      ]);
    }
  }
  const snapshots: Snapshot[] = [];
  const rehearsalReviewId = mint("reviews", "isolated-rehearsal");
  const botanicalRecords = new Map<
    string,
    { taxonId: string; records: Snapshot[] }
  >();
  for (const crosswalk of dataset.externalTaxonomyCrosswalks ?? []) {
    const external = object(crosswalk.externalIdentifier);
    if (
      external.sourceId === "source_world_flora_online_plant_list" &&
      external.sourceReleaseId === "2026-06" &&
      crosswalk.taxonomicStatus === "Accepted" &&
      !crosswalk.supersededByCrosswalkId
    )
      botanicalRecords.set(field(external, "identifier"), {
        taxonId: field(crosswalk, "taxonId"),
        records: [],
      });
  }
  const identityClaims = new Map<string, string>();
  const acceptedTaxonomy = (packetId: string, evidence: RecordValue) => {
    if (
      evidence.sourceId !== "source_world_flora_online_plant_list" ||
      evidence.release !== "2026-06" ||
      !evidence.originalValue ||
      typeof evidence.originalValue !== "object" ||
      Array.isArray(evidence.originalValue)
    )
      return;
    const captured = object(evidence.originalValue);
    if (
      captured.taxonomicStatus !== "Accepted" ||
      typeof captured.scientificName !== "string" ||
      typeof captured.taxonRank !== "string"
    )
      return;
    const source = lineage(packetId, evidence);
    if (!source.evidenceReferenceId || !source.sourceRecordKey) return;
    const identifier = field(evidence, "sourceRecord");
    const known = botanicalRecords.get(identifier);
    if (known) return known;
    const taxonId = mint("taxa", identifier);
    const externalIdentifier = {
      ...object(object(source.sourceRecordKey).source),
      identifier,
    };
    const evidenceReferenceIds = [source.evidenceReferenceId];
    const taxonRank = captured.taxonRank.toLowerCase();
    const name = {
      scientificName: captured.scientificName,
      taxonRank,
      ...(typeof captured.authorship === "string" && captured.authorship
        ? { authorship: captured.authorship }
        : {}),
    };
    const recordsForTaxon: Snapshot[] = [
      {
        collection: "taxa",
        value: {
          id: taxonId,
          status: "active",
          taxonRank,
          scientificName: name.scientificName,
          evidenceReferenceIds,
        },
      },
      {
        collection: "taxonomic-names",
        value: {
          ...name,
          id: mint("taxonomic-names", identifier),
          taxonId,
          status: "active",
          nameStatus: "accepted",
          externalIdentifier,
          evidenceReferenceIds,
          reviewId: rehearsalReviewId,
        },
      },
      {
        collection: "external-taxonomy-crosswalks",
        value: {
          id: mint("external-taxonomy-crosswalks", identifier),
          taxonId,
          taxonRank,
          externalName: name.scientificName,
          ...(name.authorship ? { authorship: name.authorship } : {}),
          externalIdentifier,
          taxonomicStatus: "Accepted",
          reviewId: rehearsalReviewId,
          matchMethod: "manual",
          locator: captured.locator ?? evidence.locator,
        },
      },
    ];
    if (
      recordsForTaxon.some(({ collection, value }) => {
        const descriptor = manifest.collections.find(
          (row) => row.role === collection,
        );
        return !descriptor || !validate(descriptor.schemaId, value).valid;
      })
    )
      return;
    const result = { taxonId, records: recordsForTaxon };
    botanicalRecords.set(identifier, result);
    return result;
  };
  const identityRecords = new Map<string, Snapshot[]>();
  for (const current of scopes) {
    if (current.outcome !== "identity-decision" || !current.subject) continue;
    const packet = papers.get(current.packetId)!;
    const evidenceIds = new Set(
      records(packet.claims)
        .filter((claim) =>
          current.identityEvidenceClaimIds?.includes(field(claim, "id")),
        )
        .flatMap((claim) => strings(claim.evidenceIds))
        .flatMap((id) => {
          const item = records(packet.evidence).find(
            (entry) => entry.id === id,
          )!;
          const reference = lineage(current.packetId, item).evidenceReferenceId;
          return reference ? [reference] : [];
        }),
    );
    if (!evidenceIds.size) {
      current.outcome = "unresolved";
      current.reason =
        "Register a source release for the identity evidence before staging the identity.";
      continue;
    }
    const evidenceReferenceIds = [...evidenceIds];
    const id = current.subject.id;
    const packetEvidence = new Map(
      records(packet.evidence).map((entry) => [field(entry, "id"), entry]),
    );
    const botanicals = records(packet.claims)
      .filter((entry) =>
        current.identityEvidenceClaimIds?.includes(field(entry, "id")),
      )
      .flatMap((claim) =>
        strings(claim.evidenceIds).flatMap((evidenceId) => {
          const evidence = packetEvidence.get(evidenceId)!;
          const botanical = acceptedTaxonomy(current.packetId, evidence);
          return botanical
            ? [{ botanical, claimId: field(claim, "id"), topic: claim.topic }]
            : [];
        }),
      );
    const taxa = new Set(botanicals.map((entry) => entry.botanical.taxonId));
    const botanical =
      current.subject.type !== "cultivar" &&
      current.label !== "Garden blackberry" &&
      taxa.size === 1
        ? botanicals[0]?.botanical
        : undefined;
    if (botanical) {
      for (const item of botanicals)
        if (item.topic !== "Manual GROW crop-identity proposal")
          identityClaims.set(
            assessmentKey(current.packetId, item.claimId),
            current.id,
          );
    }
    const value = {
      id,
      status: "active",
      evidenceReferenceIds,
      ...(botanical ? { taxonId: botanical.taxonId } : {}),
    };
    const recordsForIdentity: Snapshot[] =
      current.subject.type === "cultivar"
        ? [
            {
              collection: "cultivars",
              value: {
                ...value,
                plantConceptId: current.parentSubject!.id,
                denomination:
                  current.label === "Cheddar F1" ? "Cheddar" : current.label,
              },
            },
          ]
        : [
            {
              collection: "plant-concepts",
              value: current.parentSubject
                ? {
                    ...value,
                    kind: "growing-type",
                    parentPlantConceptId: current.parentSubject.id,
                  }
                : { ...value, kind: "generic" },
            },
            {
              collection: "localized-names",
              value: {
                id: mint("localized-names", current.id),
                subject: current.subject,
                value:
                  current.label ===
                  "Generic cultivated edible root carrot, outdoor soil culture"
                    ? "Cultivated carrot"
                    : current.label,
                languageTag: current.label === "Potiron" ? "fr" : "en",
                kind: "common",
                preferred: true,
                evidenceReferenceIds,
              },
            },
          ];
    identityRecords.set(current.id, [
      ...recordsForIdentity,
      ...(botanical?.records ?? []),
    ]);
  }
  const activeConcepts = new Set(
    dataset.plantConcepts.map((record) => field(record, "id")),
  );
  for (const current of scopes) {
    const staged = identityRecords.get(current.id);
    if (!staged || !current.parentSubject) continue;
    const parentId = current.parentSubject.id;
    const parent = scopes.find(
      (row) => row.subject?.id === parentId && identityRecords.has(row.id),
    );
    if (!activeConcepts.has(parentId) && !parent) {
      current.outcome = "unresolved";
      current.reason =
        "The proposed parent cannot be staged until its own identity evidence is registered.";
      identityRecords.delete(current.id);
    }
  }
  const rehearsableSubjects = new Set([
    ...activeConcepts,
    ...dataset.cultivars.map((row) => field(row, "id")),
    ...[...identityRecords.values()].map((set) => field(set[0]!.value, "id")),
  ]);
  const consumerFact = (predicate: unknown, value: unknown) =>
    validate(schema + "plant-fact", {
      id: "shape-check",
      subject: subject("shape-check-subject"),
      predicate,
      value,
      contextId: "shape-check-context",
      evidenceReferenceIds: ["shape-check-evidence"],
      reviewId: "shape-check-review",
      status: "active",
    }).valid;
  for (const pin of inventory.packets) {
    const packet = papers.get(pin.id)!;
    const packetEvidence = new Map(
      records(packet.evidence).map((row) => [field(row, "id"), row]),
    );
    for (const claim of records(packet.claims).filter(
      (row) => row.recommendation === "select",
    )) {
      const claimId = field(claim, "id");
      const key = assessmentKey(pin.id, claimId);
      const shape = assessed.get(key);
      if (
        !shape ||
        shape.packetSha256 !== pin.sha256 ||
        !same(shape.value, claim.value) ||
        !same(shape.conditions, claim.conditions) ||
        !same(shape.scopeIds, claim.scopeIds)
      )
        throw new Error("Missing or stale schema assessment: " + key);
      assessed.delete(key);
      const targets = strings(claim.scopeIds).map((scopeId) => {
        const mapping = byLocal.get(assessmentKey(pin.id, scopeId));
        if (!mapping) throw new Error("Missing scope: " + scopeId);
        return outcomes.get(mapping.id)!;
      });
      const evidence = strings(claim.evidenceIds).map((id) =>
        lineage(pin.id, packetEvidence.get(id)!),
      );
      const conditions = object(claim.conditions);
      const group = field(shape, "group");
      const calendar = shape.calendarCandidate
        ? object(shape.calendarCandidate)
        : undefined;
      const normalized = shape.normalizationCandidate
        ? object(shape.normalizationCandidate)
        : group === "plain-drainage" &&
            /^(use )?well-drained soil$/i.test(String(claim.value))
          ? {
              predicate: "drainage_requirement",
              value: "well_drained",
              consumer: {
                valid: consumerFact("drainage_requirement", "well_drained"),
              },
              caveat:
                "Preserve the stated drainage class. No moisture retention or freely draining substrate is inferred.",
            }
          : undefined;
      const predicate =
        calendar && object(calendar.consumer).valid === true
          ? "cultivation_window"
          : (normalized?.predicate ?? object(claim.implementation).predicate);
      const value =
        calendar && object(calendar.consumer).valid === true
          ? calendar.assertionValue
          : (normalized?.value ?? claim.value);
      const candidateFits =
        (calendar && object(calendar.consumer).valid === true) ||
        (!!normalized && object(normalized.consumer).valid === true) ||
        consumerFact(predicate, value);
      const reviewIds =
        admissionReviewIds.get(assessmentKey(pin.sha256, claimId)) ?? [];
      const disposition = dispositions.get(assessmentKey(pin.sha256, key));
      const terminal =
        disposition?.outcome === "already-represented" ||
        disposition?.outcome === "excluded" ||
        disposition?.outcome === "superseded";
      const exception =
        disposition?.outcome === "deferred"
          ? field(disposition, "reason")
          : exceptions.get(assessmentKey("claim", key));
      const resolutionReasons: string[] = exception ? [exception] : [];
      if (claim.topic === "Manual GROW crop-identity proposal")
        resolutionReasons.push(
          "The taxon link alone cannot authorize the proposed GROW record 11 source-subject mapping.",
        );
      if (
        targets.some((row) => row.label === "Garden blackberry") &&
        claim.domain === "identity" &&
        evidence.some(
          (row) =>
            object(row).sourceId === "source_world_flora_online_plant_list",
        )
      )
        resolutionReasons.push(
          "The WFO nominal species does not identify the cultivated blackberry aggregate.",
        );
      const exactTarget = targets.length === 1 ? targets[0] : undefined;
      const target =
        exactTarget?.outcome !== "unresolved"
          ? exactTarget?.subject
          : undefined;
      if (!target || !rehearsableSubjects.has(target.id))
        resolutionReasons.push(
          targets.length > 1
            ? "Approve exact subject per referenced scope and whether this is one jointly scoped claim."
            : "Resolve the exact claim scope. Comparison/applicability cannot implicitly grant a parent fact.",
        );
      if (evidence.some((row) => !row.evidenceReferenceId))
        resolutionReasons.push(
          "Admit and pin the missing exact source release and licence shown in the evidence.",
        );
      if (!candidateFits)
        resolutionReasons.push(
          assessmentReasons[group] ??
            "A lossless authoring and consumer projection is required for this value.",
        );
      const stage = conditions.lifeStage;
      const system = conditions.growingSystem;
      const lifeStage =
        typeof stage === "string" ? stage.toLowerCase() : "unknown";
      const growingSystem =
        typeof system === "string"
          ? system.toLowerCase().replaceAll(" ", "_")
          : "unknown";
      const geography = conditions.geography;
      const qualifies = strings(conditions.qualifications).length > 0;
      const contextAlias = contentDigest({
        geography,
        lifeStage,
        growingSystem,
      });
      const contextId = mint("cultivation-contexts", contextAlias);
      const geographicContextId = mint(
        "geographic-contexts",
        contentDigest(geography),
      );
      const projectedContext = {
        id: contextId,
        growingSystem,
        lifeStage,
        propagation: "unknown",
        geographicScope:
          typeof geography === "string"
            ? { type: "specified", geographicContextIds: [geographicContextId] }
            : { type: "unknown" },
      };
      const contextFits = validate(
        schema + "cultivation-context",
        projectedContext,
      ).valid;
      if (!contextFits)
        resolutionReasons.push(
          "Represent the original growing system or life stage without recoding it as unknown.",
        );
      if (
        qualifies ||
        conditions.measurementMedium !== null ||
        conditions.eventAnchor !== null
      ) {
        resolutionReasons.push(
          "Confirm projection of the recorded qualification, measurement medium or event anchor. It must survive beyond the source snapshot.",
        );
      }
      const prepared = candidateFits
        ? {
            predicate,
            value,
            context: projectedContext,
            normalization:
              normalized?.caveat ??
              (calendar
                ? "Preserve source action and Bordeaux dates."
                : "Exact selected packet value."),
          }
        : null;
      const evidenceReferenceIds = evidence.map(
        (row) => row.evidenceReferenceId,
      );
      if (
        !resolutionReasons.length &&
        prepared &&
        target &&
        !reviewIds.length &&
        !terminal
      ) {
        if (
          typeof geography === "string" &&
          !activeGeographies.has(geographicContextId) &&
          !geographies.has(geographicContextId)
        )
          geographies.set(geographicContextId, {
            collection: "geographic-contexts",
            value: {
              id: geographicContextId,
              kind: "catalog-scope",
              status: "active",
              name: geography,
              evidenceReferenceIds,
            },
          });
        if (!activeContexts.has(contextId))
          contexts.set(contextId, {
            collection: "cultivation-contexts",
            value: projectedContext,
          });
        snapshots.push({
          collection: "assertions",
          value: {
            id: mint("assertions", key),
            subject: target,
            predicate,
            value,
            contextId,
            evidenceReferenceIds,
            reviewId: rehearsalReviewId,
          },
        });
      }
      const identityMapping = identityClaims.get(key);
      const awaitingIdentity =
        !!identityMapping && identityRecords.has(identityMapping);
      rows.push({
        packetId: pin.id,
        packetRevision: pin.revision,
        packetSha256: pin.sha256,
        claim,
        targets: targets.map((row) => ({
          scopeId: row.scopeId,
          mappingId: row.id,
          outcome: row.outcome,
          subject: row.subject ?? null,
          parentSubject: row.parentSubject ?? null,
        })),
        evidence,
        prepared,
        assessmentGroup: group,
        ...(disposition ? { disposition } : {}),
        outcome: reviewIds.length
          ? "admitted"
          : terminal
            ? field(disposition, "outcome")
            : awaitingIdentity
              ? "awaiting-identity-approval"
              : resolutionReasons.length
                ? "unresolved"
                : "awaiting-content-approval",
        reasons: reviewIds.length
          ? []
          : disposition
            ? [field(disposition, "reason")]
            : awaitingIdentity
              ? [
                  "Review the exact WFO-backed taxon and name in identity mapping " +
                    identityMapping,
                ]
              : [
                  ...resolutionReasons,
                  "Any factual admission needs exact approval of this packet, claim, subject, conditions and evidence.",
                ],
        admissionReviewIds: reviewIds,
        identityMappingId: awaitingIdentity ? identityMapping : null,
      });
    }
  }
  if (assessed.size || rows.length !== inventory.totals.recommendations.select)
    throw new Error("Incomplete selected proposal coverage");
  const uniqueRecords = (entries: Snapshot[]) => [
    ...new Map(entries.map((item) => [item.value.id, item])).values(),
  ];
  const rehearsalRecords = uniqueRecords([
    ...geographies.values(),
    ...contexts.values(),
    ...[...identityRecords.values()].flat(),
    ...snapshots,
  ]);
  const evidenceNeeded = new Set(
    rehearsalRecords.flatMap(({ value }) =>
      Array.isArray(value.evidenceReferenceIds)
        ? strings(value.evidenceReferenceIds)
        : [],
    ),
  );
  const rehearsalReferences = [...references.values()].filter(({ value }) =>
    evidenceNeeded.has(field(value, "id")),
  );
  const activeEvidence = new Map(
    dataset.evidence.map((row) => [field(row, "id"), row]),
  );
  const rehearsal = [...rehearsalReferences, ...rehearsalRecords].filter(
    ({ collection, value }) => {
      if (collection !== "evidence-references") return true;
      const current = activeEvidence.get(field(value, "id"));
      if (!current) return true;
      if (!same(current, value))
        throw new Error("Existing evidence changed since the approved batch");
      return false;
    },
  );
  for (const item of rehearsal) {
    const descriptor = manifest.collections.find(
      (row) => row.role === item.collection,
    );
    if (!descriptor)
      throw new Error("Missing authoring collection " + item.collection);
    assertSchema({ validate }, descriptor.schemaId, item.value);
  }
  const reviewedCultivationFacts = batchReceipts.flatMap((row) =>
    records(object(row.reviewedPlantAdmission).claims).filter(
      (claim) => claim.assertionId,
    ),
  ).length;
  const localCalendarAssertions = dataset.reviews.flatMap((review) =>
    review.calendarAdmission
      ? records(object(review.calendarAdmission).lineage).map((row) =>
          field(row, "assertionId"),
        )
      : [],
  );
  const currentFacts = dataset.reviews.flatMap((review) =>
    review.legacyPlantAdmission
      ? records(object(review.legacyPlantAdmission).records)
          .filter((row) => row.collection === "assertions")
          .map((row) => ({
            assertion: existingAssertions.get(field(object(row.value), "id")),
            reviewId: review.id,
            provenance: review.provenance,
          }))
      : [],
  );
  const reviewSummary = inventory.packets.map((pin) => ({
    packetId: pin.id,
    revision: pin.revision,
    sha256: pin.sha256,
    path: pin.path,
    label: pin.plant.label,
    scopeIds: scopes
      .filter((row) => row.packetId === pin.id)
      .map((row) => row.id),
    proposals: rows
      .filter((row) => row.packetId === pin.id)
      .map((row) => field(row.claim, "id")),
  }));
  const batch = {
    status: "in progress",
    inventoryFingerprint: inventory.inputFingerprint,
    baseDatasetSha256: await authoringFingerprint(
      directory,
      manifest.collections,
    ),
    assessmentSha256: digest(assessmentBytes),
    licensingAcceptance: acceptance,
    relationshipDecisions: records(registry.relationships),
    reviewedPackets: reviewSummary,
    scopes,
    identityRecords: [...identityRecords].map(([mappingId, values]) => ({
      mappingId,
      records: values,
    })),
    claims: rows,
    activeCatalog: {
      assertions: dataset.assertions,
      plantConcepts: dataset.plantConcepts,
      cultivars: dataset.cultivars,
      localizedNames: dataset.localizedNames,
      legacySourceMappings: dataset.sourceSubjectMappings?.filter((row) =>
        dataset.reviews.some(
          (review) => review.id === row.reviewId && review.legacyPlantAdmission,
        ),
      ),
    },
    currentFacts,
    reviewedCultivationFacts,
    localCalendarAssertions,
    legacyDocuments: inventory.legacyDocuments,
    rehearsal: {
      referenceRecords: rehearsalReferences,
      geographicContexts: [...geographies.values()],
      cultivationContexts: [...contexts.values()],
      assertions: snapshots,
      reviewId: rehearsalReviewId,
    },
  };
  return {
    batch,
    rehearsal,
    rehearsalReviewId,
    descriptors: manifest.collections,
  };
}

async function rehearseReviewedPlantBatch(
  root: string,
  plan: Awaited<ReturnType<typeof prepareReviewedPlantBatch>>,
) {
  const source = resolve(root, catalogPath);
  const descriptors = plan.descriptors;
  const original = await readCollections(source, descriptors);
  const before = await authoringFingerprint(source, descriptors);
  if (before !== plan.batch.baseDatasetSha256)
    throw new Error("Authoring base changed before rehearsal");
  const collections = new Map(
    [...original].map(([role, rows]) => [role, [...rows]]),
  );
  for (const { collection, value } of plan.rehearsal) {
    const target = collections.get(collection)!;
    if (target.some((row) => row.id === value.id))
      throw new Error(
        "Rehearsal collides with active record " + String(value.id),
      );
    target.push(value);
  }
  collections.get("reviews")!.push({
    id: plan.rehearsalReviewId,
    purpose: "content",
    status: "accepted",
    reviewerId: "isolated-rehearsal-fixture",
    reviewedAt: "2026-11-15T00:00:00Z",
    notes:
      "Synthetic review for schema and referential-integrity testing of this temporary dataset.",
  });
  const stage = await stageDataset(source, collections, descriptors, original);
  try {
    await validateAuthoring(root, stage);
    if ((await authoringFingerprint(source, descriptors)) !== before)
      throw new Error("Active dataset changed during rehearsal");
    return {
      status: "validated",
      datasetSha256: await authoringFingerprint(stage, descriptors),
    };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

async function applyReviewedPlantBatch(root: string, approvalPath: string) {
  const file = await containedPath(root, approvalPath);
  const approval = await readObject(file);
  assertSchema({ validate }, schema + "review", approval);
  if (
    approval.scope !== "reviewed-plant-batch" ||
    approval.purpose !== "content" ||
    approval.status !== "accepted"
  )
    throw new Error("Exact content approval required");
  field(approval, "sourceReference");
  if (approval.decisionAuthority === undefined) field(approval, "quote");
  const approvedMappings = strings(approval.approvedMappingIds);
  const approvedClaims = strings(approval.approvedClaimKeys);
  const mappingIds = new Set(approvedMappings);
  const claimKeys = new Set(approvedClaims);
  if (
    mappingIds.size !== approvedMappings.length ||
    claimKeys.size !== approvedClaims.length ||
    (!mappingIds.size && !claimKeys.size)
  )
    throw new Error(
      "Choose unique, explicit mapping IDs or qualified claim keys",
    );
  const exceptions = readExceptions(approval.exceptions);
  const directory = resolve(root, catalogPath);
  const unlock = await acquireDatasetLock(directory);
  try {
    const plan = await prepareReviewedPlantBatch(root);
    const receipt = await rehearseReviewedPlantBatch(root, plan);
    const current = await batchBytes(plan, receipt);
    const saved = await readFile(
      resolve(root, integrationPath, "reviewed-plant-batch.json"),
    );
    const batchSha256 = digest(saved);
    if (
      current !== saved.toString("utf8") ||
      approval.batchSha256 !== batchSha256 ||
      approval.baseDatasetSha256 !== plan.batch.baseDatasetSha256
    )
      throw new Error(
        "Approval must pin the exact current decision batch and catalog fingerprint",
      );
    const original = await readCollections(directory, plan.descriptors);
    const collections = new Map(
      [...original].map(([role, rows]) => [role, [...rows]]),
    );
    const available = new Map(plan.rehearsal.map((row) => [row.value.id, row]));
    const selected: Snapshot[] = [];
    const mappings = plan.batch.scopes.filter(
      (row) =>
        mappingIds.has(row.id) &&
        ["mapping-decision", "identity-decision"].includes(row.outcome),
    );
    if (mappings.length !== mappingIds.size)
      throw new Error("An approved mapping is unavailable or unresolved");
    for (const item of plan.batch.identityRecords) {
      if (!mappingIds.has(item.mappingId)) continue;
      for (const record of item.records) {
        selected.push(
          record.value.reviewId === plan.rehearsalReviewId
            ? { ...record, value: { ...record.value, reviewId: approval.id } }
            : record,
        );
      }
    }

    const claims = plan.batch.claims.filter(
      (row) =>
        claimKeys.has(assessmentKey(row.packetId, field(row.claim, "id"))) &&
        row.outcome === "awaiting-content-approval",
    );
    if (claims.length !== claimKeys.size)
      throw new Error("An approved claim is unavailable or unresolved");
    const admittedIdentityClaims = plan.batch.claims.filter(
      (row) =>
        row.outcome === "awaiting-identity-approval" &&
        row.identityMappingId &&
        mappingIds.has(row.identityMappingId),
    );
    if (approval.decisionAuthority !== undefined) {
      const expected = admittedIdentityClaims.map((row) =>
        assessmentKey(row.packetId, field(row.claim, "id")),
      );
      if (
        !same(
          [...strings(approval.approvedIdentityClaimKeys)].sort(),
          expected.sort(),
        )
      )
        throw new Error(
          "Delegated approval must pin the identity claim keys covered by its mappings",
        );
    }
    const omitted = new Set([
      ...plan.batch.scopes
        .filter(
          (row) =>
            !mappingIds.has(row.id) &&
            ["mapping-decision", "identity-decision"].includes(row.outcome),
        )
        .map((row) => assessmentKey("mapping", row.id)),
      ...plan.batch.claims
        .filter((row) => row.outcome === "awaiting-content-approval")
        .map((row) => assessmentKey(row.packetId, field(row.claim, "id")))
        .filter((key) => !claimKeys.has(key))
        .map((key) => assessmentKey("claim", key)),
    ]);
    if ([...exceptions.keys()].some((key) => !omitted.has(key)))
      throw new Error(
        "An exception does not name an omitted decision in this batch",
      );
    const admittedAssertions = claims.map((row) => {
      const key = assessmentKey(row.packetId, field(row.claim, "id"));
      const assertion = available.get(mint("assertions", key));
      const scope = plan.batch.scopes.find(
        (item) =>
          item.packetId === row.packetId &&
          item.scopeId === strings(row.claim.scopeIds)[0],
      );
      if (
        !assertion ||
        !scope ||
        (scope.outcome !== "admitted" && !mappingIds.has(scope.id))
      )
        throw new Error(
          "Approve the exact claim scope mapping in the same batch: " + key,
        );
      const context = available.get(assertion.value.contextId);
      if (context) {
        for (const id of (object(context.value.geographicScope)
          .geographicContextIds as string[]) ?? []) {
          const geography = available.get(id);
          if (geography) selected.push(geography);
        }
        selected.push(context);
      }
      const value = { ...assertion.value, reviewId: approval.id };
      selected.push({ collection: "assertions", value });
      return { ...row, assertionId: field(assertion.value, "id") };
    });
    const ids = new Set(
      selected.flatMap(({ value }) =>
        Array.isArray(value.evidenceReferenceIds)
          ? strings(value.evidenceReferenceIds)
          : [],
      ),
    );
    for (const item of plan.batch.rehearsal.referenceRecords)
      if (ids.has(field(item.value, "id"))) selected.push(item);
    const snapshots = [
      ...new Map(selected.map((row) => [row.value.id, row])).values(),
    ];
    for (const { collection, value } of snapshots) {
      const rows = collections.get(collection)!;
      const active = rows.find((row) => row.id === value.id);
      if (active && !same(active, value))
        throw new Error("Approved record conflicts with active catalog");
      if (!active) rows.push(value);
    }
    if (collections.get("reviews")!.some((row) => row.id === approval.id))
      throw new Error("Approval review ID is already in use");
    collections.get("reviews")!.push({
      ...approval,
      reviewedPlantAdmission: {
        batchSha256,
        records: snapshots,
        mappings,
        claims: [...admittedAssertions, ...admittedIdentityClaims],
        licensingAcceptanceId: plan.batch.licensingAcceptance.id,
      },
    });
    return await runDecisionTransaction({
      directory,
      descriptors: plan.descriptors,
      original,
      collections,
      fingerprint: (path) => authoringFingerprint(path, plan.descriptors),
      validateStage: async (path) => {
        await validateAuthoring(root, path);
      },
      beforePublish: async () => {
        const final = await prepareReviewedPlantBatch(root);
        if (
          !same(await readObject(file), approval) ||
          digest(
            await readFile(
              resolve(root, integrationPath, "reviewed-plant-batch.json"),
            ),
          ) !== batchSha256 ||
          (await batchBytes(final, receipt)) !== current
        )
          throw new Error("Decision batch inputs changed during admission");
      },
    });
  } finally {
    await unlock();
  }
}

async function batchBytes(
  plan: Awaited<ReturnType<typeof prepareReviewedPlantBatch>>,
  receipt: Awaited<ReturnType<typeof rehearseReviewedPlantBatch>>,
) {
  const batch = {
    ...plan.batch,
    rehearsal: { ...plan.batch.rehearsal, ...receipt },
  };
  return format(JSON.stringify(batch), { parser: "json" });
}

function renderCoverage(
  batch: Awaited<ReturnType<typeof prepareReviewedPlantBatch>>["batch"],
  sha256: string,
) {
  const countScopes = (outcome: string) =>
    batch.scopes.filter((row) => row.outcome === outcome).length;
  const countClaims = (outcome: string) =>
    batch.claims.filter((row) => row.outcome === outcome).length;
  const grouped = new Map<string, number>();
  for (const row of batch.claims.filter(
    (item) => item.outcome === "unresolved",
  ))
    grouped.set(
      row.assessmentGroup,
      (grouped.get(row.assessmentGroup) ?? 0) + 1,
    );
  const lines = [
    "# Full reviewed-plant integration coverage",
    "",
    "- Status: in progress",
    `- Latest review packets: ${batch.reviewedPackets.length}`,
    `- Selected packet proposals accounted for: ${batch.claims.length}`,
    `- Review scopes: ${batch.scopes.length} total, ${countScopes("admitted")} admitted mappings, ${countScopes("identity-decision")} staged identity decisions, ${countScopes("mapping-decision")} mappings to existing subjects awaiting approval, ${countScopes("applicability")} applicability contexts, ${countScopes("comparison")} comparisons, ${countScopes("unused")} unused and ${countScopes("unresolved")} unresolved.`,
    `- Facts: ${batch.activeCatalog.assertions.length} active catalog assertions, including ${batch.currentFacts.length} from earlier legacy admissions and ${batch.reviewedCultivationFacts} from reviewed-batch assertion admissions. Latest packets: ${countClaims("admitted")} admitted, ${countClaims("awaiting-content-approval")} rehearsed and awaiting factual approval, ${countClaims("awaiting-identity-approval")} included in WFO-backed identity decisions, ${countClaims("unresolved")} unresolved with a prerequisite or representation boundary.`,
    ...(batch.claims.some((row) => row.disposition)
      ? [
          `- Resolved batch dispositions: ${countClaims("already-represented")} already represented and ${countClaims("excluded")} excluded.${countClaims("superseded") ? ` A further ${countClaims("superseded")} original proposals were superseded by admitted replacements.` : ""} The [identity and existing facts decisions](reviewed-plant-step-2-decisions.md) have a [separate coverage report](reviewed-plant-step-2-coverage.md).`,
          ...(batch.claims.some(
            (row) =>
              row.disposition &&
              [
                "site-soil-and-light-bundles",
                "unmapped-soil-classes",
                "sun-alternatives",
                "plain-drainage",
                "ph-plus-site-guidance",
                "singleton-sun",
              ].includes(row.assessmentGroup),
          )
            ? [
                "- See the [site guidance decisions](reviewed-plant-site-decisions.md) and [123-proposal coverage](reviewed-plant-site-coverage.md).",
              ]
            : []),
        ]
      : []),
    ...(batch.claims.some(
      (row) =>
        row.disposition && row.assessmentGroup === "rotation-classification",
    )
      ? [
          "- See the [rotation classification decisions](reviewed-plant-rotation-decisions.md) and [52-proposal coverage](reviewed-plant-rotation-coverage.md).",
        ]
      : []),
    ...(batch.claims.some(
      (row) =>
        row.disposition &&
        [
          "harvest-stage-and-method",
          "storage-and-curing",
          "harvest-anchors-and-intervals",
          "nested-sowing-harvest-duration",
        ].includes(row.assessmentGroup),
    )
      ? [
          "- See the [harvest and storage decisions](reviewed-plant-harvest-decisions.md) and [76-proposal coverage](reviewed-plant-harvest-coverage.md).",
        ]
      : []),
    ...(batch.claims.some(
      (row) => row.disposition && wateringGroups.includes(row.assessmentGroup),
    )
      ? [
          "- See the [watering guidance decisions](reviewed-plant-watering-decisions.md) and [48-proposal coverage](reviewed-plant-watering-coverage.md).",
        ]
      : []),
    ...(batch.claims.some(
      (row) =>
        row.disposition && establishmentGroups.includes(row.assessmentGroup),
    )
      ? [
          "- See the [planting and establishment decisions](reviewed-plant-establishment-decisions.md) and [100-proposal coverage](reviewed-plant-establishment-coverage.md).",
        ]
      : []),
    ...(batch.claims.some(
      (row) =>
        row.disposition && temperatureGroups.includes(row.assessmentGroup),
    )
      ? [
          "- See the [temperature guidance decisions](reviewed-plant-temperature-decisions.md) and [40-proposal coverage](reviewed-plant-temperature-coverage.md).",
        ]
      : []),
    ...(batch.claims.some(
      (row) => row.disposition && careGroups.includes(row.assessmentGroup),
    )
      ? [
          "- See the [plant care decisions](reviewed-plant-care-decisions.md) and [66-proposal coverage](reviewed-plant-care-coverage.md).",
        ]
      : []),
    ...(batch.claims.some(
      (row) => row.disposition && nutritionGroups.includes(row.assessmentGroup),
    )
      ? [
          "- See the [nutrition guidance decisions](reviewed-plant-nutrition-decisions.md) and [22-proposal coverage](reviewed-plant-nutrition-coverage.md).",
        ]
      : []),
    ...(batch.claims.some(
      (row) =>
        row.disposition && row.assessmentGroup === "pollination-and-companions",
    )
      ? [
          "- See the [pollination decisions](reviewed-plant-pollination-decisions.md) and [14-proposal coverage](reviewed-plant-pollination-coverage.md).",
        ]
      : []),
    ...(batch.claims.some(
      (row) => row.disposition?.batch === "reviewed-remainder",
    )
      ? [
          "- The [delegated remainder decisions](reviewed-remainder-decisions.md) and [outcome register](reviewed-remainder-outcomes.json) account for each proposal unresolved at the start of that review.",
        ]
      : []),
    ...(batch.claims.some(
      (row) => row.disposition?.batch === "final-exceptions",
    )
      ? [
          "- The [final exception decisions](final-exceptions-decisions.md) and [outcome register](final-exceptions-outcomes.json) reconcile all 58 frozen original exceptions and their separately admitted replacements.",
        ]
      : []),
    `- Saint-Étienne: ${batch.localCalendarAssertions.length} of 8 approved seasonal recommendations admitted to authoring. The [local calendar](saint-etienne/README.md) records the exact scope, approval and source lineage. Commercial availability is blocked pending claim-level rights clearance.`,
    `- All ${batch.relationshipDecisions.length} approved relationships are retained. No comparison or parent link transfers a claim.`,
    `- Consolidated decision batch SHA-256: \`${sha256}\``,
    "",
    "Each proposal in the [decision batch](reviewed-plant-batch.json) includes its exact value, conditions, packet-qualified targets, evidence, original rights declarations, approval state and unresolved reasons. The table indexes those details by review. The batch preserves the existing authoring base fingerprint and the isolated rehearsal fingerprint.",
    "",
    "Julien’s [recorded licensing acceptance](licensing-acceptance.json) applies across the inventory. Evidence barred by recorded terms is commercially ineligible. Evidence with outstanding release or rights checks remains pending. The commercial counts below describe proposed evidence gates. They do not establish consumer publication readiness.",
    "",
    "## Per-review coverage",
    "",
    "| Review | Admitted packet scope bindings | Other scopes by outcome | Facts from packet | Selected proposals with commercially ineligible evidence |",
    "| --- | --- | --- | --- | --- |",
  ];
  const escaped = (value: string) => value.replaceAll("|", "\\|");
  for (const packet of batch.reviewedPackets) {
    const scopes = batch.scopes.filter(
      (row) => row.packetId === packet.packetId,
    );
    const claims = batch.claims.filter(
      (row) => row.packetId === packet.packetId,
    );
    const bindings = scopes
      .filter((row) => row.outcome === "admitted")
      .map((row) => `${escaped(row.label)} → \`${row.subject?.id}\``)
      .join("; ");
    const other = [
      "identity-decision",
      "mapping-decision",
      "applicability",
      "comparison",
      "unused",
      "unresolved",
    ]
      .flatMap((status) => {
        const count = scopes.filter((row) => row.outcome === status).length;
        return count ? [`${count} ${status}`] : [];
      })
      .join(", ");
    const facts = claims.filter((row) => row.outcome === "admitted").length;
    const pending = claims.filter(
      (row) =>
        row.outcome === "awaiting-content-approval" ||
        row.outcome === "awaiting-identity-approval",
    ).length;
    const represented = claims.filter(
      (row) => row.outcome === "already-represented",
    ).length;
    const excluded = claims.filter((row) => row.outcome === "excluded").length;
    const superseded = claims.filter(
      (row) => row.outcome === "superseded",
    ).length;
    const ineligible = claims.filter((row) =>
      row.evidence.some((entry) => entry.rightsDecision === "ineligible"),
    ).length;
    lines.push(
      `| [${escaped(packet.label)}](../../../${packet.path}) | ${bindings || "—"} | ${other || "—"} | ${facts} admitted, ${pending} awaiting approval, ${claims.filter((row) => row.outcome === "unresolved").length} unresolved${represented ? `, ${represented} already represented` : ""}${excluded ? `, ${excluded} excluded` : ""}${superseded ? `, ${superseded} superseded` : ""} | ${ineligible} of ${claims.length} |`,
    );
  }
  lines.push(
    "",
    "## Earlier tomato and lettuce decisions",
    "",
    "The approved lettuce identities are generic lettuce, head lettuce and loose-leaf lettuce. The two types link to the generic concept, with three pinned WFO/GROW/CropGraph source families and four approved source-record mappings. The existing tomato concept was reused.",
    "",
    "| Source-backed fact | Subject ID | Assertion ID |",
    "| --- | --- | --- |",
  );
  for (const fact of batch.currentFacts) {
    const assertion = object(fact.assertion);
    const id = field(assertion, "id");
    lines.push(
      `| \`${field(assertion, "predicate")}\` | \`${field(object(assertion.subject), "id")}\` | \`${id}\` |`,
    );
  }
  lines.push(
    "",
    "Additional earlier approvals retain their source, conditions and dates in the [legacy decision reconciliation](../../../docs/reviews/plant-review-legacy-reconciliation.md). They need the source and representation work listed there. The new GROW fact evidence retains pending commercial status.",
    "",
    "## Unresolved packet proposals by workstream",
    "",
    "| Workstream | Proposals |",
    "| --- | ---: |",
  );
  for (const [name, count] of [...grouped].sort(([a], [b]) =>
    a.localeCompare(b),
  ))
    lines.push(`| ${name} | ${count} |`);
  lines.push(
    "",
    "Bordeaux windows retain Bordeaux applicability. The [Saint-Étienne work](saint-etienne/README.md) is a separate local adaptation.",
    "",
  );
  return lines.join("\n");
}

if (process.argv[1] === import.meta.filename) {
  try {
    const root = dataRoot(process.cwd());
    const [option, approvalFile, ...extra] = process.argv
      .slice(2)
      .filter((arg) => arg !== "--");
    if (
      (option === "--apply-resolved" || option === "--rehearse-resolved") &&
      approvalFile &&
      !extra.length
    ) {
      console.log(
        JSON.stringify(
          await resolveReviewedPlantBatch(
            root,
            approvalFile,
            option === "--apply-resolved",
          ),
        ),
      );
    } else if (option === "--apply" && approvalFile && !extra.length) {
      console.log(
        JSON.stringify(await applyReviewedPlantBatch(root, approvalFile)),
      );
    } else {
      if (!["--write", "--check"].includes(option ?? "") || approvalFile)
        throw new Error(
          "Use --write, --check, --apply <approval.json>, --rehearse-resolved <approval.json> or --apply-resolved <approval.json>",
        );
      const plan = await prepareReviewedPlantBatch(root);
      const receipt = await rehearseReviewedPlantBatch(root, plan);
      const batch = {
        ...plan.batch,
        rehearsal: { ...plan.batch.rehearsal, ...receipt },
      };
      const output = resolve(
        root,
        integrationPath,
        "reviewed-plant-batch.json",
      );
      const bytes = await batchBytes(plan, receipt);
      const report = resolve(root, integrationPath, "full-coverage.md");
      const coverage = await format(
        renderCoverage(batch, digest(Buffer.from(bytes))),
        { parser: "markdown" },
      );
      if (option === "--write") {
        await mkdir(resolve(root, integrationPath), { recursive: true });
        await writeFile(output, bytes);
        await writeFile(report, coverage);
      } else if (
        (await readFile(output, "utf8")) !== bytes ||
        (await readFile(report, "utf8")) !== coverage
      )
        throw new Error("Stale reviewed plant batch or coverage report");
      console.log(
        JSON.stringify({
          packets: batch.reviewedPackets.length,
          scopes: batch.scopes.length,
          identityRecords: batch.identityRecords.length,
          proposals: batch.claims.length,
          stagedAssertions: batch.rehearsal.assertions.length,
          legacyFactsAdmitted: batch.currentFacts.length,
        }),
      );
    }
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
