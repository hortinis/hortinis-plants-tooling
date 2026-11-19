# Coverage report

Each release must produce a coverage report showing:

- plants with accepted identity;
- plants with French names;
- plants with usable cold-sensitivity information;
- plants with planting or transplant rules;
- plants scoped to each supported production system;
- plants with unresolved or contradictory assertions;
- excluded records and licence reasons;
- preferred-name coverage by BCP 47 language tag, initially French and English;
- generic plant concepts with only cultivar-scoped evidence;
- source and geographic coverage.

Coverage percentages must state the denominator. A missing field means missing knowledge, not a negative recommendation.

T19 authoring coverage is available through `pnpm curate:status -- --json` under `coverage`.
It reports GROW's 140 records, the 5,006 selected CropGraph records, 33 MVP concept targets and two
cultivar exemplars independently. Candidate families and actions retain accepted, rejected, deferred
and pending counts. Missing frozen inputs have null source denominators. Target labels require explicit
reviewed subject bindings; cultivar evidence does not fill generic-concept gaps.

`coverage.readiness` applies the [C4 completion policy](../development/curation-runbook.md).
Commercial assertion counts require accepted rights reviews and commercially allowed licences for every
evidence reference. Source-backed authoring coverage does not establish French applicability or a
release profile's eligibility. Those gates, consumer fallback and inheritance remain C5 work.

The current [final catalog audit coverage](https://github.com/hortinis/hortinis-plants/blob/HEAD/data/curation/plant-integration/final-catalog-audit/coverage.md)
and [complete integration coverage](https://github.com/hortinis/hortinis-plants/blob/HEAD/data/curation/plant-integration/full-coverage.md)
report 981 stored assertions, 980 active consumer assertions, 206 admitted scope mappings,
zero unresolved scopes and eight preserved Saint-Étienne recommendations. The previous
48 replacement proposals and their 23 assertions and 27 names remain stored; the Manitoba
sanitation predecessor now has an explicit precision refinement. The original denominator
of 58 retains 19 deferred proposals. All active assertions and identity/name/evidence dependencies
have a record-level audit ledger. Commercial output contains zero facts or cultivation rules;
claim-level rights and the release/consumer gates remain open. Full authoring integration
remains in progress. See the [complete findings](https://github.com/hortinis/hortinis-plants/blob/HEAD/data/curation/plant-integration/final-catalog-audit/findings.md).

The chronological batch summaries below retain their original before-and-after totals.

The [reviewed-plant integration report](https://github.com/hortinis/hortinis-plants/blob/HEAD/data/curation/plant-integration/full-coverage.md) counts
418 authoring assertions after the [site guidance batch](https://github.com/hortinis/hortinis-plants/blob/HEAD/data/curation/plant-integration/reviewed-plant-site-coverage.md), up from 304. The eight approved Saint-Étienne seasonal rules cover seven exact plant concepts in commune 42218 for outdoor, in-ground home gardens. Nine
Bordeaux source rows are linked as comparisons. All eight local rules have pending evidence rights,
so commercial coverage for these recommendations is 0 of 8.

The delegated [harvest and storage batch](https://github.com/hortinis/hortinis-plants/blob/HEAD/data/curation/plant-integration/reviewed-plant-harvest-coverage.md)
increased the assertion count from 468 to 540. The 76 frozen proposals
produced 72 assertions, all available in the authoring projection with pending
commercial rights. Four proposals still require exact subject bindings.

The delegated [watering batch](https://github.com/hortinis/hortinis-plants/blob/HEAD/data/curation/plant-integration/reviewed-plant-watering-coverage.md)
admitted 48 proposals as 48 assertions, increasing the catalog from 540 to 588.
Unresolved proposals fell from 495 to 447. All 157 admitted scope mappings and the
eight Saint-Étienne recommendations were preserved. The watering guidance is
available in the authoring projection with commercial rights pending.

The delegated [planting and establishment batch](https://github.com/hortinis/hortinis-plants/blob/HEAD/data/curation/plant-integration/reviewed-plant-establishment-coverage.md)
accounts for 100 frozen proposals. It added 84 assertions, deferred 15 proposals
and excluded one comparison proposal. The catalog now has 672 assertions and
362 unresolved proposals. The 157 admitted mappings, 30 unresolved scopes
and eight Saint-Étienne recommendations are preserved. The new guidance has
pending commercial clearance.

The delegated [frost and growing-temperature batch](https://github.com/hortinis/hortinis-plants/blob/HEAD/data/curation/plant-integration/reviewed-plant-temperature-coverage.md)
covers 40 frozen proposals. It added 36 assertions, increasing the catalog from 672 to 708.
Four squash proposals still require pinned evidence for their exact growing types.
The 157 admitted mappings, 30 unresolved scopes and eight Saint-Étienne recommendations
were preserved. The new authoring guidance has pending commercial clearance.

The delegated [plant care batch](https://github.com/hortinis/hortinis-plants/blob/HEAD/data/curation/plant-integration/reviewed-plant-care-coverage.md)
covers 66 frozen proposals. It added 61 assertions, excluded four observations
and deferred one raspberry proposal. The catalog grew from 708 to 769 assertions.
Unresolved proposals fell from 326 to 261. The 157 admitted scope mappings,
30 unresolved scopes and eight Saint-Étienne recommendations were preserved.
Commercial clearance remains pending for the new care guidance.

The delegated [nutrition and feeding batch](https://github.com/hortinis/hortinis-plants/blob/HEAD/data/curation/plant-integration/reviewed-plant-nutrition-coverage.md)
admitted 22 proposals as 22 assertions. The catalog grew from 769 to 791 assertions,
and unresolved proposals fell from 261 to 239. All 157 admitted scope mappings,
30 unresolved scopes and eight Saint-Étienne recommendations were preserved.
The new guidance is available in the authoring projection with commercial rights pending.

## Full reviewed production scope (2026-11-18)

- Status: validated
- Commercial publication: blocked

[reviewed-catalog](https://github.com/hortinis/hortinis-plants/blob/HEAD/data/releases/reviewed-catalog/README.md) selects 96 plants,
28 growing types and 39 cultivars. All 163 admitted subjects are content-included;
none is content-blocked. Its frozen inventory accounts for 154 latest packets and
542 scopes: 206 identity mappings, 70 retained applicability qualifiers, 223 unused
and 43 comparison scopes. These scopes do not denote 542 distinct plants.

All 1,276 selected proposals are accounted for: 1,178 admitted, 24 represented,
35 superseded, 20 excluded, 19 deferred. There are no approved admission omissions
and no new admissions. Active projection retains 867 facts and 113 cultivation
rules. Original exception accounting remains 35 independently replaced, two
represented, two excluded and 19 deferred against 58. The commercial candidate
retains one subject and no facts/rules; 162 selected subjects remain rights-blocked.
See [validation](https://github.com/hortinis/hortinis-plants/blob/HEAD/data/releases/reviewed-catalog/validation.json) for checks.
