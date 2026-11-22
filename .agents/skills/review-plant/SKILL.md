---
name: review-plant
description: Review one Hortinis catalog plant and save a source-backed proposal and curator summary. Use for plant claims and discovery, including browse categories, cultivar comparisons, bilingual descriptions, and images for curator review.
---

# Review one plant

Locate the Hortinis tooling and data checkouts. In the tooling checkout at the revision declared in the data checkout’s `tooling-lock.json`, read `docs/development/plant-review-policy.md` for coverage, source selection, rights, approvals and integration. Read the applicable `AGENTS.md` instructions in both checkouts and the assigned plant’s existing reviews in the data checkout. If a required checkout or the policy is unavailable, identify the missing dependency.

Work autonomously through all eight coverage domains for the assigned plant. Use existing pinned records and targeted source research; decide routine alternatives and preserve uncertainty. Ask only for indispensable clarification, while continuing independent work. Never convert recommendations into curator approvals. Do not launch other sessions or subagents unless explicitly authorized.

## Catalog discovery

For every new plant review, follow the [discovery workflow](references/discovery.md)
alongside the eight claim domains. Select the best-supported claims, browse
memberships, bilingual descriptions, comparison set, and images autonomously.
Use the same packet revision and curator summary for the handoff. For a narrow
follow-up on an existing review, reuse prior dispositions and work within the
requested scope.

## Execute

1. Establish the assigned plant and existing catalog/target IDs, growing-type scope, prior decisions, source pins and worktree baseline. Keep cultivar evidence scoped. Use an isolated data worktree for concurrent plant work. Preserve unrelated changes.
2. Inventory every in-scope source candidate and all policy domains. Research missing quantities, conflicting evidence, consumer usefulness and claim-level commercial reuse. Keep values, source roles, conditions and rights independent. Read the policy's worked boundaries when uncertain about inferred anchors, type inheritance or numeric conversions.
3. Recommend comparable claims and explain significant alternatives; record exclusions and gaps with research attempts and a stopping reason. Do not change shared importers or schemas to hide unsupported claims. Keep new predicates as proposed implementation work.
4. Use the templates in `assets/packet.json` and `assets/summary.md` to create the review files in the data checkout’s packet directory specified by the policy. Replace starter values; use UUID-based review IDs, retaining them across revisions. Follow `schemas/curation/v1/plant-review-proposal.schema.json` in the tooling checkout. Add one evidence entry per independently locatable source claim, with original value, rights basis and capture details. Schema fields are for research proposals, not active catalog records.
5. Validate structure with the pinned tooling checkout’s built Ajv schema registry and perform the policy's semantic checks: references, complete domain/candidate dispositions, source/value accuracy, rights caveats and summary parity. Set researchComplete only when finished; leave curatorApproval null and status in progress. Save the final JSON, hash its bytes and include that SHA-256 in the summary. Do not change a delivered revision.
6. Return one curator summary with packet path, revision, digest, recommended claim IDs, and material gaps. Show the actual selected photo for each plant or cultivar scope for which a selection is possible. Label fallbacks and explain missing images. Present the selected data and images together for curator validation.

If continuing after an approval, identify the exact approved packet and claim IDs, save the approval separately and pass the data checkout as `--data-root` to the tooling commands in the curation runbook for any authorized integration. Content approval alone does not clear pending rights, unsupported predicates or release gates. Preserve prior packet revisions and do not re-review unchanged approved claims unnecessarily.

A normal assignment is “Use $review-plant to review carrot and present the selected data and photos for curator approval.”
