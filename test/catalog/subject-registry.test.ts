import { dataRoot } from "../../src/repository-paths.js";
import { catalogFile } from "../support/catalog-file.js";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { mintStableId } from "../../src/curation/grow-wfo-apply.js";
import {
  object,
  records,
  field,
} from "../../src/curation/curation-artifacts.js";
import {
  approvedMatches,
  buildSubjectRegistry,
  checkSubjectRegistry,
  resolveSubjectRelationships,
} from "../../src/curation/subject-registry.js";
import {
  subjectMatchesPath,
  validateSubjectMatches,
} from "../../src/curation/subject-match-validation.js";

type Match = Awaited<
  ReturnType<typeof validateSubjectMatches>
>["matches"][number];

function scope(
  packet: string,
  kind = "generic",
  catalogSubjectId: string | null = null,
) {
  return {
    packetId: packet,
    scopeId: "reused-local-scope",
    packetRevision: 1,
    packetSha256: "sha256",
    kind,
    catalogSubjectId,
    label: packet,
    plant: packet,
  };
}

function mapping(pin: Match["from"]) {
  return {
    id: `mapping-${pin.packetId}`,
    packetId: pin.packetId,
    scopeId: pin.scopeId,
    packetRevision: pin.packetRevision,
    packetSha256: pin.packetSha256,
    declaredKind: pin.kind,
    existingCatalogSubjectId: pin.catalogSubjectId,
    claimIds: [`claim-${pin.packetId}`],
  };
}

function match(
  id: string,
  from: Match["from"],
  to: Match["to"],
  relation = "same-subject-proposal",
): Match {
  return { id, from, to, relation, reason: "Fixture", approval: null };
}

it("resolves transitive equivalence deterministically and preserves original claim scope", () => {
  const a = scope("a", "generic", "active-subject");
  const b = scope("b", "growing-type");
  const c = scope("c");
  const wrapper = scope("wrapper");
  const mappings = [a, b, c, wrapper].map(mapping);
  const links = [
    match("ab", a, b),
    match("bc", b, c),
    match("compare", wrapper, b, "comparison-of"),
  ];
  const result = resolveSubjectRelationships(mappings, links);
  expect(result.equivalenceGroups).toEqual([
    {
      id: mintStableId("plant-integration", "review-subjects", "mapping-a"),
      mappingIds: ["mapping-a", "mapping-b", "mapping-c"],
      existingCatalogSubjectId: "active-subject",
    },
  ]);
  expect(
    resolveSubjectRelationships(mappings.toReversed(), links.toReversed())
      .equivalenceGroups,
  ).toEqual(result.equivalenceGroups);
  expect(result.relationships[2]).toEqual({
    matchId: "compare",
    relation: "comparison-of",
    fromMappingId: "mapping-wrapper",
    toMappingId: "mapping-b",
    claimInheritance: false,
  });
  expect(mappings.map((row) => row.claimIds)).toEqual([
    ["claim-a"],
    ["claim-b"],
    ["claim-c"],
    ["claim-wrapper"],
  ]);
});

it("rejects stale mappings, conflicting catalog IDs, duplicate links and prohibited merges", () => {
  const a = scope("a", "generic", "catalog-a");
  const b = scope("b", "growing-type");
  const c = scope("c", "generic", "catalog-c");
  const cultivar = scope("cultivar", "cultivar");
  const wrapper = scope("wrapper");
  const mappings = [a, b, c, cultivar, wrapper].map(mapping);
  const ab = match("ab", a, b);
  const comparison = match("compare", wrapper, b, "comparison-of");
  expect(() =>
    resolveSubjectRelationships(mappings, [
      match("stale", { ...a, packetRevision: 2 }, b),
    ]),
  ).toThrow("Stale or conflicting scope mapping");
  expect(() =>
    resolveSubjectRelationships([...mappings, mapping(a)], [ab]),
  ).toThrow("Duplicate key");
  expect(() =>
    resolveSubjectRelationships(mappings, [ab, match("bc", b, c)]),
  ).toThrow("Conflicting catalog subject mappings");
  expect(() => resolveSubjectRelationships(mappings, [ab, ab])).toThrow(
    "Duplicate applied match ID",
  );
  expect(() =>
    resolveSubjectRelationships(mappings, [ab, match("ba", b, a)]),
  ).toThrow("Duplicate applied scope pair");
  expect(() =>
    resolveSubjectRelationships(mappings, [
      ab,
      comparison,
      match("also", wrapper, a, "comparison-of"),
    ]),
  ).toThrow("Duplicate resolved comparison");
  expect(() =>
    resolveSubjectRelationships(mappings, [match("merge", cultivar, a)]),
  ).toThrow("Cultivar-to-generic merge");
  expect(() =>
    resolveSubjectRelationships(mappings, [
      comparison,
      match("wrapper", wrapper, a),
    ]),
  ).toThrow("Comparison wrapper cannot be merged");
});

it("validates the applied batch against the saved approval and rejects stale or invalid approvals", async () => {
  const root = dataRoot();
  const approvalPath = join(
    dirname(subjectMatchesPath),
    "subject-approval.json",
  );
  const approval = object(
    JSON.parse(await readFile(catalogFile(approvalPath), "utf8")),
  );
  const proposals = await validateSubjectMatches(root, subjectMatchesPath);
  expect(proposals.approved).toBe(false);
  expect(proposals.matches.every((row) => row.approval === null)).toBe(true);
  expect(approvedMatches(proposals, approval)).toHaveLength(16);
  expect(() =>
    approvedMatches(proposals, { ...approval, proposalSha256: "stale" }),
  ).toThrow("Stale subject approval");
  expect(() =>
    approvedMatches(proposals, { ...approval, matchIds: ["unknown"] }),
  ).toThrow("unknown subject match");
  const registry = await buildSubjectRegistry(root);
  await checkSubjectRegistry(root, registry);
  expect(registry.scopeMappingCount).toBe(499);
  expect(
    registry.equivalenceGroups.map((row) => row.mappingIds.length).sort(),
  ).toEqual([2, 2, 2, 2, 3]);
  expect(
    registry.relationships.filter((row) => row.relation === "comparison-of"),
  ).toHaveLength(10);
}, 30000);

it("rejects a proposal with claim inheritance, inline approval or stale packet bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "hortinis-subject-matches-"));
  try {
    const input = object(
      JSON.parse(await readFile(catalogFile(subjectMatchesPath), "utf8")),
    );
    const first = records(input.matches)[0]!;
    const path = "proposal.json";
    for (const changes of [
      { claimInheritance: true },
      { approval: { curator: "Julien" } },
    ]) {
      await writeFile(
        join(root, path),
        JSON.stringify({ matches: [{ ...first, ...changes }] }),
      );
      await expect(validateSubjectMatches(root, path)).rejects.toThrow(
        "Proposal must not inherit claims or imply approval",
      );
    }
    const pin = object(first.from);
    const packetPath = `data/curation/plant-review-packets/${field(pin, "packetId")}/r${String(pin.packetRevision)}/packet.json`;
    await mkdir(dirname(join(root, packetPath)), { recursive: true });
    await cp(catalogFile(packetPath), join(root, packetPath));
    await writeFile(
      join(root, path),
      JSON.stringify({
        matches: [{ ...first, from: { ...pin, packetSha256: "0".repeat(64) } }],
      }),
    );
    await expect(validateSubjectMatches(root, path)).rejects.toThrow(
      "Stale packet pin",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
