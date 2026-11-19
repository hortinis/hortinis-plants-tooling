# Planting and establishment guidance

- Status: validated

An `establishment_guidance` plant fact carries source-specific guidance for its
exact subject and cultivation context. The authoring profile of
`projectEstablishmentGuidance` preserves the approved fact, context ID, review ID
and evidence IDs. Consumers resolve the
context and evidence by ID. Commercial projection applies the existing
claim-level evidence, rights and geographic-context gates.

`series[].steps` is in source order. Separate series are explicitly marked
as alternatives or independent observations. A step identifies its action
and planting material. Setting can be attached to a step when propagation
and field placement differ. An unspecified setting or material carries no
default. `applicabilityPath` narrows the exact subject to the listed packet
scope from most specific to broader, when needed. A consumer should display
that qualifier with the fact and should require a match before using the
guidance for a growing type. Parent, comparison and cultivar relationships
do not transfer these facts.

Use `timing.kind` to distinguish season cues, source calendar months, intervals
relative to named events, elapsed observations from a named event and succession.
Conditions within a step apply together. Source-region seasonal cues should
remain attached to the source context. The `observation-dependent` evaluation
mode is for display, comparison or a manually confirmed reminder. The
cultivation-rule projector remains the contract for automatically evaluable
rules.

Depth and spacing are separate dimension roles. The `reference` names the
measurement point or relative basis when the source identifies it. For example,
clove cover is measured from the soil surface to the clove top, while a
bulb-height multiple stays relative to the size of that bulb. Within-row,
between-row, final-spacing and thinning measurements retain their distinct
roles. Inch values, possibly approximate metric expressions and relative
depths remain in the recorded units.

Temperature carries its medium and role on the relevant step. `strict-minimum`
means strictly above its scalar value, whereas `minimum` includes equality.
`preferred-range` and `optimum` are source preferences. `reported-germination`
and `good-germination` are source observations. `decay-risk` identifies the
reported risk boundary, with direction and context supplied in the guidance.
The same step holds a reported germination duration, its paired temperature
and any conditions. A planting threshold can carry the measurement depth.
Qualitative conditions remain text. Source differences in numeric thresholds
are retained as separate observations.

See the [batch decisions](https://github.com/hortinis/hortinis-plants/blob/HEAD/data/curation/plant-integration/reviewed-plant-establishment-decisions.md) for the exact source interpretations.
