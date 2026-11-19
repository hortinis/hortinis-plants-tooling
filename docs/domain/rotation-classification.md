# Rotation classification

- Status: validated

`rotation_classification` is a source-qualified descriptive assertion projected as a
`plant-fact`. Its value identifies the scheme by catalog source ID and original field
name, gives a status and retains the exact source label. The evidence reference pins
the specific release, source record, original field locator and rights decision.
Cultivation context records applicability. A consumer can display or filter crop
observations within a source scheme and release, applying the recorded context to
the exact subject. Classifications do not inherit through cultivar, growing-type
or comparison links.

| Status           | Meaning                                                         |
| ---------------- | --------------------------------------------------------------- |
| `classified`     | The source assigns the exact crop scope a category.             |
| `unknown`        | The source explicitly records that the category is unknown.     |
| `not-applicable` | The source explicitly declares the classification inapplicable. |

An absent row or blank field results in no classification assertion. Preserve the
source token for either explicit status. A source catch-all such as `Miscellaneous`
is itself a category. It cannot be converted to an unknown or an exemption.

The GROW Edible Plant Database release DOI 10.15132/10000157 labels the field
`Cultivation group (Rotational information)`. The same table has separate
`Full taxonomic name` and `Nutrient requirements` columns. The project describes
cultivation groups separately from taxonomic names and nutrient requirements.
See the [release](https://discovery.dundee.ac.uk/en/datasets/edible-plant-database/),
[Information Package, section 5.2.1](https://discovery.dundee.ac.uk/files/52250562/Attachment_0.pdf)
and [Mission Outcomes, section 3.3](https://discovery.dundee.ac.uk/files/40471956/D1.4_Mission_Outcomes.pdf).

The verified batch maps GROW `Allium`, `Brassica`, `Chenopodiaceae`, `Cucurbit`,
`Lamiaceae`, `Legume`, `Miscellaneous`, `Solanaceae` and `Umbelliferae` to
`classified` and preserves each spelling verbatim. These labels belong to the
GROW scheme even where they look like a botanical family or genus name. Other
spellings in the release, including `Brassicas`, `Solanum` and `Salad`, were
outside this batch. No synonym normalization or equivalence across schemes was
established. The full table and the selected rows contained no blank or explicit
unknown or not-applicable group values. The disputed spring-cabbage assignment
remains in the decision log.

Classification by harvested part, nutrient demand or cultivation practice is
meaningful only when the source defines that grouping. For example, RHS uses a
`Roots` grouping and provides separately specified rotation sequences. Its
groupings and sequences were used only as comparison evidence for this batch.
The GROW category field provides no sequence, return interval, pest, disease,
nutrient or companion-planting guidance. [RHS crop rotation](https://www.rhs.org.uk/vegetables/crop-rotation)

An explicit `plantingSeason` on a cultivation context narrows applicability
without specifying a planting window. For example, the GROW record for
autumn-planted onion applies to bulb onion only under the autumn-planting context.
