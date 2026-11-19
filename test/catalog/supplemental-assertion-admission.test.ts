import { catalogFile } from "../support/catalog-file.js";
import { validateGrowWfoDataset } from "../../src/curation/grow-wfo-validation.js";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import {
  object,
  records,
  field,
  contentDigest,
  digest,
} from "../../src/curation/curation-artifacts.js";
import { authoringFingerprint } from "../../src/curation/decision-transaction.js";
import { admitSupplementalAssertion } from "../../src/curation/supplemental-assertion-admission.js";
import { validateSubjectMatches } from "../../src/curation/subject-match-validation.js";

it("validates pinned matches without approving them", async () => {
  const report = await validateSubjectMatches(
    catalogFile(),
    "data/curation/plant-integration/subject-matches.json",
  );
  expect(report.approved).toBe(false);
  expect(report.matches).toHaveLength(16);
});

it("requires exact approval, admits a supported value only on an isolated copy, and preserves pending rights", async () => {
  const root = await mkdtemp(join(tmpdir(), "hortinis-assertion-test-"));
  try {
    const inventory = object(
      JSON.parse(
        await readFile(
          catalogFile(
            "data/curation/plant-review-consolidation/inventory.json",
          ),
          "utf8",
        ),
      ),
    );
    for (const item of records(inventory.inputs)) {
      const path = field(item, "path");
      if (path.startsWith("schemas/")) continue;
      await mkdir(dirname(join(root, path)), { recursive: true });
      await cp(catalogFile(path), join(root, path));
    }
    await cp(
      catalogFile("data/sources/supplemental"),
      join(root, "data/sources/supplemental"),
      { recursive: true },
    );
    const packetPath =
      "data/curation/plant-review-packets/pr_c95ecbcf-3dc5-454b-b685-08db9d8c3b88/r1/packet.json";
    const bytes = await readFile(join(root, packetPath));
    const packet = object(JSON.parse(bytes.toString()));
    const claim = records(packet.claims).find(
      (row) => row.id === "pc_74f7f40c-5018-4ad3-9fbb-d08db04d976f",
    )!;
    const dataset = join(root, "data/curation/grow-wfo-initial");
    const manifest = object(
      JSON.parse(
        await readFile(join(dataset, "dataset-manifest.json"), "utf8"),
      ),
    );
    const descriptors = records(manifest.collections).map((row) => ({
      path: field(row, "path"),
    }));
    const base = await authoringFingerprint(dataset, descriptors);
    // Synthetic test approval: never persisted in the working catalog.
    const subject = {
      type: "plant-concept",
      id: "c4-plant-concepts-9db246485c8aa7afd8c780b162ee13f5",
    };
    const contextId =
      "c4-cultivation-contexts-f81ec874bda61d9f1e288435df49d08a";
    const scopeId = "ps_003c1fae-81e5-451f-9260-a31f3f05c055";
    const approval = {
      packetId: packet.id,
      packetRevision: packet.revision,
      packetSha256: digest(bytes),
      claimId: claim.id,
      scopeId,
      subject,
      contextId,
      predicate: "soil_ph_range",
      valueSha256: contentDigest(claim.value),
      conditionsSha256: contentDigest(claim.conditions),
    };
    const review = {
      id: "test-content-review",
      purpose: "content",
      status: "accepted",
      reviewerId: "test-curator",
      reviewedAt: "2026-11-14T00:00:00Z",
      approval,
    };
    const input = {
      transactionId: "test-supplemental-assertion",
      baseDatasetSha256: base,
      packetPath,
      packetSha256: digest(bytes),
      claimId: claim.id,
      scopeId,
      subject,
      contextId,
      contentReview: review,
      rightsReview: {
        id: "test-rights-review",
        purpose: "rights",
        status: "accepted",
        reviewerId: "test-curator",
        reviewedAt: "2026-11-14T00:00:00Z",
        notes: "Administrative pending-rights record; no commercial clearance.",
      },
    };
    await writeFile(
      join(root, "input.json"),
      JSON.stringify({ ...input, contentReview: { ...review, approval: {} } }),
    );
    await expect(
      admitSupplementalAssertion(root, "input.json"),
    ).rejects.toThrow("Exact curator");
    expect(await authoringFingerprint(dataset, descriptors)).toBe(base);
    await writeFile(join(root, "input.json"), JSON.stringify(input));
    await admitSupplementalAssertion(root, "input.json");
    const assertions = (
      await readFile(join(dataset, "assertions.jsonl"), "utf8")
    )
      .trim()
      .split("\n")
      .map((line) => object(JSON.parse(line)));
    expect(
      assertions.some(
        (row) =>
          row.reviewId === "test-content-review" &&
          contentDigest(row.value) === contentDigest(claim.value),
      ),
    ).toBe(true);
    const evidence = (
      await readFile(join(dataset, "evidence-references.jsonl"), "utf8")
    )
      .trim()
      .split("\n")
      .map((line) => object(JSON.parse(line)));
    expect(
      evidence
        .filter((row) => object(row.rights).reviewId === "test-rights-review")
        .every((row) => object(row.rights).decision === "pending-review"),
    ).toBe(true);
    await expect(
      admitSupplementalAssertion(root, "input.json"),
    ).rejects.toThrow("Stale authoring fingerprint");
    const admitted = assertions.find(
      (row) => row.reviewId === "test-content-review",
    )!;
    await writeFile(
      join(dataset, "assertions.jsonl"),
      assertions
        .map((row) =>
          JSON.stringify(
            row === admitted
              ? { ...row, value: { minimum: 5, maximum: 7 } }
              : row,
          ),
        )
        .join("\n") + "\n",
    );
    const altered = await validateGrowWfoDataset({
      repositoryRoot: root,
      datasetDirectory: dataset,
    });
    expect(altered.valid).toBe(false);
    expect(
      altered.issues.some((row) =>
        row.message.includes("Supplemental admission snapshot"),
      ),
    ).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 120000);
