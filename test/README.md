# Tests

Vitest tests are written in TypeScript and run in the Node.js environment.

- `unit/` contains focused unit tests named `*.test.ts`.
- `catalog/` contains integration tests against a catalog data checkout.
- `fixtures/` contains reusable fixture data grouped by contract or feature.
- Conformance tests belong under `conformance/` and should reference
  fixtures rather than embedding large data objects in test files.

Run `pnpm test:fixtures` in a tooling-only checkout. Set `HORTINIS_DATA_ROOT` to the catalog checkout for `pnpm test` and `pnpm coverage`.

Use `pnpm exec vitest run --coverage --maxWorkers=2` for bounded local test concurrency.
`curation-coverage.test.ts` exercises denominator, readiness, rights and cultivar-scope accounting;
`curation-apply.test.ts` verifies apply/regenerate/deep-audit coverage with unchanged and changed history.
`pnpm verify:curation` performs the full pinned offline integration rehearsal and writes ignored
hash/memory evidence under `.cache/verification/t19/`. It requires local WFO and TAXREF archives.
See the [runbook](../docs/development/curation-runbook.md) for preparation and recovery.
