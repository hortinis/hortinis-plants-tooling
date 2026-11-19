import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { dataRoot } from "../repository-paths.js";
import { format } from "prettier";
import {
  consolidatePlantReviews,
  renderConsolidation,
} from "./plant-review-consolidation.js";

try {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  if (
    args.length !== 1 ||
    !["--write", "--check", "--verify"].includes(args[0]!)
  )
    throw new Error("Usage: curate:consolidate -- --write|--check|--verify");
  const root = dataRoot(process.cwd());
  const report = await consolidatePlantReviews(root);
  if (args[0] !== "--verify") {
    const directory = resolve(root, "data/curation/plant-review-consolidation");
    const files = {
      "inventory.json": await format(JSON.stringify(report), {
        parser: "json",
      }),
      "README.md": await format(renderConsolidation(report), {
        parser: "markdown",
      }),
    };
    if (args[0] === "--write") await mkdir(directory, { recursive: true });
    for (const [name, text] of Object.entries(files)) {
      const path = resolve(directory, name);
      if (args[0] === "--write") await writeFile(path, text);
      else if ((await readFile(path, "utf8")) !== text)
        throw new Error(
          `Stale inventory: ${path}; run curate:consolidate -- --write`,
        );
    }
  }
  console.log(
    `${report.totals.packets} latest packets; ${report.totals.recommendations.select ?? 0} selected proposals; integrity ${report.checks.status}; ${report.checks.issues.length} issues.`,
  );
  for (const issue of report.checks.issues)
    console.error(`${issue.path}: ${issue.message}`);
  if (report.checks.issues.length > 0) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
