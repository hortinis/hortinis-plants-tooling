import { describe, expect, it } from "vitest";
import { preparePlantIntegration } from "../../src/curation/prepare-plant-integration.js";
import { dataRoot } from "../../src/repository-paths.js";

describe("plant integration preparation", () => {
  it("qualifies reused scopes, preserves upstream provenance and never grants commercial clearance", async () => {
    const result = await preparePlantIntegration(dataRoot());
    expect(result.mappings.length).toBeGreaterThan(100);
    const repeated = result.mappings.filter(
      (row) => row.scopeId === "ps_00000000-0000-4000-8000-000000000002",
    );
    expect(repeated.length).toBeGreaterThan(1);
    expect(new Set(repeated.map((row) => row.id)).size).toBe(repeated.length);
    expect(
      result.mappings.every((row) => row.proposedCatalogSubjectId === null),
    ).toBe(true);
    for (const entry of result.sources) {
      const licence = entry.licence as { commercialUse: string };
      const manifest = entry.sourceManifest as {
        licenceReview: { status: string };
        profileEligibility: { decision: string }[];
      };
      expect(licence.commercialUse).not.toBe("allowed");
      expect(manifest.licenceReview.status).toBe("unreviewed");
      expect(
        manifest.profileEligibility.every((row) => row.decision !== "eligible"),
      ).toBe(true);
      expect(entry.provenance).toHaveProperty("originalRelease");
      expect(entry.provenance).toHaveProperty("locator");
    }
  }, 30000);
});
