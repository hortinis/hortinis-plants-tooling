import { dataRoot } from "../../src/repository-paths.js";
import { catalogFile } from "../support/catalog-file.js";
import { readBordeauxAssessment } from "../../src/curation/saint-etienne-calendar.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

interface DryRunRow {
  packetId: string;
  packetPath: string;
  packetSha256: string;
  claimId: string;
  value: {
    action: string;
    start: { month: number; day: number };
    end: { month: number; day: number };
    crossesYearBoundary: boolean;
    season: number;
  };
  evidence: ({ id: string; supplementalPackageId: string | null } & Record<
    string,
    unknown
  >)[];
  conditions: { geography: string };
  scopes: { id: string }[];
  packetReview: unknown;
  conversion: {
    disposition: string;
    sourceAction: string;
    authoring?: unknown;
    consumer?: unknown;
    reason?: string;
  };
}

interface Packet {
  id: string;
  status: string;
  curatorApproval: unknown;
  evidence: { id: string; originalValue: Record<string, unknown> }[];
  scopes: { id: string }[];
  claims: {
    id: string;
    value: unknown;
    scopeIds: string[];
    evidenceIds: string[];
    conditions: object;
  }[];
}

it("reproduces the schema-fit totals and maps only the supported Bordeaux windows", async () => {
  const live = "data/curation/grow-wfo-initial/assertions.jsonl";
  const historicalInputs = "docs/investigations/schema-fit/inputs.json";
  const before = [live, historicalInputs].map((path) =>
    readFileSync(catalogFile(path)),
  );
  const output = (await readBordeauxAssessment(dataRoot())).toString();
  expect((await readBordeauxAssessment(dataRoot())).toString()).toBe(output);
  const report = JSON.parse(output) as {
    totals: unknown;
    bordeaux: { rows: DryRunRow[] };
  };
  const inventory = JSON.parse(
    readFileSync(
      catalogFile("data/curation/plant-review-consolidation/inventory.json"),
      "utf8",
    ),
  ) as { totals: { packets: number; recommendations: { select: number } } };
  expect(report.totals).toMatchObject({
    packets: inventory.totals.packets,
    selected: inventory.totals.recommendations.select,
    supplementalWithStoredAdmission: 0,
  });
  expect(report.bordeaux).toMatchObject({
    selected: 107,
    mapped: 78,
    mappedPackets: 47,
    unresolved: 29,
    outsideBatch: inventory.totals.recommendations.select - 107,
    projectionStatus: "blocked",
  });

  const rows = report.bordeaux.rows;
  expect(rows).toHaveLength(107);
  expect(
    new Set(rows.map((row) => row.packetId + "/" + row.claimId)).size,
  ).toBe(rows.length);
  for (const row of rows) {
    const packetBytes = readFileSync(catalogFile(row.packetPath));
    const packet = JSON.parse(packetBytes.toString()) as Packet;
    const claim = packet.claims.find(({ id }) => id === row.claimId)!;
    expect(packet.id).toBe(row.packetId);
    expect(createHash("sha256").update(packetBytes).digest("hex")).toBe(
      row.packetSha256,
    );
    expect(row.value).toEqual(claim.value);
    expect(row.conditions).toEqual(claim.conditions);
    expect(row.conditions.geography).toBe("France (Bordeaux)");
    expect(row.scopes).toEqual(
      packet.scopes.filter(({ id }) => claim.scopeIds.includes(id)),
    );
    expect(row.packetReview).toEqual({
      status: packet.status,
      curatorApproval: packet.curatorApproval,
    });
    const source = packet.evidence.find(
      ({ id }) => id === claim.evidenceIds[0],
    )!;
    expect(row.evidence).toEqual([{ ...source, supplementalPackageId: null }]);
    expect(source.originalValue).toEqual({
      start: row.value.start,
      end: row.value.end,
      carrierYear: 2017,
    });

    const { conversion, value } = row;
    if (value.action === "indoors_or_undercover") {
      expect(conversion).toEqual({
        disposition: "unresolved",
        sourceAction: "indoors_or_undercover",
        reason: expect.stringContaining("require a decision") as unknown,
      });
      continue;
    }
    const harvest = value.action === "harvest";
    const action = harvest ? "harvest" : "establish_outdoors";
    const sourceAction = harvest ? "harvest" : "outdoor_sowing_or_planting";
    const timing = {
      type: "calendar-date-window",
      start: value.start,
      end: value.end,
    };
    const validation = { valid: true, errors: [] };
    expect(conversion).toEqual({
      disposition: "mapped",
      sourceAction,
      authoring: {
        predicate: "cultivation_window",
        value: {
          action,
          sourceAction,
          timing,
          sourceTiming: value,
          mappingMethod: harvest ? "identity" : "combined-action-preserved",
        },
        validation,
      },
      consumer: { action, timing, validation },
    });
  }

  expect(
    rows.filter((row) => row.value.action === "establish_outdoors"),
  ).toHaveLength(10);
  expect(rows.filter((row) => row.value.crossesYearBoundary)).toHaveLength(9);
  expect(
    rows.filter((row) => row.conversion.disposition === "unresolved"),
  ).toHaveLength(29);
  expect(
    [live, historicalInputs].map((path) => readFileSync(catalogFile(path))),
  ).toEqual(before);
}, 30000);
