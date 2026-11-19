import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, open, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { dataRoot, toolingRoot } from "../repository-paths.js";
import { serializeCanonicalJson } from "../serialization/canonical-json.js";
import { validate } from "../schema/validation-api.js";
import { mintStableId } from "./grow-wfo-apply.js";

const integration = "data/curation/plant-integration";
const catalog = "data/curation/grow-wfo-initial";
export const saintEtienneSourcePrefix =
  "data/sources/supplemental/saint-etienne-calendar/";
const batchPath = integration + "/saint-etienne/batch.json";
const batchSchema =
  "urn:hortinis:plants:schema:curation:v1:local-calendar-proposal";
const previewSchema =
  "urn:hortinis:plants:schema:curation:v1:local-calendar-preview";
const namespace = "saint-etienne-home-garden-calendar";
const mint = (collection: string, alias: string) =>
  mintStableId(namespace, collection, alias);
const sha = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");
const parse = <T>(bytes: Buffer | string): T =>
  JSON.parse(bytes.toString()) as T;

interface Subject {
  type: "plant-concept";
  id: string;
}
interface Scope {
  id: string;
  label: string;
  parentScopeId: string | null;
}
interface PacketPin {
  packetId: string;
  packetRevision: number;
  packetSha256: string;
}
interface Mapping extends PacketPin {
  scopeId: string;
  mappingId: string;
  subject: Subject;
}
interface Evidence {
  id: string;
  capture: { kind: string; path?: string; sha256?: string };
}
interface BordeauxRow extends PacketPin {
  packetPath: string;
  claimId: string;
  conditions: { geography: string };
  scopes: Scope[];
  value: { action: string; season: number };
  evidence: Evidence[];
  conversion: { disposition: string; sourceAction: string };
}
interface Window {
  claims: string[];
  action: string;
  season: string;
  requirements: string[];
  threshold: null | {
    medium: string;
    operator: string;
    value: number;
    unit: "Cel";
  };
  evidence: string[];
  method: string;
  confidence: string;
  limitations: string;
}
interface Identity {
  basis: string;
  label: string;
  kind: "generic" | "growing-type";
  scientificName: string;
  identityClaimIds: string[];
  parentBasis?: string;
  rationale: string;
}
interface Batch {
  revision: number;
  inventoryFingerprint: string;
  bordeauxRowsSha256: string;
  inputPins: Record<string, string>;
  baselineAssertions: { ids: string[]; sha256: string };
  geography: {
    name: string;
    communeCode: string;
    coverage: string;
    limitations: string;
  };
  evidence: Record<string, unknown>;
  qualifiers: Record<string, string>;
  identities: Identity[];
  existingSubjectMappings: {
    basis: string;
    subjectId: string;
    rationale: string;
  }[];
  windows: Window[];
}
interface Packet {
  id: string;
  revision: number;
  claims: {
    id: string;
    domain: string;
    recommendation: string;
    scopeIds: string[];
    evidenceIds: string[];
  }[];
  evidence: Evidence[];
}
interface Preview {
  id: string;
  subject: Subject;
  contextId: string;
  communeCode: string;
  action: string;
  season: string;
  requirements: string[];
  threshold: Window["threshold"];
  inheritance: "exact-subject-only";
  status: "in progress";
  commercialRelease: "blocked";
}

function checkShape(id: string, value: unknown): void {
  const result = validate(id, value);
  assert.ok(
    result.valid,
    result.valid ? undefined : JSON.stringify(result.errors),
  );
}

function checkCapture(
  { capture }: Evidence,
  read: (path: string) => Buffer,
): void {
  if (capture.kind === "reference-only") return;
  assert.ok(capture.path && capture.sha256, "Missing evidence capture pin");
  assert.equal(sha(read(capture.path)), capture.sha256, capture.path);
}

function deferredReason(row: BordeauxRow): string {
  if (row.value.action === "indoors_or_undercover")
    return "The Bordeaux source combines indoor and under-cover routes without heat, structure or substrate conditions. Independent propagation advice cannot disambiguate that source field.";
  if (row.value.action === "harvest")
    return "Local harvest timing requires an establishment anchor, maturity/variety and site-specific season evidence.";
  if (
    row.scopes.some(({ label }) => label === "Cucumber") &&
    row.value.season === 2
  )
    return "The August succession lacks outdoor-type maturity and remaining local warm-season evidence.";
  return "Outside this first establishment cohort. Requires crop- and action-specific local adaptation evidence and an exact subject decision.";
}

/** Filter the review preview only. Applicability requires the exact subject, commune and outdoor context. */
export function matchesLocalCalendarPreview(
  preview: Pick<Preview, "subject" | "communeCode" | "contextId">,
  garden: {
    subject: Subject;
    communeCode: string;
    contextId: string;
    growingSystem: string;
  },
): boolean {
  return (
    garden.growingSystem === "outdoor" &&
    garden.communeCode === preview.communeCode &&
    garden.contextId === preview.contextId &&
    garden.subject.type === preview.subject.type &&
    garden.subject.id === preview.subject.id
  );
}

/** Run the historical assessment separately, with its report streamed to disk. */
export async function readBordeauxAssessment(
  root = process.cwd(),
): Promise<Buffer> {
  const scratch = await mkdtemp(join(tmpdir(), "hortinis-bordeaux-"));
  const path = join(scratch, "report.json");
  try {
    const output = await open(path, "wx");
    try {
      await new Promise<void>((accept, reject) => {
        const child = spawn(
          process.execPath,
          [
            join(toolingRoot, "scripts/schema-fit-assessment.mjs"),
            "--bordeaux",
          ],
          {
            cwd: toolingRoot,
            env: { ...process.env, HORTINIS_DATA_ROOT: root },
            stdio: ["ignore", output.fd, "inherit"],
          },
        );
        child.once("error", reject);
        child.once("close", (code, signal) => {
          if (code === 0) accept();
          else
            reject(new Error(`Bordeaux assessment failed: ${signal ?? code}`));
        });
      });
    } finally {
      await output.close();
    }
    return await readFile(path);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

export function saintEtienneBaselineInput(path: string, bytes: Buffer): Buffer {
  if (path !== catalog + "/dataset-manifest.json") return bytes;
  // The exact approved manifest has 12 primary dependencies plus 466
  // supplemental packages of three dependencies. Later admissions append
  // dependencies. Callers still require the resulting historical SHA-256.
  const manifest = parse<{ dependencies: { path: string }[] }>(bytes);
  const dependencies = manifest.dependencies
    .filter((entry) => !entry.path.startsWith(saintEtienneSourcePrefix))
    .slice(0, 12 + 466 * 3);
  if (dependencies.length === manifest.dependencies.length) return bytes;
  return Buffer.concat([
    serializeCanonicalJson({ ...manifest, dependencies }),
    Buffer.from("\n"),
  ]);
}

export async function prepareSaintEtienneCalendar(root = process.cwd()) {
  const read = (path: string) => readFileSync(resolve(root, path));
  const batchBytes = read(batchPath);
  const batch = parse<Batch>(batchBytes);
  checkShape(batchSchema, batch);
  for (const [path, digest] of Object.entries(batch.inputPins))
    assert.equal(
      sha(saintEtienneBaselineInput(path, read(path))),
      digest,
      path,
    );

  const bordeaux = parse<{
    inventoryFingerprint: string;
    bordeaux: {
      mapped: number;
      mappedPackets: number;
      unresolved: number;
      rows: BordeauxRow[];
    };
  }>(await readBordeauxAssessment(root));
  const catalogAssertionsPath = catalog + "/assertions.jsonl";
  const catalogAssertions = read(catalogAssertionsPath);
  const assertionRows = catalogAssertions
    .toString()
    .split("\n")
    .filter((line) => line.length > 0);
  const distinctAssertions = new Map(
    assertionRows.map((line) => [parse<{ id: string }>(line).id, line]),
  );
  assert.equal(distinctAssertions.size, assertionRows.length);
  const baselineRows = batch.baselineAssertions.ids.map((id) => {
    const line = distinctAssertions.get(id);
    assert.ok(line, "Missing original catalog assertion " + id);
    return line;
  });
  assert.equal(
    sha(baselineRows.join("\n") + "\n"),
    batch.baselineAssertions.sha256,
  );
  const sourceRows = bordeaux.bordeaux.rows;
  assert.equal(
    sha(JSON.stringify(sourceRows)),
    batch.bordeauxRowsSha256,
    "Bordeaux source rows drifted",
  );
  const rows = new Map(sourceRows.map((row) => [row.claimId, row]));
  assert.equal(rows.size, sourceRows.length);
  const statusBytes = read(integration + "/status.json");
  const status = parse<{
    inventoryFingerprint: string;
    totals: Record<string, number>;
    canonicalSubjectAdmission: { mappings: Mapping[] };
  }>(statusBytes);
  assert.equal(status.inventoryFingerprint, bordeaux.inventoryFingerprint);
  const existing = parse<{
    subjects: { label: string; record: { id: string; kind: string } }[];
  }>(read(integration + "/canonical-subject-proposal.json"));
  const active = new Map(
    read(catalog + "/plant-concepts.jsonl")
      .toString()
      .trim()
      .split("\n")
      .map((line) => {
        const record = parse<{
          id: string;
          status: string;
          kind: string;
          parentPlantConceptId?: string;
        }>(line);
        return [record.id, record];
      }),
  );
  const rowFor = (claim: string) => {
    const row = rows.get(claim);
    assert.ok(row, claim);
    assert.equal(row.conditions.geography, "France (Bordeaux)");
    assert.equal(
      row.scopes.length,
      1,
      "An explicit scope decision is required",
    );
    assert.equal(row.conversion.sourceAction, "outdoor_sowing_or_planting");
    assert.equal(row.conversion.disposition, "mapped");
    return row;
  };
  const pinFor = (row: PacketPin): PacketPin => ({
    packetId: row.packetId,
    packetRevision: row.packetRevision,
    packetSha256: row.packetSha256,
  });
  const scopeKey = (row: BordeauxRow) => row.packetId + "/" + row.scopes[0]!.id;
  const byScope = new Map(
    status.canonicalSubjectAdmission.mappings.map((mapping) => [
      mapping.packetId + "/" + mapping.scopeId,
      { ...mapping, disposition: "admitted" },
    ]),
  );
  const addMapping = (
    row: BordeauxRow,
    subjectId: string,
    rationale: string,
  ) => {
    const key = scopeKey(row);
    assert.ok(!byScope.has(key), "Cannot replace scope mapping " + key);
    const mapping = {
      ...pinFor(row),
      scopeId: row.scopes[0]!.id,
      mappingId: mint("scope-mappings", key),
      subject: { type: "plant-concept" as const, id: subjectId },
      disposition: "in progress",
      rationale,
    };
    byScope.set(key, mapping);
    return mapping;
  };
  const family = new Map(
    batch.identities.map((identity) => [
      identity.basis,
      mint("plant-concepts", scopeKey(rowFor(identity.basis))),
    ]),
  );
  assert.equal(family.size, batch.identities.length);
  assert.equal(new Set(family.values()).size, family.size);
  const identityEvidence = new Map<string, Evidence & PacketPin>();
  const identities = batch.identities.map((identity) => {
    const row = rowFor(identity.basis);
    const scope = row.scopes[0]!;
    assert.equal(identity.label, scope.label);
    const bytes = read(row.packetPath);
    assert.equal(sha(bytes), row.packetSha256);
    const packet = parse<Packet>(bytes);
    assert.equal(packet.id, row.packetId);
    assert.equal(packet.revision, row.packetRevision);
    const evidenceIds = new Set(
      identity.identityClaimIds.flatMap((claimId) => {
        const claim = packet.claims.find((item) => item.id === claimId);
        assert.ok(
          claim?.domain === "identity" &&
            claim.recommendation === "select" &&
            claim.scopeIds.includes(scope.id),
          claimId,
        );
        return claim.evidenceIds;
      }),
    );
    const evidenceReferenceIds = [...evidenceIds].map((evidenceId) => {
      const item = packet.evidence.find(
        (evidence) => evidence.id === evidenceId,
      );
      assert.ok(item, evidenceId);
      checkCapture(item, read);
      const id = mint("evidence-references", packet.id + "/" + item.id);
      identityEvidence.set(id, { ...item, ...pinFor(row) });
      return id;
    });
    const id = family.get(identity.basis)!;
    const parent = identity.parentBasis
      ? rowFor(identity.parentBasis)
      : undefined;
    if (identity.kind === "growing-type") {
      assert.ok(
        parent &&
          parent.packetId === row.packetId &&
          parent.scopes[0]!.id === scope.parentScopeId,
      );
      assert.ok(
        batch.identities.some(
          (item) =>
            item.basis === identity.parentBasis && item.kind === "generic",
        ),
      );
    } else assert.equal(scope.parentScopeId, null);
    const record = {
      id,
      status: "active",
      kind: identity.kind,
      evidenceReferenceIds,
      ...(parent
        ? { parentPlantConceptId: family.get(identity.parentBasis!) }
        : {}),
    };
    const admitted = active.get(id);
    if (admitted) {
      assert.equal(admitted.status, record.status, id);
      assert.equal(admitted.kind, record.kind, id);
      assert.equal(
        admitted.parentPlantConceptId,
        "parentPlantConceptId" in record
          ? record.parentPlantConceptId
          : undefined,
        id,
      );
    }
    checkShape("urn:hortinis:plants:schema:v1:plant-concept", record);
    const mapping = addMapping(row, id, identity.rationale);
    const localizedName = {
      id: mint("localized-names", id),
      subject: mapping.subject,
      languageTag: "en",
      value: identity.label,
      kind: "common",
      preferred: true,
      evidenceReferenceIds,
    };
    checkShape("urn:hortinis:plants:schema:v1:localized-name", localizedName);
    return {
      ...identity,
      disposition: "in progress",
      record,
      localizedName,
      mapping,
    };
  });
  const proposedBindings = batch.existingSubjectMappings.map((binding) => {
    const row = rowFor(binding.basis);
    assert.ok(active.get(binding.subjectId)?.status === "active");
    assert.ok(
      existing.subjects.some(
        (subject) =>
          subject.record.id === binding.subjectId &&
          subject.record.kind === "generic" &&
          subject.label === row.scopes[0]!.label,
      ),
      "Canonical subject evidence required for new binding",
    );
    return addMapping(row, binding.subjectId, binding.rationale);
  });

  const geography = {
    id: mint("geographic-contexts", batch.geography.communeCode),
    status: "active",
    kind: "administrative-area",
    name: batch.geography.name,
    evidenceReferenceIds: ["commune", "la-puriniere", "boutheon"].map((key) =>
      mint("evidence-references", key),
    ),
  };
  checkShape("urn:hortinis:plants:schema:v1:geographic-context", geography);
  const contexts = new Map<string, object>();
  const relevant = new Map<string, string>();
  const windows = batch.windows.map((window) => {
    const originals = window.claims.map(rowFor);
    const mappings = originals.map((row) => {
      const mapping = byScope.get(scopeKey(row));
      assert.ok(mapping, row.claimId);
      assert.deepEqual(pinFor(mapping), pinFor(row));
      return mapping;
    });
    const subject = mappings[0]!.subject;
    for (const mapping of mappings) assert.deepEqual(mapping.subject, subject);
    assert.ok(
      window.evidence.includes("la-puriniere") &&
        window.evidence.includes("boutheon"),
    );
    for (const id of window.evidence)
      assert.ok(Object.hasOwn(batch.evidence, id), id);
    for (const key of window.requirements)
      assert.ok(Object.hasOwn(batch.qualifiers, key), key);
    if (window.threshold?.medium === "soil")
      assert.equal(window.action, "direct_sow");
    if (window.threshold?.medium === "air")
      assert.equal(window.action, "transplant");
    const propagation =
      window.action === "direct_sow"
        ? "direct_sowing"
        : window.action === "transplant"
          ? "transplant"
          : window.requirements.includes("spring-material")
            ? "unknown"
            : "direct_sowing_or_transplant";
    const contextId = mint(
      "cultivation-contexts",
      geography.id + "/" + propagation,
    );
    const context = {
      id: contextId,
      geographicScope: {
        type: "specified",
        geographicContextIds: [geography.id],
      },
      growingSystem: "outdoor",
      propagation,
      soilOrContainer: "in_ground",
      productionSetting: "home-garden",
      protection: "none",
    };
    checkShape("urn:hortinis:plants:schema:v1:cultivation-context", context);
    contexts.set(contextId, context);
    const id = mint("local-calendar-proposals", originals[0]!.claimId);
    for (const row of originals) {
      assert.ok(
        !relevant.has(row.claimId),
        "Duplicate original " + row.claimId,
      );
      relevant.set(row.claimId, id);
    }
    const preview: Preview = {
      id,
      subject,
      contextId,
      communeCode: batch.geography.communeCode,
      action: window.action,
      season: window.season,
      requirements: window.requirements,
      threshold: window.threshold,
      inheritance: "exact-subject-only",
      status: "in progress",
      commercialRelease: "blocked",
    };
    checkShape(previewSchema, preview);
    const conditions: object[] = window.requirements.map((key) => ({
      type: key === "frost" ? "frost-risk-passed" : "qualitative",
      key,
      guidance: batch.qualifiers[key],
      ...(key === "hardening" ? { appliesTo: "transplant" } : {}),
    }));
    if (window.threshold) {
      const { medium, operator, value, unit } = window.threshold;
      conditions.push({
        type: `${medium}-temperature-threshold`,
        operator,
        temperature: { value, unit },
      });
    }
    const timing = {
      type: "conditional-season",
      season: window.season,
      evaluation: "local-observation-required",
      applicability: "exact-subject-only",
      allOf: conditions,
      confidence: window.confidence,
      limitations: window.limitations,
    };
    checkShape("urn:hortinis:plants:schema:v1:cultivation-rule", {
      id,
      subject,
      contextId,
      reviewId: mint("reviews", id),
      evidenceReferenceIds: window.evidence.map((key) =>
        mint("evidence-references", key),
      ),
      status: "active",
      action: window.action,
      timing,
    });
    const assertionId = mint("assertions", id);
    const liveProjection = distinctAssertions.has(assertionId)
      ? "validated"
      : "in progress";
    return {
      ...window,
      id,
      originals,
      mappings,
      timing,
      assertionId,
      preview,
      provenance:
        "Independent RHS action evidence applied using local Météo-France climatology. Bordeaux claims are comparison lineage.",
      liveProjection,
    };
  });

  const dispositions = sourceRows.map((row) => {
    row.evidence.forEach((item) => checkCapture(item, read));
    const proposalId = relevant.get(row.claimId);
    return {
      original: row,
      proposalId: proposalId ?? null,
      status: proposalId
        ? windows.find((row) => row.id === proposalId)!.liveProjection
        : "blocked",
      reason: proposalId
        ? "Independent local recommendation; original retained for comparison"
        : deferredReason(row),
    };
  });
  for (const [path, digest] of Object.entries(batch.inputPins))
    assert.equal(
      sha(saintEtienneBaselineInput(path, read(path))),
      digest,
      path,
    );
  assert.deepEqual(read(catalogAssertionsPath), catalogAssertions);
  assert.deepEqual(read(integration + "/status.json"), statusBytes);
  assert.equal(sha(read(batchPath)), sha(batchBytes));
  return {
    formatVersion: "1.0.0",
    status: windows.every((row) => row.liveProjection === "validated")
      ? "validated"
      : "in progress",
    curatorApproval: parse<{ id: string }>(
      read(integration + "/saint-etienne/approval.json"),
    ).id,
    commercialRelease: "blocked",
    revision: batch.revision,
    batchSha256: sha(batchBytes),
    inventoryFingerprint: bordeaux.inventoryFingerprint,
    bordeauxRowsSha256: batch.bordeauxRowsSha256,
    baseline: {
      inventoryFingerprint: batch.inventoryFingerprint,
      catalogAssertions: baselineRows.length,
    },
    integrationTotals: status.totals,
    currentCatalogAssertions: {
      count: assertionRows.length,
      sha256: sha(catalogAssertions),
    },
    totals: {
      bordeauxMapped: bordeaux.bordeaux.mapped,
      bordeauxMappedPackets: bordeaux.bordeaux.mappedPackets,
      indoorOrUndercoverUnresolved: bordeaux.bordeaux.unresolved,
      outdoorOrHarvestDeferred: bordeaux.bordeaux.mapped - relevant.size,
      originalRowsWithProposal: relevant.size,
      windows: windows.length,
      newIdentities: identities.length,
      proposedScopeMappings: identities.length + proposedBindings.length,
    },
    geography: { ...batch.geography, record: geography },
    contexts: [...contexts.values()],
    evidence: Object.fromEntries(
      Object.entries(batch.evidence).map(([key, value]) => [
        key,
        { id: mint("evidence-references", key), source: value },
      ]),
    ),
    qualifiers: batch.qualifiers,
    identities,
    identityEvidence: Object.fromEntries(identityEvidence),
    proposedBindings,
    windows,
    dispositions,
  };
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  process.stdout.write(
    JSON.stringify(
      await prepareSaintEtienneCalendar(dataRoot(process.cwd())),
      null,
      2,
    ) + "\n",
  );
}
