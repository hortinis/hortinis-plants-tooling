import { readFile } from "node:fs/promises";
import { dataRoot } from "../repository-paths.js";
import {
  object,
  records,
  field,
  containedPath,
  digest,
  assertSchema,
} from "./curation-artifacts.js";
import { parseJsonStrict } from "../serialization/canonical-json.js";
import { validate } from "../schema/validation-api.js";

export const integrationDirectory = "data/curation/plant-integration";
export const subjectMatchesPath = `${integrationDirectory}/subject-matches.json`;

/** Validate exact local scopes without inferring identity or inheriting approvals. */
export async function validateSubjectMatches(root: string, inputPath: string) {
  const bytes = await readFile(await containedPath(root, inputPath));
  const input = object(parseJsonStrict(bytes));
  const ids = new Set<string>();
  const pairs = new Set<string>();
  const result = [];
  for (const match of records(input.matches)) {
    const id = field(match, "id");
    if (ids.has(id)) throw new Error(`Duplicate match ID: ${id}`);
    ids.add(id);
    if (
      !["same-subject-proposal", "comparison-of"].includes(
        field(match, "relation"),
      )
    )
      throw new Error(`Unknown match relation: ${id}`);
    if (match.claimInheritance !== false || match.approval !== null)
      throw new Error(
        `Proposal must not inherit claims or imply approval: ${id}`,
      );
    const endpoints = [];
    for (const side of ["from", "to"]) {
      const pin = object(match[side]);
      const packetId = field(pin, "packetId");
      const revision = pin.packetRevision;
      if (
        !/^pr_[0-9a-f-]+$/.test(packetId) ||
        !Number.isSafeInteger(revision) ||
        Number(revision) < 1
      )
        throw new Error("Invalid packet pin");
      const path = `data/curation/plant-review-packets/${packetId}/r${String(revision)}/packet.json`;
      const bytes = await readFile(await containedPath(root, path));
      if (digest(bytes) !== field(pin, "packetSha256"))
        throw new Error(`Stale packet pin: ${id}/${side}`);
      const packet = object(JSON.parse(bytes.toString("utf8")));
      assertSchema(
        { validate },
        "urn:hortinis:plants:schema:curation:v1:plant-review-proposal",
        packet,
      );
      if (packet.id !== packetId || packet.revision !== revision)
        throw new Error("Packet identity differs from pin");
      const scopeId = field(pin, "scopeId");
      const scope = records(packet.scopes).find((row) => row.id === scopeId);
      if (!scope) throw new Error(`Missing scope: ${id}/${side}`);
      endpoints.push({
        packetId,
        packetRevision: Number(revision),
        packetSha256: digest(bytes),
        scopeId,
        catalogSubjectId: scope.catalogSubjectId,
        label: field(scope, "label"),
        kind: field(scope, "kind"),
        plant: field(object(packet.plant), "label"),
      });
    }
    const from = endpoints[0]!,
      to = endpoints[1]!;
    const first = `${from.packetId}:${from.scopeId}`,
      second = `${to.packetId}:${to.scopeId}`;
    if (first === second) throw new Error(`Self match: ${id}`);
    const pair =
      match.relation === "same-subject-proposal"
        ? [first, second].sort().join("|")
        : `${first}|${second}`;
    if (pairs.has(pair)) throw new Error(`Duplicate subject pair: ${id}`);
    pairs.add(pair);
    if (
      match.relation === "same-subject-proposal" &&
      (from.kind === "cultivar") !== (to.kind === "cultivar")
    )
      throw new Error(`Cultivar-to-generic merge is prohibited: ${id}`);
    result.push({
      id,
      relation: match.relation,
      from,
      to,
      reason: field(match, "reason"),
      approval: null,
    });
  }
  return {
    status: "validated",
    approved: false,
    proposalSha256: digest(bytes),
    matches: result,
  };
}

if (process.argv[1] === import.meta.filename) {
  try {
    console.log(
      JSON.stringify(
        await validateSubjectMatches(
          dataRoot(process.cwd()),
          process.argv[2] ?? subjectMatchesPath,
        ),
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
