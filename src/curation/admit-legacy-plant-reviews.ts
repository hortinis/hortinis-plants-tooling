import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { cacheRoot, dataRoot } from "../repository-paths.js";
import { validate } from "../schema/validation-api.js";
import {
  assertSchema,
  digest,
  field,
  object,
  records,
  same,
  type RecordValue,
} from "./curation-artifacts.js";
import {
  acquireDatasetLock,
  authoringFingerprint,
  readCollections,
  runDecisionTransaction,
} from "./decision-transaction.js";
import { mintStableId } from "./grow-wfo-apply.js";
import {
  catalogPath,
  readLicensingAcceptance,
  validateAuthoring,
} from "./reviewed-licensing-acceptance.js";
import { consolidatePlantReviews } from "./plant-review-consolidation.js";

const transaction = "legacy-tomato-lettuce-2026-10";
const mint = (collection: string, alias: string) =>
  mintStableId(transaction, collection, alias);
const plant = (id: string) => ({ type: "plant-concept", id });
const contextId = "c4-cultivation-contexts-f81ec874bda61d9f1e288435df49d08a";
const tomato = plant("c4-plant-concepts-9db246485c8aa7afd8c780b162ee13f5");

export async function admitLegacyPlantReviews(
  root: string,
  directory = resolve(root, catalogPath),
) {
  const unlock = await acquireDatasetLock(directory);
  try {
    const {
      manifest: { collections: descriptors },
      dataset,
    } = await validateAuthoring(root, directory);
    const initial = await authoringFingerprint(directory, descriptors);
    const original = await readCollections(directory, descriptors);
    const collections = new Map(
      [...original].map(([role, rows]) => [role, [...rows]]),
    );
    const licence = await readLicensingAcceptance(root);
    if (
      !same(
        original.get("reviews")?.find((row) => row.id === licence.id),
        licence,
      )
    )
      throw new Error("Record the curator's licensing acceptance first");
    const inventory = await consolidatePlantReviews(root);
    if (inventory.checks.status !== "validated")
      throw new Error("Invalid review inventory");
    const pins = new Map<string, string>();
    const read = async (path: string, expected?: string) => {
      const bytes = await readFile(resolve(root, path));
      const sha = digest(bytes);
      if (expected && sha !== expected) throw new Error(`Stale input: ${path}`);
      pins.set(path, sha);
      return bytes.toString("utf8");
    };
    const getRunOutput = async (adapter: string, filename: string) => {
      const path = resolve(cacheRoot(root), "import-runs", adapter, "latest");
      const run = object(
        JSON.parse(await read(resolve(path, "importer-run-manifest.json"))),
      );
      const output = records(run.outputs).find((row) => row.path === filename);
      if (!output) throw new Error(`Missing importer output: ${filename}`);
      return (await read(resolve(path, filename), field(output, "sha256")))
        .trimEnd()
        .split("\n")
        .map((line) => object(JSON.parse(line)));
    };
    const [growRecords, cropRecords, candidates] = await Promise.all([
      getRunOutput("grow", "source-records.jsonl"),
      getRunOutput("cropgraph", "source-records.jsonl"),
      getRunOutput("grow", "candidates.jsonl"),
    ]);
    const selectedRecord = (rows: RecordValue[], id: string) => {
      const record = rows.find(
        (row) => object(row.sourceRecordKey).recordId === id,
      );
      if (!record) throw new Error(`Missing source record ${id}`);
      return record;
    };
    const changed: { collection: string; value: RecordValue }[] = [];
    const append = (collection: string, value: RecordValue) => {
      const descriptor = descriptors.find((row) => row.role === collection);
      if (!descriptor) throw new Error(`Missing collection ${collection}`);
      assertSchema({ validate }, descriptor.schemaId, value);
      const rows = collections.get(collection)!;
      const existing = rows.find((row) => row.id === value.id);
      if (existing && !same(existing, value))
        throw new Error(`Conflicting record ${String(value.id)}`);
      if (!existing) {
        rows.push(value);
        changed.push({ collection, value });
      }
      return field(value, "id");
    };
    const evidence = (
      alias: string,
      sourceRecordKey: unknown,
      locator: unknown,
      originalValue: unknown,
      licenceId: string,
      method: string,
      decision = "pending-review",
    ) =>
      append("evidence-references", {
        id: mint("evidence-references", alias),
        sourceRecordKey,
        locator,
        normalization: { originalValue, method },
        rights: {
          licenceId,
          decision,
          reviewId: licence.id,
          reason:
            decision === "eligible"
              ? "Pinned WFO backbone CC0 applies to the captured taxonomic fields."
              : "Curator accepted recorded source licensing. Commercial claim rights retain their pending status.",
        },
      });
    const memo = async (name: string, date: string) => {
      const path = `docs/reviews/${name}.md`;
      const pin = inventory.legacyDocuments.find((doc) => doc.path === path);
      if (!pin) throw new Error(`Missing legacy decision ${name}`);
      const text = await read(path, pin.sha256);
      if (!text.includes("Julien") || !text.includes(date))
        throw new Error(`Missing decision authority in ${path}`);
      return {
        id: mint("reviews", name),
        purpose: "content",
        status: "accepted",
        reviewerId: "Julien",
        reviewedAt: date + "T00:00:00Z",
        provenance: { path, sha256: pin.sha256, timestampPrecision: "date" },
      };
    };
    const identity = await memo("lettuce-identity-2026-10-08", "2026-10-08");
    const lettucePin = inventory.packets.find(
      (packet) => packet.plant.label === "Lettuce cultivar comparison",
    );
    if (!lettucePin) throw new Error("Missing lettuce WFO capture");
    const lettucePacket = object(
      JSON.parse(await read(lettucePin.path, lettucePin.sha256)),
    );
    const lettuceTaxonomy = records(lettucePacket.evidence).find(
      (row) =>
        row.sourceRecord === "wfo-0000128816" &&
        row.sourceId === "source_world_flora_online_plant_list",
    );
    if (!lettuceTaxonomy) throw new Error("Missing approved lettuce taxon");
    const acceptedName = object(lettuceTaxonomy.originalValue);
    if (
      acceptedName.scientificName !== "Lactuca sativa" ||
      acceptedName.taxonomicStatus !== "Accepted"
    )
      throw new Error("Lettuce WFO identity differs from the approved taxon");
    const startIdentity = changed.length;
    const wfo = {
      sourceId: field(lettuceTaxonomy, "sourceId"),
      sourceManifestId: "source_manifest_wfo_plant_list_2026_06",
      sourceReleaseId: field(lettuceTaxonomy, "release"),
    };
    const wfoId = field(lettuceTaxonomy, "sourceRecord");
    const wfoLocator = field(lettuceTaxonomy, "locator");
    const wfoEvidence = evidence(
      wfoId,
      { source: wfo, recordId: wfoId },
      wfoLocator,
      acceptedName,
      "licence_cc0_1_0",
      "Accepted WFO backbone identity in the previously approved lettuce structure.",
      "eligible",
    );
    const taxonId = append("taxa", {
      id: mint("taxa", wfoId),
      status: "active",
      scientificName: acceptedName.scientificName,
      taxonRank: acceptedName.taxonRank,
      evidenceReferenceIds: [wfoEvidence],
    });
    const externalIdentifier = { ...wfo, identifier: wfoId };
    const acceptedTaxonomicNameId = append("taxonomic-names", {
      id: mint("taxonomic-names", wfoId),
      taxonId,
      status: "active",
      nameStatus: "accepted",
      scientificName: acceptedName.scientificName,
      authorship: acceptedName.authorship,
      taxonRank: acceptedName.taxonRank,
      externalIdentifier,
      reviewId: identity.id,
      evidenceReferenceIds: [wfoEvidence],
    });
    const crosswalkId = append("external-taxonomy-crosswalks", {
      id: mint("external-taxonomy-crosswalks", wfoId),
      taxonId,
      externalIdentifier,
      externalName: acceptedName.scientificName,
      authorship: acceptedName.authorship,
      taxonRank: acceptedName.taxonRank,
      taxonomicStatus: acceptedName.taxonomicStatus,
      locator: wfoLocator,
      reviewId: identity.id,
      matchMethod: "manual",
    });
    const headSynonym = records(lettucePacket.evidence).find(
      (row) =>
        row.sourceRecord === "wfo-1200068578" && row.sourceId === wfo.sourceId,
    );
    if (!headSynonym) throw new Error("Missing WFO head-lettuce synonym");
    const synonymValue = object(headSynonym.originalValue);
    if (
      synonymValue.scientificName !== "Lactuca sativa var. capitata" ||
      synonymValue.taxonomicStatus !== "Synonym" ||
      synonymValue.acceptedNameUsageId !== wfoId
    )
      throw new Error("Head-lettuce WFO source outcome changed");
    const synonymId = field(headSynonym, "sourceRecord");
    const synonymLocator = field(headSynonym, "locator");
    const synonymEvidence = evidence(
      synonymId,
      { source: wfo, recordId: synonymId },
      synonymLocator,
      synonymValue,
      "licence_cc0_1_0",
      "Pinned WFO synonym for the crop source name.",
      "eligible",
    );
    const synonymExternal = { ...wfo, identifier: synonymId };
    append("taxonomic-names", {
      id: mint("taxonomic-names", synonymId),
      taxonId,
      status: "active",
      nameStatus: "synonym",
      scientificName: synonymValue.scientificName,
      authorship: synonymValue.authorship,
      taxonRank: synonymValue.taxonRank,
      externalIdentifier: synonymExternal,
      reviewId: identity.id,
      acceptedTaxonomicNameId,
      evidenceReferenceIds: [synonymEvidence],
    });
    const headCrosswalk = append("external-taxonomy-crosswalks", {
      id: mint("external-taxonomy-crosswalks", synonymId),
      taxonId,
      externalIdentifier: synonymExternal,
      externalName: synonymValue.scientificName,
      authorship: synonymValue.authorship,
      taxonRank: synonymValue.taxonRank,
      taxonomicStatus: synonymValue.taxonomicStatus,
      acceptedNameIdentifier: wfoId,
      locator: synonymLocator,
      reviewId: identity.id,
      matchMethod: "manual",
    });
    const addConcept = (
      label: string,
      alias: string,
      evidenceReferenceIds: string[],
      parentPlantConceptId?: string,
    ) => {
      const subject = plant(
        append("plant-concepts", {
          id: mint("plant-concepts", alias),
          status: "active",
          evidenceReferenceIds,
          ...(parentPlantConceptId
            ? { kind: "growing-type", parentPlantConceptId, taxonId }
            : { kind: "generic", taxonId }),
        }),
      );
      append("localized-names", {
        id: mint("localized-names", alias),
        subject,
        value: label,
        languageTag: "en",
        kind: "common",
        preferred: true,
        evidenceReferenceIds,
      });
      return subject;
    };
    const lettuce = addConcept("Lettuce", wfoId, [wfoEvidence]);
    const lettuceTypes = [
      { grow: "19", crop: "lettuce-head", label: "Head lettuce" },
      { grow: "50", crop: "lettuce-leaf", label: "Loose-leaf lettuce" },
    ].map(({ grow, crop, label }) => {
      const growRecord = selectedRecord(growRecords, grow);
      const cropRecord = selectedRecord(cropRecords, crop);
      const growFields = object(growRecord.fields);
      const cropFields = object(cropRecord.rawEntry);
      const sourceEvidence = [
        evidence(
          grow + ":name",
          growRecord.sourceRecordKey,
          field(growRecord, "sourceLocator") + "&field=Common%20name",
          {
            name: growFields["Common name"],
            scientificName: growFields["Full taxonomic name"],
          },
          "licence_cc_by_4_0",
          "Approved GROW growing-type identity.",
        ),
        evidence(
          crop + ":name",
          cropRecord.sourceRecordKey,
          cropRecord.sourceLocator,
          {
            name: cropFields.commonName,
            scientificName: cropFields.scientificName,
            citation: cropRecord.effectiveCitation,
            commercialRights: cropRecord.commercialRights,
          },
          "licence_cropgraph_data_declared_cc_by_4_0",
          "Approved CropGraph growing-type identity.",
        ),
      ];
      const subject = addConcept(
        label,
        wfoId + ":" + grow,
        sourceEvidence,
        lettuce.id,
      );
      for (const record of [growRecord, cropRecord]) {
        const key = object(record.sourceRecordKey);
        const sourceName =
          record === growRecord
            ? growFields["Full taxonomic name"]
            : cropFields.scientificName;
        const externalTaxonomyCrosswalkId =
          record === cropRecord && grow === "19" ? headCrosswalk : crosswalkId;
        append("source-name-decisions", {
          id: mint("source-name-decisions", field(key, "recordId")),
          sourceRecordKey: key,
          sourceName,
          sourceLocator: record.sourceLocator,
          decision: "manual-match",
          externalTaxonomyCrosswalkId,
          reviewId: identity.id,
          reason:
            "Preserve the original source botanical name and the pinned WFO outcome under the approved lettuce identity.",
        });
        append("source-subject-mappings", {
          id: mint("source-subject-mappings", field(key, "recordId")),
          sourceRecordKey: key,
          sourceLocator: record.sourceLocator,
          decision: "map",
          subject,
          externalTaxonomyCrosswalkId,
          reviewId: identity.id,
          reason:
            "Exact source-record pairing in the 2026-10-08 lettuce identity approval.",
        });
      }
      return { grow, subject, growRecord };
    });
    const identityRecords = changed.slice(startIdentity);
    const commitReview = (review: RecordValue, snapshots: typeof changed) => {
      const existing = original
        .get("reviews")
        ?.find((row) => row.id === review.id);
      if (existing) {
        if (snapshots.length)
          throw new Error("Previously admitted legacy review is incomplete");
        return;
      }
      append("reviews", {
        ...review,
        legacyPlantAdmission: { records: snapshots },
      });
    };
    commitReview(identity, identityRecords);

    const addAssertion = (
      alias: string,
      subject: ReturnType<typeof plant>,
      predicate: string,
      value: unknown,
      evidenceId: string,
      review: RecordValue,
      cultivationContext = contextId,
    ) =>
      append("assertions", {
        id: mint("assertions", alias),
        subject,
        predicate,
        value,
        contextId: cultivationContext,
        evidenceReferenceIds: [evidenceId],
        reviewId: review.id,
      });
    const selectedCandidate = (
      grow: string,
      subject: ReturnType<typeof plant>,
      predicate: string,
      expected: unknown,
      review: RecordValue,
      method: string,
    ) => {
      const candidate = candidates.find(
        (row) =>
          row.sourceRecordId === grow &&
          row.predicate === predicate &&
          same(row.normalizedValue, expected),
      );
      if (!candidate)
        throw new Error(
          `Pinned GROW candidate does not match approval: ${grow} ${predicate}`,
        );
      const alias = field(candidate, "id");
      const reference = evidence(
        alias,
        candidate.sourceRecordKey,
        candidate.sourceLocator,
        candidate.rawValue,
        field(candidate, "licenceId"),
        method,
      );
      addAssertion(alias, subject, predicate, expected, reference, review);
    };
    const rawFact = (
      record: RecordValue,
      subject: ReturnType<typeof plant>,
      column: string,
      predicate: string,
      value: unknown,
      review: RecordValue,
      check: RegExp,
      method: string,
      cultivationContext = contextId,
    ) => {
      const alias =
        field(object(record.sourceRecordKey), "recordId") +
        ":" +
        column +
        ":" +
        predicate;
      const raw = field(object(record.fields), column);
      if (!check.test(raw))
        throw new Error(
          `Pinned GROW raw field differs from approval: ${alias}`,
        );
      const originalValue =
        predicate === "sun_requirement"
          ? {
              [column]: raw,
              "Sunlight requirements": object(record.fields)[
                "Sunlight requirements"
              ],
            }
          : raw;
      const reference = evidence(
        alias,
        record.sourceRecordKey,
        field(record, "sourceLocator") + "&field=" + encodeURIComponent(column),
        originalValue,
        "licence_cc_by_4_0",
        method,
      );
      addAssertion(
        alias,
        subject,
        predicate,
        value,
        reference,
        review,
        cultivationContext,
      );
    };
    const duration = (days: number) => ({
      minimum: days,
      maximum: days,
      unit: "d",
    });
    const temperature = (optimum: number) => ({ optimum, unit: "Cel" });
    const tomatoGermination = await memo(
      "tomato-soil-germination-water-2026-10-07",
      "2026-10-07",
    );
    let start = changed.length;
    selectedCandidate(
      "88",
      tomato,
      "soil_ph_range",
      { minimum: 5.5, maximum: 7.5 },
      tomatoGermination,
      "Reported preferred interval.",
    );
    selectedCandidate(
      "88",
      tomato,
      "germination_profile",
      { duration: duration(6), temperature: temperature(26) },
      tomatoGermination,
      "Paired fields: approximately six days; no controlled trial at exactly 26°C is established.",
    );
    commitReview(tomatoGermination, changed.slice(start));
    const lettuceGermination = await memo(
      "lettuce-ph-germination-sun-2026-10-10",
      "2026-10-10",
    );
    start = changed.length;
    for (const { grow, subject, growRecord } of lettuceTypes) {
      selectedCandidate(
        grow,
        subject,
        "soil_ph_range",
        { minimum: 6, maximum: 7 },
        lettuceGermination,
        "Reported preferred interval.",
      );
      selectedCandidate(
        grow,
        subject,
        "germination_profile",
        {
          temperature: temperature(24),
          ...(grow === "19" ? { duration: duration(3) } : {}),
        },
        lettuceGermination,
        "Head: approximately three days. Loose-leaf: duration unspecified.",
      );
      rawFact(
        growRecord,
        subject,
        "Plant Requirements",
        "sun_requirement",
        ["full_sun"],
        lettuceGermination,
        /full sun/i,
        "Curator selected the prose. The conflicting Partial shade field remains source evidence.",
      );
    }
    commitReview(lettuceGermination, changed.slice(start));
    const lettuceGrowth = await memo(
      "lettuce-growth-water-nutrients-2026-10-10",
      "2026-10-11",
    );
    start = changed.length;
    for (const { grow, subject } of lettuceTypes) {
      selectedCandidate(
        grow,
        subject,
        "growing_temperature",
        { minimum: 4, maximum: 27, unit: "Cel" },
        lettuceGrowth,
        "GROW reported ideal band, separate from the Manitoba best-production context.",
      );
    }
    commitReview(lettuceGrowth, changed.slice(start));
    const tomatoSoil = await memo(
      "tomato-soil-care-nutrients-2026-10-08",
      "2026-10-08",
    );
    start = changed.length;
    rawFact(
      selectedRecord(growRecords, "88"),
      tomato,
      "Soil",
      "soil_texture",
      ["loam"],
      tomatoSoil,
      /^Loamy$/,
      "Qualitative source soil texture.",
    );
    commitReview(tomatoSoil, changed.slice(start));
    const tomatoSeedlings = await memo(
      "tomato-seedling-zones-calendars-2026-10-08",
      "2026-10-08",
    );
    start = changed.length;
    const europe = dataset.contexts.find((row) => row.id === contextId);
    if (!europe) throw new Error("Missing GROW context");
    const seedlingContext = append("cultivation-contexts", {
      ...europe,
      id: mint("cultivation-contexts", "grow-seedling"),
      lifeStage: "seedling",
    });
    rawFact(
      selectedRecord(growRecords, "88"),
      tomato,
      "Plant Requirements",
      "growing_temperature",
      temperature(18),
      tomatoSeedlings,
      /Seedlings are best kept at 18°C/,
      "Reported seedling recommendation. Numerical day/night and measurement medium are unspecified.",
      seedlingContext,
    );
    commitReview(tomatoSeedlings, changed.slice(start));

    const lettuceSoil = await memo(
      "lettuce-soil-spacing-sowing-2026-10-11",
      "2026-10-11",
    );
    start = changed.length;
    for (const { grow, subject, growRecord } of lettuceTypes) {
      if (grow === "19") {
        rawFact(
          growRecord,
          subject,
          "Soil",
          "drainage_requirement",
          "well_drained",
          lettuceSoil,
          /well-drained/i,
          "Extract the explicitly approved drainage component. Fertility and moisture retention are independent source observations.",
        );
      } else {
        rawFact(
          growRecord,
          subject,
          "Soil",
          "soil_texture",
          ["loam"],
          lettuceSoil,
          /^Loamy$/,
          "Qualitative source soil texture. Moisture retention remains a separate observation.",
        );
      }
    }
    commitReview(lettuceSoil, changed.slice(start));

    const tomatoTransplant = await memo(
      "tomato-transplanting-2026-10-08",
      "2026-10-08",
    );
    start = changed.length;
    const cropTomato = selectedRecord(cropRecords, "tomato");
    const windows = records(object(cropTomato.rawEntry).windows);
    const transplant = windows.find((window) => window.action === "transplant");
    if (
      !transplant ||
      transplant.anchor !== "last_spring" ||
      transplant.fromFrostDays !== 7 ||
      transplant.toFrostDays !== 84 ||
      transplant.notes !== "Harden off 7-10 days; soil should reach 60°F"
    )
      throw new Error(
        "CropGraph transplant source differs from the approved window and note",
      );
    const cropLocation =
      field(cropTomato, "sourceLocator") +
      "/windows/" +
      windows.indexOf(transplant);
    const cropLicence = "licence_cropgraph_data_declared_cc_by_4_0";
    const cropMethod =
      "North American outdoor transplant guidance. Original CropGraph rights remain pending.";
    const transplantContext =
      "c4-cultivation-contexts-540a3956ecfe63e8e06c282011878245";
    const windowEvidence = evidence(
      "cropgraph:tomato:transplant-window",
      cropTomato.sourceRecordKey,
      cropLocation,
      {
        ...transplant,
        citation: cropTomato.effectiveCitation,
        commercialRights: cropTomato.commercialRights,
      },
      cropLicence,
      cropMethod,
    );
    addAssertion(
      "cropgraph:tomato:transplant-window",
      tomato,
      "cultivation_window",
      {
        action: "transplant",
        mappingMethod: "normalized-source-timing",
        sourceAction: "transplant",
        sourceTiming: transplant,
        timing: {
          type: "relative-day-window",
          anchor: "last_spring_frost",
          startOffsetDays: 7,
          endOffsetDays: 84,
        },
      },
      windowEvidence,
      tomatoTransplant,
      transplantContext,
    );
    const temperatureEvidence = evidence(
      "cropgraph:tomato:transplant-soil",
      cropTomato.sourceRecordKey,
      cropLocation + "/notes",
      {
        value: 60,
        unit: "[degF]",
        note: transplant.notes,
        citation: cropTomato.effectiveCitation,
        commercialRights: cropTomato.commercialRights,
      },
      cropLicence,
      cropMethod +
        " Convert the recommended soil threshold to approximately 15.6 °C. The separate germination field is outside the approval.",
    );
    addAssertion(
      "cropgraph:tomato:transplant-soil",
      tomato,
      "cultivation_window",
      {
        action: "transplant",
        mappingMethod: "normalized-source-timing",
        sourceAction: "transplant",
        sourceTiming: {
          note: transplant.notes,
          recommendedSoilTemperatureF: 60,
        },
        timing: {
          type: "soil-temperature-threshold",
          operator: "at-least",
          temperature: { value: 15.6, unit: "Cel" },
        },
      },
      temperatureEvidence,
      tomatoTransplant,
      transplantContext,
    );
    commitReview(tomatoTransplant, changed.slice(start));

    if (!changed.length) return { datasetSha256: initial, added: 0 };
    const receipt = await runDecisionTransaction({
      directory,
      descriptors,
      collections,
      original,
      fingerprint: (path) => authoringFingerprint(path, descriptors),
      validateStage: async (path) => {
        await validateAuthoring(root, path);
      },
      beforePublish: async () => {
        if ((await authoringFingerprint(directory, descriptors)) !== initial)
          throw new Error("Legacy admission base changed");
        for (const [path, sha] of pins) {
          if (digest(await readFile(resolve(root, path))) !== sha)
            throw new Error(`Legacy admission input changed: ${path}`);
        }
      },
    });
    return { ...receipt, added: changed.length };
  } finally {
    await unlock();
  }
}

if (process.argv[1] === import.meta.filename) {
  try {
    console.log(await admitLegacyPlantReviews(dataRoot(process.cwd())));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
