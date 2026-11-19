# Repository guidance

## Scope

This repository owns the schemas and tools used to build, validate, review, licence-audit and publish the Hortinis plant catalog. Pass the canonical data checkout with `--data-root` or `HORTINIS_DATA_ROOT`. The pipeline runs without a database or runtime service.

## Data rules

- Preserve source release, source record, locator, licence and review state for every assertion.
- Do not merge facts from different sources into an unexplained value.
- Do not import non-commercial content into a commercial release profile.
- Do not treat a source's file-level licence as proof of rights in upstream material.
- Use stable opaque catalog identifiers; never use a file path or array position as an identifier.
- Keep generated release artifacts out of ordinary Git history.

## Toolchain

- Use Node.js 24, TypeScript, pnpm, JSON Schema 2020-12, Ajv and Vitest.
- Use streaming transforms for large source archives.
- Publish deterministic JSON Lines chunks compressed with gzip, conforming to Hortinis ADR-0014.
- Do not add PostgreSQL, SQLite or a runtime HTTP service to this repository.

## Documentation

- Write repository documentation and tooling text in English.
- Use the statuses `planned`, `in progress`, `validated` and `blocked`.
- Record unresolved choices in [the open questions register](docs/open-questions.md).
- Do not silently resolve an open question in an importer or release script.

## Plant claim review

For autonomous review of one plant, use the repository-local [review-plant skill](.agents/skills/review-plant/SKILL.md) and [plant review policy](docs/development/plant-review-policy.md). Prepare source-backed proposals and a single curator approval summary; research completion does not approve claims or admit them to the catalog.
