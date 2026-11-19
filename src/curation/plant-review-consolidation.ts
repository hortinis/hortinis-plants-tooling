import { createHash } from "node:crypto";
import { readFile, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { cacheRoot, toolingRoot } from "../repository-paths.js";
import { parseJsonStrict } from "../serialization/canonical-json.js";
import { validate } from "../schema/validation-api.js";

const packetSchema =
  "urn:hortinis:plants:schema:curation:v1:plant-review-proposal";
const packetRoot = "data/curation/plant-review-packets";
const datasetRoot = "data/curation/grow-wfo-initial";
const domains = [
  "identity",
  "temperature",
  "planting",
  "environment",
  "water",
  "nutrition",
  "harvest",
  "care",
];

interface Scope {
  id: string;
  label: string;
  kind: string;
  catalogSubjectId: string | null;
  parentScopeId: string | null;
}
interface Evidence {
  id: string;
  sourceId: string | null;
  release: string;
  sourceRecord: string;
  locator: string;
  url: string | null;
  rights: {
    licence: string | null;
    status: string;
    commercialUseAllowed: boolean | null;
    upstreamChecked: boolean;
  };
  capture: { kind: string; path: string | null; sha256: string | null };
}
interface Claim {
  id: string;
  domain: string;
  topic: string;
  scopeIds: string[];
  evidenceIds: string[];
  recommendation: string;
  implementation: { predicate: string | null; status: string; notes: string };
}
interface Packet {
  id: string;
  revision: number;
  status: string;
  researchComplete: boolean;
  curatorApproval: null;
  catalogIntegration: string;
  plant: {
    label: string;
    scientificName: string | null;
    catalogSubjectId: string | null;
    scopeNotes: string;
  };
  scopes: Scope[];
  evidence: Evidence[];
  claims: Claim[];
  coverage: { domain: string; claimIds: string[]; reason: string }[];
  sourceCandidateDispositions: { claimIds: string[] }[];
  questions: {
    id: string;
    status: string;
    domain: string;
    question: string;
    resolutionNeeded: string;
  }[];
}
interface Issue {
  path: string;
  message: string;
}

export function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** A research metadata screen, never a formal catalog rights decision. */
export function screenRights(evidence: Evidence[]): string {
  if (
    evidence.some(
      (entry) =>
        entry.rights.commercialUseAllowed === false ||
        entry.rights.status === "blocked",
    )
  )
    return "blocked";
  if (
    evidence.length > 0 &&
    evidence.every(
      (entry) =>
        entry.rights.status === "validated" &&
        entry.rights.commercialUseAllowed === true &&
        entry.rights.upstreamChecked &&
        entry.rights.licence !== null,
    )
  )
    return "validated";
  return "in progress";
}

export function latestRevision(names: string[]): string {
  const revisions = names.filter((name) => /^r[1-9]\d*$/.test(name));
  revisions.sort((a, b) => Number(b.slice(1)) - Number(a.slice(1)));
  if (!revisions[0]) throw new Error("Packet directory has no revision");
  return revisions[0];
}

function count(values: string[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) result[value] = (result[value] ?? 0) + 1;
  return Object.fromEntries(
    Object.entries(result).sort(([a], [b]) => compare(a, b)),
  );
}
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Reads every latest packet; never edits a packet, approval or active catalog record. */
export async function consolidatePlantReviews(root: string) {
  const rootPath = await realpath(root);
  const schemaRoot = await realpath(toolingRoot);
  const inputs = new Map<string, { path: string; sha256: string }>();
  const cachedBytes = new Map<string, { repository: string; bytes: Buffer }>();
  const issues: Issue[] = [];
  async function read(
    path: string,
    repository = rootPath,
    repositoryPath = path,
  ): Promise<Buffer> {
    if (
      isAbsolute(repositoryPath) ||
      relative(repository, resolve(repository, repositoryPath)).startsWith("..")
    )
      throw new Error(`Input escapes repository: ${path}`);
    const cached = cachedBytes.get(path);
    if (cached) {
      if (cached.repository !== repository)
        throw new Error(`Input path belongs to both repositories: ${path}`);
      return cached.bytes;
    }
    const absolute = await realpath(join(repository, repositoryPath));
    if (relative(repository, absolute).startsWith(".."))
      throw new Error(`Input symlink escapes repository: ${path}`);
    const bytes = await readFile(absolute);
    cachedBytes.set(path, { repository, bytes });
    inputs.set(path, { path, sha256: sha256(bytes) });
    return bytes;
  }
  const schema = parseJsonStrict(
    await read("schemas/authoring/v1/assertion.schema.json", schemaRoot),
  ) as { properties: { predicate: { enum: string[] } } };
  await read(
    "schemas/curation/v1/plant-review-proposal.schema.json",
    schemaRoot,
  );
  async function readCapture(path: string): Promise<Buffer> {
    const cachePrefix = ".cache/";
    if (!path.startsWith(cachePrefix)) return read(path);
    return read(
      path,
      await realpath(cacheRoot(rootPath)),
      path.slice(cachePrefix.length),
    );
  }
  const manifest = parseJsonStrict(
    await read(`${datasetRoot}/dataset-manifest.json`),
  ) as {
    dependencies: { role: string; id: string; path: string; sha256: string }[];
  };
  const sourceIds = new Set<string>();
  for (const dependency of manifest.dependencies) {
    const bytes = await read(dependency.path);
    if (sha256(bytes) !== dependency.sha256)
      issues.push({
        path: dependency.path,
        message: "Active dataset dependency checksum mismatch",
      });
    if (dependency.role === "source") {
      const source = parseJsonStrict(bytes) as { id: string };
      sourceIds.add(source.id);
    }
  }
  const activeCatalog: Record<string, number> = {};
  for (const name of (await readdir(join(rootPath, datasetRoot)))
    .filter((name) => name.endsWith(".jsonl"))
    .sort()) {
    const lines = (await read(`${datasetRoot}/${name}`))
      .toString("utf8")
      .trim()
      .split("\n")
      .filter(Boolean);
    for (const line of lines) parseJsonStrict(line);
    activeCatalog[name.replace(/\.jsonl$/, "")] = lines.length;
  }
  const legacyDocuments = [];
  for (const name of (await readdir(join(rootPath, "docs/reviews")))
    .filter((name) => /^(tomato|lettuce)-.*\.md$/.test(name))
    .sort()) {
    const path = `docs/reviews/${name}`;
    legacyDocuments.push({ path, sha256: sha256(await read(path)) });
  }
  const supplementalPath =
    "data/curation/supplemental-reviews/tomato-rhs-2026-10-07/review.json";
  legacyDocuments.push({
    path: supplementalPath,
    sha256: sha256(await read(supplementalPath)),
  });
  const packets = [];
  const claimIndex = [];
  const sourceGroups = new Map<
    string,
    {
      sourceId: string | null;
      origin: string | null;
      release: string;
      licence: string | null;
      evidenceCount: number;
      selectedReferences: { packetId: string; evidenceId: string }[];
    }
  >();
  const identifierOwners = new Map<
    string,
    { packetId: string; path: string }[]
  >();
  let revisionCount = 0;
  let capturesVerified = 0;
  for (const directory of (
    await readdir(join(rootPath, packetRoot), { withFileTypes: true })
  )
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => compare(a.name, b.name))) {
    const revisions = (
      await readdir(join(rootPath, packetRoot, directory.name), {
        withFileTypes: true,
      })
    )
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    const revision = latestRevision(revisions);
    revisionCount += revisions.filter((name) =>
      /^r[1-9]\d*$/.test(name),
    ).length;
    const path = `${packetRoot}/${directory.name}/${revision}/packet.json`;
    const bytes = await read(path);
    const unknownPacket = parseJsonStrict(bytes);
    const validation = validate(packetSchema, unknownPacket);
    if (!validation.valid)
      throw new Error(`${path}: ${JSON.stringify(validation.errors)}`);
    const packet = unknownPacket as Packet;
    const digest = sha256(bytes);
    const issue = (message: string) => {
      issues.push({ path, message });
    };
    if (
      packet.id !== directory.name ||
      packet.revision !== Number(revision.slice(1))
    )
      issue("Packet ID/revision disagrees with its directory");
    const summaryPath = path.replace(/packet\.json$/, "summary.md");
    try {
      if (!(await read(summaryPath)).toString("utf8").includes(digest))
        issue("Summary does not contain the current packet SHA-256");
    } catch (error) {
      issue(`Summary unavailable: ${String(error)}`);
    }
    const localIds = new Set<string>();
    for (const id of [
      packet.id,
      ...packet.scopes.map((entry) => entry.id),
      ...packet.evidence.map((entry) => entry.id),
      ...packet.claims.map((entry) => entry.id),
      ...packet.questions.map((entry) => entry.id),
    ]) {
      if (localIds.has(id)) issue(`Duplicate opaque ID within packet: ${id}`);
      localIds.add(id);
      identifierOwners.set(id, [
        ...(identifierOwners.get(id) ?? []),
        { packetId: packet.id, path },
      ]);
    }
    const scopes = new Map(packet.scopes.map((entry) => [entry.id, entry]));
    const evidence = new Map(packet.evidence.map((entry) => [entry.id, entry]));
    const claims = new Map(packet.claims.map((entry) => [entry.id, entry]));
    for (const scope of packet.scopes) {
      const seen = new Set([scope.id]);
      let parent = scope.parentScopeId;
      while (parent !== null) {
        if (seen.has(parent)) {
          issue(`Scope cycle: ${scope.id}`);
          break;
        }
        seen.add(parent);
        const target = scopes.get(parent);
        if (!target) {
          issue(`Unknown parent scope: ${parent}`);
          break;
        }
        parent = target.parentScopeId;
      }
    }
    for (const domain of domains) {
      if (
        packet.coverage.filter((entry) => entry.domain === domain).length !== 1
      )
        issue(`Expected exactly one coverage entry for ${domain}`);
    }
    for (const entry of [
      ...packet.coverage,
      ...packet.sourceCandidateDispositions,
    ]) {
      for (const id of entry.claimIds)
        if (!claims.has(id)) issue(`Unknown coverage/candidate claim: ${id}`);
    }
    const covered = new Set(packet.coverage.flatMap((entry) => entry.claimIds));
    for (const claim of packet.claims) {
      if (claim.recommendation === "select" && !covered.has(claim.id))
        issue(`Selected claim absent from domain coverage: ${claim.id}`);
      for (const id of claim.scopeIds)
        if (!scopes.has(id)) issue(`Unknown claim scope: ${id}`);
      for (const id of claim.evidenceIds)
        if (!evidence.has(id)) issue(`Unknown claim evidence: ${id}`);
      const linkedEvidence = claim.evidenceIds.flatMap(
        (id) => evidence.get(id) ?? [],
      );
      const predicateKnown =
        claim.implementation.predicate !== null &&
        schema.properties.predicate.enum.includes(
          claim.implementation.predicate,
        );
      const sourceAdmission = linkedEvidence
        .filter(
          (entry) => entry.sourceId === null || !sourceIds.has(entry.sourceId),
        )
        .map((entry) => entry.id);
      const rightsScreen =
        linkedEvidence.length === claim.evidenceIds.length
          ? screenRights(linkedEvidence)
          : "in progress";
      claimIndex.push({
        packetId: packet.id,
        packetRevision: packet.revision,
        packetSha256: digest,
        claimId: claim.id,
        domain: claim.domain,
        topic: claim.topic,
        recommendation: claim.recommendation,
        scopeIds: claim.scopeIds,
        evidenceIds: claim.evidenceIds,
        implementation: claim.implementation,
        authoringPredicateKnown: predicateKnown,
        rightsScreen,
        sourceAdmissionEvidenceIds: sourceAdmission,
        referenceOnlyEvidenceIds: linkedEvidence
          .filter((entry) => entry.capture.kind === "reference-only")
          .map((entry) => entry.id),
        workstream:
          claim.domain === "identity"
            ? "identity-and-subjects"
            : predicateKnown
              ? "existing-predicate-integration"
              : `${claim.domain}-representation`,
      });
    }
    const selectedEvidenceIds = new Set(
      packet.claims
        .filter((claim) => claim.recommendation === "select")
        .flatMap((claim) => claim.evidenceIds),
    );
    for (const entry of packet.evidence) {
      if (entry.capture.kind !== "reference-only") {
        if (!entry.capture.path || !entry.capture.sha256)
          issue(`Capture lacks path/hash: ${entry.id}`);
        else {
          try {
            if (
              sha256(await readCapture(entry.capture.path)) !==
              entry.capture.sha256
            )
              issue(`Evidence checksum mismatch: ${entry.id}`);
            else capturesVerified += 1;
          } catch (error) {
            issue(`Evidence unavailable: ${entry.id}: ${String(error)}`);
          }
        }
      }
      let origin: string | null = null;
      if (entry.url !== null) {
        try {
          origin = new URL(entry.url).origin;
        } catch {
          /* A locator can be non-HTTP. */
        }
      }
      const key = JSON.stringify([
        entry.sourceId,
        origin,
        entry.release,
        entry.rights.licence,
      ]);
      const group = sourceGroups.get(key) ?? {
        sourceId: entry.sourceId,
        origin,
        release: entry.release,
        licence: entry.rights.licence,
        evidenceCount: 0,
        selectedReferences: [],
      };
      group.evidenceCount += 1;
      if (selectedEvidenceIds.has(entry.id))
        group.selectedReferences.push({
          packetId: packet.id,
          evidenceId: entry.id,
        });
      sourceGroups.set(key, group);
    }
    const selected = claimIndex.filter(
      (entry) =>
        entry.packetId === packet.id && entry.recommendation === "select",
    );
    packets.push({
      id: packet.id,
      revision: packet.revision,
      path,
      summaryPath,
      sha256: digest,
      plant: packet.plant,
      scopes: packet.scopes,
      status: packet.status,
      researchComplete: packet.researchComplete,
      catalogIntegration: packet.catalogIntegration,
      packetApproval: packet.curatorApproval,
      recommendations: count(
        packet.claims.map((entry) => entry.recommendation),
      ),
      selectedImplementation: count(
        selected.map((entry) => entry.implementation.status),
      ),
      selectedRightsScreen: count(selected.map((entry) => entry.rightsScreen)),
      selectedNeedingSourceAdmission: selected.filter(
        (entry) => entry.sourceAdmissionEvidenceIds.length > 0,
      ).length,
      selectedWithReferenceOnlyEvidence: selected.filter(
        (entry) => entry.referenceOnlyEvidenceIds.length > 0,
      ).length,
      questions: packet.questions.map(
        ({ id, status, domain, question, resolutionNeeded }) => ({
          id,
          status,
          domain,
          question,
          resolutionNeeded,
        }),
      ),
    });
  }
  packets.sort(
    (a, b) =>
      compare(a.plant.label.toLowerCase(), b.plant.label.toLowerCase()) ||
      compare(a.id, b.id),
  );
  const selected = claimIndex.filter(
    (entry) => entry.recommendation === "select",
  );
  const sortedInputs = [...inputs.values()].sort((a, b) =>
    compare(a.path, b.path),
  );
  return {
    formatVersion: "1.0.0",
    status: "in progress",
    scope:
      "All latest plant review packets plus existing tomato/lettuce review records; no MVP filter",
    inputFingerprint: sha256(JSON.stringify(sortedInputs)),
    checks: {
      status: issues.length === 0 ? "validated" : "blocked",
      capturesVerified,
      issues,
    },
    totals: {
      packets: packets.length,
      revisions: revisionCount,
      claims: claimIndex.length,
      recommendations: count(claimIndex.map((entry) => entry.recommendation)),
      selectedImplementation: count(
        selected.map((entry) => entry.implementation.status),
      ),
      selectedRightsScreen: count(selected.map((entry) => entry.rightsScreen)),
      selectedWorkstreams: count(selected.map((entry) => entry.workstream)),
      selectedNeedingSourceAdmission: selected.filter(
        (entry) => entry.sourceAdmissionEvidenceIds.length > 0,
      ).length,
      selectedWithReferenceOnlyEvidence: selected.filter(
        (entry) => entry.referenceOnlyEvidenceIds.length > 0,
      ).length,
      questions: packets.reduce(
        (sum, packet) => sum + packet.questions.length,
        0,
      ),
    },
    activeCatalog,
    legacyDocuments,
    packets,
    claimIndex,
    crossPacketIdentifierCollisions: [...identifierOwners.entries()]
      .filter(([, owners]) => owners.length > 1)
      .map(([id, owners]) => ({ id, owners })),
    sourceGroups: [...sourceGroups.entries()]
      .sort(([a], [b]) => compare(a, b))
      .map(([, group]) => group),
    inputs: sortedInputs,
  };
}

export type PlantReviewConsolidation = Awaited<
  ReturnType<typeof consolidatePlantReviews>
>;

export function renderConsolidation(report: PlantReviewConsolidation): string {
  const escape = (text: string) =>
    text.replaceAll("|", "\\|").replaceAll("\n", " ");
  const link = (path: string) => `../../../${path}`;
  const lines = [
    "# All reviewed plants: consolidation inventory",
    "",
    "- Status: in progress",
    `- Input fingerprint: \`${report.inputFingerprint}\``,
    "- Regenerate: `pnpm curate:consolidate -- --write`; verify: `pnpm curate:consolidate -- --check`.",
    "",
    "This is a review inventory, not catalog admission or release approval. It covers every latest packet, including ornamentals, perennials, cover crops, growing types and cultivar comparisons. Packet counts are not unique catalog-subject counts. Older revisions remain preserved.",
    "",
    "See [integration work](../../../docs/development/plant-review-consolidation.md) and [existing approval reconciliation](../../../docs/reviews/plant-review-legacy-reconciliation.md). `inventory.json` contains exact packet/claim/evidence/question identifiers, input hashes and workstream membership. Values, source rights qualifications and original evidence remain in the linked immutable packets.",
    "",
    "## Snapshot",
    "",
    `- ${report.totals.packets} latest packets across ${report.totals.revisions} revisions; ${report.totals.claims} claims.`,
    `- Recommendations: ${Object.entries(report.totals.recommendations)
      .map(([key, value]) => `${value} ${key}`)
      .join(", ")}.`,
    `- Selected implementation declarations: ${JSON.stringify(report.totals.selectedImplementation)}.`,
    `- Selected evidence rights screen: ${JSON.stringify(report.totals.selectedRightsScreen)}.`,
    `- ${report.totals.selectedNeedingSourceAdmission} selected claims reference a source ID absent from active source dependencies (or no source ID).`,
    `- ${report.totals.selectedWithReferenceOnlyEvidence} selected claims include reference-only evidence.`,
    `- ${report.totals.questions} packet questions retained with original IDs and resolution requirements.`,
    `- Active authoring: ${report.activeCatalog["plant-concepts"] ?? 0} plant concepts, ${report.activeCatalog.assertions ?? 0} assertions.`,
    "",
    "The rights screen is conservative research metadata: `validated` requires every linked evidence item to declare validated rights, commercial use, upstream checking and a licence. It is not a formal rights review; mixed contextual evidence can keep a claim pending. Source-ID presence does not verify the release or locator. A known predicate does not establish that the proposed value or scope fits its contract. No proposal is automatically approved or admitted. Source groups are work queues keyed by declared source ID, URL origin, release and licence; they do not establish source equivalence or inherit rights between documents.",
    "",
    "## Selected claims by implementation workstream",
    "",
    "| Workstream | Claims |",
    "| --- | ---: |",
    ...Object.entries(report.totals.selectedWorkstreams).map(
      ([key, value]) => `| ${key} | ${value} |`,
    ),
    "",
    "## Every latest packet",
    "",
    "Counts below concern recommendations, not approvals. S/A/D/E = select/alternative/defer/exclude; V/P = implementation declared validated/planned; rights V/P/B = research screen validated/in progress/blocked. Source = selected claims needing source-ID admission. Every row links its curator summary; exact revision and digest are in the machine inventory.",
    "",
    "| Review | Revision | S/A/D/E | Implementation V/P | Rights V/P/B | Source | Questions |",
    "| --- | ---: | --- | --- | --- | ---: | ---: |",
    ...report.packets.map(
      (packet) =>
        `| [${escape(packet.plant.label)}](${link(packet.summaryPath)}) | ${packet.revision} | ${["select", "alternative", "defer", "exclude"].map((key) => packet.recommendations[key] ?? 0).join("/")} | ${packet.selectedImplementation.validated ?? 0}/${packet.selectedImplementation.planned ?? 0} | ${["validated", "in progress", "blocked"].map((key) => packet.selectedRightsScreen[key] ?? 0).join("/")} | ${packet.selectedNeedingSourceAdmission} | ${packet.questions.length} |`,
    ),
    "",
    "## Integrity checks",
    "",
    `Status: ${report.checks.status}. Verified ${report.checks.capturesVerified} evidence references against local capture bytes (shared files count once per reference). Checked packet schemas, numeric revision selection, opaque-ID uniqueness within each packet, references, scope ancestry, selected-claim domain coverage and summary digests. This does not re-establish factual accuracy, source-candidate completeness, prose-summary parity, legal clearance or deep source audits.`,
    "",
    ...(report.checks.issues.length === 0
      ? ["No integrity issues found."]
      : report.checks.issues.map(
          (entry) =>
            `- [${entry.path}](${link(entry.path)}): ${escape(entry.message)}`,
        )),
    "",
    "## Cross-packet identifiers requiring explicit mapping",
    "",
    "Review-local references are always qualified by packet ID in this inventory. Repeated local IDs cannot be used as global catalog identifiers or as evidence that subjects are equivalent. Resolve these through explicit packet/scope-to-canonical mappings; do not alter delivered packet bytes.",
    "",
    ...(report.crossPacketIdentifierCollisions.length === 0
      ? ["No cross-packet collisions found."]
      : report.crossPacketIdentifierCollisions.map(
          (entry) =>
            `- \`${entry.id}\` occurs in ${entry.owners.length} latest packets; exact packet IDs and paths are listed in the machine inventory.`,
        )),
    "",
    "## Earlier review records",
    "",
    "These records retain prior decisions independently of packet approvals. The reconciliation document distinguishes approved content, deferrals and active assertions; cultivar comparisons do not inherit generic approvals.",
    "",
    ...report.legacyDocuments.map(
      (entry) =>
        `- [${entry.path.split("/").at(-1)}](${link(entry.path)}) — SHA-256 \`${entry.sha256}\``,
    ),
    "",
  ];
  return lines.join("\n");
}
