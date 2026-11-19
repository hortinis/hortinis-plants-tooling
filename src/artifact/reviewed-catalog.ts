import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { authoringFingerprint } from "../curation/decision-transaction.js";
import {
  catalogPath,
  validateAuthoring,
} from "../curation/reviewed-licensing-acceptance.js";
import {
  contentDigest,
  digest,
  object,
  records,
  strings,
  same,
} from "../curation/curation-artifacts.js";
import type {
  DatasetRecord,
  ValidationDataset,
} from "../curation/validation-dataset.js";
import { projectCatalog } from "../domain/catalog-projection.js";
import {
  cacheRoot,
  dataRoot,
  outputRoot,
  toolingRoot,
} from "../repository-paths.js";
import {
  buildCatalogCandidate,
  ingestCatalogCandidate,
} from "./catalog-candidate.js";

export const scopePath = "data/releases/reviewed-catalog";

/** Active graph references only. Immutable admission snapshots are historical, not active dependencies. */
export function releaseReferences(row: DatasetRecord): string[] {
  const source = object(object(row.sourceRecordKey ?? { source: row }).source);
  return [
    row.contextId,
    row.reviewId,
    object(row.subject ?? {}).id,
    row.taxonId,
    row.parentTaxonId,
    row.acceptedTaxonomicNameId,
    row.parentPlantConceptId,
    row.plantConceptId,
    row.cultivarGroupId,
    row.parentGeographicContextId,
    ...(row.includedRecordIds
      ? [row.sourceId, row.licenceId, ...strings(row.includedRecordIds)]
      : []),
    ...strings(row.evidenceReferenceIds ?? []),
    ...strings(row.cultivarGroupIds ?? []),
    ...strings(row.parentGeographicContextIds ?? []),
    ...strings(object(row.geographicScope ?? {}).geographicContextIds ?? []),
    ...(row.rights
      ? [
          object(row.rights).licenceId,
          object(row.rights).reviewId,
          source.sourceId,
        ]
      : []),
  ].filter((id): id is string => typeof id === "string");
}

/** Selection never changes applicability and never substitutes administrative licensing acceptance for rights. */
export function selectReviewedCatalog(
  dataset: ValidationDataset,
  subjectIds: readonly string[],
  mode: "authoring" | "commercial",
) {
  const projected = projectCatalog(dataset, mode);
  const byId = new Map(
    Object.values(projected).flatMap((rows) =>
      rows.map((row) => [String(row.id), row] as const),
    ),
  );
  const roots = new Set(subjectIds);
  const selected = new Set<string>();
  const visit = (id: string) => {
    if (selected.has(id)) return;
    const row = byId.get(id);
    if (!row) throw new Error("Missing eligible release dependency: " + id);
    selected.add(id);
    releaseReferences(row).forEach(visit);
  };
  for (const id of roots) if (mode === "authoring" || byId.has(id)) visit(id);
  for (const kind of ["plant-fact", "cultivation-rule", "localized-name"])
    for (const row of projected[kind] ?? [])
      if (roots.has(String(object(row.subject).id))) visit(String(row.id));
  // Synonyms and localized taxon names are selected only for the resulting identity graph.
  for (const row of projected["taxonomic-name"] ?? [])
    if (selected.has(String(row.taxonId))) visit(String(row.id));
  for (const row of projected["localized-name"] ?? [])
    if (selected.has(String(object(row.subject).id))) visit(String(row.id));
  return Object.fromEntries(
    Object.entries(projected).map(([kind, rows]) => [
      kind,
      rows.filter((row) => selected.has(String(row.id))),
    ]),
  );
}

/** Reconcile exact accepted receipt snapshots, including supported records accidentally omitted from live collections. */
export function findAdmissionOmissions(dataset: ValidationDataset) {
  const live = new Map<string, DatasetRecord>();
  for (const rows of Object.values(dataset))
    if (Array.isArray(rows))
      for (const row of rows as DatasetRecord[])
        if (typeof row.id === "string") live.set(row.id, row);
  const omissions: DatasetRecord[] = [];
  for (const review of dataset.reviews) {
    if (review.status !== "accepted") continue;
    for (const key of [
      "reviewedPlantAdmission",
      "legacyPlantAdmission",
      "calendarAdmission",
      "canonicalSubjectAdmission",
      "supplementalAdmission",
    ])
      for (const snapshot of records(object(review[key] ?? {}).records ?? [])) {
        const value = object(snapshot.value),
          current = live.get(String(value.id));
        if (!current || contentDigest(current) !== contentDigest(value))
          omissions.push({
            reviewId: review.id,
            collection: snapshot.collection,
            id: value.id,
            reason: current
              ? "Admitted record changed"
              : "Approved receipt record missing",
            value,
          });
      }
  }
  return omissions;
}

export async function prepareReviewedCatalog(root: string) {
  const read = async (path: string) =>
    object(JSON.parse(await readFile(resolve(root, path), "utf8")));
  const definition = await read(scopePath + "/profile.json");
  const pins = await read(scopePath + "/starting-pins.json");
  const { dataset, manifest } = await validateAuthoring(
    root,
    resolve(root, catalogPath),
  );
  const fingerprint = await authoringFingerprint(
    resolve(root, catalogPath),
    manifest.collections,
  );
  if (
    fingerprint !== definition.datasetSha256 ||
    fingerprint !== pins.datasetSha256
  )
    throw new Error(
      "Catalog differs from verified final audit; review and freeze a new scope explicitly",
    );
  for (const [path, hash] of Object.entries(object(pins.files)))
    if (digest(await readFile(resolve(root, path))) !== hash)
      throw new Error("Preserved input changed: " + path);
  for (const pin of manifest.dependencies)
    if (digest(await readFile(resolve(root, pin.path))) !== pin.sha256)
      throw new Error("Source pin changed: " + pin.path);
  const batch = await read(
    "data/curation/plant-integration/reviewed-plant-batch.json",
  );
  const inventory = await read(
    "data/curation/plant-review-consolidation/inventory.json",
  );
  if (
    batch.baseDatasetSha256 !== fingerprint ||
    batch.inventoryFingerprint !== inventory.inputFingerprint
  )
    throw new Error("Stale integration inventory");
  const omissions = findAdmissionOmissions(dataset);
  if (omissions.length)
    throw new Error(
      "Exact approved admissions require a pinned transaction: " +
        JSON.stringify(omissions),
    );
  const subjectRecords = [
    ...dataset.plantConcepts,
    ...dataset.cultivars,
    ...(dataset.cultivarGroups ?? []),
  ].filter((row) => row.status === "active");
  const subjectIds = subjectRecords.map((row) => String(row.id)).sort();
  const authoring = selectReviewedCatalog(dataset, subjectIds, "authoring");
  const commercial = selectReviewedCatalog(dataset, subjectIds, "commercial");
  const contentIds = new Set(
    Object.values(authoring).flatMap((rows) => rows.map((row) => row.id)),
  );
  const commercialIds = new Set(
    Object.values(commercial).flatMap((rows) => rows.map((row) => row.id)),
  );
  const scopes: DatasetRecord[] = records(batch.scopes).map((row) => {
    const binding = row.subject ?? row.parentSubject ?? null;
    if (row.outcome === "admitted" && !contentIds.has(object(binding).id))
      throw new Error("Reviewed identity missing: " + String(row.id));
    if (
      !["admitted", "applicability", "unused", "comparison"].includes(
        String(row.outcome),
      )
    )
      throw new Error("Unresolved reviewed identity: " + String(row.id));
    return {
      ...row,
      exactCatalogSubject: binding,
      disposition:
        row.outcome === "admitted"
          ? "included"
          : row.outcome === "applicability"
            ? "included-as-qualification"
            : "excluded",
      commerciallyEmitted:
        binding !== null && commercialIds.has(object(binding).id),
      qualification: row.outcome === "applicability" ? row.label : null,
    };
  });
  const packets = [];
  for (const packet of records(inventory.packets)) {
    if (
      digest(await readFile(resolve(root, String(packet.path)))) !==
      packet.sha256
    )
      throw new Error("Latest packet changed");
    const mappings = scopes.filter((row) => row.packetId === packet.id);
    if (mappings.length !== records(packet.scopes).length)
      throw new Error("Incomplete packet scope inventory");
    packets.push({
      id: packet.id,
      revision: packet.revision,
      path: packet.path,
      sha256: packet.sha256,
      plant: packet.plant,
      scopeMappingIds: mappings.map((row) => row.id),
    });
  }
  const claims = records(batch.claims).map((row) => ({
    packetId: row.packetId,
    packetSha256: row.packetSha256,
    claimId: object(row.claim).id,
    outcome: row.outcome,
    reasons: row.reasons,
    admissionReviewIds: row.admissionReviewIds,
    targets: row.targets,
  }));
  const unresolved = claims.filter((row) => row.outcome === "unresolved");
  const originals = await read(
    "data/curation/plant-integration/final-exceptions-outcomes.json",
  );
  const originalExceptionDenominator = records(originals.originals).length;
  const deferredOriginals = records(originals.originals).filter(
    (row) => row.outcome === "still-deferred",
  );
  if (
    originals.originalExceptionDenominator !== originalExceptionDenominator ||
    definition.originalExceptionDenominator !== originalExceptionDenominator ||
    definition.deferredOriginals !== deferredOriginals.length ||
    unresolved.length !== deferredOriginals.length
  )
    throw new Error("Original exception accounting changed");
  for (const claim of claims) {
    if (
      claim.outcome === "admitted" &&
      !strings(claim.admissionReviewIds).every((id) =>
        dataset.reviews.some(
          (row) => row.id === id && row.status === "accepted",
        ),
      )
    )
      throw new Error("Missing exact approval");
  }
  const evidenceById = new Map(dataset.evidence.map((row) => [row.id, row]));
  const authoredById = new Map(
    Object.values(authoring).flatMap((rows) =>
      rows.map((row) => [String(row.id), row] as const),
    ),
  );
  const blockers = (id: string) => {
    const visited = new Set<string>(),
      result: DatasetRecord[] = [];
    const visit = (key: string) => {
      if (visited.has(key)) return;
      visited.add(key);
      const row = authoredById.get(key);
      if (!row) return;
      if (evidenceById.has(key)) {
        const rights = object(row.rights);
        const licence = dataset.licences?.find(
          (item) => item.id === rights.licenceId,
        );
        const review = dataset.reviews.find(
          (item) => item.id === rights.reviewId,
        );
        if (
          rights.decision !== "eligible" ||
          licence?.commercialUse !== "allowed" ||
          review?.status !== "accepted" ||
          review.purpose !== "rights"
        )
          result.push({
            evidenceId: key,
            locator: row.locator,
            rights,
            licenceCommercialUse: licence?.commercialUse ?? null,
            rightsReviewStatus: review?.status ?? null,
          });
      }
      releaseReferences(row).forEach(visit);
    };
    visit(id);
    return result;
  };
  const subjects = subjectRecords.map((row) => ({
    id: row.id,
    kind: row.denomination
      ? "cultivar"
      : row.kind === "growing-type"
        ? "growing-type"
        : "plant",
    sha256: contentDigest(row),
    disposition: "included",
    commercialDisposition: commercialIds.has(row.id) ? "included" : "blocked",
    commercialReason: commercialIds.has(row.id)
      ? null
      : "Exact subject evidence or identity dependency fails existing commercial eligibility; administrative acceptance does not clear it.",
    commercialBlockers: commercialIds.has(row.id)
      ? []
      : blockers(String(row.id)),
    scopeMappingIds: scopes
      .filter((scope) => object(scope.exactCatalogSubject ?? {}).id === row.id)
      .map((scope) => scope.id),
    provenance: scopes.some(
      (scope) => object(scope.exactCatalogSubject ?? {}).id === row.id,
    )
      ? "reviewed identity receipt"
      : "existing admitted legacy identity or required parent",
  }));
  const counts = {
    packets: packets.length,
    scopes: scopes.length,
    plants: subjects.filter((row) => row.kind === "plant").length,
    growingTypes: subjects.filter((row) => row.kind === "growing-type").length,
    cultivars: subjects.filter((row) => row.kind === "cultivar").length,
    includedSubjects: subjects.length,
    blockedContentSubjects: 0,
    commerciallyIncludedSubjects: subjects.filter(
      (row) => row.commercialDisposition === "included",
    ).length,
    commerciallyBlockedSubjects: subjects.filter(
      (row) => row.commercialDisposition === "blocked",
    ).length,
    selectedProposals: claims.length,
    newAdmissions: 0,
    approvedOmissions: omissions.length,
    originalExceptionDenominator,
    deferredOriginals: deferredOriginals.length,
  };
  return {
    dataset,
    definition,
    preservedInputFiles: Object.keys(object(pins.files)).length,
    dependencies: manifest.dependencies.map((row) => ({
      path: row.path,
      role: row.role,
      sha256: row.sha256,
    })),
    authoring,
    commercial,
    inventory: {
      status: "validated",
      reviewer: "Codex, agent review under delegated authority",
      profile: "reviewed-catalog",
      datasetSha256: fingerprint,
      inventoryFingerprint: inventory.inputFingerprint,
      counts,
      packets,
      scopes,
      subjects,
      claims,
      originalOutcomes: originals.originalOutcomes,
      deferredOriginals,
      recordSelection: Object.fromEntries(
        Object.entries(authoring).map(([kind, rows]) => [
          kind,
          rows.map((row) => ({
            id: row.id,
            sha256: contentDigest(row),
            commercialDisposition: commercialIds.has(row.id)
              ? "included"
              : "filtered-out",
          })),
        ]),
      ),
      dependencies: manifest.dependencies.map((row) => ({ ...row })),
    },
  };
}

export async function buildReviewedCatalog(root: string, write: boolean) {
  const {
    inventory,
    dependencies,
    commercial,
    authoring,
    definition,
    preservedInputFiles,
  } = await prepareReviewedCatalog(root);
  const text = JSON.stringify(inventory, null, 2) + "\n";
  const frozenPath = resolve(root, scopePath, "inventory.json");
  if (write) {
    await mkdir(resolve(root, scopePath), { recursive: true });
    // Freeze once; subsequent runs verify rather than silently replacing the approved scope.
    try {
      if ((await readFile(frozenPath, "utf8")) !== text)
        throw new Error("Frozen scope already exists with different bytes");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await writeFile(frozenPath, text);
    }
    await writeFile(
      resolve(root, scopePath, "inventory.sha256"),
      digest(Buffer.from(text)) + "  inventory.json\n",
    );
  } else {
    if ((await readFile(frozenPath, "utf8")) !== text)
      throw new Error("Frozen scope is stale");
    if (
      (await readFile(resolve(root, scopePath, "inventory.sha256"), "utf8")) !==
      digest(Buffer.from(text)) + "  inventory.json\n"
    )
      throw new Error("Inventory checksum mismatch");
  }
  if (
    definition.name !== "reviewed-catalog" ||
    definition.inventorySha256 !== digest(Buffer.from(text)) ||
    !same(definition.subjectIds, inventory.subjects.map((row) => row.id).sort())
  )
    throw new Error("Profile differs from frozen scope");
  const all = new Map(
    [...commercial.source!, ...commercial.licence!].map((row) => [row.id, row]),
  );
  const attributions = commercial["evidence-reference"]!.map((row) => {
    const source = object(
        object(row.sourceRecordKey ?? { source: row }).source,
      ),
      rights = object(row.rights);
    return {
      id: "attribution-" + String(row.id),
      sourceId: source.sourceId,
      sourceReleaseId: source.sourceReleaseId,
      sourceLocator: row.locator,
      licenceId: rights.licenceId,
      requiredNotice:
        all.get(rights.licenceId)?.requiredNotice ??
        all.get(rights.licenceId)?.name,
      profile: "reviewed-catalog",
      includedRecordIds: [row.id],
    };
  });
  const sourceIds = new Set(commercial.source!.map((row) => row.id));
  const read = async (path: string) =>
    JSON.parse(await readFile(path, "utf8")) as DatasetRecord;
  const sourceManifests = await Promise.all(
    dependencies
      .filter((row) => row.role === "source-manifest")
      .map((row) => read(resolve(root, row.path))),
  );
  const schemas = [];
  for (const directory of [
    "catalog/v1",
    "authoring/v1",
    "curation/v1",
    "source-manifest/v1",
    "importer/v1",
  ])
    for (const name of (
      await readdir(resolve(toolingRoot, "schemas", directory))
    )
      .filter((name) => name.endsWith(".json"))
      .sort())
      schemas.push(
        await read(resolve(toolingRoot, "schemas", directory, name)),
      );
  const metadata = {
    "schemas.json": {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:hortinis:plants:schema:v1:audit-bundle",
      $defs: Object.fromEntries(schemas.map((row) => [String(row.$id), row])),
    },
    "source-manifests.json": sourceManifests.filter((row) =>
      sourceIds.has(object(row.provider).id),
    ),
    "candidate-scope.json": {
      profile: "reviewed-catalog",
      publishable: false,
      inventorySha256: digest(Buffer.from(text)),
      counts: inventory.counts,
      limitations: [
        "Commercial eligibility filters remain operative. Filtered records are not released.",
        "Consumer compatibility, rights clearance and two clean-checkout builds remain release prerequisites.",
      ],
    },
  };
  const families = { ...commercial, attribution: attributions };
  const directory = resolve(
    outputRoot(root),
    "artifacts/releases/reviewed-catalog/candidate",
  );
  const first = await buildCatalogCandidate(directory, families, metadata, {
    profile: "reviewed-catalog",
  });
  const contentDirectory = resolve(
    outputRoot(root),
    "artifacts/releases/reviewed-catalog/content-rehearsal",
  );
  const contentManifest = await buildCatalogCandidate(
    contentDirectory,
    authoring,
    {
      ...metadata,
      "source-manifests.json": sourceManifests,
      "candidate-scope.json": {
        ...metadata["candidate-scope.json"],
        mode: "content-rehearsal",
        publishable: false,
        limitations: [
          "Authoring selection rehearsal only; contains pending rights. Not commercial output.",
        ],
      },
    },
  );
  for (const [path, selected] of [
    [directory, families],
    [contentDirectory, authoring],
  ] as const) {
    const ingested = await ingestCatalogCandidate(path);
    for (const [kind, rows] of Object.entries(selected))
      if (
        !same(
          [...rows].sort((a, b) =>
            String(a.id).localeCompare(String(b.id), "en"),
          ),
          ingested.families[kind] ?? [],
        )
      )
        throw new Error("Candidate round trip lost records");
    const ids = new Set(
      Object.values(selected).flatMap((rows) => rows.map((row) => row.id)),
    );
    for (const rows of Object.values(selected))
      for (const row of rows)
        if (releaseReferences(row).some((id) => !ids.has(id)))
          throw new Error("Dangling candidate dependency");
  }
  const result = {
    status: "validated",
    counts: inventory.counts,
    inventorySha256: digest(Buffer.from(text)),
    manifestSha256: contentDigest(first),
    contentRehearsalManifestSha256: contentDigest(contentManifest),
    authoring: Object.fromEntries(
      Object.entries(authoring).map(([k, v]) => [k, v.length]),
    ),
    commercial: Object.fromEntries(
      Object.entries(families).map(([k, v]) => [k, v.length]),
    ),
    roundTrip: true,
    referenceIntegrity: true,
    preservedInputFiles,
    sourceDependencies: dependencies.length,
  };
  const receiptDirectory = resolve(
    cacheRoot(root),
    "verification/reviewed-catalog",
  );
  await mkdir(receiptDirectory, {
    recursive: true,
  });
  await writeFile(
    resolve(receiptDirectory, "projection.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  return result;
}

if (process.argv[1] === import.meta.filename) {
  if (!["--write", "--check"].includes(process.argv[2] ?? ""))
    throw new Error("Use --write or --check");
  console.log(
    JSON.stringify(
      await buildReviewedCatalog(
        dataRoot(process.cwd()),
        process.argv[2] === "--write",
      ),
    ),
  );
}
