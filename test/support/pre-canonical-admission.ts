import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  field,
  object,
  records,
} from "../../src/curation/curation-artifacts.js";
import { saintEtienneBaselineInput } from "../../src/curation/saint-etienne-calendar.js";
import { parseJsonStrict } from "../../src/serialization/canonical-json.js";

// Remove subject admissions and dependent reviewed-batch admissions from an
// isolated dataset copy so first-admission tests can reuse the live fixtures.
export async function removeCanonicalAdmissions(dataset: string) {
  const reviewLines = (await readFile(join(dataset, "reviews.jsonl"), "utf8"))
    .split("\n")
    .filter(Boolean);
  const removedIds = new Map<string, Set<string>>();
  for (const line of reviewLines) {
    const review = object(parseJsonStrict(line));
    const admission =
      review.canonicalSubjectAdmission ??
      review.reviewedPlantAdmission ??
      review.calendarAdmission;
    if (!admission) continue;
    const receipt = object(admission);
    for (const entry of [
      ...records(receipt.records),
      { collection: "reviews", value: review },
    ]) {
      const collection = field(entry, "collection");
      const ids = removedIds.get(collection) ?? new Set<string>();
      ids.add(field(object(entry.value), "id"));
      removedIds.set(collection, ids);
    }
  }

  for (const [collection, ids] of removedIds) {
    const path = join(dataset, collection + ".jsonl");
    const lines = (await readFile(path, "utf8")).split("\n");
    const retained = lines.filter(
      (line) => !line || !ids.has(field(object(parseJsonStrict(line)), "id")),
    );
    await writeFile(path, retained.join("\n"));
  }
  const manifest = join(dataset, "dataset-manifest.json");
  const bytes = await readFile(manifest);
  const baseline = saintEtienneBaselineInput(
    "data/curation/grow-wfo-initial/dataset-manifest.json",
    bytes,
  );
  if (!baseline.equals(bytes)) await writeFile(manifest, baseline);
}
