import type {
  GrowCalendarWindow,
  GrowPlantRecord,
} from "../adapters/grow/types.js";
import {
  object,
  records,
  same,
  strings,
  type RecordValue,
} from "./curation-artifacts.js";

export const bordeauxWorkbook =
  "data/sources/grow/releases/2020/PlantingCalendar.xlsx";

export function resolveBordeauxWindow(
  row: RecordValue,
  window: GrowCalendarWindow,
  access: GrowPlantRecord,
  geographicContextId: string,
) {
  const claim = object(row.claim);
  const selected = object(claim.value);
  const conditions = object(claim.conditions);
  const evidence = records(row.evidence);
  const entry = evidence[0];
  const { operation, start, end, season, crossesYearBoundary } = window;
  const protectedSowing = operation === "indoors_or_undercover";
  const outdoorEstablishment = operation === "outdoor_sowing_or_planting";
  if (
    evidence.length !== 1 ||
    entry?.sourceId !== "source_grow_edible_plant_database" ||
    entry.sourceRecord !== window.sourceRecordId ||
    entry.locator !== window.sourceLocator ||
    access.sourceRecordId !== window.sourceRecordId ||
    !same(entry.originalValue, { carrierYear: 2017, start, end }) ||
    window.location.sheetCode !== "LUS" ||
    window.location.name !== "France (Bordeaux)" ||
    conditions.geography !== window.location.name ||
    conditions.measurementMedium !== null ||
    conditions.lifeStage !== null ||
    conditions.eventAnchor !== null ||
    !["unknown", "outdoor", "Outdoor", "outdoor soil culture"].includes(
      String(conditions.growingSystem),
    ) ||
    ["39", "49"].includes(window.sourceRecordId) ||
    selected.type !== "calendar-date-window" ||
    selected.precision !== window.precision ||
    selected.season !== season ||
    selected.crossesYearBoundary !== crossesYearBoundary ||
    !same(selected.start, start) ||
    !same(selected.end, end) ||
    (selected.action !== operation &&
      !(outdoorEstablishment && selected.action === "establish_outdoors"))
  )
    return;

  const qualifications = strings(conditions.qualifications);
  return {
    value: {
      action: protectedSowing
        ? "sow_indoors_or_undercover"
        : outdoorEstablishment
          ? "establish_outdoors"
          : "harvest",
      timing: { type: "calendar-date-window", start, end },
      sourceAction: operation,
      sourceTiming: { ...selected, carrierYear: 2017 },
      mappingMethod:
        protectedSowing || outdoorEstablishment
          ? "combined-action-preserved"
          : "identity",
    },
    context: {
      geographicScope: {
        type: "specified",
        geographicContextIds: [geographicContextId],
      },
      growingSystem: protectedSowing ? "indoor_or_undercover" : "outdoor",
      propagation: outdoorEstablishment
        ? "direct_sowing_or_transplant"
        : "unknown",
      ...(conditions.growingSystem === "outdoor soil culture"
        ? { soilOrContainer: "in_ground" }
        : {}),
      ...(access.fields["Common name"] === "Onion (Autumn planted)"
        ? { plantingSeason: "autumn" }
        : {}),
      ...(qualifications.length ? { observation: { qualifications } } : {}),
    },
  };
}
