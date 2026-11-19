# Hortinis Plants Tooling

This repository owns the schemas, source adapters, curation commands, validators and deterministic release builder for the Hortinis plant catalog. The [Hortinis Plants data repository](https://github.com/hortinis/hortinis-plants) owns the source pins, evidence, editorial decisions and canonical catalog records.

## Run the tooling

Use Node.js 24 and the pnpm version declared in `package.json`. Check out the tooling commit recorded in the data repository's `tooling-lock.json` when validating a data change or preparing a release.

From the tooling checkout, with the data checkout next to it:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test:fixtures
HORTINIS_DATA_ROOT=../hortinis-plants pnpm test
pnpm curate:validate -- --data-root ../hortinis-plants
pnpm release:reviewed-catalog -- --data-root ../hortinis-plants --output-root ./local-output
```

`--data-root` selects the checkout that contains `data/`. `--output-root` selects the directory under which release artifacts are written. It defaults to the data checkout. `--cache-root` selects the cache directory itself, which defaults to `.cache` under the output root. The corresponding environment variables are `HORTINIS_DATA_ROOT`, `HORTINIS_OUTPUT_ROOT` and `HORTINIS_CACHE_ROOT`. Resolve command-line paths from the tooling checkout or pass absolute paths.

The reviewed catalog command verifies the frozen scope and builds a candidate plus a content rehearsal. Publication requires an approved release profile, verified rights and attribution, and reproducible artifacts. See the [release process](docs/development/release-process.md) and [artifact contract](docs/contracts/artifact-format.md).

## Plant claim review

Use `$review-plant` for one plant per session, with the tooling and data checkouts available. Save the packet, evidence and curator summary in the data checkout. The [review policy](docs/development/plant-review-policy.md) defines coverage, approval and admission. The [curation runbook](docs/development/curation-runbook.md) covers source preparation and integration.

## Licence

The tooling is licensed under [AGPL-3.0-only](LICENSE). The [data licence policy](https://github.com/hortinis/hortinis-plants/blob/HEAD/DATA-LICENSE.md) governs the separate catalog compilation and its source-specific rights.
