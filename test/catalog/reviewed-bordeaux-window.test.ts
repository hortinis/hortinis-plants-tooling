import { catalogFile } from "../support/catalog-file.js";
import { describe, expect, it } from "vitest";
import { readCalendar } from "../../src/adapters/grow/read-calendar.js";
import { readPlantCsv } from "../../src/adapters/grow/read-plant-csv.js";
import {
  bordeauxWorkbook,
  resolveBordeauxWindow,
} from "../../src/curation/reviewed-bordeaux-window.js";

describe("Bordeaux reviewed sowing windows", () => {
  it("preserves the workbook alternatives and rejects a displaced date or taxon", async () => {
    const workbook = await readCalendar(catalogFile(bordeauxWorkbook));
    const plants = await readPlantCsv(
      catalogFile("data/sources/grow/releases/2020/export/edible-plants.csv"),
    );
    const source = (recordId: string) => {
      const window = workbook.windows.find(
        (row) =>
          row.sourceRecordId === recordId &&
          row.location.sheetCode === "LUS" &&
          row.operation === "indoors_or_undercover",
      )!;
      const plant = plants.plants.find(
        (row) => row.sourceRecordId === recordId,
      )!;
      const row = {
        claim: {
          value: {
            type: "calendar-date-window",
            action: window.operation,
            season: window.season,
            precision: window.precision,
            start: window.start,
            end: window.end,
            crossesYearBoundary: window.crossesYearBoundary,
          },
          conditions: {
            geography: "France (Bordeaux)",
            growingSystem: "unknown",
            measurementMedium: null,
            eventAnchor: null,
            lifeStage: null,
            qualifications: [],
          },
        },
        evidence: [
          {
            sourceId: "source_grow_edible_plant_database",
            sourceRecord: recordId,
            locator: window.sourceLocator,
            originalValue: {
              carrierYear: 2017,
              start: window.start,
              end: window.end,
            },
          },
        ],
      };
      return { row, window, plant };
    };
    const { row, window, plant } = source("26");
    const resolved = resolveBordeauxWindow(row, window, plant, "bordeaux");
    expect(resolved?.value).toMatchObject({
      action: "sow_indoors_or_undercover",
      mappingMethod: "combined-action-preserved",
      sourceTiming: { carrierYear: 2017, season: 1 },
    });
    expect(resolved?.context).toMatchObject({
      growingSystem: "indoor_or_undercover",
      geographicScope: { geographicContextIds: ["bordeaux"] },
    });
    expect(
      resolveBordeauxWindow(
        row,
        { ...window, start: { day: 2, month: 2 } },
        plant,
        "bordeaux",
      ),
    ).toBeUndefined();
    for (const id of ["39", "49"]) {
      const conflict = source(id);
      expect(
        resolveBordeauxWindow(
          conflict.row,
          conflict.window,
          conflict.plant,
          "bordeaux",
        ),
      ).toBeUndefined();
    }
  });
});
