import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  consolidatePlantReviews,
  latestRevision,
  sha256,
} from "../../src/curation/plant-review-consolidation.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const id = (prefix: string, n: number) =>
  `${prefix}_00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "plant-consolidation-"));
  roots.push(root);
  async function write(path: string, value: string) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), value);
  }
  const source = JSON.stringify({ id: "source_test" });
  await write("data/sources/test/source.json", source);
  await write(
    "data/curation/grow-wfo-initial/dataset-manifest.json",
    JSON.stringify({
      dependencies: [
        {
          role: "source",
          id: "source_test",
          path: "data/sources/test/source.json",
          sha256: sha256(source),
        },
      ],
    }),
  );
  await write("data/curation/grow-wfo-initial/assertions.jsonl", "");
  await write(
    "docs/reviews/tomato-example.md",
    "Existing explicit approval; scope is unchanged.\n",
  );
  await write(
    "data/curation/supplemental-reviews/tomato-rhs-2026-10-07/review.json",
    "{}\n",
  );
  await write(".cache/source-inputs/evidence.txt", "Pinned evidence\n");
  const template = JSON.parse(
    await readFile(".agents/skills/review-plant/assets/packet.json", "utf8"),
  ) as Record<string, unknown>;
  async function packet(n: number, revision: number, upstreamChecked = true) {
    const value = {
      ...template,
      id: id("pr", n),
      revision,
      researchComplete: true,
      plant: {
        label: n === 1 ? "Generic plant" : "Ornamental cultivar comparison",
        scientificName: null,
        catalogSubjectId: null,
        targetGeography: "France",
        scopeNotes: "Retain independently reviewed scope.",
      },
      scopes: [
        {
          id: id("ps", n),
          label: "Generic scope",
          kind: "generic",
          catalogSubjectId: null,
          parentScopeId: null,
        },
      ],
      evidence: [
        {
          id: id("pe", n),
          sourceId: "source_test",
          release: "v1",
          sourceRecord: String(n),
          locator: "evidence.txt#claim",
          url: null,
          observedAt: "2026-11-14",
          originalValue: "full sun",
          notes: "Pinned original evidence",
          rights: {
            licence: "CC0-1.0",
            licenceUrl: null,
            status: "validated",
            commercialUseAllowed: true,
            upstreamChecked,
            attribution: null,
            notes: "Fixture rights only",
          },
          capture: {
            kind: "review-extract",
            path: ".cache/source-inputs/evidence.txt",
            sha256: sha256("Pinned evidence\n"),
          },
        },
      ],
      claims: [
        {
          id: id("pc", n),
          domain: "environment",
          topic: "Sunlight",
          scopeIds: [id("ps", n)],
          evidenceIds: [id("pe", n)],
          value: ["full_sun"],
          recommendation: "select",
          reason: "Source-backed proposal",
          interpretation: { kind: "source-explicit", notes: "No inference" },
          conditions: {
            measurementMedium: null,
            lifeStage: null,
            eventAnchor: null,
            geography: "France",
            growingSystem: null,
            qualifications: [],
          },
          implementation: {
            predicate: "sun_requirement",
            status: "validated",
            notes: "Existing predicate; integration remains planned",
          },
        },
      ],
      coverage: [
        "identity",
        "temperature",
        "planting",
        "environment",
        "water",
        "nutrition",
        "harvest",
        "care",
      ].map((domain) => ({
        domain,
        outcome: domain === "environment" ? "proposed" : "unresolved",
        claimIds: domain === "environment" ? [id("pc", n)] : [],
        reason: "Fixture coverage",
      })),
      questions: [],
      checks: [],
    };
    const path = `data/curation/plant-review-packets/${value.id}/r${revision}/packet.json`;
    const bytes = JSON.stringify(value);
    await write(path, bytes);
    await write(
      path.replace("packet.json", "summary.md"),
      `Packet SHA-256: ${sha256(bytes)}\n`,
    );
    return { path, value };
  }
  return { root, write, packet };
}

describe("all-plant review consolidation", () => {
  it("selects revisions numerically, includes non-MVP reviews and preserves approval boundaries", async () => {
    const f = await fixture();
    await f.packet(1, 1);
    await f.packet(1, 2);
    const latest = await f.packet(1, 10);
    await f.packet(2, 1, false);
    const before = await readFile(join(f.root, latest.path), "utf8");
    const report = await consolidatePlantReviews(f.root);
    expect(report.totals.packets).toBe(2);
    expect(report.totals.revisions).toBe(4);
    expect(report.packets[0]?.revision).toBe(10);
    expect(report.totals.recommendations.select).toBe(2);
    expect(report.totals.selectedRightsScreen).toEqual({
      "in progress": 1,
      validated: 1,
    });
    expect(report.totals.selectedNeedingSourceAdmission).toBe(0);
    expect(
      report.packets.every(
        (entry) =>
          entry.packetApproval === null &&
          entry.catalogIntegration === "planned",
      ),
    ).toBe(true);
    expect(report.checks.status).toBe("validated");
    expect(report.legacyDocuments).toHaveLength(2);
    expect(await consolidatePlantReviews(f.root)).toEqual(report);
    expect(await readFile(join(f.root, latest.path), "utf8")).toBe(before);
  });

  it("reports changed evidence, stale summaries and dangling references without repairing frozen packets", async () => {
    const f = await fixture();
    const saved = await f.packet(1, 1);
    const original = await consolidatePlantReviews(f.root);
    saved.value.claims[0]!.evidenceIds = [id("pe", 99)];
    await f.write(saved.path, JSON.stringify(saved.value));
    await f.write(".cache/source-inputs/evidence.txt", "Changed bytes\n");
    const report = await consolidatePlantReviews(f.root);
    expect(report.checks.status).toBe("blocked");
    expect(
      report.checks.issues.map((issue) => issue.message).join("\n"),
    ).toContain("Unknown claim evidence");
    expect(
      report.checks.issues.map((issue) => issue.message).join("\n"),
    ).toContain("Summary does not contain");
    expect(
      report.checks.issues.map((issue) => issue.message).join("\n"),
    ).toContain("Evidence checksum mismatch");
    expect(report.inputFingerprint).not.toBe(original.inputFingerprint);
    expect(report.claimIndex[0]?.rightsScreen).toBe("in progress");
  });

  it("keeps incompatible rights separate and rejects malformed proposals", async () => {
    const f = await fixture();
    const saved = await f.packet(1, 1);
    saved.value.evidence[0]!.rights.commercialUseAllowed = false;
    saved.value.evidence[0]!.sourceId = "source_unadmitted";
    const bytes = JSON.stringify(saved.value);
    await f.write(saved.path, bytes);
    await f.write(
      saved.path.replace("packet.json", "summary.md"),
      sha256(bytes),
    );
    const report = await consolidatePlantReviews(f.root);
    expect(report.totals.selectedRightsScreen.blocked).toBe(1);
    expect(report.totals.selectedNeedingSourceAdmission).toBe(1);
    expect(report.checks.status).toBe("validated");
    await f.write(
      saved.path,
      JSON.stringify({ ...saved.value, curatorApproval: "approved" }),
    );
    await expect(consolidatePlantReviews(f.root)).rejects.toThrow(
      "curatorApproval",
    );
  });

  it("does not silently choose an arbitrary directory when no revision exists", () => {
    expect(latestRevision(["r2", "r10", "r1", "evidence"])).toBe("r10");
    expect(() => latestRevision(["evidence", "r0"])).toThrow("no revision");
  });

  it("qualifies reused review-local scopes by packet and reports their mapping requirement", async () => {
    const f = await fixture();
    await f.packet(1, 1);
    const second = await f.packet(2, 1);
    second.value.scopes[0]!.id = id("ps", 1);
    second.value.claims[0]!.scopeIds = [id("ps", 1)];
    const bytes = JSON.stringify(second.value);
    await f.write(second.path, bytes);
    await f.write(
      second.path.replace("packet.json", "summary.md"),
      sha256(bytes),
    );
    const report = await consolidatePlantReviews(f.root);
    expect(report.checks.status).toBe("validated");
    expect(report.crossPacketIdentifierCollisions).toHaveLength(1);
    expect(
      report.crossPacketIdentifierCollisions[0]?.owners.map(
        (entry) => entry.packetId,
      ),
    ).toEqual([id("pr", 1), id("pr", 2)]);
    expect(report.claimIndex.map((entry) => entry.packetId)).toEqual([
      id("pr", 1),
      id("pr", 2),
    ]);
  });
});
