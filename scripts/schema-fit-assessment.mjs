/* global structuredClone */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import console from "node:console";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { Ajv2020 } from "ajv/dist/2020.js";

const toolingRoot = resolve(import.meta.dirname, "..");
const dataRoot = resolve(process.env.HORTINIS_DATA_ROOT ?? toolingRoot);
const assessment = "docs/investigations/schema-fit";
const output = resolve(
  process.env.HORTINIS_OUTPUT_ROOT ?? dataRoot,
  assessment,
);
function inputPath(path) {
  const belongsToData =
    path.startsWith("data/") ||
    path.startsWith(assessment + "/") ||
    path === "AGENTS.md" ||
    path === "docs/open-questions.md";
  return resolve(belongsToData ? dataRoot : toolingRoot, path);
}
const curation = "data/curation";
const packets = `${curation}/plant-review-packets`;
const integration = `${curation}/plant-integration`;
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const exec = promisify(execFile);
const git = async (...args) =>
  (
    await exec("git", args, { cwd: dataRoot, encoding: "utf8" })
  ).stdout.trimEnd();
const head = () => git("rev-parse", "HEAD");
const dirty = () => git("status", "--porcelain=v1", "--untracked-files=normal");
const observed = async () => ({ head: await head(), dirty: await dirty() });
const walk = (directory) =>
  readdirSync(inputPath(directory), { withFileTypes: true })
    .flatMap((item) => {
      const path = join(directory, item.name);
      return item.isDirectory() ? walk(path) : [path];
    })
    .sort();

const observationDate = process.argv[2];
const dryRun = observationDate === "--bordeaux";
assert.equal(process.argv.length, 3, "Expected a date or --bordeaux");
if (!dryRun) assert.match(observationDate ?? "", /^\d{4}-\d{2}-\d{2}$/);
const baseline = dryRun ? null : await observed();
const byteCache = new Map();
function bytes(path) {
  if (!byteCache.has(path)) byteCache.set(path, readFileSync(inputPath(path)));
  return byteCache.get(path);
}
const json = (path) => JSON.parse(bytes(path));
const schemas = () =>
  walk("schemas").filter((path) => path.endsWith(".schema.json"));
const packetFiles = () =>
  walk(packets).filter((path) => /\/r\d+\/packet\.json$/.test(path));
const schemaPaths = schemas();
const bordeauxSchemas = new Map([
  [
    "schemas/authoring/v1/assertion.schema.json",
    `${assessment}/bordeaux-authoring-assertion.json`,
  ],
  [
    "schemas/catalog/v1/cultivation-rule.schema.json",
    `${assessment}/bordeaux-cultivation-rule.json`,
  ],
]);
const packetPaths = packetFiles();
for (const path of [
  ...schemaPaths,
  ...packetPaths,
  ...walk("src"),
  "pnpm-lock.yaml",
  "package.json",
  "node_modules/ajv/package.json",
  "AGENTS.md",
  "docs/open-questions.md",
  "docs/development/plant-review-policy.md",
  "docs/development/plant-review-consolidation.md",
  "docs/development/integrated-curation.md",
  "scripts/schema-fit-assessment.mjs",
  ...(dryRun ? [...bordeauxSchemas.values()] : []),
])
  bytes(path);

const manifest = json(`${curation}/grow-wfo-initial/dataset-manifest.json`);
const dependencies = new Set(manifest.dependencies.map(({ path }) => path));
const inventory = json(`${curation}/plant-review-consolidation/inventory.json`);
const stored = json(`${integration}/status.json`);
const prep = json(`${integration}/preparation.json`);
assert.equal(stored.inventoryFingerprint, inventory.inputFingerprint);
const byId = new Map(inventory.packets.map((p) => [p.id, p]));
const preparedScopes = new Map();
for (const mapping of prep.mappings) {
  const pinned = byId.get(mapping.packetId);
  assert.equal(mapping.packetRevision, pinned?.revision);
  assert.equal(mapping.packetSha256, pinned?.sha256);
  const scopes = preparedScopes.get(mapping.packetId) ?? new Set();
  assert.ok(!scopes.has(mapping.scopeId), mapping.id);
  scopes.add(mapping.scopeId);
  preparedScopes.set(mapping.packetId, scopes);
}
const preparation = new Map(prep.sources.map((entry) => [entry.id, entry]));
assert.equal(preparation.size, prep.sources.length);
const usedPackages = new Set();
const claimKey = (packetId, claimId) => `${packetId}/${claimId}`;
const statusByClaim = new Map(
  stored.proposals.map((p) => [claimKey(p.packetId, p.claimId), p]),
);
assert.equal(statusByClaim.size, stored.proposals.length);

const latest = new Map();
for (const path of packetPaths) {
  const packet = json(path);
  assert.ok(
    path.endsWith(`/${packet.id}/r${packet.revision}/packet.json`),
    path,
  );
  if (
    !latest.has(packet.id) ||
    latest.get(packet.id).packet.revision < packet.revision
  )
    latest.set(packet.id, { path, packet });
}
assert.equal(latest.size, byId.size);

const ajvOptions = {
  allErrors: true,
  strict: true,
  validateSchema: true,
  coerceTypes: false,
  useDefaults: false,
  removeAdditional: false,
};
const ajv = new Ajv2020(ajvOptions);
for (const path of schemaPaths) ajv.addSchema(json(path));
function validator(id, registry = ajv) {
  const validate = registry.getSchema(`urn:hortinis:plants:schema:${id}`);
  assert.ok(validate, id);
  return (data) => {
    const valid = validate(data);
    return { valid, errors: valid ? [] : structuredClone(validate.errors) };
  };
}
const authoring = validator("authoring:v1:assertion");
// Historical Bordeaux rows include exact Ajv diagnostics. Keep those bytes on
// the original assertion contract while validating their proposed conversions
// against the live contract.
let bordeauxAuthoring;
if (dryRun) {
  const registry = new Ajv2020(ajvOptions);
  for (const path of schemaPaths) {
    registry.addSchema(json(bordeauxSchemas.get(path) ?? path));
  }
  bordeauxAuthoring = validator("authoring:v1:assertion", registry);
}
const fact = validator("v1:plant-fact");
const rule = validator("v1:cultivation-rule");
const packetSchema = validator("curation:v1:plant-review-proposal");
const skeleton = {
  id: "shape-check",
  subject: { type: "plant-concept", id: "shape-check-subject" },
  contextId: "shape-check-context",
  evidenceReferenceIds: ["shape-check-evidence"],
  reviewId: "shape-check-review",
};

function registered(packet, digest, evidence) {
  const alias = `${packet.id}:${evidence.id}`;
  const id =
    "c4-source-admissions-" +
    sha(
      `hortinis:c4:plant-integration-preparation:source-admissions:${alias}`,
    ).slice(0, 32);
  const prefix = `data/sources/supplemental/${id}`;
  if (!dependencies.has(`${prefix}/source.json`)) return null;
  const receipt = json(`${prefix}/provenance.json`);
  assert.deepEqual(receipt, preparation.get(id), id);
  assert.equal(receipt.packetId, packet.id);
  assert.equal(receipt.packetRevision, packet.revision);
  assert.equal(receipt.packetSha256, digest);
  assert.equal(receipt.evidenceId, evidence.id);
  for (const [name, key] of [
    ["source", "source"],
    ["licence", "licence"],
    ["source-manifest", "sourceManifest"],
  ]) {
    const path = `${prefix}/${name}.json`;
    assert.ok(dependencies.has(path), path);
    assert.deepEqual(json(path), receipt[key], path);
  }
  for (const key of [
    "locator",
    "originalValue",
    "sourceRecord",
    "rights",
    "capture",
  ])
    assert.deepEqual(receipt.provenance[key], evidence[key], `${id} ${key}`);
  assert.equal(receipt.provenance.originalRelease, evidence.release);
  assert.equal(receipt.provenance.originalSourceId, evidence.sourceId);
  if (evidence.capture.kind !== "reference-only")
    assert.equal(
      sha(bytes(evidence.capture.path)),
      evidence.capture.sha256,
      evidence.capture.path,
    );
  usedPackages.add(id);
  return id;
}

function validMonthDay({ month, day }) {
  // GROW's workbook stores these dates in the non-leap carrier year 2017.
  return (
    Number.isInteger(month) &&
    Number.isInteger(day) &&
    day > 0 &&
    day <= [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
  );
}

function checkCalendarDates(value, original, claimId) {
  const { start, end } = value;
  const ordering = ({ month, day }) => month * 100 + day;
  assert.equal(value.precision, "day", claimId);
  assert.equal(original.carrierYear, 2017, claimId);
  assert.ok(validMonthDay(start) && validMonthDay(end), claimId);
  assert.deepEqual(original.start, start, claimId);
  assert.deepEqual(original.end, end, claimId);
  assert.equal(
    value.crossesYearBoundary,
    ordering(start) > ordering(end),
    claimId,
  );
}

function calendarCandidate(
  claim,
  evidence,
  sourceAction = claim.value?.action,
) {
  const source = claim.value;
  if (
    !source?.start ||
    !source?.end ||
    source.precision !== "day" ||
    !["establish_outdoors", "outdoor_sowing_or_planting", "harvest"].includes(
      source.action,
    )
  )
    return null;
  const action =
    source.action === "outdoor_sowing_or_planting"
      ? "establish_outdoors"
      : source.action;
  const timing = {
    type: "calendar-date-window",
    start: source.start,
    end: source.end,
  };
  assert.equal(evidence.length, 1, claim.id);
  checkCalendarDates(source, evidence[0].originalValue, claim.id);
  const assertionValue = {
    action,
    timing,
    sourceAction,
    sourceTiming: source,
    mappingMethod:
      action === sourceAction ? "identity" : "combined-action-preserved",
  };
  return {
    assertionValue,
    authoring: authoring({
      ...skeleton,
      predicate: "cultivation_window",
      value: assertionValue,
    }),
    consumer: rule({ ...skeleton, status: "active", action, timing }),
  };
}

// The LUS worksheet uses these source headers in each of its two seasons.
const bordeauxColumns = {
  "D:E": [1, "indoors_or_undercover"],
  "F:G": [1, "outdoor_sowing_or_planting"],
  "H:I": [1, "harvest"],
  "K:L": [2, "indoors_or_undercover"],
  "M:N": [2, "outdoor_sowing_or_planting"],
  "O:P": [2, "harvest"],
};

function bordeauxConversion(row) {
  const { claimId, value, evidence, conditions } = row;
  assert.equal(conditions.geography, "France (Bordeaux)", claimId);
  assert.equal(evidence.length, 1, claimId);
  const [source] = evidence;
  assert.equal(source.sourceId, "source_grow_edible_plant_database", claimId);
  assert.equal(source.release, "doi:10.15132/10000157", claimId);
  const cells = /^PlantingCalendar\.xlsx!LUS!([A-Z])([1-9]\d*):([A-Z])\2$/.exec(
    source.locator,
  );
  assert.ok(cells, claimId + " invalid Bordeaux locator");
  const columns = bordeauxColumns[cells[1] + ":" + cells[3]];
  assert.ok(columns, claimId + " unknown Bordeaux action columns");
  const [season, sourceAction] = columns;
  assert.equal(value.season, season, claimId);
  assert.equal(
    value.action === "establish_outdoors"
      ? "outdoor_sowing_or_planting"
      : value.action,
    sourceAction,
    claimId + " locator action mismatch",
  );
  if (Object.hasOwn(value, "sourceAction"))
    assert.equal(value.sourceAction, sourceAction, claimId);

  assert.equal(source.capture.kind, "review-extract", claimId);
  assert.equal(sha(bytes(source.capture.path)), source.capture.sha256, claimId);
  const extract = json(source.capture.path);
  const entries = extract.candidates ?? extract.entries ?? extract.claims;
  const captured = entries.filter(
    (entry) => (entry.sourceLocator ?? entry.locator) === source.locator,
  );
  assert.equal(
    captured.length,
    1,
    claimId + " locator missing or ambiguous in capture",
  );
  const [entry] = captured;
  assert.deepEqual(
    entry.rawValue ?? entry.originalValue,
    source.originalValue,
    claimId,
  );
  const capturedRecord = entry.sourceRecordId ?? entry.sourceRecord;
  if (extract.candidates) {
    assert.equal(capturedRecord, source.sourceRecord, claimId);
    assert.equal(entry.sourceId, source.sourceId, claimId);
    assert.equal(entry.sourceReleaseId, source.release, claimId);
    assert.equal(
      entry.applicability.geography.name,
      conditions.geography,
      claimId,
    );
    assert.equal(entry.normalizedValue.action, sourceAction, claimId);
    assert.equal(entry.normalizedValue.season, season, claimId);
  } else {
    assert.equal(entry.evidenceId ?? entry.id, source.id, claimId);
    if (extract.entries)
      assert.equal(capturedRecord, source.sourceRecord, claimId);
  }
  const candidate = calendarCandidate(
    { id: claimId, value },
    evidence,
    sourceAction,
  );
  if (sourceAction === "indoors_or_undercover") {
    assert.equal(candidate, null, claimId);
    checkCalendarDates(value, source.originalValue, claimId);
    return {
      sourceAction,
      disposition: "unresolved",
      reason:
        "The source combines indoor sowing and undercover cultivation. The action and growing system require a decision.",
    };
  }
  assert.ok(candidate?.authoring.valid && candidate.consumer.valid, claimId);
  return {
    sourceAction,
    disposition: "mapped",
    authoring: {
      predicate: "cultivation_window",
      value: candidate.assertionValue,
      validation: candidate.authoring,
    },
    consumer: {
      action: candidate.assertionValue.action,
      timing: candidate.assertionValue.timing,
      validation: candidate.consumer,
    },
  };
}

function otherCandidate(claim) {
  const { predicate } = claim.implementation;
  const { value } = claim;
  if (predicate === "days_to_first_harvest" && value.anchor === "seeding") {
    const mapped = { ...value.duration, anchor: "after_sowing" };
    return {
      predicate,
      value: mapped,
      authoring: authoring({ ...skeleton, predicate, value: mapped }),
      consumer: fact({
        ...skeleton,
        predicate,
        value: mapped,
        status: "active",
      }),
      caveat:
        "Confirm first-harvest endpoint and preserve approximate Manitoba garden scope.",
    };
  }
  if (
    predicate === "cultivation_window" &&
    value.minimumSoilTemperatureC !== undefined
  ) {
    const action = "direct_sow";
    const timing = {
      type: "soil-temperature-threshold",
      operator: "at-least",
      temperature: { value: value.minimumSoilTemperatureC, unit: "Cel" },
    };
    const mapped = {
      action,
      timing,
      sourceAction: action,
      sourceTiming: value,
      mappingMethod: "identity",
    };
    return {
      predicate,
      value: mapped,
      authoring: authoring({ ...skeleton, predicate, value: mapped }),
      consumer: rule({ ...skeleton, status: "active", action, timing }),
      caveat:
        "Require explicit direct-sow action and outdoor single-root scope review. Keep the source's approximate Fahrenheit value and omit unknown depth/measurement protocol.",
    };
  }
  if (
    predicate === "sun_requirement" &&
    Array.isArray(value) &&
    value.length === 1
  ) {
    const mapped = value[0];
    return {
      predicate,
      value: mapped,
      authoring: authoring({ ...skeleton, predicate, value: mapped }),
      consumer: fact({
        ...skeleton,
        predicate,
        value: mapped,
        status: "active",
      }),
      caveat: "Retain source array and qualifiers in lineage.",
    };
  }
  return null;
}

function classify(claim, supplemental, consumerFit, calendar) {
  const {
    domain,
    value,
    topic,
    implementation: { predicate },
  } = claim;
  const phrase =
    `${topic} ${typeof value === "string" ? value : JSON.stringify(value)}`.toLowerCase();
  const has = (pattern) => pattern.test(phrase);
  const result = (group, cause) => ({ group, cause });
  if (domain === "identity" && !predicate) {
    if (!supplemental)
      return result("taxon-name-subject-records", "wrong-record-type");
    if (
      has(
        /mophead|lacecap|growing types|growing-type|separate lily groups|early\/maincrop|short-root form|june-bearing/,
      )
    )
      return result("subject-types-and-applicability", "scope-or-conditions");
    if (has(/qualité culinaire|couleur gousse|conical root/))
      return result("cultivar-comparison-traits", "wrong-record-or-predicate");
    return result("supplemental-identity-and-comparison", "wrong-record-type");
  }
  if (calendar?.authoring.valid && calendar.consumer.valid)
    return result("calendar-date-windows", "lossless-normalization");
  if (predicate === "days_to_first_harvest" && value.anchor === "seeding")
    return result("nested-sowing-harvest-duration", "lossless-normalization");
  if (
    predicate === "cultivation_window" &&
    value.minimumSoilTemperatureC !== undefined
  )
    return result("action-specific-soil-threshold", "scope-or-conditions");
  if (consumerFit?.valid)
    return result("existing-fact-shape", "assessment-scope");
  if (predicate === "sun_requirement" && Array.isArray(value))
    return result(
      value.length === 1 ? "singleton-sun" : "sun-alternatives",
      value.length === 1 ? "lossless-normalization" : "missing-representation",
    );
  if (domain === "environment") {
    if (has(/grow soil texture/) && !predicate)
      return result("unmapped-soil-classes", "ambiguous-source-meaning");
    if (has(/\bph\b/))
      return result("ph-plus-site-guidance", "scope-or-conditions");
    if (/^(use )?well-drained soil$/i.test(String(value)))
      return result("plain-drainage", "wrong-record-or-predicate");
    if (has(/sun|drain|shad|fertil|shelter|moist|soil|loam|potting|substrate/))
      return result("site-soil-and-light-bundles", "scope-or-conditions");
    return result("other-site-and-form", "wrong-record-or-predicate");
  }
  if (domain === "temperature") {
    if (has(/germinat|emergence.*\bat\b/))
      return result("germination-role-and-pairing", "missing-representation");
    if (
      has(
        /frost|freez|hardiness|hardy|overwinter|cold|winter root|open flowers and unopened buds/,
      )
    )
      return result("frost-stage-and-exposure", "scope-or-conditions");
    if (value === "unknown")
      return result("unresolved-temperature-class", "ambiguous-source-meaning");
    return result(
      "growth-stage-and-temperature-role",
      "missing-representation",
    );
  }
  if (domain === "planting") {
    if (value?.action === "indoors_or_undercover")
      return result("ambiguous-calendar-action", "ambiguous-source-meaning");
    if (has(/soil temperature|°[cf]|temperature|four-inch/))
      return result("planting-thermal-conditions", "scope-or-conditions");
    if (
      has(
        /spac|\bcm\b|\binches\b|\bfeet\b|depth|heights? deep|betweenplantscm|block arrangement|plants\/ha/,
      )
    )
      return result("planting-dimensions-and-layout", "missing-representation");
    if (
      has(
        /frost|harden|weeks|before|after|season|spring|autumn|summer|winter|succession|\bdays\b/,
      )
    )
      return result("planting-timing-and-preparation", "scope-or-conditions");
    return result("propagation-and-establishment", "missing-representation");
  }
  if (domain === "water") {
    if (has(/\bkpa\b|tensiometer|soil tension/))
      return result("water-tension-trigger", "missing-representation");
    if (has(/\bmm\b|amountmm|rainfall equivalent|\binch\b|\b3–5 cm\b/))
      return result("water-amount-and-period", "missing-representation");
    if (has(/every \d|intervaldays/))
      return result("water-interval-without-amount", "missing-representation");
    return result("water-stage-and-conditions", "scope-or-conditions");
  }
  if (domain === "nutrition") {
    if (has(/\d+\s*(?:lb|kg|g\b|oz)|nitrogen.*schedule/))
      return result("nutrient-product-and-dose", "missing-representation");
    if (has(/agronomist|site-specific|soil (analysis|test)|soil-tested/))
      return result(
        "nutrition-requires-local-input",
        "ambiguous-source-meaning",
      );
    return result("conditional-feeding", "scope-or-conditions");
  }
  if (domain === "harvest") {
    if (has(/storage|conservation|storability|store|curing/))
      return result("storage-and-curing", "wrong-record-or-predicate");
    if (has(/\bweeks?\b|\bdays?\b|minimumdays|checkintervaldays/))
      return result("harvest-anchors-and-intervals", "scope-or-conditions");
    return result("harvest-stage-and-method", "missing-representation");
  }
  if (has(/rotation family|rotation group/))
    return result("rotation-classification", "ambiguous-source-meaning");
  if (has(/prun|deadh[e]?ad|pinch|trim|canes/))
    return result("pruning-and-training", "scope-or-conditions");
  if (
    has(
      /pollinat|compatible pollen|self-fertil|flowering partners|insect access/,
    )
  )
    return result("pollination-and-companions", "scope-or-conditions");
  if (has(/weed/)) return result("weed-management", "missing-representation");
  if (has(/support|trellis/))
    return result("physical-support", "missing-representation");
  if (
    has(/stor|curing|ventilat|perforated sheets|surface drying|best-use window/)
  )
    return result("storage-and-curing", "wrong-record-or-predicate");
  return result("other-care-practices", "scope-or-conditions");
}

const rows = [];
const bordeaux = [];
for (const [id, { path, packet }] of latest) {
  const digest = sha(bytes(path));
  const pinned = byId.get(id);
  assert.equal(path, pinned.path);
  assert.equal(packet.revision, pinned.revision);
  assert.equal(digest, pinned.sha256);
  assert.deepEqual(
    preparedScopes.get(id),
    new Set(packet.scopes.map(({ id }) => id)),
  );
  const checked = packetSchema(packet);
  assert.ok(checked.valid, JSON.stringify(checked.errors));
  const evidenceById = new Map(packet.evidence.map((row) => [row.id, row]));
  for (const claim of packet.claims.filter(
    (row) => row.recommendation === "select",
  )) {
    const evidence = claim.evidenceIds.map((id) => {
      const original = evidenceById.get(id);
      const packageId = registered(packet, digest, original);
      return { ...original, supplementalPackageId: packageId };
    });
    const registeredIds = evidence
      .filter((row) => row.supplementalPackageId)
      .map(({ id }) => id);
    const supplemental =
      evidence.length > 0 && registeredIds.length === evidence.length;
    const { predicate } = claim.implementation;
    const assertion = { ...skeleton, predicate, value: claim.value };
    const shape = authoring(assertion);
    const status = statusByClaim.get(claimKey(id, claim.id));
    assert.ok(status, claim.id);
    for (const [key, expected] of Object.entries({
      packetRevision: packet.revision,
      packetSha256: digest,
      predicate,
      domain: claim.domain,
      scopeIds: claim.scopeIds,
      allEvidenceHasSupplementalMetadata: supplemental,
      authoringSchemaShapeFits: shape.valid,
      registeredSupplementalEvidenceIds: registeredIds,
    }))
      assert.deepEqual(status[key], expected, `${claim.id} ${key}`);
    const exactFact = shape.valid
      ? fact({ ...assertion, status: "active" })
      : null;
    const calendar = calendarCandidate(claim, evidence);
    const normalizationCandidate = otherCandidate(claim);
    if (normalizationCandidate) {
      assert.ok(normalizationCandidate.authoring.valid, claim.id);
      assert.ok(normalizationCandidate.consumer.valid, claim.id);
    }
    const primary = classify(claim, supplemental, exactFact, calendar);
    const conditions = claim.conditions;
    rows.push({
      packetId: id,
      packetRevision: packet.revision,
      packetSha256: digest,
      packetPath: path,
      plant: packet.plant.label,
      claimId: claim.id,
      domain: claim.domain,
      topic: claim.topic,
      implementation: claim.implementation,
      value: claim.value,
      interpretation: claim.interpretation,
      scopeIds: claim.scopeIds,
      scopes: packet.scopes.filter((scope) =>
        claim.scopeIds.includes(scope.id),
      ),
      conditions,
      evidence,
      allSupplementalMetadataRegistered: supplemental,
      authoringExact: shape,
      plantFactExact: exactFact,
      calendarCandidate: calendar,
      normalizationCandidate,
      ...primary,
      admissionReviewIdsInStoredStatus: status.admissionReviewIds,
      applicabilityDimensions: [
        ...[
          "measurementMedium",
          "lifeStage",
          "eventAnchor",
          "geography",
          "growingSystem",
        ].filter((key) => conditions[key] !== null),
        ...(conditions.qualifications.length ? ["qualifications"] : []),
      ],
    });
    if (dryRun && claim.value?.type === "calendar-date-window") {
      const row = rows.at(-1);
      const { calendarCandidate: baselineCandidate, ...lineage } = row;
      const conversion = bordeauxConversion(row);
      assert.equal(
        Boolean(baselineCandidate),
        conversion.disposition === "mapped",
        claim.id,
      );
      bordeaux.push({
        ...lineage,
        authoringExact: bordeauxAuthoring(assertion),
        recommendation: claim.recommendation,
        packetReview: {
          status: packet.status,
          curatorApproval: packet.curatorApproval,
        },
        conversion,
      });
    }
  }
}

assert.equal(rows.length, statusByClaim.size);
assert.equal(usedPackages.size, preparation.size);
const subset = rows.filter((row) => row.allSupplementalMetadataRegistered);
const totals = {
  packets: latest.size,
  selected: rows.length,
  supplemental: subset.length,
  supplementalPackages: usedPackages.size,
  partlyRegistered: rows.filter(
    (row) =>
      !row.allSupplementalMetadataRegistered &&
      row.evidence.some((ev) => ev.supplementalPackageId),
  ).length,
  authoringExact: rows.filter((row) => row.authoringExact.valid).length,
  supplementalAuthoringExact: subset.filter((row) => row.authoringExact.valid)
    .length,
  calendarCandidates: rows.filter(
    (row) => row.calendarCandidate?.consumer.valid,
  ).length,
  supplementalWithStoredAdmission: subset.filter(
    (row) => row.admissionReviewIdsInStoredStatus.length,
  ).length,
  plantFactExact: rows.filter((row) => row.plantFactExact?.valid).length,
  supplementalPlantFactExact: subset.filter((row) => row.plantFactExact?.valid)
    .length,
};
assert.equal(
  totals.supplementalAuthoringExact,
  stored.totals.exactSchemaShapeAndSupplementalMetadata,
);
const summarize = (selected, key) =>
  Object.fromEntries(
    [...new Set(selected.map((row) => row[key]))].sort().map((value) => {
      const matching = selected.filter((row) => row[key] === value);
      return [
        value,
        {
          claims: matching.length,
          packets: new Set(matching.map((row) => row.packetId)).size,
          plantLabels: new Set(matching.map((row) => row.plant)).size,
          exactAuthoring: matching.filter((row) => row.authoringExact.valid)
            .length,
          exactPlantFact: matching.filter((row) => row.plantFactExact?.valid)
            .length,
          example: claimKey(matching[0].packetId, matching[0].claimId),
          exampleValue: matching[0].value,
          exampleOriginalValues: matching[0].evidence.map(
            ({ originalValue }) => originalValue,
          ),
        },
      ];
    }),
  );
const slices = {
  supplemental: subset,
  other: rows.filter((row) => !row.allSupplementalMetadataRegistered),
};
const summary = Object.fromEntries(
  Object.entries(slices).map(([name, selected]) => [
    name,
    Object.fromEntries(
      ["domain", "cause", "group"].map((key) => [
        key,
        summarize(selected, key),
      ]),
    ),
  ]),
);
const work = [
  ["bordeaux-calendar", "other", ["calendar-date-windows"]],
  [
    "supplemental-fact-pilot",
    "supplemental",
    ["existing-fact-shape", "nested-sowing-harvest-duration"],
  ],
  [
    "qualified-site-facts",
    "supplemental",
    [
      "plain-drainage",
      "site-soil-and-light-bundles",
      "ph-plus-site-guidance",
      "other-site-and-form",
    ],
  ],
  [
    "planting-rules",
    "supplemental",
    [
      "action-specific-soil-threshold",
      "planting-thermal-conditions",
      "planting-dimensions-and-layout",
      "planting-timing-and-preparation",
      "propagation-and-establishment",
    ],
  ],
  [
    "temperature-observations",
    "supplemental",
    [
      "frost-stage-and-exposure",
      "germination-role-and-pairing",
      "growth-stage-and-temperature-role",
    ],
  ],
  [
    "water-guidance",
    "supplemental",
    [
      "water-amount-and-period",
      "water-interval-without-amount",
      "water-stage-and-conditions",
    ],
  ],
  [
    "harvest-and-storage",
    "supplemental",
    [
      "harvest-stage-and-method",
      "harvest-anchors-and-intervals",
      "storage-and-curing",
    ],
  ],
  [
    "conditional-care",
    "supplemental",
    [
      "other-care-practices",
      "pruning-and-training",
      "physical-support",
      "pollination-and-companions",
      "weed-management",
    ],
  ],
  [
    "qualified-nutrition",
    "supplemental",
    [
      "nutrient-product-and-dose",
      "nutrition-requires-local-input",
      "conditional-feeding",
    ],
  ],
  [
    "subject-and-comparison",
    "supplemental",
    [
      "supplemental-identity-and-comparison",
      "subject-types-and-applicability",
      "cultivar-comparison-traits",
    ],
  ],
];
const workCoverage = Object.fromEntries(
  work.map(([id, slice, groups]) => {
    const selected = slices[slice].filter((row) => groups.includes(row.group));
    return [
      id,
      {
        slice,
        groups,
        claims: selected.length,
        packets: new Set(selected.map((row) => row.packetId)).size,
        plantLabels: new Set(selected.map((row) => row.plant)).size,
      },
    ];
  }),
);
assert.equal(
  Object.values(workCoverage)
    .filter((row) => row.slice === "supplemental")
    .reduce((sum, row) => sum + row.claims, 0),
  subset.length,
);
const fingerprints = Object.fromEntries(
  [...byteCache]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, data]) => [path, sha(data)]),
);
assert.deepEqual(
  packetFiles(),
  packetPaths,
  "Packet file list changed during analysis",
);
assert.deepEqual(
  schemas(),
  schemaPaths,
  "Schema file list changed during analysis",
);
for (const [path, digest] of Object.entries(fingerprints))
  assert.equal(
    sha(readFileSync(inputPath(path))),
    digest,
    `Input changed during analysis: ${path}`,
  );
const pretty = (data) => JSON.stringify(data, null, 2) + "\n";
if (dryRun) {
  const mapped = bordeaux.filter(
    ({ conversion }) => conversion.disposition === "mapped",
  );
  const unresolved = bordeaux.length - mapped.length;
  process.stdout.write(
    pretty({
      mode: "bordeaux-calendar-dry-run",
      inventoryFingerprint: inventory.inputFingerprint,
      schemaFingerprint: sha(
        JSON.stringify(schemaPaths.map((path) => [path, fingerprints[path]])),
      ),
      totals,
      schemaFitRoutes: summary,
      bordeaux: {
        selected: bordeaux.length,
        mapped: mapped.length,
        mappedPackets: new Set(mapped.map((row) => row.packetId)).size,
        unresolved,
        outsideBatch: rows.length - bordeaux.length,
        outsideBatchReason:
          "Selected proposals without a Bordeaux calendar-date window are outside this conversion batch.",
        projectionStatus: "blocked",
        projectionReason:
          "Catalog use requires approved packet-qualified subject and Bordeaux context mappings, claim approval and rights review.",
        rows: bordeaux,
      },
    }),
  );
} else {
  const end = await observed();
  assert.equal(end.head, baseline.head, "HEAD changed during analysis");
  mkdirSync(output, { recursive: true });
  writeFileSync(
    `${output}/inputs.json`,
    pretty({
      observationDate,
      node: process.version,
      ajv: json("node_modules/ajv/package.json").version,
      baseline,
      end,
      sha256: fingerprints,
    }),
  );
  writeFileSync(
    `${output}/assessment.jsonl`,
    rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
  );
  writeFileSync(
    `${output}/summary.json`,
    pretty({ totals, summary, workCoverage }),
  );
  console.log(pretty(totals));
}
