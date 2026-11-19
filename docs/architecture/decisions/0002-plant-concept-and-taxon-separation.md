# ADR-0002: Separate plant concepts from taxa

- Status: validated

## Decision

Taxonomy supplies scientific identity and relationships. `PlantConcept` supplies cultivated meaning and stable catalog identity. Growing types use independently evidenced plant concepts with an explicit generic parent for catalog organization. Cultivars and denominated cultivar groups remain optional children. Read the [catalog model](../../domain/catalog-model.md#generic-concepts-and-growing-types) for applicability and inheritance rules.

## Consequences

Taxonomic name changes do not rewrite garden history. Plant concepts retain aliases and replacements; later linking a free-form user entry must preserve its historical label.
