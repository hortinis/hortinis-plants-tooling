import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { dataRoot } from "../repository-paths.js";
import { format } from "prettier";
import { validate } from "../schema/validation-api.js";
import {
  consolidatePlantReviews,
  sha256,
} from "./plant-review-consolidation.js";
import { mintStableId } from "./grow-wfo-apply.js";
import {
  object,
  records,
  field,
  strings,
  assertSchema,
  containedPath,
  type RecordValue,
} from "./curation-artifacts.js";

/** Preparation only: no content or rights approvals and no active dataset writes. */
export async function preparePlantIntegration(root: string) {
  const inventory = await consolidatePlantReviews(root);
  if (inventory.checks.status !== "validated")
    throw new Error("Repair inventory integrity before preparing integration");
  const manifest = object(
    JSON.parse(
      await readFile(
        resolve(root, "data/curation/grow-wfo-initial/dataset-manifest.json"),
        "utf8",
      ),
    ),
  );
  const knownSources = new Set(
    records(manifest.dependencies)
      .filter((row) => row.role === "source")
      .map((row) => field(row, "id")),
  );
  const mappings: RecordValue[] = [];
  const sources: RecordValue[] = [];
  for (const pin of inventory.packets) {
    const packet = object(
      JSON.parse(await readFile(await containedPath(root, pin.path), "utf8")),
    );
    const claims = records(packet.claims);
    for (const scope of records(packet.scopes)) {
      const scopeId = field(scope, "id");
      const linked = claims.filter((claim) =>
        strings(claim.scopeIds).includes(scopeId),
      );
      const selected = linked.filter(
        (claim) => claim.recommendation === "select",
      );
      const label = field(scope, "label");
      const comparison = /comparison|overview|boundary|excluded/i.test(label);
      const unused = linked.length === 0;
      const role = unused
        ? "unused"
        : comparison
          ? "comparison"
          : scope.kind === "cultivar"
            ? "cultivar"
            : scope.kind === "growing-type"
              ? "type-or-applicability"
              : "plant-concept";
      mappings.push({
        id: mintStableId(
          "plant-integration-preparation",
          "scope-mappings",
          `${pin.id}:${scopeId}`,
        ),
        status: role === "unused" ? "validated" : "in progress",
        packetId: pin.id,
        packetRevision: pin.revision,
        packetSha256: pin.sha256,
        scopeId,
        label,
        declaredKind: scope.kind,
        parentScopeId: scope.parentScopeId,
        role,
        ...(selected.length &&
        selected.every((claim) => Array.isArray(claim.replaces))
          ? { replacementScope: true }
          : {}),
        existingCatalogSubjectId: scope.catalogSubjectId,
        proposedCatalogSubjectId: null,
        claimIds: linked.map((claim) => claim.id),
        selectedClaimIds: selected.map((claim) => claim.id),
        reason: unused
          ? "No claim references this scope; do not mint a subject."
          : comparison
            ? "Comparison/boundary material is retained; it does not independently establish a catalog subject."
            : scope.kind === "growing-type"
              ? "Resolve whether this is a horticultural identity or an applicability context; no automatic cultivar-group conversion."
              : "Retain this packet-qualified scope until explicit identity mapping; do not merge by name or taxonomy alone.",
      });
    }
    const selectedEvidence = new Set(
      claims
        .filter((claim) => claim.recommendation === "select")
        .flatMap((claim) => strings(claim.evidenceIds)),
    );
    for (const evidence of records(packet.evidence)) {
      const evidenceId = field(evidence, "id");
      if (
        !selectedEvidence.has(evidenceId) ||
        knownSources.has(String(evidence.sourceId))
      )
        continue;
      const alias = `${pin.id}:${evidenceId}`;
      const sourceId = mintStableId(
        "plant-integration-preparation",
        "sources",
        alias,
      );
      const licenceId = mintStableId(
        "plant-integration-preparation",
        "licences",
        alias,
      );
      const manifestId = mintStableId(
        "plant-integration-preparation",
        "source-manifests",
        alias,
      );
      const rights = object(evidence.rights);
      const capture = object(evidence.capture);
      const resourcePath =
        capture.kind === "reference-only" ? pin.path : field(capture, "path");
      const bytes = await readFile(await containedPath(root, resourcePath));
      const expected =
        capture.kind === "reference-only"
          ? pin.sha256
          : field(capture, "sha256");
      if (sha256(bytes) !== expected)
        throw new Error(`Changed capture: ${evidenceId}`);
      const source = {
        id: sourceId,
        name: `Review evidence: ${String(evidence.url ?? evidence.locator)}`,
      };
      const licence = {
        id: licenceId,
        name: "Claim rights pending formal admission",
        expression: "LicenseRef-Review-Pending",
        referenceLocator: String(
          rights.licenceUrl ?? evidence.url ?? evidence.locator,
        ),
        commercialUse:
          rights.commercialUseAllowed === false ? "forbidden" : "unknown",
        attributionRequired: true,
        requiredNotice: String(
          typeof rights.attribution === "string"
            ? rights.attribution
            : "Retain source record, locator and review provenance; no redistribution grant is established.",
        ),
      };
      const sourceManifest = {
        id: manifestId,
        provider: { id: sourceId, name: source.name },
        release: { identifier: `hortinis-review-evidence:${evidenceId}` },
        resources: [
          {
            locator: resourcePath,
            checksum: { algorithm: "sha256", value: expected },
            byteSize: bytes.byteLength,
          },
        ],
        licenceReview: {
          status: "unreviewed",
          declaredLicence:
            typeof rights.licence === "string" ? rights.licence : "Unknown",
          evidenceLocator: licence.referenceLocator,
          notes:
            "Research rights declarations are preserved in provenance, not promoted to formal clearance. Resource hashes pin local review evidence, not necessarily publisher documents.",
        },
        profileEligibility: [
          {
            profile: "commercial",
            decision:
              rights.commercialUseAllowed === false
                ? "ineligible"
                : "pending-review",
            reason: "Explicit claim-level rights admission remains required.",
          },
        ],
      };
      for (const [kind, value] of [
        ["source", source],
        ["licence", licence],
        ["source-manifest", sourceManifest],
      ] as const)
        assertSchema(
          { validate },
          `urn:hortinis:plants:schema:v1:${kind}`,
          value,
        );
      sources.push({
        id: mintStableId(
          "plant-integration-preparation",
          "source-admissions",
          alias,
        ),
        status: "planned",
        packetId: pin.id,
        packetRevision: pin.revision,
        packetSha256: pin.sha256,
        evidenceId,
        source,
        licence,
        sourceManifest,
        sourceRecordKey: {
          recordId: evidence.sourceRecord,
          source: {
            sourceId,
            sourceManifestId: manifestId,
            sourceReleaseId: sourceManifest.release.identifier,
          },
        },
        provenance: {
          originalSourceId: evidence.sourceId,
          originalRelease: evidence.release,
          sourceRecord: evidence.sourceRecord,
          locator: evidence.locator,
          url: evidence.url,
          observedAt: evidence.observedAt,
          originalValue: evidence.originalValue,
          rights: evidence.rights,
          capture: evidence.capture,
          packetPath: pin.path,
        },
      });
    }
  }
  return {
    formatVersion: "1.0.0",
    status: "in progress",
    inventoryFingerprint: inventory.inputFingerprint,
    mappings,
    sources,
  };
}

if (process.argv[1] === import.meta.filename) {
  try {
    const args = process.argv.slice(2).filter((arg) => arg !== "--");
    if (args.length !== 1 || !["--write", "--check"].includes(args[0]!))
      throw new Error("Use --write or --check");
    const root = dataRoot(process.cwd());
    const result = await preparePlantIntegration(root);
    const directory = resolve(root, "data/curation/plant-integration");
    const text = await format(JSON.stringify(result), { parser: "json" });
    if (args[0] === "--write") {
      await mkdir(directory, { recursive: true });
      await writeFile(resolve(directory, "preparation.json"), text);
    } else if (
      (await readFile(resolve(directory, "preparation.json"), "utf8")) !== text
    )
      throw new Error("Preparation is stale; regenerate before use");
    console.log(
      `${result.mappings.length} packet-qualified scope mappings; ${result.sources.length} schema-validated source admission packages. No active claims applied.`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
