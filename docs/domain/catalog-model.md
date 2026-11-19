# Catalog model

## Core concepts

`Taxon` carries botanical identity. `PlantConcept` is the Hortinis-facing cultivated subject and may
reference a taxon when that mapping is supported. `CultivarGroup` and `Cultivar` are optional children of a
plant concept. A localized name is a separate, evidence-backed record. Plant facts, cultivation rules,
contexts and relationships are also separate records joined by stable IDs.

An authoring assertion records one source-backed statement. A consumer projection emits normalized
`plant-fact` and `cultivation-rule` records only after review and profile-rights gates. Schemas define the
record boundaries; semantic build checks resolve references and enforce inheritance and release policy.

## Identifier rules

Identifiers are stable opaque strings minted by the catalog. Scientific names, aliases, file paths and
array positions are not identifiers. Retired records remain resolvable and identify a replacement when
one is known. A missing replacement is not guessed.

User records may retain a free-form historical label when no catalog entry exists. Linking a catalog ID
later must not rewrite that label.

## Generic concepts and growing types

A plant concept may be `generic` or `growing-type`. Existing records without `kind` are generic.
A growing type refers to a distinct generic `parentPlantConceptId` and has its own stable ID,
localized names and evidence. An active type requires an active parent. If both records carry
taxon links, they agree. The parent relationship organizes the catalog. Assertions, rules and
supersession remain scoped to the exact concept and their explicitly reviewed applicability.

A repeatable horticultural identity such as a growth habit or market type can be a growing type.
Planting season, growing system and harvest stage belong to claim applicability when they describe
conditions of use. Reserve `CultivarGroup` for an evidence-backed horticultural Group with a
denomination and `Cultivar` for a named cultivar. Source vocabulary and evidence remain
available through the attached references. Similar labels, shared taxonomy and comparisons
carry no scope inheritance.

## Cultivars and inheritance

A generic plant concept remains selectable without a cultivar. A cultivar references exactly one parent
plant concept and may have zero or more cultivar groups. When a cultivar is selected, Hortinis applies the
parent's accepted, profile-eligible facts and rules automatically, then includes the cultivar-scoped data.
The parent data is replaced only when a cultivar record explicitly lists the parent record in its matching
`supersedesFactIds`, `supersedesRuleIds` or other corresponding supersession field. Without that explicit
link, both records remain available; they are not merged into an invented value. A generic plant selection
does not receive cultivar-specific data.

Supersession is checked against subject ancestry and is explicit per record, not inferred from matching
predicates or timing. Consumers retain each record's provenance and context. If multiple unreplaced values
remain, Hortinis applies its product policy or abstains; the catalog does not silently choose one.

[Rotation classifications](rotation-classification.md), [harvest guidance](harvest-guidance.md),
[plant care guidance](care-guidance.md) and [pollination guidance](pollination-guidance.md)
are exact-subject facts. Consumers apply the recorded context and display each source-qualified
observation on its authored subject.

## Names

Localized names carry BCP 47 language tags and explicit preferred/alias status. A cultivar denomination is
language-neutral identity and is not automatically translated. Consumers may fall back only to an
explicitly tagged name; missing translations are reported, not invented.

## Runtime boundary

The catalog excludes garden plantings, user observations, forecasts, tasks, final recommendations and
synchronization operations. Hortinis owns those runtime data and decisions.

## Source-scoped identities and descriptions

A `crop-use-group` represents a horticultural use across species, such as winter
squash grown to maturity for storage. A `production-scope` represents a defined
system, such as a PDO program. These concepts carry their own evidence and
use their own assertion subjects. Neither has a taxon or a parent identity.
Consumers display the exact crop use or production condition and apply no
inheritance through the comparison that introduced it.

A `supplier-accession` is a supplier-qualified offering. The record preserves the
seller and trade label. Its identity does not imply that another supplier's
offering with a similar label is equivalent or that the label is a cultivar
denomination. A separate `botanical_scope` fact can name the sourced taxon.

A `botanical_scope` fact records that a cultivated subject falls within the pinned
taxon. A `taxonomic_source_usage` fact carries a particular source's name,
record identifier, accepted record and rank where supplied. It makes the
source treatment visible without claiming that a treatment of a different rank
or authority is equivalent in another backbone. A source vernacular carried
in this fact remains attributed to that source. Adding a selectable localized
crop name requires its own exact decision.

`cultivar_description` stores displayable traits on an exact cultivar. Where the
source supplies a culinary classification code, the value carries its scheme.
`plant_form_description` identifies the part being described.
`horticultural_classification` stores a source-defined distinction between
forms or uses without declaring the labels to be cultivar denominations.

`regulated_seed_eligibility` records alternative eligible seed routes. Use the
same versioned PDO context for related planting, product-quality and
postharvest assertions. The context publication date identifies the published
version. It does not compute applicability under subsequent amendments.
