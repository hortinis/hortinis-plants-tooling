import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { dataRoot } from "../repository-paths.js";
import { format } from "prettier";
import { preparePlantIntegration } from "./prepare-plant-integration.js";
import {
  containedPath,
  digest,
  field,
  object,
  records,
  same,
  strings,
  uniqueBy,
  type RecordValue,
} from "./curation-artifacts.js";
import { parseJsonStrict } from "../serialization/canonical-json.js";
import { mintStableId } from "./grow-wfo-apply.js";
import {
  integrationDirectory,
  subjectMatchesPath,
  validateSubjectMatches,
} from "./subject-match-validation.js";

const approvalPath = `${integrationDirectory}/subject-approval.json`;
export const subjectRegistryPath = `${integrationDirectory}/subject-registry.json`;

type Proposals = Awaited<ReturnType<typeof validateSubjectMatches>>;
type Endpoint = Proposals["matches"][number]["from"];

export function approvedMatches(proposals: Proposals, approval: RecordValue) {
  if (field(approval, "proposalSha256") !== proposals.proposalSha256)
    throw new Error("Stale subject approval: proposal digest differs");
  if (approval.scope !== "subject-relationships")
    throw new Error("Approval must cover subject relationships only");
  field(approval, "curator");
  field(approval, "quote");
  field(approval, "sourceChatId");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(field(approval, "recordedOn")))
    throw new Error("Invalid subject approval record date");
  const approved = strings(approval.matchIds);
  const ids = new Set(approved);
  if (ids.size === 0 || ids.size !== approved.length)
    throw new Error("Empty or duplicate subject approval IDs");
  const selected = proposals.matches.filter((match) => ids.has(match.id));
  if (selected.length !== ids.size)
    throw new Error("Approval refers to an unknown subject match ID");
  return selected;
}

const scopeKey = ({ packetId, scopeId }: Endpoint) => `${packetId}:${scopeId}`;

/** Resolve identity only. Claim references and evidence stay on their original packet scopes. */
export function resolveSubjectRelationships(
  mappings: RecordValue[],
  matches: Proposals["matches"],
) {
  const byScope = uniqueBy(
    mappings,
    (row) => `${field(row, "packetId")}:${field(row, "scopeId")}`,
  );
  const byId = uniqueBy(mappings, (row) => field(row, "id"));
  function mappingId(pin: Endpoint) {
    const key = scopeKey(pin);
    const mapping = byScope.get(key);
    if (
      !mapping ||
      mapping.packetRevision !== pin.packetRevision ||
      mapping.packetSha256 !== pin.packetSha256 ||
      mapping.declaredKind !== pin.kind ||
      mapping.existingCatalogSubjectId !== pin.catalogSubjectId
    )
      throw new Error(`Stale or conflicting scope mapping: ${key}`);
    return field(mapping, "id");
  }

  const adjacency = new Map<string, string[]>();
  const wrappers = new Set(
    matches
      .filter((match) => match.relation === "comparison-of")
      .map((match) => mappingId(match.from)),
  );
  const pairs = new Set<string>();
  const matchIds = new Set<string>();
  const relationships = matches.map((match) => {
    const from = mappingId(match.from);
    const to = mappingId(match.to);
    if (matchIds.has(match.id))
      throw new Error(`Duplicate applied match ID: ${match.id}`);
    matchIds.add(match.id);
    if (from === to) throw new Error(`Self match: ${match.id}`);
    const pair = [from, to].sort().join(":");
    if (pairs.has(pair))
      throw new Error(`Duplicate applied scope pair: ${match.id}`);
    pairs.add(pair);
    if (match.relation === "same-subject-proposal") {
      if ((match.from.kind === "cultivar") !== (match.to.kind === "cultivar"))
        throw new Error(`Cultivar-to-generic merge is prohibited: ${match.id}`);
      if (wrappers.has(from) || wrappers.has(to))
        throw new Error(`Comparison wrapper cannot be merged: ${match.id}`);
      adjacency.set(from, [...(adjacency.get(from) ?? []), to]);
      adjacency.set(to, [...(adjacency.get(to) ?? []), from]);
    } else if (wrappers.has(to)) {
      throw new Error(`Comparison target cannot be a wrapper: ${match.id}`);
    }
    return {
      matchId: match.id,
      relation:
        match.relation === "same-subject-proposal"
          ? "same-subject"
          : "comparison-of",
      fromMappingId: from,
      toMappingId: to,
      claimInheritance: false,
    };
  });

  const resolved = new Map<string, string>();
  const equivalenceGroups = [];
  for (const anchor of [...adjacency.keys()].sort()) {
    if (resolved.has(anchor)) continue;
    const id = mintStableId("plant-integration", "review-subjects", anchor);
    const pending = [anchor];
    const mappingIds = [];
    const catalogIds = new Set<string>();
    while (pending.length > 0) {
      const member = pending.pop()!;
      if (resolved.has(member)) continue;
      resolved.set(member, id);
      mappingIds.push(member);
      const catalogId = byId.get(member)!.existingCatalogSubjectId;
      if (typeof catalogId === "string") catalogIds.add(catalogId);
      pending.push(...adjacency.get(member)!);
    }
    if (catalogIds.size > 1)
      throw new Error(`Conflicting catalog subject mappings in group ${id}`);
    equivalenceGroups.push({
      id,
      mappingIds: mappingIds.sort(),
      existingCatalogSubjectId: [...catalogIds][0] ?? null,
    });
  }

  const comparisons = new Set<string>();
  for (const link of relationships) {
    if (link.relation !== "comparison-of") continue;
    const target = resolved.get(link.toMappingId) ?? link.toMappingId;
    const key = `${link.fromMappingId}:${target}`;
    if (comparisons.has(key))
      throw new Error(`Duplicate resolved comparison: ${link.matchId}`);
    comparisons.add(key);
  }
  return { equivalenceGroups, relationships };
}

export async function buildSubjectRegistry(root: string) {
  const proposals = await validateSubjectMatches(root, subjectMatchesPath);
  const bytes = await readFile(await containedPath(root, approvalPath));
  const approval = object(parseJsonStrict(bytes));
  const selected = approvedMatches(proposals, approval);
  const { mappings } = await preparePlantIntegration(root);
  const savedPreparation = object(
    parseJsonStrict(
      await readFile(
        await containedPath(root, `${integrationDirectory}/preparation.json`),
      ),
    ),
  );
  if (!same(records(savedPreparation.mappings), mappings))
    throw new Error("Stale or altered integration scope mappings");

  // Replacement scopes have their own exact admission. Keep them out of the
  // approved relationship registry, which is pinned by earlier transactions.
  const relationshipMappings = mappings.filter((row) => !row.replacementScope);
  return {
    status: "validated",
    proposalSha256: proposals.proposalSha256,
    approvalSha256: digest(bytes),
    scopeMappingCount: relationshipMappings.length,
    proposalCount: proposals.matches.length,
    ...resolveSubjectRelationships(relationshipMappings, selected),
  };
}

export async function checkSubjectRegistry(
  root: string,
  expected: Awaited<ReturnType<typeof buildSubjectRegistry>>,
) {
  const saved = parseJsonStrict(
    await readFile(await containedPath(root, subjectRegistryPath)),
  );
  if (!same(saved, expected))
    throw new Error("Stale or altered subject registry");
}

if (process.argv[1] === import.meta.filename) {
  try {
    const args = process.argv.slice(2).filter((arg) => arg !== "--");
    if (args.length !== 1 || !["--write", "--check"].includes(args[0]!))
      throw new Error("Use --write or --check");
    const root = dataRoot(process.cwd());
    const registry = await buildSubjectRegistry(root);
    if (args[0] === "--write") {
      await writeFile(
        resolve(root, subjectRegistryPath),
        await format(JSON.stringify(registry), { parser: "json" }),
      );
    } else {
      await checkSubjectRegistry(root, registry);
    }
    console.log(
      `${registry.relationships.length} applied relationships across ${registry.scopeMappingCount} packet-qualified scope mappings.`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
