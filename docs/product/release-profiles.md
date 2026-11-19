# Release profiles

The compiler produces named profiles so the MVP can exclude unnecessary size and rights complexity.

| Profile          | Purpose                    | Content                                                                                                                                                                                                       |
| ---------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dev-validation` | Non-publishable V0 testing | The reviewed identities, names, contexts and sowing or planting-window rules selected by Hortinis P0.7a; exact scope is recorded with each fixture version                                                    |
| `fr-mvp`         | First Hortinis release     | The 33 reviewed generic plant concepts from ADR-0005; two tomato cultivar exemplars; French and English names; identity, cold sensitivity and planting-window rules for metropolitan France including Corsica |
| `fr-rich`        | Expanded France use        | Additional cultivation, threats and reviewed regional rules                                                                                                                                                   |
| `global-core`    | Reusable reference layer   | Global taxonomy, synonyms and generally reusable traits                                                                                                                                                       |
| optional packs   | Explicit opt-in extensions | Regional, image or specialist content with independent licence manifests                                                                                                                                      |

Every profile has its own manifest and attribution output. Consumers must not assume records exist across profiles.

`dev-validation` uses the same manifest, schema, canonical JSONL.gz, hashing and attribution contracts
as release profiles. It remains outside ordinary Git history and must not be published or interpreted as
evidence that `fr-mvp` coverage or release gates are complete.

`fr-mvp` does not require broad cultivar coverage. A missing localized name falls back deterministically to another explicitly tagged name and then to the scientific name; it does not authorize an invented translation.

## Full reviewed cohort

- Status: validated

`reviewed-catalog` is the approved production content-selection profile for the
entire currently reviewed cohort, independently of `fr-mvp`: 96 plants, 28 growing
types and 39 cultivars. Its [definition](https://github.com/hortinis/hortinis-plants/blob/HEAD/data/releases/reviewed-catalog/profile.json)
and [frozen scope inventory](https://github.com/hortinis/hortinis-plants/blob/HEAD/data/releases/reviewed-catalog/inventory.json)
bind exact subject IDs, latest packets, qualifications, record digests and commercial
dispositions. The [decision record](https://github.com/hortinis/hortinis-plants/blob/HEAD/data/releases/reviewed-catalog/decisions.md)
records delegated curator authority. Content inclusion does not waive commercial
eligibility: 162 of 163 subjects remain commercially blocked, and the filtered
candidate contains zero facts or rules. Full-cohort publication remains blocked.

`node dist/artifact/reviewed-catalog.js --check` validates the frozen scope and
builds an isolated, non-publishable candidate with profile `reviewed-catalog` using
the existing schema, deterministic gzip and verified ingestion contracts. Rights
filters, attribution and dependency closure remain mandatory. Scope updates require
an explicitly reviewed revision; packet counts are never plant counts.
