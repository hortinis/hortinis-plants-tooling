import { dataRoot } from "../../src/repository-paths.js";
import { catalogFile } from "../support/catalog-file.js";
import { readFileSync } from "node:fs";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  matchesLocalCalendarPreview,
  prepareSaintEtienneCalendar,
} from "../../src/curation/saint-etienne-calendar.js";
import { admitSaintEtienneCalendar } from "../../src/curation/admit-saint-etienne-calendar.js";
import {
  digest,
  field,
  object,
  records,
} from "../../src/curation/curation-artifacts.js";
import { validateAuthoring } from "../../src/curation/reviewed-licensing-acceptance.js";
import { validateValidationDataset } from "../../src/curation/validation-dataset.js";
import {
  matchesConditionalCultivationRule,
  projectCultivationRules,
} from "../../src/domain/cultivation-rule-projection.js";
import { validate } from "../../src/schema/validation-api.js";

it("accounts for all Bordeaux claims while preparing a separate local batch", async () => {
  const protectedPaths = [
    "data/curation/grow-wfo-initial/assertions.jsonl",
    "data/curation/grow-wfo-initial/packet-decisions.jsonl",
    "data/curation/plant-integration/canonical-subject-approval.json",
    "data/curation/plant-integration/subject-approval.json",
    "docs/investigations/schema-fit/inputs.json",
  ];
  const before = protectedPaths.map((path) => readFileSync(catalogFile(path)));
  const currentStatus = object(
    JSON.parse(
      readFileSync(
        catalogFile("data/curation/plant-integration/status.json"),
        "utf8",
      ),
    ),
  );
  const totals = object(currentStatus.totals);
  const result = await prepareSaintEtienneCalendar(dataRoot());
  expect(result).toMatchObject({
    status: "validated",
    curatorApproval: "review-51196473-0fa8-481a-ba0e-a1a50ca5f14a",
    commercialRelease: "blocked",
    baseline: { catalogAssertions: 4 },
    integrationTotals: {
      packets: totals.packets,
      qualifiedScopesOutsideThisAdmission:
        totals.qualifiedScopesOutsideThisAdmission,
      canonicalRecordsAdmitted: 9,
      canonicalQualifiedScopesAdmitted: 11,
      subjectMatchesApprovedAndApplied: 16,
    },
    totals: {
      bordeauxMapped: 78,
      bordeauxMappedPackets: 47,
      indoorOrUndercoverUnresolved: 29,
      outdoorOrHarvestDeferred: 69,
      originalRowsWithProposal: 9,
      windows: 8,
      newIdentities: 5,
      proposedScopeMappings: 6,
    },
  });
  expect(result.currentCatalogAssertions.count).toBe(
    before[0]!.toString().trim().split("\n").length,
  );
  expect(result.dispositions).toHaveLength(107);
  const protectedCases = result.dispositions.filter(
    (row) => row.original.value.action === "indoors_or_undercover",
  );
  expect(protectedCases).toHaveLength(29);
  expect(
    protectedCases.every(
      (row) => row.proposalId === null && row.reason.includes("without heat"),
    ),
  ).toBe(true);
  const onion = result.windows.find((window) => window.originals.length === 2)!;
  expect(onion.action).toBe("establish_outdoors");
  expect(onion.mappings.map((mapping) => mapping.disposition)).toEqual([
    "admitted",
    "admitted",
  ]);
  expect(onion.originals[0]!.value).toMatchObject({
    start: { month: 3, day: 15 },
    end: { month: 6, day: 16 },
  });
  expect(onion.originals[0]!.evidence[0]).toMatchObject({
    originalValue: { carrierYear: 2017 },
  });
  expect(result.proposedBindings[0]!.disposition).toBe("in progress");
  const cucumber = result.windows.find((window) =>
    window.evidence.includes("cucumber"),
  )!;
  expect(cucumber).toMatchObject({
    action: "transplant",
    threshold: { medium: "air", operator: "reliably-above", value: 12 },
    liveProjection: "validated",
  });
  const peas = result.windows.filter((window) =>
    window.evidence.includes("pea"),
  );
  expect(peas).toHaveLength(2);
  for (const pea of peas) {
    expect(pea).toMatchObject({
      preview: {
        action: "direct_sow",
        threshold: { medium: "soil", value: 10 },
      },
      liveProjection: "validated",
    });
  }
  const garden = { ...peas[0]!.preview, growingSystem: "outdoor" };
  expect(matchesLocalCalendarPreview(peas[0]!.preview, garden)).toBe(true);
  expect(matchesLocalCalendarPreview(peas[1]!.preview, garden)).toBe(false);
  expect(
    matchesLocalCalendarPreview(peas[0]!.preview, {
      ...garden,
      communeCode: "33063",
    }),
  ).toBe(false);
  expect(
    matchesLocalCalendarPreview(peas[0]!.preview, {
      ...garden,
      growingSystem: "unheated_shelter",
    }),
  ).toBe(false);
  expect(
    matchesLocalCalendarPreview(peas[0]!.preview, {
      ...garden,
      contextId: "another-context",
    }),
  ).toBe(false);
  expect(
    validate("urn:hortinis:plants:schema:curation:v1:local-calendar-preview", {
      ...peas[0]!.preview,
      timing: onion.originals[0]!.value,
    }).valid,
  ).toBe(false);
  expect(protectedPaths.map((path) => readFileSync(catalogFile(path)))).toEqual(
    before,
  );
}, 30_000);

it("projects all approved conditions and keeps source dates in comparison lineage", async () => {
  const plan = await prepareSaintEtienneCalendar(dataRoot());
  const { dataset } = await validateAuthoring(
    dataRoot(),
    catalogFile("data/curation/grow-wfo-initial"),
  );
  const review = dataset.reviews.find(
    (row) => row.id === plan.curatorApproval,
  )!;
  const admission = object(review.calendarAdmission);
  const approval = object(admission.approval);
  expect(approval.sha256).toBe(
    digest(readFileSync(catalogFile(field(approval, "path")))),
  );
  expect(object(admission.licensingAcceptance)).toMatchObject({
    id: "review-6e7a55c6-60c3-4bb1-a070-257d3aef0dea",
  });
  const lineage = records(admission.lineage);
  const expectedIds = new Set(plan.windows.map((window) => window.assertionId));
  const projected = projectCultivationRules(dataset, "authoring").filter(
    (rule) => expectedIds.has(String(rule.id)),
  );
  expect(projected).toHaveLength(8);
  expect(
    projectCultivationRules(dataset, "commercial").filter((rule) =>
      expectedIds.has(String(rule.id)),
    ),
  ).toEqual([]);
  const geography = dataset.geographicContexts!.find(
    (row) => row.id === plan.geography.record.id,
  )!;
  expect(geography).toMatchObject({
    administrativeCode: { scheme: "INSEE-COG-commune", code: "42218" },
    limitations: plan.geography.limitations,
  });
  for (const window of plan.windows) {
    const rule = projected.find((row) => row.id === window.assertionId)!;
    const context = dataset.contexts.find((row) => row.id === rule.contextId)!;
    const timing = object(rule.timing);
    expect(rule).toMatchObject({
      subject: window.preview.subject,
      action: window.action,
    });
    expect(timing).toMatchObject({
      type: "conditional-season",
      season: window.season,
      confidence: window.confidence,
      limitations: window.limitations,
      evaluation: "local-observation-required",
      applicability: "exact-subject-only",
    });
    expect(timing).not.toHaveProperty("start");
    const conditions = records(timing.allOf);
    expect(conditions.filter((row) => typeof row.key === "string")).toEqual(
      window.requirements.map((key) => ({
        type: key === "frost" ? "frost-risk-passed" : "qualitative",
        key,
        guidance: plan.qualifiers[key],
        ...(key === "hardening" ? { appliesTo: "transplant" } : {}),
      })),
    );
    expect(
      conditions.filter(
        (row) =>
          row.type === "air-temperature-threshold" ||
          row.type === "soil-temperature-threshold",
      ),
    ).toEqual(
      window.threshold
        ? [
            {
              type: `${window.threshold.medium}-temperature-threshold`,
              operator: window.threshold.operator,
              temperature: { value: window.threshold.value, unit: "Cel" },
            },
          ]
        : [],
    );
    const garden = {
      subject: window.preview.subject,
      communeCode: "42218",
      growingSystem: "outdoor",
      protection: "none",
      soilOrContainer: "in_ground",
      productionSetting: "home-garden",
    };
    expect(
      matchesConditionalCultivationRule(rule, context, geography, garden),
    ).toBe(true);
    for (const override of [
      { communeCode: "33063" },
      { growingSystem: "unheated_shelter" },
      { protection: "cloche" },
      { soilOrContainer: "container" },
      { productionSetting: "commercial-production" },
      { subject: { type: "cultivar", id: garden.subject.id } },
      { subject: { type: "plant-concept", id: "another-plant" } },
    ]) {
      expect(
        matchesConditionalCultivationRule(rule, context, geography, {
          ...garden,
          ...override,
        }),
      ).toBe(false);
    }
    const receipt = lineage.find((row) => row.assertionId === rule.id)!;
    expect(receipt.proposalId).toBe(window.id);
    expect(
      records(receipt.mappings).map((mapping) => ({
        scopeId: mapping.scopeId,
        packetSha256: mapping.packetSha256,
        approvedMappingId: mapping.approvedMappingId,
        subject: mapping.subject,
      })),
    ).toEqual(
      window.mappings.map((mapping) => ({
        scopeId: mapping.scopeId,
        packetSha256: mapping.packetSha256,
        approvedMappingId: mapping.mappingId,
        subject: mapping.subject,
      })),
    );
    expect(
      records(receipt.comparisonOnly).map((row) => row.originalWindow),
    ).toEqual(window.originals.map((row) => row.value));
    for (const id of rule.evidenceReferenceIds as string[]) {
      const evidence = dataset.evidence.find((row) => row.id === id)!;
      expect(evidence).toMatchObject({
        rights: { decision: "pending-review" },
      });
      expect(evidence.sourceManifestId).toBeDefined();
      expect(evidence.sourceReleaseId).toBeDefined();
      expect(evidence.sourceRecordId).toBeDefined();
      expect(evidence.locator).not.toContain("PlantingCalendar.xlsx");
    }
  }

  const first = projected[0]!;
  const amended = dataset.assertions.map((row) =>
    row.id === first.id
      ? {
          ...row,
          value: {
            ...object(row.value),
            timing: {
              ...object(first.timing),
              allOf: records(object(first.timing).allOf).slice(1),
            },
          },
        }
      : row,
  );
  expect(
    validateValidationDataset({ ...dataset, assertions: amended }),
  ).toContainEqual(
    expect.objectContaining({
      code: "INVALID_SOURCE_DECISION",
      recordId: review.id,
    }),
  );
  const wrongReceipt = {
    ...admission,
    lineage: lineage.map((entry, index) =>
      index === 0
        ? {
            ...entry,
            mappings: records(entry.mappings).map((mapping) => ({
              ...mapping,
              admittedMappingId: "unapproved-mapping",
            })),
          }
        : entry,
    ),
  };
  const wrongReviews = dataset.reviews.map((row) =>
    row.id === review.id ? { ...row, calendarAdmission: wrongReceipt } : row,
  );
  expect(
    validateValidationDataset({ ...dataset, reviews: wrongReviews }),
  ).toContainEqual(
    expect.objectContaining({
      code: "INVALID_SOURCE_DECISION",
      recordId: review.id,
    }),
  );
}, 30_000);

it("replays first admission exactly and verifies a retry in isolation", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "hortinis-calendar-admission-"));
  const catalog = "data/curation/grow-wfo-initial";
  try {
    await mkdir(join(scratch, "data/curation"), { recursive: true });
    for (const path of [
      "AGENTS.md",
      "docs",
      ...(await readdir(catalogFile("data/curation")))
        .filter((name) => name !== "grow-wfo-initial")
        .map((name) => "data/curation/" + name),
    ])
      await symlink(catalogFile(path), join(scratch, path));
    await cp(catalogFile("data/sources"), join(scratch, "data/sources"), {
      recursive: true,
    });
    await cp(catalogFile(catalog), join(scratch, catalog), { recursive: true });
    const manifest = catalog + "/dataset-manifest.json";
    const liveManifest = object(
      JSON.parse(readFileSync(catalogFile(manifest), "utf8")),
    );
    await writeFile(
      join(scratch, manifest),
      JSON.stringify({
        ...liveManifest,
        dependencies: records(liveManifest.dependencies).filter(
          (entry) =>
            !field(entry, "path").startsWith(
              "data/sources/supplemental/saint-etienne-calendar/",
            ),
        ),
      }),
    );
    const { dataset } = await validateAuthoring(
      dataRoot(),
      catalogFile(catalog),
    );
    const review = dataset.reviews.find(
      (row) => row.scope === "saint-etienne-calendar-proposal",
    )!;
    const added = [
      ...records(object(review.calendarAdmission).records),
      { collection: "reviews", value: review },
    ];
    for (const file of new Set(added.map((row) => field(row, "collection")))) {
      const ids = new Set(
        added
          .filter((row) => row.collection === file)
          .map((row) => object(row.value).id),
      );
      const path = catalog + "/" + file + ".jsonl";
      const lines = readFileSync(catalogFile(path), "utf8").split("\n");
      await writeFile(
        join(scratch, path),
        lines
          .filter((line) => !line || !ids.has(object(JSON.parse(line)).id))
          .join("\n"),
      );
    }
    const before = await validateAuthoring(scratch, join(scratch, catalog));
    const admittedAssertionCount = records(
      object(review.calendarAdmission).records,
    ).filter((row) => row.collection === "assertions").length;
    expect(before.dataset.assertions).toHaveLength(
      dataset.assertions.length - admittedAssertionCount,
    );
    const result = await admitSaintEtienneCalendar(scratch);
    expect(result.alreadyAdmitted).toBe(false);
    expect(projectCultivationRules(dataset, "commercial")).toEqual(
      projectCultivationRules(before.dataset, "commercial"),
    );
    expect(await admitSaintEtienneCalendar(scratch)).toEqual({
      alreadyAdmitted: true,
      datasetSha256: result.datasetSha256,
    });
    for (const file of await readdir(catalogFile(catalog))) {
      if (file === "dataset-manifest.json") {
        // This replay appends the calendar dependencies after later admissions.
        // Verify the exact dependency records independently of insertion order.
        const replayed = object(
          JSON.parse(readFileSync(join(scratch, catalog, file), "utf8")),
        );
        const live = object(
          JSON.parse(readFileSync(catalogFile(catalog, file), "utf8")),
        );
        const ordered = (value: unknown) =>
          records(value).toSorted((a, b) =>
            field(a, "id").localeCompare(field(b, "id")),
          );
        expect({
          ...replayed,
          dependencies: ordered(replayed.dependencies),
        }).toEqual({
          ...live,
          dependencies: ordered(live.dependencies),
        });
        continue;
      }
      expect(readFileSync(join(scratch, catalog, file))).toEqual(
        readFileSync(catalogFile(catalog, file)),
      );
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}, 120_000);
