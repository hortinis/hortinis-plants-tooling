# Autonomous plant claim review policy

- Status: validated
- Policy version: 1.0.0
- Established: 2026-11-07
- Scope: one assigned plant per research session; curator validates the resulting packet.

## Outcome and authority

Prepare a complete, source-specific proposal for the assigned plant without asking the curator to decide each claim during research. Use this policy and existing explicit decisions to make routine recommendations. Read existing plant reviews before researching; do not reopen approved choices without new evidence or silently replace them.

A session may inspect pinned data, research public sources and reuse terms, capture permitted evidence, propose values and exclusions, save a draft packet and summary, and run appropriate checks. Request clarification only when identity, scope or a material preference cannot reasonably be inferred; continue independent work. Tool permissions still apply. Do not approve proposals on the curator's behalf, publish, contact publishers, or apply active catalog changes during research. Do not broaden the assignment to unrelated plants or refactor shared schemas/importers to accommodate a finding. Propose unsupported authoring needs explicitly.

Use the [review-plant skill](../../.agents/skills/review-plant/SKILL.md) for execution. The skill and schema live in the tooling checkout. Start from the tooling revision recorded in the data checkout’s `tooling-lock.json` and read the data checkout’s instructions and existing reviews.

## Assignment and identity

Default to the generic edible plant in the repository's metropolitan-France catalog scope, including Corsica. Preserve evidence from other regions with its original geography; assess transferability rather than silently relabelling it French advice. Include existing relevant horticultural growing types and choose cultivars with useful comparison evidence for new reviews. Resolve ambiguity from existing delivery targets, source records and taxonomy first. If multiple plausible species remain, report the ambiguity and complete only identity-independent work.

Separate taxonomic acceptance, horticultural growing types and named cultivars. A shared species does not justify merging head/leaf, determinate/indeterminate, field/greenhouse or cultivar-specific claims. Applying generic evidence to multiple types is an explicit inference; document its justification and limits. Never promote cultivar evidence into a generic fact without support.

Reuse existing opaque identifiers. Mint review-local UUID-based identifiers once and retain them across revisions; these are not catalog subject admission. Catalog identifiers must use the repository's existing minting workflow during integration, never paths or array indices.

## Coverage and completion

Every packet must account for all eight domains, using proposed claims, justified exclusions or unresolved gaps:

| Domain      | Review coverage                                                                     |
| ----------- | ----------------------------------------------------------------------------------- |
| identity    | Accepted identity, synonyms, growing types, relevant names                          |
| temperature | Germination, growth, seedling stage, cold/frost and heat sensitivity                |
| planting    | Sowing/planting windows, temperature criteria, transplanting, hardening, succession |
| environment | Sunlight/shade, soil texture/drainage, moisture retention and pH                    |
| water       | Quantity, frequency, soil-moisture triggers and conditions                          |
| nutrition   | Nutrient/product, dose, timing and soil/system assumptions where supported          |
| harvest     | Duration and starting event, harvest stage/method                                   |
| care        | Relevant supports, pruning, conditional routine care                                |

Account for every in-scope candidate from pinned sources, including alternatives and exclusions. Do not re-import large archives unnecessarily; use existing adapters/packets and targeted lookups. Review identity and planting/cold coverage first because they affect MVP delivery. Pest-treatment cataloguing and exhaustive cultivar inventories are outside the default assignment.

Every new plant review includes [catalog discovery](../../.agents/skills/review-plant/references/discovery.md).
Select the supported data, compare relevant cultivars, propose bilingual
display text and browse memberships, and choose suitable crop and cultivar
images. For focused updates to existing reviews, follow the requested scope
and reuse prior dispositions.

A research session is complete when all domains and source candidates have a disposition, discovery outputs are selected or have documented gaps for a new review, significant conflicts have a reasoned recommendation or explicit gap, evidence and rights limitations are visible, and the summary and packet pass the checks below. Complete research can contain unresolved claims; it does not establish C4/C5 readiness or release eligibility.

## Evidence and selection

Start with pinned GROW/CropGraph records and existing WFO/TAXREF outcomes. For missing, conflicting or unusable claims, prefer relevant primary horticultural sources with explicit commercial reuse terms. Assess expertise, methodology, age, growing system, region and cultivar coverage. Two websites repeating the same source are not independent corroboration. One authoritative, directly applicable source can be sufficient; use independent evidence when conflict, inference or weak context warrants it.

Prefer quantities that Hortinis can use. Preserve original values and units alongside conversions, approximate qualifiers, measurement medium, life stage, event anchors and applicability. Keep paired observations together. Never supply missing temperature-duration pairs from different sources, average unexplained source values, infer a dose from High/Medium, or turn an optimum band into a viability gate.

Keep separate claim roles: optimum/best production, reported growing band, stress risk, hardiness classification and survival. A temperature associated with erratic germination is not a lethal maximum. Similarly, water frequency is not water volume; kPa soil suction is not degrees Celsius; field planting is not last frost; days from sowing differ from days after transplanting. Missing conditions stay explicitly unknown.

Recommend one source-backed value per comparable scope/claim role when justified. Keep significant alternatives and explain why they were not selected. Retain complementary claims when they serve different roles or conditions; do not force them into one range. Qualitative soil texture, drainage and care can be useful. Uncalibrated water/nutrient classes remain evidence when no actionable interpretation is supported.

Before adding a claim, explain its consumer use (filter, planting rule, care reminder, comparison or descriptive attribute). Mark unsupported catalog representation as planned with the proposed meaning; do not pretend a new predicate is implemented. Use existing supported predicates where semantics match.

## Rights and evidence capture

Preserve source release/version (or unknown publication date plus observation date), source record, exact locator, URL, original value, licence evidence and review state for every proposal. Check claim-level and upstream rights independently of a file-level licence. Separate content suitability from redistribution eligibility; a persuasive fact can remain unusable in a commercial release.

Exclude non-commercial material from commercial recommendations. Do not equate factual/numeric extraction, a government domain, citations or paraphrasing with permission. OpenMB and CC BY terms require attribution and respect third-party exclusions. An uncredited third-party image or seed packet is not cleared by the host's general policy. Unknown rights stay in progress; explicit incompatible rights prevent admission.

Capture permitted original documents or short review extracts with SHA-256 when possible. Label extracts accurately and retain the original locator; an extract checksum does not prove original-document archiving. If only a URL/search index is available, mark reference-only and disclose the reproducibility gap. Avoid copying protected full text. Store large/redistribution-uncertain originals in the appropriate ignored source-input cache, not Git. Keep authored review packets, permitted small evidence and summaries in Git-eligible paths.

## Research stopping rule

Research each material gap through a targeted primary-source search and a reasonable follow-up route. Stop when evidence supports a proposal, when further results repeat or weaken the evidence, or when access/rights cannot be resolved with available tools. Record search attempts, remaining uncertainty and what would resolve it. Continue the remaining domains. Do not invent values to complete a checklist, loop indefinitely, contact rights holders without instruction, or mark an entire plant blocked because one claim is missing. Explicit user time/cost limits override this default.

## Saved packet and curator summary

In the data checkout, store each research packet under `data/curation/plant-review-packets/<packet-id>/r<revision>/packet.json` and its companion `summary.md`. Use the [draft packet schema](../../schemas/curation/v1/plant-review-proposal.schema.json) and [starter assets](../../.agents/skills/review-plant/assets/packet.json). This is a review artifact, not a catalog assertion or generated release artifact.

Keep packet and claim IDs stable when revising; increment the revision and retain earlier delivered files. Compute SHA-256 of the final packet bytes and put the digest in the summary. Do not modify those bytes after presenting them for approval; corrections produce a new revision. Record the data checkout’s base commit and dirty state without resetting unrelated work. Use its pinned tooling revision for validation. `researchComplete` can become true only after all checks pass; packet status remains in progress and curatorApproval remains null.

Use a concise table: claim ID, recommended value, applicable type/stage, source/reuse basis and essential qualification. Start with identity and counts. Group all claims by domain; keep every recommendation identifiable even when grouping rows. Follow with material conflicts/inferences and unresolved gaps. Link detailed evidence instead of reproducing the research narrative. Label licensing uncertainty prominently. Show source alternatives only when they change the approval decision.
Show the selected photos in this summary and the curator handoff. Pair each
photo with its exact subject, proposal ID and source, and label crop
fallbacks. Record missing or unverifiable images as gaps.

The curator can reply “Approve this packet except claim X; revise Y.” Record the exact packet ID, revision, digest, approved claim IDs, exceptions and curator/date in a separate approval record. Ambiguous approvals must be clarified before applying dependent changes. A revised value or changed evidence needs a new review. Approved content may still have pending rights or representation work; do not treat it as publishable.

## Verification and integration

Before handoff:

- Validate packet structure against JSON Schema 2020-12 with Ajv (the existing schema registry discovers it on build). Starter assets are incomplete drafts, not ready packets.
- Check unique opaque IDs and every scope, evidence, claim, parent and coverage reference. Verify all domains and in-scope source candidates are accounted for; every unresolved/irrelevant domain needs a reason.
- Verify selected values against locators, units, bounds, anchors and source scopes; review inference and rights independently. Verify any archived evidence hashes and report missing captures honestly.
- Check proposed claim implementation support and all material caveats. Ensure the summary matches the exact final JSON, including exceptions and all selected claim IDs.
- Run `git diff --check` in the data checkout. Report which checks actually ran. Factual and rights review requires the source checks above.

Keep unresolved questions in the packet during concurrent research. At integration, reconcile them into `docs/open-questions.md` in the data checkout, preserving existing decisions. If only one session is writing, it may update the register directly. Do not have multiple sessions mutate shared catalog collections or the register concurrently. Prefer a separate data worktree per concurrent plant, from a deliberate shared baseline; uncommitted files in another checkout are not inherited automatically. Do not create sessions/subagents or merge work without the user's assignment/authorization.

After content approval, follow the existing [curation runbook](curation-runbook.md) and [integrated workflow](integrated-curation.md) to prepare/apply source admission, rights reviews, mappings and supported assertions. Integrate sequentially, audit the exact current inputs, and report what was saved, committed, admitted and still pending. This policy does not waive existing release gates or authorize publication.

## Worked boundaries from the collaborative reviews

These illustrate decisions, not reusable values for other plants:

- Lettuce: GROW 4–27°C growing band and Manitoba 15–18°C best-production context have different roles; neither establishes survival. Manitoba 6–8-day emergence without a numeric temperature must not be paired with another source's 24°C.
- Lettuce: leaf/butterhead versus crisphead spacing remains scoped; “head” does not mean all head types have iceberg spacing. Queensland conditional irrigation intervals and kPa triggers do not establish weekly millimetres.
- Tomato: an interpreted transplant-relative harvest anchor must retain the original source's unknown anchor and supporting evidence; source interpretation is not a direct quote.
- Licensing: the Manitoba-hosted McKenzie packet remains third-party evidence, while UMN content was not selected as the commercially reusable numeric watering source.

See the original [lettuce reviews](https://github.com/hortinis/hortinis-plants/blob/HEAD/docs/reviews/lettuce-ph-germination-sun-2026-10-10.md), [lettuce watering review](https://github.com/hortinis/hortinis-plants/blob/HEAD/docs/reviews/lettuce-growth-water-nutrients-2026-10-10.md) and [tomato review](https://github.com/hortinis/hortinis-plants/blob/HEAD/docs/reviews/tomato-soil-germination-water-2026-10-07.md) when those boundaries matter.
