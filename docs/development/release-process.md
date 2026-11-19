# Release process

1. In the data repository, pin or deliberately update source releases. Record the intended tooling commit in `tooling-lock.json`.
2. Run the source adapters from that tooling revision against the data checkout and retain the audit reports.
3. Review unresolved mappings, rights and contradictions, then approve the release profile in the data repository.
4. Build twice in isolated pairs of clean checkouts at the same data commit and tooling commit. Use independent output directories and compare manifest and artifact hashes.
5. Validate manifest, chunks, attribution, size budgets and Hortinis ingestion. Keep all generated release files outside ordinary Git history.
6. Publish the approved artifact as an immutable GitHub Release on the data repository. Record the release URL, both commits, checksums, source versions and known limitations.

From the tooling checkout, the current reviewed-catalog checks can be run with:

```sh
pnpm release:reviewed-catalog -- --data-root ../hortinis-plants --output-root ./local-output
```

This command checks the frozen inventory, commercial projection and round-trip ingestion and writes the candidate and content rehearsal under `local-output/artifacts/releases/reviewed-catalog/`. Both outputs carry non-publishable candidate metadata. Full-cohort publication remains subject to the recorded rights and profile decisions in the data checkout.

A Hortinis operator chooses when and how an approved artifact becomes active.

Publish stable releases quarterly when accepted changes exist. Publish an additional immutable correction release for an urgent factual, provenance or rights issue.
