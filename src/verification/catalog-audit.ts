import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  validateAuthoring,
  catalogPath,
  integrationPath,
} from "../curation/reviewed-licensing-acceptance.js";
import { authoringFingerprint } from "../curation/decision-transaction.js";
import {
  contentDigest,
  digest,
  object,
  records,
  same,
  strings,
} from "../curation/curation-artifacts.js";
import { projectCatalog } from "../domain/catalog-projection.js";
import { assertionSupersession } from "../domain/assertion-supersession.js";
import {
  buildCatalogCandidate,
  ingestCatalogCandidate,
} from "../artifact/catalog-candidate.js";
import { serializeCanonicalJson } from "../serialization/canonical-json.js";
import type { DatasetRecord } from "../curation/validation-dataset.js";
import {
  cacheRoot,
  dataRoot,
  outputRoot,
  toolingRoot,
} from "../repository-paths.js";

/** Reproducible full-catalog ledger and isolated, non-publishable consumer acquisition audit. */
export async function auditCatalog(root: string) {
  const workspace = outputRoot(root);
  const output = resolve(workspace, integrationPath, "final-catalog-audit");
  const artifactDirectory = resolve(
    workspace,
    "artifacts/releases/final-catalog-audit",
  );
  await mkdir(output, { recursive: true });
  const read = async (path: string) =>
    object(JSON.parse(await readFile(resolve(root, path), "utf8")));
  const save = async (name: string, value: unknown) =>
    writeFile(join(output, name), JSON.stringify(value, null, 2) + "\n");
  const { dataset, manifest } = await validateAuthoring(
    root,
    resolve(root, catalogPath),
  );
  const fingerprint = await authoringFingerprint(
    resolve(root, catalogPath),
    manifest.collections,
  );
  const authoring = projectCatalog(dataset, "authoring"),
    commercial = projectCatalog(dataset, "commercial");
  const retired = assertionSupersession(dataset);
  const all = new Map<unknown, DatasetRecord>();
  for (const rows of Object.values(dataset))
    if (Array.isArray(rows))
      for (const row of rows as DatasetRecord[])
        if (row.id) all.set(row.id, row);
  const byId = new Map(
    [...authoring["plant-fact"]!, ...authoring["cultivation-rule"]!].map(
      (row) => [row.id, row],
    ),
  );
  const lineage = new Map<unknown, unknown[]>();
  for (const review of dataset.reviews) {
    for (const admission of [
      review.reviewedPlantAdmission,
      review.legacyPlantAdmission,
      review.calendarAdmission,
    ]) {
      if (!admission) continue;
      for (const snapshot of records(object(admission).records ?? [])) {
        const value = object(snapshot.value),
          owners = lineage.get(value.id) ?? [];
        owners.push({
          reviewId: review.id,
          collection: snapshot.collection,
          sha256: contentDigest(value),
          resolutionPath: review.resolutionPath ?? null,
        });
        lineage.set(value.id, owners);
      }
    }
  }
  const names = dataset.localizedNames ?? [];
  const rows = dataset.assertions.map((assertion) => {
    const projected = byId.get(assertion.id),
      context = all.get(assertion.contextId)!;
    if (!context || !all.has(object(assertion.subject).id))
      throw new Error("Missing assertion dependency");
    if (
      !retired.has(assertion.id) &&
      (!projected ||
        !same(projected.subject, assertion.subject) ||
        !same(projected.evidenceReferenceIds, assertion.evidenceReferenceIds) ||
        projected.contextId !== assertion.contextId ||
        projected.reviewId !== assertion.reviewId ||
        (assertion.predicate !== "cultivation_window" &&
          !same(projected.value, assertion.value)))
    )
      throw new Error("Lossy consumer projection");
    const evidence = strings(assertion.evidenceReferenceIds).map((id) =>
      all.get(id)!,
    );
    return {
      id: assertion.id,
      status: retired.has(assertion.id) ? "superseded" : "active",
      assertionSha256: contentDigest(assertion),
      subject: all.get(object(assertion.subject).id),
      names: names.filter((name) => same(name.subject, assertion.subject)),
      predicate: assertion.predicate,
      value: assertion.value,
      context,
      geography: strings(
        object(context.geographicScope).geographicContextIds ?? [],
      ).map((id) => all.get(id)),
      evidence: evidence.map((entry) => ({
        record: entry,
        source: all.get(
          object(object(entry.sourceRecordKey ?? { source: entry }).source)
            .sourceId,
        ),
        licence: all.get(object(entry.rights).licenceId),
        rightsReview: all.get(object(entry.rights).reviewId)?.id,
      })),
      contentReviewId: assertion.reviewId,
      admissionLineage: lineage.get(assertion.id) ?? [],
      authoringProjected: !!projected,
      commercialProjected: [
        ...commercial["plant-fact"]!,
        ...commercial["cultivation-rule"]!,
      ].some((row) => row.id === assertion.id),
    };
  });
  await save("assertion-ledger.json", {
    status: "validated",
    datasetSha256: fingerprint,
    rows,
  });
  await save("identity-name-ledger.json", {
    status: "validated",
    taxa: dataset.taxa,
    taxonomicNames: dataset.taxonomicNames,
    plantConcepts: dataset.plantConcepts,
    cultivars: dataset.cultivars,
    localizedNames: names.map((row) => ({
      record: row,
      admissionLineage: lineage.get(row.id) ?? [],
      authoringProjected: authoring["localized-name"]!.some(
        (name) => name.id === row.id,
      ),
      commercialProjected: commercial["localized-name"]!.some(
        (name) => name.id === row.id,
      ),
    })),
  });
  const starting = await read(
    integrationPath + "/final-catalog-audit/starting-pins.json",
  );
  let packetPins = 0;
  for (const [path, hash] of Object.entries(object(starting.files)))
    if (
      path.startsWith("data/curation/plant-review-packets/") ||
      path.includes("/final-exceptions-")
    ) {
      if (digest(await readFile(resolve(root, path))) !== hash)
        throw new Error("Historical artifact changed: " + path);
      packetPins++;
    }
  let preservedRecords = 0;
  for (const descriptor of manifest.collections) {
    const baseline = await readFile(
      resolve(
        cacheRoot(root),
        "verification/final-catalog-audit/baseline",
        descriptor.path,
      ),
      "utf8",
    );
    const current = new Set(
      (
        await readFile(resolve(root, catalogPath, descriptor.path), "utf8")
      ).split("\n"),
    );
    for (const line of baseline.split("\n").filter(Boolean)) {
      if (!current.has(line))
        throw new Error("Historical record bytes changed: " + descriptor.path);
      preservedRecords++;
    }
  }
  const outcomes = await read(
    integrationPath + "/final-exceptions-outcomes.json",
  );
  if (
    outcomes.originalExceptionDenominator !== 58 ||
    records(outcomes.originals).filter(
      (row) => row.outcome === "still-deferred",
    ).length !== 19 ||
    records(outcomes.replacements).length !== 48
  )
    throw new Error("Original exception accounting changed");
  const replacementAudit = [];
  for (const replacement of records(outcomes.replacements)) {
    if (
      digest(await readFile(resolve(root, String(replacement.packet)))) !==
      replacement.packetSha256
    )
      throw new Error("Changed replacement packet");
    const review = all.get(replacement.reviewId)!;
    if (!review || review.purpose !== "content" || review.status !== "accepted")
      throw new Error("Missing exact replacement approval");
    const linked = records(replacement.records).map((link) => {
      const live = all.get(link.id)!;
      if (!live || contentDigest(live) !== link.sha256)
        throw new Error("Changed admitted replacement record");
      return {
        ...link,
        active: !retired.has(link.id),
        authoringProjected: Object.values(authoring).some((rows) =>
          rows.some((row) => row.id === link.id),
        ),
        commercialProjected: Object.values(commercial).some((rows) =>
          rows.some((row) => row.id === link.id),
        ),
      };
    });
    replacementAudit.push({ ...replacement, records: linked });
  }
  const finalNameIds = new Set(
    dataset.reviews
      .filter(
        (review) =>
          typeof review.resolutionPath === "string" &&
          review.resolutionPath.startsWith(
            integrationPath + "/final-exceptions-",
          ),
      )
      .flatMap((review) =>
        records(object(review.reviewedPlantAdmission).records)
          .filter((row) => row.collection === "localized-names")
          .map((row) => object(row.value).id),
      ),
  );
  if (finalNameIds.size !== 27)
    throw new Error("Missing previous localized-name additions");
  await save("replacement-audit.json", {
    status: "validated",
    proposals: replacementAudit,
    localizedNameIds: [...finalNameIds],
  });
  const local = dataset.reviews
    .filter((row) => row.calendarAdmission)
    .flatMap((review) =>
      records(object(review.calendarAdmission).lineage).map((link) => ({
        reviewId: review.id,
        approval: review,
        link,
        assertion: all.get(link.assertionId),
        consumer: byId.get(link.assertionId),
      })),
    );
  if (local.length !== 8 || local.some((row) => !row.consumer))
    throw new Error("Missing local calendar recommendations");
  await save("saint-etienne-audit.json", { status: "validated", rows: local });
  const dependencies = [];
  for (const dependency of manifest.dependencies) {
    const bytes = await readFile(resolve(root, dependency.path));
    if (digest(bytes) !== dependency.sha256)
      throw new Error("Changed source dependency");
    dependencies.push({ path: dependency.path, sha256: dependency.sha256 });
  }
  const schemas = [];
  for (const directory of [
    "catalog/v1",
    "authoring/v1",
    "curation/v1",
    "source-manifest/v1",
    "importer/v1",
  ]) {
    for (const name of (
      await readdir(resolve(toolingRoot, "schemas", directory))
    )
      .filter((name) => name.endsWith(".json"))
      .sort())
      schemas.push(
        object(
          JSON.parse(
            await readFile(
              resolve(toolingRoot, "schemas", directory, name),
              "utf8",
            ),
          ),
        ),
      );
  }
  const attributions = authoring["evidence-reference"]!.map((entry) => {
    const source = object(
        object(entry.sourceRecordKey ?? { source: entry }).source,
      ),
      rights = object(entry.rights),
      licence = all.get(rights.licenceId)!;
    return {
      id: "attribution-" + String(entry.id),
      sourceId: source.sourceId,
      sourceReleaseId: source.sourceReleaseId,
      sourceLocator: entry.locator,
      licenceId: rights.licenceId,
      requiredNotice: licence.requiredNotice ?? licence.name,
      profile: "dev-validation",
      includedRecordIds: [entry.id],
    };
  });
  const metadata = {
    "schemas.json": {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:hortinis:plants:schema:v1:audit-bundle",
      $defs: Object.fromEntries(schemas.map((row) => [String(row.$id), row])),
    },
    "source-provenance.json": records(
      (await read(integrationPath + "/preparation.json")).sources,
    ),
    "source-manifests.json": await Promise.all(
      manifest.dependencies
        .filter((row) => row.role === "source-manifest")
        .map((row) => read(row.path)),
    ),
    "candidate-scope.json": {
      status: "validated",
      publishable: false,
      profile: "authoring-audit",
      datasetSha256: fingerprint,
      limitations: [
        "Claim-level rights remain pending; not a commercial release.",
        "Compatibility policy and minimum consumer version require coordination.",
        "Only local acquisition is exercised; no browser IndexedDB application is present in this repository.",
      ],
    },
  };
  const families: Record<string, readonly DatasetRecord[]> = {
    ...authoring,
    attribution: attributions,
  };
  const first = await buildCatalogCandidate(
    resolve(artifactDirectory, "a"),
    families,
    metadata,
  );
  const second = await buildCatalogCandidate(
    resolve(artifactDirectory, "b"),
    families,
    metadata,
  );
  if (!same(first, second)) throw new Error("Nondeterministic candidate build");
  const ingested = await ingestCatalogCandidate(
    resolve(artifactDirectory, "a"),
  );
  for (const [kind, entries] of Object.entries(families))
    if (
      !same(
        [...entries].sort((a, b) =>
          String(a.id).localeCompare(String(b.id), "en"),
        ),
        ingested.families[kind] ?? [],
      )
    )
      throw new Error("Round trip lost records: " + kind);
  // Independently check active cross-record references; immutable review snapshots are history, not active facts.
  const emitted = new Set(
    Object.values(families).flatMap((rows) => rows.map((row) => row.id)),
  );
  for (const [kind, entries] of Object.entries(families))
    for (const row of entries) {
      const refs = [
        row.contextId,
        row.reviewId,
        object(row.subject ?? {}).id,
        row.taxonId,
        row.parentPlantConceptId,
        row.plantConceptId,
        row.parentTaxonId,
        row.acceptedTaxonomicNameId,
        ...strings(row.evidenceReferenceIds ?? []),
        ...strings(row.cultivarGroupIds ?? []),
        ...strings(row.parentGeographicContextIds ?? []),
        ...strings(
          object(row.geographicScope ?? {}).geographicContextIds ?? [],
        ),
      ].filter((id) => id !== undefined);
      if (refs.some((id) => !emitted.has(id)))
        throw new Error(
          "Dangling consumer reference: " + kind + "/" + String(row.id),
        );
    }
  const comparisons = new Map<string, DatasetRecord[]>();
  for (const row of rows.filter((row) => row.status === "active")) {
    const context: Record<string, unknown> = { ...row.context };
    delete context.id;
    const key = contentDigest({
      subject: row.subject?.id,
      predicate: row.predicate,
      context,
    });
    const group = comparisons.get(key) ?? [];
    group.push({ id: row.id, value: row.value, evidence: row.evidence });
    comparisons.set(key, group);
  }
  await save("guidance-comparisons.json", {
    status: "validated",
    policy:
      "Different source values remain independent; no averaging, inherited scope or automatic preference.",
    comparableScopes: [...comparisons.values()].filter(
      (group) => group.length > 1,
    ),
  });
  await save("deferred-originals.json", {
    status: "blocked",
    originalExceptionDenominator: 58,
    rows: records(outcomes.originals).filter(
      (row) => row.outcome === "still-deferred",
    ),
  });
  const commercialSourceIds = new Set(commercial.source!.map((row) => row.id));
  const commercialEvidenceIds = new Set(
    commercial["evidence-reference"]!.map((row) => row.id),
  );
  const commercialMetadata = {
    "schemas.json": metadata["schemas.json"],
    "source-manifests.json": metadata["source-manifests.json"].filter((row) =>
      commercialSourceIds.has(object(row.provider).id),
    ),
    "candidate-scope.json": {
      publishable: false,
      profile: "commercial-filter-audit",
      datasetSha256: fingerprint,
    },
  };
  const commercialFamilies = {
    ...commercial,
    attribution: attributions.filter((row) =>
      row.includedRecordIds.some((id) => commercialEvidenceIds.has(id)),
    ),
  };
  const commercialFirst = await buildCatalogCandidate(
    resolve(artifactDirectory, "commercial-a"),
    commercialFamilies,
    commercialMetadata,
  );
  const commercialSecond = await buildCatalogCandidate(
    resolve(artifactDirectory, "commercial-b"),
    commercialFamilies,
    commercialMetadata,
  );
  if (!same(commercialFirst, commercialSecond))
    throw new Error("Nondeterministic commercial-filter candidate");
  const commercialIngested = await ingestCatalogCandidate(
    resolve(artifactDirectory, "commercial-a"),
  );
  for (const [kind, entries] of Object.entries(commercialFamilies))
    if (
      !same(
        [...entries].sort((a, b) =>
          String(a.id).localeCompare(String(b.id), "en"),
        ),
        commercialIngested.families[kind] ?? [],
      )
    )
      throw new Error("Commercial round trip lost records");
  const summary = {
    status: "validated",
    datasetSha256: fingerprint,
    storedAssertions: dataset.assertions.length,
    activeAssertions: byId.size,
    supersededAssertions: retired.size,
    historicalArtifactsVerified: packetPins,
    historicalRecordLinesPreserved: preservedRecords,
    sourceDependenciesVerified: dependencies.length,
    authoring: Object.fromEntries(
      Object.entries(authoring).map(([k, v]) => [k, v.length]),
    ),
    commercial: Object.fromEntries(
      Object.entries(commercial).map(([k, v]) => [k, v.length]),
    ),
    originalExceptionDenominator: 58,
    deferredOriginals: 19,
    replacementProposals: 48,
    candidate: {
      manifestSha256: digest(Buffer.from(serializeCanonicalJson(first))),
      artifacts: first.requiredArtifacts.length,
      maximumCompressedChunkBytes: Math.max(
        ...first.requiredArtifacts
          .filter((row) => row.kind === "jsonl-gzip")
          .map((row) => Number(row.byteSize)),
      ),
      deterministic: true,
      roundTrip: true,
      referenceIntegrity: true,
    },
    commercialCandidate: {
      manifestSha256: digest(
        Buffer.from(serializeCanonicalJson(commercialFirst)),
      ),
      deterministic: true,
      roundTrip: true,
      artifacts: commercialFirst.requiredArtifacts.length,
    },
    dependencies,
  };
  await save("audit-results.json", summary);
  return summary;
}

if (process.argv[1] === import.meta.filename) {
  const result = await auditCatalog(dataRoot(process.cwd()));
  console.log(
    JSON.stringify({ ...result, dependencies: result.dependencies.length }),
  );
}
