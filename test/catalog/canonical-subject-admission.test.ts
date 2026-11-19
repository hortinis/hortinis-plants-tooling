import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";
import { dataRoot } from "../../src/repository-paths.js";
import { removeCanonicalAdmissions } from "../support/pre-canonical-admission.js";
import {
  admitCanonicalSubjects,
  prepareCanonicalSubjectAdmission,
} from "../../src/curation/canonical-subject-admission.js";
import {
  digest,
  field,
  readObject,
  records,
} from "../../src/curation/curation-artifacts.js";
import { authoringFingerprint } from "../../src/curation/decision-transaction.js";
import { validateGrowWfoDataset } from "../../src/curation/grow-wfo-validation.js";
import { buildSubjectRegistry } from "../../src/curation/subject-registry.js";

it("gates canonical subject admission independently and preserves comparison, claim and rights state", async () => {
  const root = await mkdtemp(join(tmpdir(), "hortinis-subject-admission-"));
  const integration = "data/curation/plant-integration";
  const dataset = join(root, "data/curation/grow-wfo-initial");
  const validate = () =>
    validateGrowWfoDataset({
      repositoryRoot: root,
      datasetDirectory: dataset,
    });
  try {
    const inventory = await readObject(
      join(
        dataRoot(),
        "data/curation/plant-review-consolidation/inventory.json",
      ),
    );
    for (const item of records(inventory.inputs)) {
      const path = field(item, "path");
      if (path.startsWith("schemas/")) continue;
      await mkdir(dirname(join(root, path)), { recursive: true });
      await cp(join(dataRoot(), path), join(root, path));
    }
    await cp(join(dataRoot(), integration), join(root, integration), {
      recursive: true,
    });
    await cp(
      join(dataRoot(), "data/sources/supplemental"),
      join(root, "data/sources/supplemental"),
      { recursive: true },
    );
    await removeCanonicalAdmissions(dataset);
    const baseline = await validate();
    expect(baseline.issues).toEqual([]);
    const descriptors = baseline.loaded!.manifest.collections;
    const baseDatasetSha256 = await authoringFingerprint(dataset, descriptors);
    const proposalSha256 = digest(
      await readFile(
        join(root, integration, "canonical-subject-proposal.json"),
      ),
    );
    const relationships = await readFile(
      join(root, integration, "subject-registry.json"),
    );
    const assertionBytes = await readFile(join(dataset, "assertions.jsonl"));
    const manifestBytes = await readFile(
      join(dataset, "dataset-manifest.json"),
    );

    // This synthetic approval is confined to the isolated test dataset.
    const review = {
      id: "fixture-subject-admission-review",
      purpose: "content",
      status: "accepted",
      reviewerId: "fixture-curator",
      reviewedAt: "2026-11-15T00:00:00Z",
      scope: "canonical-subjects",
      quote: "Synthetic approval for the exact identity proposal.",
      sourceChatId: "fixture-chat",
      proposalSha256,
      baseDatasetSha256,
    };
    const writeReview = (value: Record<string, unknown>) =>
      writeFile(join(root, "approval.json"), JSON.stringify(value));

    await writeReview({ ...review, scope: "subject-relationships" });
    await expect(admitCanonicalSubjects(root, "approval.json")).rejects.toThrow(
      "separate accepted canonical subject",
    );
    await writeReview({ ...review, proposalSha256: "stale" });
    await expect(admitCanonicalSubjects(root, "approval.json")).rejects.toThrow(
      "exact canonical subject proposal",
    );
    expect(await authoringFingerprint(dataset, descriptors)).toBe(
      baseDatasetSha256,
    );

    await writeReview(review);
    await admitCanonicalSubjects(root, "approval.json");
    const result = await validate();
    expect(result.issues).toEqual([]);
    const registry = await buildSubjectRegistry(root);
    const plan = await prepareCanonicalSubjectAdmission(
      root,
      registry,
      result.loaded!,
    );
    expect(plan.admissionReviewId).toBe(review.id);
    expect(plan.mappings).toHaveLength(11);
    expect(
      new Set(plan.mappings.map((mapping) => mapping.reviewSubjectId)).size,
    ).toBe(5);
    expect(
      registry.relationships.filter((row) => row.relation === "comparison-of"),
    ).toHaveLength(10);
    expect(
      registry.relationships.every((row) => row.claimInheritance === false),
    ).toBe(true);
    expect(await readFile(join(dataset, "assertions.jsonl"))).toEqual(
      assertionBytes,
    );
    expect(await readFile(join(dataset, "dataset-manifest.json"))).toEqual(
      manifestBytes,
    );
    expect(
      await readFile(join(root, integration, "subject-registry.json")),
    ).toEqual(relationships);
    expect(
      result.loaded!.dataset.plantConcepts.filter(
        (row) => row.kind === "growing-type",
      ),
    ).toHaveLength(
      baseline.loaded!.dataset.plantConcepts.filter(
        (row) => row.kind === "growing-type",
      ).length + 4,
    );
    expect(result.loaded!.dataset.cultivars).toHaveLength(1);
    expect(result.loaded!.dataset.cultivarGroups).toHaveLength(0);
    const addedEvidence = result.loaded!.dataset.evidence.filter(
      (row) =>
        !baseline.loaded!.dataset.evidence.some(
          (existing) => existing.id === row.id,
        ),
    );
    expect(addedEvidence.length).toBeGreaterThan(0);
    expect(
      addedEvidence.every(
        (row) =>
          (row.rights as { decision: string }).decision === "pending-review",
      ),
    ).toBe(true);
    await expect(admitCanonicalSubjects(root, "approval.json")).rejects.toThrow(
      "already admitted",
    );

    const concepts = result.loaded!.dataset.plantConcepts.map((row) =>
      row.kind === "growing-type"
        ? { ...row, parentPlantConceptId: row.id }
        : row,
    );
    await writeFile(
      join(dataset, "plant-concepts.jsonl"),
      concepts.map((row) => JSON.stringify(row)).join("\n") + "\n",
    );
    const changed = await validate();
    expect(
      changed.issues.some((issue) =>
        issue.message.includes("distinct generic parent"),
      ),
    ).toBe(true);
    expect(
      changed.issues.some((issue) =>
        issue.message.includes("authored snapshots differ"),
      ),
    ).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 120000);
