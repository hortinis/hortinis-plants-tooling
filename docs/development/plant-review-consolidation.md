# Consolidating all reviewed plants

- Status: in progress
- Scope established: 2026-11-14
- Scope: every reviewed plant, growing type, cultivar comparison and overview, plus the earlier tomato/lettuce reviews. The 33-plant MVP does not restrict consolidation.

The [complete inventory](https://github.com/hortinis/hortinis-plants/blob/HEAD/data/curation/plant-review-consolidation/README.md) makes the research backlog reviewable. Its companion `inventory.json` preserves exact packet IDs, latest revisions, byte digests, claim IDs, scope IDs, evidence references, implementation declarations, rights-screen results and all packet questions. The [legacy reconciliation](https://github.com/hortinis/hortinis-plants/blob/HEAD/docs/reviews/plant-review-legacy-reconciliation.md) preserves earlier approvals and deferrals separately from new proposals. This inventory is a tracked curation artifact, not a generated release artifact.

## Refresh and inspect

```sh
pnpm curate:consolidate -- --write
pnpm curate:consolidate -- --check
```

The first command rebuilds only the inventory files. The second recomputes the report and rejects stale bytes or integrity findings. Both discover all packet directories without a delivery-target filter and select revisions numerically. New plants or revisions automatically enter the next report. Neither command mints catalog subjects, infers approval, changes frozen packets or applies assertions.

The report pins local source captures and verifies their hashes, validates latest proposal schemas and structural references, and checks summary digests. It does not repeat horticultural research or establish legal clearance. Full source-run/deep catalog audits remain part of transactional admission. `implementation.status` is a research declaration; even an existing predicate still needs exact value-shape, context and consumer-projection checks.

## Integration sequence

| Work                                                   | Status      | Concrete completion condition                                                                                                                                                                        |
| ------------------------------------------------------ | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Consolidate every latest packet and earlier decisions  | validated   | All packet directories appear with revisions/digests, claim dispositions, evidence references and questions; no MVP filter; earlier approved content and deferrals are indexed.                      |
| Record curator decisions for autonomous proposals      | planned     | Separate approval records bind packet ID, revision, SHA-256, explicit approved claim IDs, exceptions, curator and date. Earlier unchanged approvals are preserved.                                   |
| Reconcile overlapping subjects and horticultural types | in progress | Explicit mappings distinguish species, generic concepts, types, cultivars and comparison-only material. Existing canonical IDs are reused; new opaque IDs are minted through transactions.           |
| Admit source releases and claim-specific rights        | planned     | External sources have source/release records, locators, captured evidence, attribution and formal rights decisions. Non-commercial or unresolved claims remain excluded from commercial projections. |
| Implement common representation gaps                   | planned     | Typed authoring and consumer support preserves units, measurement medium, stage, event anchors, paired observations and conditions; meaningful conformance tests cover each addition.                |
| Prepare/apply supported claims sequentially            | planned     | Explicit decisions pass current input/deep audits and transactional validation; mappings, evidence, contexts and assertion lineage are preserved.                                                    |
| Assess catalog coverage and release eligibility        | planned     | All consolidated subjects have explicit admitted/deferred/excluded outcomes; release profiles independently evaluate rights, geography, projection and required coverage.                            |

The workstreams in the machine inventory divide selected claims into identity/subjects, existing-predicate integration and missing representation by domain. They are dependency queues, not automatic admission batches. For example, a supported `growing_temperature` predicate does not justify flattening distinct best-production, seedling or stress conditions into one range.

The initial scan found the starter scope ID `ps_00000000-0000-4000-8000-000000000002` in 61 different latest packets. References in the inventory are qualified by packet ID, so these records remain distinct. Before admission, map each exact packet/scope pair to its reviewed canonical subject; do not reuse this placeholder as a catalog identifier or infer a shared subject. Frozen packet revisions remain unchanged.

## Current subject admission batch

The [approved canonical subject batch](https://github.com/hortinis/hortinis-plants/blob/HEAD/data/curation/plant-integration/canonical-subject-decision.md) admitted four growing types, one named cultivar and four generic parents. Its 11 mappings cover five approved equivalence groups within the 499 packet-qualified scopes across all 111 reviewed packets. The other 488 scopes include unused and comparison material and still need explicit dispositions where applicable. The 10 directed comparisons keep their original review scopes. The catalog still has four existing assertions, and all 1,227 selected supplemental claim proposals are pending admission. Reviewed taxonomy links, remaining subject mapping, claim selection, rights and release coverage remain separate work.

See the [admission commands and status report](https://github.com/hortinis/hortinis-plants/blob/HEAD/data/curation/plant-integration/README.md#canonical-subject-admission).

## Bordeaux calendar preparation

- Status: validated

The [read-only report and dry run](https://github.com/hortinis/hortinis-plants/blob/HEAD/docs/investigations/schema-fit/README.md#read-only-bordeaux-dry-run) accounts for 1,227 selected proposals across 111 latest packets. It maps 78 Bordeaux windows across 47 reviews to cultivation-rule shapes, retains 29 ambiguous windows with reasons, and records the other 1,120 proposals outside this conversion batch. The 466 supplemental packages still need claim-level decisions. The earlier tomato and lettuce review backlog remains in the consolidation inventory.

## Shared decisions to resolve once

1. **Subject overlap and growing types.** Reconcile generic and comparison packets before minting subjects: carrot and potato cultivar comparisons; garden pea and snap-bean comparisons; head/leaf lettuce; onion colours; sweet/hot/Espelette peppers; overlapping squash species, types, named cultivars and overviews. Shared taxonomy or similar labels do not authorize merging or inheritance. Ornamental genera/hybrids and mixed overviews may require several explicit subjects or remain descriptive review material.
2. **External source admission.** Manitoba, Queensland, botanical-garden and other supplemental evidence needs its own source/release records and claim-level rights. The existing four-source candidate transaction path cannot accept a research packet as if it were a frozen integrated candidate. Define the explicit admission/lineage path before applying those claims.
3. **Water and nutrition.** Preserve water amount versus frequency versus soil-tension trigger, rainfall contribution, product/nutrient, area basis, stage and soil assumptions. Qualitative source classes cannot supply missing numeric doses.
4. **Temperature, planting and care.** Preserve preferred versus stress/survival roles, air versus soil, preparation durations, field-planting versus frost anchors, paired spacing axes, conditional shade/pruning/support and cultivar-specific applicability.
5. **Geography and release profiles.** Consolidation includes all reviewed subjects regardless of MVP membership. France applicability and non-MVP release-profile inclusion remain explicit downstream decisions; consolidating a foreign-source claim does not make it French advice.

These choices are registered in [open questions](../open-questions.md#all-reviewed-plants-consolidation). Packet-level questions remain individually addressable in the inventory; this groups their shared dependencies without silently resolving or rewriting them.

## Approval and integration boundary

Consolidation does not select recommended claims on the curator's behalf. The [plant review policy](plant-review-policy.md) requires exact, separate approval records and distinguishes content approval, rights and active admission. Prepare concrete claim decisions from the linked summaries, then integrate their approved scope through the [curation runbook](curation-runbook.md) and [transaction workflow](integrated-curation.md).

For the earlier approved tomato/lettuce content, preserve approval provenance and finish source/representation prerequisites before applying. For the autonomous packets, retain all alternatives, exclusions and unresolved gaps alongside the recommended claims. Publication remains a separate release action.

## Source metadata implementation update

- Status: in progress
- The supplemental metadata transaction is implemented and the 466 prepared packages are registered as 1,398 pinned dependencies. Claim collections were preserved byte-for-byte. See the [transaction receipt](https://github.com/hortinis/hortinis-plants/blob/HEAD/data/curation/plant-integration/source-admission-receipt.json). Commercial rights remain pending or ineligible.
- Julien approved six same-subject relationships and ten comparison links in the [separate approval record](https://github.com/hortinis/hortinis-plants/blob/HEAD/data/curation/plant-integration/subject-approval.json). The [subject registry](https://github.com/hortinis/hortinis-plants/blob/HEAD/data/curation/plant-integration/subject-registry.json) applies them to packet-qualified scopes in five equivalence groups and ten directed links. Claim approval, canonical subject admission and commercial rights remain separate.
- Supplemental assertion transactions, formal rights decisions and the remaining subject/context mappings are still required before new claims can enter the catalog.

## Full-inventory batch update

- Status: in progress

The [per-review coverage report](https://github.com/hortinis/hortinis-plants/blob/HEAD/data/curation/plant-integration/full-coverage.md) supersedes the earlier counts above. The [consolidated approval guide](https://github.com/hortinis/hortinis-plants/blob/HEAD/data/curation/plant-integration/reviewed-plant-approval.md) points to the exact decision batch, including separate identity, scope and factual approval selections. The authoring catalog records the [curator's licensing acceptance](https://github.com/hortinis/hortinis-plants/blob/HEAD/data/curation/plant-integration/licensing-acceptance.json) and the earlier lettuce identity and source mappings plus supported tomato and lettuce assertions. The rehearsal uses a temporary catalog and a fixture review to exercise authoring schemas and references. Comparison and parent relationships remain explicit and confer no claim applicability.
